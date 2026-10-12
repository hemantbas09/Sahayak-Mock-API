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

  // Optional path routing: ANY /mock/:uuid/* on the main port (§6, fallback
  // for restricted networks where per-env ports are impractical).
  if (config.pathRouting) {
    app.all('/mock/:uuid/*', (req, res) => {
      const env = store.get(req.params.uuid);
      if (!env) {
        res.status(404).json({ error: 'Environment not found' });
        return;
      }
      // Serve immediately (no latency wait on the path-routed convenience path
      // would surprise clients — latency is still simulated via the engine).
      void (async () => {
        const raw = await readBody(req);
        const response = await handleMockRequest(env, raw, deps);
        const wait = Math.min(60000, Math.max(0, response.latencyMs));
        setTimeout(() => {
          res.writeHead(response.statusCode, response.headers);
          res.end(response.body);
        }, wait);
      })();
    });
  }

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
    if (config.pathRouting) console.log(`  Path route: http://localhost:${config.port}/mock/<uuid>/<path>`);
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
