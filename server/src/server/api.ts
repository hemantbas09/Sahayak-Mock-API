/**
 * HTTP layer: configuration API, logs API, and the mock endpoint.
 * All the interesting logic lives in state.ts / mock/ - this module only
 * translates between HTTP and the domain.
 */
import express from 'express';
import { NextFunction, Request, Response } from 'express';
import { Op, OPS_PROTOCOL_VERSION } from '../lib/ops';
import { Store } from './state';
import { LogBuffer } from './logs';
import {
  buildPreflightHeaders,
  findEnvironment,
  resolveMockResponse,
} from './mock/responder';

const ALLOWED_OP_TYPES = new Set([
  'env.upsert', 'env.delete', 'env.reorder',
  'route.upsert', 'route.delete', 'route.reorder',
  'response.upsert', 'response.delete', 'response.reorder',
]);

function isValidOpsPayload(body: unknown): body is { version: number; ops: Op[] } {
  if (!body || typeof body !== 'object') return false;
  const payload = body as { version?: unknown; ops?: unknown };
  if (!Array.isArray(payload.ops)) return false;
  return payload.ops.every((op) => op && typeof op === 'object' && typeof (op as { type?: unknown }).type === 'string' && ALLOWED_OP_TYPES.has((op as { type: string }).type));
}

export function createApiRouter(store: Store, logs: LogBuffer): express.Router {
  const router = express.Router();

  // Current configuration snapshot (what the server is serving right now).
  router.get('/environments', (_req, res) => {
    res.json(store.list());
  });

  // Persist a batch of operations. Only the changed entities arrive here.
  router.post('/environments', async (req, res) => {
    const payload = req.body;
    if (!isValidOpsPayload(payload)) {
      return res.status(400).json({
        error: 'Invalid ops payload. Expected { version, ops: [...] } with op types ' + [...ALLOWED_OP_TYPES].join(', '),
      });
    }
    if (payload.version !== OPS_PROTOCOL_VERSION) {
      return res.status(400).json({
        error: `Unsupported ops protocol version ${payload.version} (server expects ${OPS_PROTOCOL_VERSION})`,
      });
    }

    try {
      const applied = await store.applyOps(payload.ops);
      res.json({ success: true, applied });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[API] Failed to apply ops:', err);
      res.status(400).json({ error: `Failed to apply operations: ${message}` });
    }
  });

  // Logs.
  router.get('/logs', (_req, res) => {
    res.json(logs.list());
  });

  router.delete('/logs', (_req, res) => {
    logs.clear();
    res.json({ success: true });
  });

  return router;
}

/**
 * The mock endpoint: /mock/:envId/*
 */
export function createMockHandler(store: Store, logs: LogBuffer) {
  return async function handleMockRequest(req: Request, res: Response, _next: NextFunction): Promise<void> {
    const startedAt = Date.now();
    const envId = req.params.envId;

    const env = findEnvironment(store.list(), envId);
    if (!env) {
      const body = `Mock environment with ID or slug "${envId}" not found.`;
      logs.record(
        LogBuffer.buildEntry({
          envId,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          headers: req.headers,
          query: req.query,
          body: req.body,
          responseStatus: 404,
          responseHeaders: { 'Content-Type': 'text/plain' },
          responseBody: body,
          matchedRoute: 'None (Unknown environment)',
          latencyMs: Date.now() - startedAt,
        })
      );
      res.status(404).send(body);
      return;
    }

    // CORS preflight is answered automatically for every environment.
    if (req.method.toLowerCase() === 'options') {
      const headers = buildPreflightHeaders(env);
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      res.status(204).end();
      return;
    }

    const rawPath = req.params[0] || '';
    const resolved = resolveMockResponse(env, {
      method: req.method,
      path: rawPath,
      query: req.query,
      body: req.body,
      headers: req.headers,
    });

    // Diagnostics for 404/405 (kept identical in shape to the legacy server).
    if (resolved.kind === 'not_found') {
      logs.record(
        LogBuffer.buildEntry({
          envId,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          headers: req.headers,
          query: req.query,
          body: req.body,
          responseStatus: resolved.statusCode,
          responseHeaders: { 'Content-Type': 'text/plain' },
          responseBody: resolved.body,
          matchedRoute: resolved.matchedRoute,
          latencyMs: Date.now() - startedAt,
        })
      );
      res.status(resolved.statusCode).send(resolved.body);
      return;
    }

    if (resolved.kind === 'method_mismatch') {
      const headers = { ...resolved.headers };
      headers['X-Mock-Method-Fallback'] = 'true';
      headers['X-Mock-Warning'] = resolved.warning;
      logs.record(
        LogBuffer.buildEntry({
          envId,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          headers: req.headers,
          query: req.query,
          body: req.body,
          responseStatus: resolved.statusCode,
          responseHeaders: headers,
          responseBody: resolved.body,
          matchedRoute: resolved.matchedRoute,
          latencyMs: Date.now() - startedAt,
          warning: resolved.warning,
        })
      );
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      res.status(resolved.statusCode).send(resolved.body);
      return;
    }

    if (resolved.kind === 'validation_failed') {
      logs.record(
        LogBuffer.buildEntry({
          envId,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          headers: req.headers,
          query: req.query,
          body: req.body,
          responseStatus: resolved.statusCode,
          responseHeaders: resolved.headers,
          responseBody: resolved.body,
          matchedRoute: resolved.matchedRoute,
          latencyMs: Date.now() - startedAt,
          warning: 'Payload validation failed',
        })
      );
      for (const [key, value] of Object.entries(resolved.headers)) res.setHeader(key, value);
      res.status(resolved.statusCode).send(resolved.body);
      return;
    }

    // Normal mock response (with optional latency simulation).
    const delay = resolved.delayMs;

    const send = () => {
      const latencyMs = Date.now() - startedAt;
      for (const [key, value] of Object.entries(resolved.headers)) res.setHeader(key, value);
      logs.record(
        LogBuffer.buildEntry({
          envId,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
          headers: req.headers,
          query: req.query,
          body: req.body,
          responseStatus: resolved.statusCode,
          responseHeaders: resolved.headers,
          responseBody: resolved.body,
          matchedRoute: resolved.matchedRoute,
          latencyMs,
          warning: resolved.warnings.length > 0 ? resolved.warnings.join(' | ') : undefined,
        })
      );
      res.status(resolved.statusCode).send(resolved.body);
    };

    if (delay > 0) {
      setTimeout(send, delay);
    } else {
      send();
    }
  };
}
