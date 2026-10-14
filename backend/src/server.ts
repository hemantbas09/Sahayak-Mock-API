/**
 * Sahayak server — entry point (DESIGN.md §4.1: wiring only).
 *
 * config → storage (MongoDB, file fallback) → store → logs → listeners →
 * HTTP (config API + auth + static frontend + optional path routing).
 * All logic lives in src/{api,auth,config,listeners,logs,pipeline,state,
 * storage,db,mock} — this file only connects them.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

import { loadConfig } from './config';
import { Store } from './state';
import { LogService } from './logs';
import { ListenerManager } from './listeners';
import { MongoStorage } from './storage/mongoStorage';
import { FileStorage } from './storage/fileStorage';
import { StorageBackend } from './storage/index';
import { createApiRouter, createAuthRouter, ensureSeedUser } from './api';
import { handleMockRequest, PipelineDeps } from './pipeline';

async function initStorage(config: ReturnType<typeof loadConfig>): Promise<StorageBackend> {
  if (config.mongoUri) {
    try {
      // Dynamic imports so a missing mongoose never blocks file mode.
      const { connectMongo, maskMongoUri } = await import('./db/mongodb');
      const conn = await connectMongo(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
      const storage = new MongoStorage(conn);
      await storage.init();
      console.log(`[Storage] MongoDB at ${maskMongoUri(config.mongoUri)}`);
      return storage;
    } catch (err) {
      console.warn(
        '[Storage] MongoDB connection failed, falling back to local file storage:',
        err instanceof Error ? err.message : err
      );
    }
  } else {
    console.log(`[Storage] Local file storage at ${config.dataDir} (set MONGODB_URI to use MongoDB)`);
  }
  const storage = new FileStorage(config.dataDir);
  await storage.init();
  return storage;
}

async function main() {
  const config = loadConfig();

  const store = new Store();
  const storage = await initStorage(config);
  store.setStorage(storage);
  await store.load();
  console.log(`[Store] Loaded ${store.list().length} environment(s) from ${storage.name} storage`);

  const logs = new LogService(storage);

  if (config.authEnabled && config.seedAdmin) {
    await ensureSeedUser(storage, config.seedAdmin);
  }

  const deps: PipelineDeps = { store, logs, dataDir: config.filesDir };
  const listeners = new ListenerManager(store, deps);
  await listeners.startAll();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));

  const apiDeps = {
    store,
    storage,
    logs,
    listeners,
    auth: { enabled: config.authEnabled, secret: config.jwtSecret },
    allowedOrigins: config.appUrls,
  };

  app.use('/api/auth', createAuthRouter(apiDeps));
  app.use('/api', createApiRouter(apiDeps));

  // Helper to resolve environment by endpointPrefix, name slug, exact name, or uuid
  function resolveEnvironment(identifier: string): import('./lib/types').Environment | null {
    const clean = identifier.toLowerCase().replace(/^\/+|\/+$/g, '');
    if (!clean) return null;
    const envs = store.list();
    for (const env of envs) {
      const p = (env.endpointPrefix || '').toLowerCase().replace(/^\/+|\/+$/g, '');
      if (p && p === clean) return env;
    }
    for (const env of envs) {
      const slug = env.name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (slug && slug === clean) return env;
    }
    for (const env of envs) {
      if (env.name.toLowerCase() === clean) return env;
    }
    for (const env of envs) {
      if (env.uuid.toLowerCase() === clean) return env;
    }
    return null;
  }

  async function dispatchMock(env: import('./lib/types').Environment, req: express.Request, res: express.Response, urlOverride?: string) {
    try {
      const raw = await readBody(req);
      if (urlOverride) {
        raw.url = urlOverride;
      }
      const response = await handleMockRequest(env, raw, deps);
      const wait = Math.min(60000, Math.max(0, response.latencyMs));
      setTimeout(() => {
        res.writeHead(response.statusCode, response.headers);
        res.end(response.body);
      }, wait);
    } catch (err) {
      res.status(500).json({ error: 'Mock processing error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  // 1. Explicit path routing: ANY /mock/:envId/* on the main port
  app.all('/mock/:envId/*', (req, res) => {
    const env = resolveEnvironment(req.params.envId);
    if (!env) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    const prefixToStrip = `/mock/${req.params.envId}`;
    let remainingUrl = req.url.slice(prefixToStrip.length) || '/';
    if (env.endpointPrefix) {
      const normPrefix = env.endpointPrefix.startsWith('/') ? env.endpointPrefix : `/${env.endpointPrefix}`;
      remainingUrl = normPrefix + (remainingUrl.startsWith('/') ? remainingUrl : `/${remainingUrl}`);
    }
    void dispatchMock(env, req, res, remainingUrl);
  });

  // 2. Direct path routing: when deployed, /bankxp/account/password -> routes to BankXP environment
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/mock')) {
      return next();
    }
    if (req.method === 'GET' && /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map)$/i.test(req.path)) {
      return next();
    }
    if (req.method === 'GET' && (req.path === '/' || req.path === '/environments' || req.path === '/login')) {
      return next();
    }

    const segments = req.path.split('/').filter(Boolean);
    if (segments.length > 0) {
      const firstSegment = segments[0];
      const env = resolveEnvironment(firstSegment);
      if (env) {
        let targetUrl = req.url;
        const cleanPrefix = (env.endpointPrefix || '').toLowerCase().replace(/^\/+|\/+$/g, '');
        if (!cleanPrefix || cleanPrefix !== firstSegment.toLowerCase()) {
          const rest = '/' + segments.slice(1).join('/');
          const queryIdx = req.url.indexOf('?');
          const query = queryIdx !== -1 ? req.url.slice(queryIdx) : '';
          targetUrl = rest + query;
        }
        void dispatchMock(env, req, res, targetUrl);
        return;
      }
    }

    next();
  });

  // Serve the built Angular app when FRONTEND_DIST points at it (production).
  if (config.frontendDist) {
    const distPath = path.resolve(config.frontendDist);
    const indexHtml = path.join(distPath, 'index.html');
    if (fs.existsSync(indexHtml)) {
      app.use(express.static(distPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/mock')) return next();
        res.sendFile(indexHtml);
      });
      console.log(`[Static] Serving frontend from ${distPath}`);
    } else {
      console.warn(`[Static] FRONTEND_DIST set but ${indexHtml} not found - skipping static serving`);
    }
  }

  app.listen(config.port, config.host, () => {
    console.log(`Sahayak server running on http://localhost:${config.port}`);
    console.log(`  Config API: http://localhost:${config.port}/api/status`);
    console.log(`  Path route: http://localhost:${config.port}/<prefix>/<path> or /mock/<env>/<path>`);
    for (const s of listeners.status()) {
      if (s.state === 'listening') {
        console.log(`  Mock:       ${s.protocol}://localhost:${s.port}/  (${s.name})`);
      }
    }
  });
}

import { IncomingMessage } from 'node:http';

/** Collect the request body + headers for the path-routed handler. */
function readBody(req: IncomingMessage): Promise<import('./pipeline').RawMockRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
      }
      resolve({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers,
        rawBody: Buffer.concat(chunks).toString('utf8'),
        ip: req.socket.remoteAddress ?? '',
        hostname: headers.host ?? '',
      });
    });
    req.on('error', reject);
  });
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
