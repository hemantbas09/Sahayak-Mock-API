/**
 * End-to-end test: boots the real Express app (no Vite) against a temp file
 * storage and exercises the ops save flow + mock endpoints over HTTP.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { Store } from '../src/server/state';
import { LogBuffer } from '../src/server/logs';
import { FileStorage } from '../src/server/storage/fileStorage';
import { createApp } from '../src/server/app';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-api-e2e-'));
const dataFile = path.join(dataDir, 'mock-config.json');

async function withServer(fn: (baseUrl: string, store: Store, logs: LogBuffer) => Promise<void>) {
  const store = new Store();
  const logs = new LogBuffer();
  const storage = new FileStorage(dataFile);
  store.setStorage(storage);
  await store.load();

  const app = createApp(store, logs, storage.name);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unexpected server address');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl, store, logs);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('e2e: ops save flow + mock endpoints', async () => {
  await withServer(async (baseUrl) => {
    // 1) Empty on first boot
    let res = await fetch(`${baseUrl}/api/environments`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);

    // 2) Create env + route + response in one ops batch
    res = await fetch(`${baseUrl}/api/environments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        ops: [
          { type: 'env.upsert', env: { id: 'env-1', name: 'Bank API', endpointPrefix: '', port: 3000, latency: 0, headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json' }] } },
          { type: 'route.upsert', envId: 'env-1', route: { id: 'route-1', method: 'get', endpoint: 'users/:id', description: '', latency: 0, selectedResponseId: 'resp-1' } },
          { type: 'response.upsert', envId: 'env-1', routeId: 'route-1', response: { id: 'resp-1', statusCode: 200, label: 'ok', headers: [], body: '{"id":"{{param id}}"}', rules: [], rulesOperator: 'AND' } },
        ],
      }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, applied: 3 });

    // 3) Snapshot reflects the change
    res = await fetch(`${baseUrl}/api/environments`);
    const envs = await res.json();
    assert.equal(envs.length, 1);
    assert.equal(envs[0].routes[0].responses[0].body, '{"id":"{{param id}}"}');

    // 4) Mock endpoint serves the templated response
    res = await fetch(`${baseUrl}/mock/env-1/users/42`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('application/json'));
    assert.deepEqual(await res.json(), { id: '42' });

    // 5) Wrong method -> 405 with method mismatch body
    res = await fetch(`${baseUrl}/mock/env-1/users/42`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 405);
    const mmBody = await res.json();
    assert.equal(mmBody.data.responseCode, 'METHOD_MISMATCH');

    // 6) Unknown path -> 404
    res = await fetch(`${baseUrl}/mock/env-1/does-not-exist`);
    assert.equal(res.status, 404);

    // 7) Unknown env -> 404
    res = await fetch(`${baseUrl}/mock/nope/anything`);
    assert.equal(res.status, 404);

    // 8) Logs recorded, sensitive headers redacted
    res = await fetch(`${baseUrl}/mock/env-1/users/99`, { headers: { Authorization: 'Bearer secret-token' } });
    assert.equal(res.status, 200);
    res = await fetch(`${baseUrl}/api/logs`);
    const logsList = await res.json();
    assert.ok(logsList.length >= 4);
    const userLog = logsList.find((l: { url: string }) => l.url.endsWith('/users/99'));
    assert.equal(userLog.headers.authorization, '[redacted]');

    // 9) Edit ONE response body -> payload with a single response.upsert
    res = await fetch(`${baseUrl}/api/environments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: 1,
        ops: [
          { type: 'response.upsert', envId: 'env-1', routeId: 'route-1', response: { id: 'resp-1', statusCode: 200, label: 'ok', headers: [], body: '{"id":"{{param id}}","v":2}', rules: [], rulesOperator: 'AND' } },
        ],
      }),
    });
    assert.deepEqual(await res.json(), { success: true, applied: 1 });

    res = await fetch(`${baseUrl}/mock/env-1/users/7`);
    assert.deepEqual(await res.json(), { id: '7', v: 2 });

    // 10) Malformed ops payload -> 400
    res = await fetch(`${baseUrl}/api/environments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, ops: [{ type: 'bogus', id: 'x' }] }),
    });
    assert.equal(res.status, 400);

    // 11) Delete the environment -> snapshot empty
    res = await fetch(`${baseUrl}/api/environments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, ops: [{ type: 'env.delete', id: 'env-1' }] }),
    });
    assert.deepEqual(await res.json(), { success: true, applied: 1 });
    res = await fetch(`${baseUrl}/api/environments`);
    assert.deepEqual(await res.json(), []);

    // 12) Mock endpoint for the deleted env now 404s
    res = await fetch(`${baseUrl}/mock/env-1/users/1`);
    assert.equal(res.status, 404);

    // 13) Status endpoint
    res = await fetch(`${baseUrl}/api/status`);
    const status = await res.json();
    assert.equal(status.ok, true);
    assert.equal(status.storage, 'file');
    assert.equal(status.environments, 0);

    // 14) Clear logs
    res = await fetch(`${baseUrl}/api/logs`, { method: 'DELETE' });
    assert.deepEqual(await res.json(), { success: true });
    res = await fetch(`${baseUrl}/api/logs`);
    assert.deepEqual(await res.json(), []);
  });
});

test('e2e: configuration survives a restart via file storage', async () => {
  const store = new Store();
  const logs = new LogBuffer();
  const storage = new FileStorage(dataFile);
  store.setStorage(storage);
  await store.load();

  await store.applyOps([
    { type: 'env.upsert', env: { id: 'env-persist', name: 'Persisted', endpointPrefix: '', port: 3000, latency: 0, headers: [] } },
    { type: 'route.upsert', envId: 'env-persist', route: { id: 'route-p', method: 'get', endpoint: 'ping', description: '', latency: 0, selectedResponseId: 'resp-p' } },
    { type: 'response.upsert', envId: 'env-persist', routeId: 'route-p', response: { id: 'resp-p', statusCode: 200, label: 'ok', headers: [], body: 'pong', rules: [], rulesOperator: 'AND' } },
  ]);
  // Let the queued write settle (file storage is synchronous internally).
  await new Promise((resolve) => setTimeout(resolve, 50));

  // New store instance = "restart"
  const restarted = new Store();
  restarted.setStorage(new FileStorage(dataFile));
  await restarted.load();
  const envs = restarted.list();
  assert.equal(envs.length, 1);
  assert.equal(envs[0].id, 'env-persist');
  assert.equal(envs[0].routes[0].responses[0].body, 'pong');

  fs.rmSync(dataDir, { recursive: true, force: true });
});
