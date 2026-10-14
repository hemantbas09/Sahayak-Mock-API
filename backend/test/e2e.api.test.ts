import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { Store } from '../src/state';
import { LogService } from '../src/logs';
import { ListenerManager } from '../src/listeners';
import { FileStorage } from '../src/storage/fileStorage';
import { createApiRouter, createAuthRouter } from '../src/api';
import { Environment } from '../src/lib/types';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sahayak-api-'));
const storage = new FileStorage(tmp);
await storage.init();
const store = new Store();
store.setStorage(storage);
await store.load();
const logs = new LogService(storage);
const listeners = new ListenerManager(store, { store, logs, dataDir: tmp });
const app = express();
app.use(express.json());
const apiDeps = {
  store,
  storage,
  logs,
  listeners,
  auth: { enabled: true, secret: 'test-secret' },
  allowedOrigins: [],
};
app.use('/api/auth', createAuthRouter(apiDeps));
app.use('/api', createApiRouter(apiDeps));

const ADMIN = { email: 'admin@test.local', password: 'admin-pass' };
let adminToken: string;

function envFixture(over: Partial<Environment> = {}): Environment {
  const respUuid = 'resp-1';
  return {
    uuid: 'env-test',
    name: 'Test Env',
    port: 3999,
    endpointPrefix: '/api',
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [
      {
        uuid: 'route-1',
        type: 'http',
        method: 'get',
        endpoint: 'ping',
        documentation: '',
        responseMode: null,
        responses: [
          {
            uuid: respUuid,
            label: 'ok',
            statusCode: 200,
            headers: [{ key: 'Content-Type', value: 'application/json' }],
            latency: 0,
            bodyType: 'INLINE',
            body: '{"pong":true}',
            filePath: '',
            databucketId: '',
            rules: [],
            rulesOperator: 'AND',
            defaultResponse: true,
          },
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      },
    ],
    data: [],
    version: 1,
    ...over,
  };
}

beforeAll(async () => {
  // Seed admin directly (no ensureSeedUser call in this harness).
  const { hashPassword } = await import('../src/auth');
  await storage.createUser({
    email: ADMIN.email,
    passwordHash: await hashPassword(ADMIN.password),
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  await listeners.stopAll();
  await fs.rm(tmp, { recursive: true, force: true });
});

async function login() {
  const res = await request(app).post('/api/auth/login').send(ADMIN);
  adminToken = res.body.token;
  return adminToken;
}

describe('config API', () => {
  it('rejects /api without a token (401)', async () => {
    const res = await request(app).get('/api/environments');
    expect(res.status).toBe(401);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(ADMIN.email);
    expect(res.body.user.role).toBe('admin');
  });

  it('rejects login with a wrong password (401)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('lists environments (empty at first)', async () => {
    await login();
    const res = await request(app).get('/api/environments').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('creates an environment (201)', async () => {
    const res = await request(app)
      .post('/api/environments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(envFixture());
    expect(res.status).toBe(201);
    expect(res.body.uuid).toBe('env-test');
    expect(res.body.version).toBe(1);
  });

  it('reads back the created environment', async () => {
    const res = await request(app)
      .get('/api/environments/env-test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Test Env');
    expect(res.body.routes).toHaveLength(1);
  });

  it('saves with the matching version (200, version bumped)', async () => {
    const res = await request(app)
      .put('/api/environments/env-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: 1, environment: { name: 'Renamed' } });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
  });

  it('rejects a stale save with 409 + conflict message', async () => {
    // Version is now 2; sending version 1 must conflict.
    const res = await request(app)
      .put('/api/environments/env-test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: 1, environment: { name: 'Stale' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('conflict');
    expect(res.body.serverVersion).toBe(2);
    // State intact — name unchanged.
    const fresh = await request(app)
      .get('/api/environments/env-test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(fresh.body.name).toBe('Renamed');
  });

  it('404s on an unknown environment', async () => {
    const res = await request(app)
      .get('/api/environments/does-not-exist')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('duplicates an environment (201)', async () => {
    const res = await request(app)
      .post('/api/environments/env-test/duplicate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(201);
    expect(res.body.version).toBe(1);
  });

  it('exports a Mockoon-shaped file (no version/createdAt)', async () => {
    const res = await request(app)
      .get('/api/environments/env-test/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.application).toBe('mockoon');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].version).toBeUndefined();
    expect(res.body.data[0].createdAt).toBeUndefined();
    expect(res.body.data[0].name).toBe('Renamed');
  });

  it('imports a Mockoon file round-trip (201)', async () => {
    const exportRes = await request(app)
      .get('/api/environments/env-test/export')
      .set('Authorization', `Bearer ${adminToken}`);
    const importRes = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send(exportRes.body);
    expect(importRes.status).toBe(201);
    expect(importRes.body.imported.length).toBe(1);
  });

  it('imports an OpenAPI v3 document (201)', async () => {
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Pets API' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: { '200': { description: 'ok', content: { 'application/json': { example: { pets: [1, 2] } } } } },
          },
        },
      },
    };
    const res = await request(app)
      .post('/api/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(spec);
    expect(res.status).toBe(201);
    expect(res.body.imported[0].name).toBe('Pets API');
  });

  it('deletes an environment (admin, 200)', async () => {
    const dup = await request(app)
      .post('/api/environments/env-test/duplicate')
      .set('Authorization', `Bearer ${adminToken}`);
    // Find the duplicated uuid via the list.
    const list = await request(app).get('/api/environments').set('Authorization', `Bearer ${adminToken}`);
    const copy = list.body.find((e: { name: string }) => e.name.includes('(copy)'));
    const del = await request(app)
      .delete(`/api/environments/${copy.uuid}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
  });

  it('reports health in /api/status', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.storage).toBe('file');
    expect(typeof res.body.environments).toBe('number');
    expect(Array.isArray(res.body.listeners)).toBe(true);
  });

  it('enforces roles: viewer cannot save (403)', async () => {
    const { hashPassword } = await import('../src/auth');
    await storage.createUser({
      email: 'viewer@test.local',
      passwordHash: await hashPassword('viewer-pass'),
      role: 'viewer',
      createdAt: new Date().toISOString(),
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'viewer@test.local', password: 'viewer-pass' });
    const viewerToken = loginRes.body.token;

    const save = await request(app)
      .put('/api/environments/env-test')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ version: 2, environment: { name: 'Nope' } });
    expect(save.status).toBe(403);

    // Viewer CAN read.
    const read = await request(app)
      .get('/api/environments/env-test')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(read.status).toBe(200);
  });

  it('previews a template (F10 helper)', async () => {
    const res = await request(app)
      .post('/api/environments/env-test/preview-template')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ template: 'hello {{queryParam "who" "world"}}' });
    expect(res.status).toBe(200);
    expect(typeof res.body.output).toBe('string');
  });
});
