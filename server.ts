/**
 * API Mock Server - entry point.
 *
 * Wiring only: config -> storage -> store -> HTTP. The actual logic lives in
 * src/server/* (api, state, logs, mock/*) and src/lib/ops.ts.
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { createServer as createViteServer } from 'vite';

import { loadConfig } from './src/server/config';
import { Store } from './src/server/state';
import { LogBuffer } from './src/server/logs';
import { FileStorage } from './src/server/storage/fileStorage';
import { createApp } from './src/server/app';

// Works both as ESM (tsx dev) and as the CJS production bundle (esbuild
// provides __dirname in that format; import.meta is empty there).
const __dirname =
  typeof process.argv[1] !== 'undefined' && typeof __dirname === 'undefined'
    ? path.dirname(fileURLToPath(import.meta.url))
    : typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));

async function initStorage(config: ReturnType<typeof loadConfig>) {
  // Firestore when a service account is configured; otherwise local file.
  if (config.firestore.enabled && config.firestore.serviceAccount) {
    try {
      const { getApp, getApps, initializeApp, cert } = await import('firebase-admin/app');
      const { getFirestore } = await import('firebase-admin/firestore');
      const { FirestoreStorage } = await import('./src/server/storage/firestoreStorage');

      const adminApp = getApps().length > 0 ? getApp() : initializeApp({ credential: cert(config.firestore.serviceAccount) });
      const db = config.firestore.databaseId ? getFirestore(adminApp, config.firestore.databaseId) : getFirestore(adminApp);

      console.log(
        `[Storage] Firestore (project: ${(config.firestore.serviceAccount as { project_id?: string }).project_id ?? '?'}${config.firestore.databaseId ? `, database: ${config.firestore.databaseId}` : ', database: (default)'})`
      );
      return new FirestoreStorage(db);
    } catch (err) {
      console.warn('[Storage] Firestore init failed, falling back to local file storage:', err instanceof Error ? err.message : err);
    }
  } else {
    console.log(`[Storage] Local file storage at ${config.fileStoragePath} (set FIREBASE_SERVICE_ACCOUNT_JSON to use Firestore)`);
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

  // Frontend: Vite dev middleware or static dist.
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      root: __dirname,
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(config.port, config.host, () => {
    console.log(`API Mock Server running on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
