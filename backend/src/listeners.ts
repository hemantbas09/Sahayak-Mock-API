/**
 * Per-environment mock listeners (DESIGN.md §2.1/§6, B6).
 *
 * Each environment owns an HTTP (or HTTPS) server on its configured port —
 * exactly how Mockoon desktop/CLI behaves. The ListenerManager opens/closes/
 * reloads servers as environments are created, saved, or deleted. Port
 * conflicts are surfaced (not fatal): the env stays saved but its listener
 * is marked failed with the reason, visible via /api/status and the UI.
 *
 * All request handling goes through the shared pipeline (src/pipeline.ts);
 * latency is applied here (the engine returns the requested delay).
 */
import fs from 'fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'path';
import { AddressInfo } from 'node:net';
import { Server } from 'node:net';
import { Environment } from './lib/types';
import { Store } from './state';
import { handleMockRequest, PipelineDeps, RawMockRequest } from './pipeline';
import { clampLatency } from './mock/context';

export interface ListenerStatus {
  uuid: string;
  name: string;
  port: number;
  protocol: 'http' | 'https';
  state: 'listening' | 'failed' | 'stopped';
  error?: string;
}

const MAX_BODY = 50 * 1024 * 1024; // §2.15: 50 MB body limit

export class ListenerManager {
  private servers = new Map<string, Server>();
  private statuses = new Map<string, ListenerStatus>();

  constructor(private readonly store: Store, private readonly deps: PipelineDeps) {}

  /** Open listeners for all environments (server boot). */
  async startAll(): Promise<void> {
    for (const env of this.store.list()) {
      await this.start(env).catch(() => undefined);
    }
    this.store.onChange((event, env) => {
      if (event === 'deleted') {
        void this.stop(env.uuid);
      } else {
        void this.restart(env);
      }
    });
  }

  /** Open (or reopen) the listener for one environment. Never throws. */
  async start(env: Environment): Promise<void> {
    await this.stop(env.uuid);
    const protocol = env.tlsOptions.enabled ? 'https' : 'http';
    try {
      let tlsOptions: { cert: Buffer; key: Buffer } | null = null;
      if (env.tlsOptions.enabled) {
        const cert = await fs.readFile(path.resolve(this.deps.dataDir, env.tlsOptions.certPath || ''));
        const key = await fs.readFile(path.resolve(this.deps.dataDir, env.tlsOptions.keyPath || ''));
        tlsOptions = { cert, key };
      }
      const server = this.buildServer(env, protocol, tlsOptions);
      server.listen(env.port);
      await new Promise<void>((resolve, reject) => {
        server.once('listening', () => resolve());
        server.once('error', reject);
      });
      this.servers.set(env.uuid, server);
      this.statuses.set(env.uuid, {
        uuid: env.uuid,
        name: env.name,
        port: env.port,
        protocol,
        state: 'listening',
      });
      console.log(`[Listener] ${env.name} (${env.uuid}) on ${protocol}://localhost:${env.port}`);
    } catch (err) {
      const reason = describeErr(err);
      this.statuses.set(env.uuid, {
        uuid: env.uuid,
        name: env.name,
        port: env.port,
        protocol,
        state: 'failed',
        error: reason,
      });
      console.warn(`[Listener] ${env.name} (${env.uuid}) failed on port ${env.port}: ${reason}`);
    }
  }

  private async restart(env: Environment): Promise<void> {
    const existing = this.servers.get(env.uuid);
    const status = this.statuses.get(env.uuid);
    // Only restart servers that were previously healthy; leave stopped ones alone.
    if (existing || status?.state !== 'stopped') {
      await this.start(env);
    }
  }

  async stop(uuid: string): Promise<void> {
    const server = this.servers.get(uuid);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      this.servers.delete(uuid);
    }
    const status = this.statuses.get(uuid);
    if (status) status.state = 'stopped';
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((uuid) => this.stop(uuid)));
    this.statuses.clear();
  }

  status(): ListenerStatus[] {
    return this.store.list().map((env) => {
      return (
        this.statuses.get(env.uuid) ?? {
          uuid: env.uuid,
          name: env.name,
          port: env.port,
          protocol: env.tlsOptions.enabled ? 'https' : 'http',
          state: 'stopped' as const,
        }
      );
    });
  }

  private buildServer(
    env: Environment,
    protocol: 'http' | 'https',
    tlsOptions?: { cert: Buffer; key: Buffer } | null
  ): Server {
    const manager = this;
    const requestHandler = async (
      req: http.IncomingMessage,
      res: http.ServerResponse
    ): Promise<void> => {
      const raw = await readRawRequest(req);
      const engineResponse = await handleMockRequest(env, raw, manager.deps);

      const latency = clampLatency(engineResponse.latencyMs);
      const respond = (): void => {
        res.writeHead(engineResponse.statusCode, engineResponse.headers);
        res.end(engineResponse.body);
      };
      if (latency > 0) {
        setTimeout(respond, latency);
      } else {
        respond();
      }
    };

    const server =
      protocol === 'https'
        ? https.createServer({ cert: tlsOptions?.cert, key: tlsOptions?.key }, (req, res) => {
            requestHandler(req, res).catch((err) => {
              console.error('[Listener] request error:', err);
              if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Internal mock server error' }));
            });
          })
        : http.createServer((req, res) => {
            requestHandler(req, res).catch((err) => {
              console.error('[Listener] request error:', err);
              if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Internal mock server error' }));
            });
          });

    server.keepAliveTimeout = 65000;
    return server;
  }
}

async function readRawRequest(req: http.IncomingMessage): Promise<RawMockRequest> {
  const chunks: Buffer[] = [];
  let size = 0;
  let oversized = false;
  const rawBody = await new Promise<string>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        oversized = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(oversized ? '' : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }

  return {
    method: req.method ?? 'GET',
    url: req.url ?? '/',
    headers,
    rawBody,
    ip: req.socket.remoteAddress ?? '',
    hostname: headers.host ?? '',
  };
}

function describeErr(err: unknown): string {
  if (err instanceof Error) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') return 'port already in use';
    if ((err as NodeJS.ErrnoException).code === 'EACCES') return 'permission denied (port < 1024?)';
    return err.message;
  }
  return String(err);
}

export type { AddressInfo };
