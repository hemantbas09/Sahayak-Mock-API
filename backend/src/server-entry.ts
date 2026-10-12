/**
 * Sahayak server - entry point.
 *
 * Wiring only: config -> storage (MongoDB, file fallback) -> store -> HTTP.
 * All logic lives in src/server/* (api, state, logs, mock/*, storage/*) and
 * src/lib/ops.ts. The mock engine is pure and shared-logic; see DESIGN.md.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';

import { loadConfig } from './server/config';
import { Store } from './server/state';
import { LogBuffer } from './server/logs';
import { FileStorage } from './server/storage/fileStorage';
import { createApp } from './server/app';

async function initStorage(config: ReturnType<typeof loadConfig>) {
  if (config.mongoUri) {
    try {
      // Dynamic imports so a missing/broken mongoose never blocks file mode.
      const { connectMongo, maskMongoUri } = await import('./db/mongodb');
      const { MongoStorage } = await import('./server/storage/mongoStorage');
      const conn = await connectMongo(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log(`[Storage] MongoDB at ${maskMongoUri(config.mongoUri)}`);
      return new MongoStorage(conn);
    } catch (err) {
      console.warn(
        '[Storage] MongoDB connection failed, falling back to local file storage:',
        err instanceof Error ? err.message : err
      );
    }
  } else {
    console.log(`[Storage] Local file storage at ${config.fileStoragePath} (set MONGODB_URI to use MongoDB)`);
  }
  return new FileStorage(config.fileStoragePath);
}

async function main() {
  const config = loadConfig();
  const store = new Store();
  const logs = new LogBuffer();

  const storage = await initStorage(config);
  store.setStorage(storage);
  await store.load();
  console.log(`[Store] Loaded ${store.list().length} environment(s) from ${storage.name} storage`);

  const app = createApp(store, logs, storage.name);

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
    console.log(`  API:   http://localhost:${config.port}/api/status`);
    console.log(`  Mocks: http://localhost:${config.port}/mock/<environment>/<path>`);
  });
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
