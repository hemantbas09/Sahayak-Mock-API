/**
 * Express app factory. Kept separate from server.ts so it can be unit/E2E
 * tested without the Vite dev server or port binding.
 */
import express from 'express';
import { Store } from './state';
import { LogBuffer } from './logs';
import { createApiRouter, createMockHandler } from './api';

export function createApp(store: Store, logs: LogBuffer, storageName: string): express.Express {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Configuration + logs API.
  app.use('/api', createApiRouter(store, logs));

  // Health / status.
  app.get('/api/status', (_req, res) => {
    res.json({
      ok: true,
      storage: storageName,
      environments: store.list().length,
    });
  });

  // Mock endpoints: /mock/:envId/anything
  app.all('/mock/:envId/*', createMockHandler(store, logs));
  app.all('/mock/:envId', createMockHandler(store, logs));

  return app;
}
