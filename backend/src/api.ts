/**
 * Configuration REST API (DESIGN.md §6, B7).
 *
 * Two routers:
 *  - createAuthRouter: /api/auth/* (login public, /me + user mgmt role-checked)
 *  - createApiRouter:  everything else under /api (auth + role-checked)
 *
 * Saves are whole-document, version-locked (§4.3): PUT returns 409 with a
 * clear conflict message when the client's version is stale.
 */
import { randomUUID } from 'node:crypto';
import { Router, json, urlencoded } from 'express';
import multer from 'multer';
import { Environment, User, UserRole } from './lib/types';
import { Store } from './state';
import { LogService } from './logs';
import { StorageBackend } from './storage/index';
import {
  apiCors,
  authMiddleware,
  hashPassword,
  requireRole,
  signToken,
  verifyPassword,
  AuthConfig,
} from './auth';
import { ListenerManager } from './listeners';
import { toMockoonExport, fromMockoonImport } from './storage/index';
import { render, createRenderContext } from './mock/templating';
import { createEnvRuntime } from './mock/context';

export interface ApiDeps {
  store: Store;
  storage: StorageBackend;
  logs: LogService;
  listeners: ListenerManager;
  auth: AuthConfig;
  allowedOrigins: string[];
}

/** Create the seed admin (username/password) if not already created. */
export async function ensureSeedUser(storage: StorageBackend, seed: { email: string; password: string }): Promise<void> {
  if (!seed.email || !seed.password) return;
  const existing = await storage.listUsers();
  const found = existing.find((u) => u.email.toLowerCase() === seed.email.toLowerCase());
  if (!found) {
    await storage.createUser({
      email: seed.email,
      passwordHash: await hashPassword(seed.password),
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    console.log(`[Auth] Seeded admin user ${seed.email}`);
  }
}

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router();
  const { store, logs, listeners, auth, storage } = deps;

  router.use(json({ limit: '50mb' }));
  router.use(urlencoded({ extended: true, limit: '50mb' }));
  router.use(apiCors(deps.allowedOrigins));

  const authMw = authMiddleware(auth, auth.secret);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  // --- environment CRUD ---

  router.get('/environments', authMw, requireRole('viewer'), (req, res) => {
    const statuses = listeners.status();
    const summaries = store.list().map((e) => ({
      uuid: e.uuid,
      name: e.name,
      port: e.port,
      endpointPrefix: e.endpointPrefix,
      routeCount: e.routes.length,
      version: e.version,
      listener: statuses.find((s) => s.uuid === e.uuid)?.state ?? 'stopped',
    }));
    res.json(summaries);
  });

  router.get('/environments/:uuid', authMw, requireRole('viewer'), (req, res) => {
    const env = store.get(req.params.uuid);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    res.json(env);
  });

  router.post('/environments', authMw, requireRole('editor'), async (req, res) => {
    const doc = normalizeEnvironmentInput(req.body);
    if (!doc) {
      res.status(400).json({ error: 'Invalid environment document' });
      return;
    }
    if (await portTaken(store, doc.uuid, doc.port)) {
      res.status(409).json({ error: `Port ${doc.port} is already used by another environment` });
      return;
    }
    const result = await store.createEnvironment(doc);
    if (!result.ok) {
      res.status(result.error === 'conflict' ? 409 : 500).json({ error: result.message ?? result.error });
      return;
    }
    res.status(201).json({ success: true, uuid: doc.uuid, version: result.version });
  });

  router.put('/environments/:uuid', authMw, requireRole('editor'), async (req, res) => {
    const uuid = req.params.uuid;
    const body = req.body as { version?: number; environment?: Partial<Environment> };
    if (typeof body?.version !== 'number' || !body.environment) {
      res.status(400).json({ error: 'Expected { version, environment }' });
      return;
    }
    const current = store.get(uuid);
    if (!current) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    const incoming: Environment = { ...current, ...body.environment, uuid };
    if (await portTaken(store, uuid, incoming.port)) {
      res.status(409).json({ error: `Port ${incoming.port} is already used by another environment` });
      return;
    }
    const result = await store.saveEnvironment(uuid, body.version, incoming);
    if (result.ok) {
      res.json({ success: true, version: result.version, needsListenerRestart: result.needsListenerRestart });
      return;
    }
    if (result.error === 'conflict') {
      res.status(409).json({ error: 'conflict', message: result.message, serverVersion: result.version });
      return;
    }
    if (result.error === 'not-found') {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    res.status(500).json({ error: result.message ?? 'Persistence failed' });
  });

  router.delete('/environments/:uuid', authMw, requireRole('editor'), async (req, res) => {
    const result = await store.deleteEnvironment(req.params.uuid);
    res.status(result.ok ? 200 : result.error === 'not-found' ? 404 : 500).json(result.ok ? { success: true } : { error: result.error });
  });

  router.post('/environments/:uuid/duplicate', authMw, requireRole('editor'), async (req, res) => {
    const result = await store.duplicateEnvironment(req.params.uuid, randomUUID());
    if (!result.ok) {
      res.status(result.error === 'not-found' ? 404 : result.error === 'conflict' ? 409 : 500).json({
        error: result.message ?? result.error,
      });
      return;
    }
    res.status(201).json({ success: true, version: result.version });
  });

  // --- listener start / stop (Active vs Paused toggle) ---

  router.post('/environments/:uuid/start', authMw, requireRole('editor'), async (req, res) => {
    const env = store.get(req.params.uuid);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    await listeners.start(env);
    const status = listeners.status().find((s) => s.uuid === env.uuid);
    if (status?.state === 'failed') {
      res.status(409).json({
        error: status.error || `Port ${env.port} is already in use or unavailable`,
        status,
      });
      return;
    }
    res.json({ success: true, status });
  });

  router.post('/environments/:uuid/stop', authMw, requireRole('editor'), async (req, res) => {
    const env = store.get(req.params.uuid);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    await listeners.stop(env.uuid);
    const status = listeners.status().find((s) => s.uuid === env.uuid);
    res.json({ success: true, status });
  });

  // --- import / export ---

  router.post('/import', authMw, requireRole('editor'), upload.single('file'), async (req, res) => {
    try {
      let raw: string | undefined;
      if (req.file?.buffer) raw = req.file.buffer.toString('utf8');
      else if (typeof req.body?.file === 'string') raw = req.body.file;
      else raw = JSON.stringify(req.body ?? {});

      const envs = parseImportFile(raw ?? '');
      if (envs.length === 0) {
        res.status(400).json({ error: 'No environments found (expected Mockoon JSON or OpenAPI v3)' });
        return;
      }
      const created: { uuid: string; name: string; portConflict: boolean }[] = [];
      for (const env of envs) {
        const targetUuid = store.get(env.uuid) ? randomUUID() : env.uuid;
        const envToCreate: Environment = {
          ...env,
          uuid: targetUuid,
        };
        const conflict = await portTaken(store, envToCreate.uuid, envToCreate.port);
        const result = await store.createEnvironment(envToCreate);
        if (result.ok) created.push({ uuid: envToCreate.uuid, name: envToCreate.name, portConflict: conflict });
      }
      res.status(201).json({ success: true, imported: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  router.get('/environments/:uuid/export', authMw, requireRole('viewer'), (req, res) => {
    const env = store.get(req.params.uuid);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${slug(env.name)}.mockoon.json"`);
    res.json({ application: 'mockoon', date: new Date().toISOString(), data: [toMockoonExport(env)] });
  });

  // --- preview template (F10 helper) ---

  router.post('/environments/:uuid/preview-template', authMw, requireRole('editor'), (req, res) => {
    const env = store.get(req.params.uuid);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    const { template, sample } = req.body as { template?: string; sample?: Record<string, unknown> };
    if (typeof template !== 'string') {
      res.status(400).json({ error: 'Expected { template }' });
      return;
    }
    const ctx = createRenderContext({
      env,
      runtime: createEnvRuntime(env),
      cookies: (sample?.cookies as Record<string, string>) ?? {},
      params: (sample?.params as Record<string, string>) ?? {},
    });
    const result = render(template, ctx);
    res.json({ output: result.output, warnings: result.warnings });
  });

  // --- logs ---

  router.get('/logs', authMw, requireRole('viewer'), async (req, res) => {
    const envUuid = typeof req.query.env === 'string' ? req.query.env : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json(await logs.read(envUuid, limit));
  });

  router.delete('/logs', authMw, requireRole('admin'), async (_req, res) => {
    await logs.clear();
    res.json({ success: true });
  });

  // --- status (public health check) ---

  router.get('/status', (_req, res) => {
    res.json({
      ok: true,
      storage: storage.name,
      environments: store.list().length,
      listeners: listeners.status(),
    });
  });

  void storage; // users live on storage; used by the auth router
  return router;
}

/** Auth routes: login public, /me + user management role-checked (§2.7). */
export function createAuthRouter(deps: ApiDeps): Router {
  const router = Router();
  const { auth, storage } = deps;
  router.use(json({ limit: '1mb' }));

  router.post('/login', async (req, res) => {
    const identifier = ((req.body as { username?: string; email?: string }).username || (req.body as { username?: string; email?: string }).email)?.trim();
    const password = (req.body as { password?: string }).password;
    if (!identifier || !password) {
      res.status(400).json({ error: 'Expected username and password' });
      return;
    }
    const user = await storage.getUserByEmail(identifier);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const token = signToken({ email: user.email, role: user.role }, auth.secret);
    res.json({ token, user: { username: user.email, email: user.email, role: user.role } });
  });

  router.get('/me', authMiddleware(auth, auth.secret), (req, res) => {
    res.json({ username: req.user?.email, email: req.user?.email, role: req.user?.role });
  });

  router.get('/users', authMiddleware(auth, auth.secret), requireRole('admin'), async (_req, res) => {
    const users = await storage.listUsers();
    res.json(users.map(({ passwordHash: _p, ...rest }) => rest));
  });

  router.post('/users', authMiddleware(auth, auth.secret), requireRole('admin'), async (req, res) => {
    const { email, password, role } = req.body as { email?: string; password?: string; role?: UserRole };
    if (!email || !password || !role || !['admin', 'editor', 'viewer'].includes(role)) {
      res.status(400).json({ error: 'Expected { email, password, role: admin|editor|viewer }' });
      return;
    }
    try {
      await storage.createUser({ email, passwordHash: await hashPassword(password), role, createdAt: new Date().toISOString() });
      res.status(201).json({ success: true });
    } catch {
      res.status(409).json({ error: 'User already exists' });
    }
  });

  router.delete('/users/:email', authMiddleware(auth, auth.secret), requireRole('admin'), async (req, res) => {
    await storage.removeUser(req.params.email);
    res.json({ success: true });
  });

  return router;
}

// ---------------------------------------------------------------- helpers

async function portTaken(store: Store, selfUuid: string, port: number): Promise<boolean> {
  if (!port) return false;
  return store.list().some((e) => e.uuid !== selfUuid && e.port === port);
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'environment';
}

/** Accept a loose environment document; fill Mockoon defaults. */
function normalizeEnvironmentInput(body: unknown): Environment | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Partial<Environment>;
  const uuid = typeof raw.uuid === 'string' && raw.uuid ? raw.uuid : randomUUID();
  try {
    return fromMockoonImport({ ...raw, uuid });
  } catch {
    return null;
  }
}

/** Parse a Mockoon JSON file or an OpenAPI v3 document into environments. */
export function parseImportFile(raw: string): Environment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON');
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    // Mockoon file: { application: 'mockoon', data: [envs] }
    if (obj.application === 'mockoon' && Array.isArray(obj.data)) {
      return (obj.data as unknown[]).map(fromMockoonImport);
    }
    // Bare array of environments
    if (Array.isArray(parsed)) {
      return (parsed as unknown[]).map(fromMockoonImport);
    }
    // Single environment document
    if (typeof obj.uuid === 'string') {
      return [fromMockoonImport(parsed)];
    }
    // OpenAPI v3: { openapi: '3.x', paths: {...} }
    if (typeof obj.openapi === 'string' && obj.openapi.startsWith('3') && obj.paths) {
      return [openApiToEnvironment(obj)];
    }
  }
  return [];
}

/** Minimal OpenAPI v3 → environment (paths → routes, schemas/examples → INLINE bodies). */
function openApiToEnvironment(doc: Record<string, unknown>): Environment {
  const info = (doc.info ?? {}) as { title?: string };
  const routes: Environment['routes'] = [];
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;

  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(operations)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      const operation = op as { operationId?: string; description?: string; responses?: Record<string, unknown> };
      const ok = Object.entries(operation.responses ?? {}).find(([code]) => code.startsWith('2'))?.[1] as
        | { content?: Record<string, { schema?: unknown; example?: unknown }> }
        | undefined;
      const example = ok?.content?.['application/json']?.example ?? ok?.content?.['application/json']?.schema;
      const body = example === undefined ? '' : typeof example === 'string' ? example : JSON.stringify(example, null, 2);
      routes.push({
        uuid: randomUUID(),
        type: 'http',
        method: method as Environment['routes'][number]['method'],
        endpoint: path,
        documentation: operation.description ?? operation.operationId ?? '',
        responseMode: null,
        responses: [
          {
            uuid: randomUUID(),
            label: 'Default',
            statusCode: 200,
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            latency: 0,
            bodyType: 'INLINE',
            body,
            filePath: '',
            databucketId: '',
            rules: [],
            rulesOperator: 'AND',
            defaultResponse: true,
          },
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      });
    }
  }

  return {
    uuid: randomUUID(),
    name: info.title ?? 'Imported OpenAPI',
    port: 0,
    endpointPrefix: '',
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes,
    data: [],
    version: 1,
  };
}

export type { User };
