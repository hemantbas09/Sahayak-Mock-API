import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/state';
import { LogService } from '../src/logs';
import { ListenerManager } from '../src/listeners';
import { FileStorage } from '../src/storage/fileStorage';
import { Environment, RouteResponse } from '../src/lib/types';

async function freePort(): Promise<number> {
  const srv = http.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const { port } = srv.address() as { port: number };
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sahayak-mock-'));
// A FILE response fixture.
await fs.mkdir(path.join(tmp, 'files'), { recursive: true });
await fs.writeFile(path.join(tmp, 'files', 'sample.txt'), 'file body content');

const storage = new FileStorage(tmp);
await storage.init();
const store = new Store();
store.setStorage(storage);
await store.load();
const logs = new LogService(storage);
const listeners = new ListenerManager(store, { store, logs, dataDir: path.join(tmp, 'files') });

let port: number;
let env: Environment;
const base = () => `http://127.0.0.1:${port}`;

function resp(over: Partial<RouteResponse>): RouteResponse {
  return {
    uuid: crypto.randomUUID(),
    label: 'Default',
    statusCode: 200,
    headers: [],
    latency: 0,
    bodyType: 'INLINE',
    body: '',
    filePath: '',
    databucketId: '',
    rules: [],
    rulesOperator: 'AND',
    defaultResponse: true,
    ...over,
  };
}

beforeAll(async () => {
  port = await freePort();
  const bucketUuid = crypto.randomUUID();
  env = {
    uuid: 'mock-env',
    name: 'Mock E2E',
    port,
    endpointPrefix: '/api',
    headers: [{ key: 'X-Env-Header', value: 'from-env' }],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [
      {
        uuid: 'r-template',
        type: 'http',
        method: 'get',
        endpoint: 'hello',
        documentation: '',
        responseMode: null,
        responses: [
          resp({
            label: 'templated',
            body: `{"hello":"{{queryParam 'name' 'stranger'}}","id":"{{uuid}}"}`,
            defaultResponse: true,
          }),
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      },
      {
        uuid: 'r-rules',
        type: 'http',
        method: 'post',
        endpoint: 'orders',
        documentation: '',
        responseMode: null,
        responses: [
          // zero-rule response — SKIPPED in rules mode (must be default)
          resp({
            label: 'zero-rule-default',
            body: '{"why":"default"}',
            defaultResponse: true,
          }),
          resp({
            label: 'vip',
            statusCode: 201,
            body: '{"tier":"vip"}',
            defaultResponse: false,
            rules: [
              {
                uuid: crypto.randomUUID(),
                target: 'headers',
                property: 'x-tier',
                modifier: '',
                operator: 'equals',
                invert: false,
                value: 'vip',
              },
            ],
          }),
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      },
      {
        uuid: 'r-sequential',
        type: 'http',
        method: 'get',
        endpoint: 'rotate',
        documentation: '',
        responseMode: 'SEQUENTIAL',
        responses: [
          resp({ label: 'one', body: 'A', statusCode: 200, defaultResponse: false }),
          resp({ label: 'two', body: 'B', statusCode: 200, defaultResponse: false }),
          resp({ label: 'three', body: 'C', statusCode: 200, defaultResponse: false }),
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      },
      {
        uuid: 'r-bucket',
        type: 'http',
        method: 'get',
        endpoint: 'bucket',
        documentation: '',
        responseMode: null,
        responses: [
          resp({
            label: 'bucket-content',
            bodyType: 'DATABUCKET',
            databucketId: bucketUuid,
            defaultResponse: true,
          }),
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      },
      {
        uuid: 'r-file',
        type: 'http',
        method: 'get',
        endpoint: 'doc',
        documentation: '',
        responseMode: null,
        responses: [
          resp({
            label: 'file',
            bodyType: 'FILE',
            filePath: 'sample.txt',
            defaultResponse: true,
          }),
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      },
      {
        uuid: 'r-crud',
        type: 'crud',
        method: 'get',
        endpoint: 'items',
        documentation: '',
        responseMode: null,
        responses: [
          {
            uuid: 'crud-resp',
            label: 'CRUD',
            statusCode: 200,
            headers: [],
            latency: 0,
            bodyType: 'DATABUCKET',
            body: '',
            filePath: '',
            databucketId: bucketUuid,
            rules: [],
            rulesOperator: 'AND',
            defaultResponse: true,
          },
        ],
        proxyHost: '',
        proxyRemovePrefix: false,
      },
    ],
    data: [
      {
        uuid: bucketUuid,
        name: 'items',
        content: JSON.stringify(
          [
            { id: 1, name: 'alpha' },
            { id: 2, name: 'beta' },
          ],
          null,
          2
        ),
      },
    ],
    version: 1,
  };
  await storage.create(env);
  await store.load();
  await listeners.startAll();
});

afterAll(async () => {
  await listeners.stopAll();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('mock serving (real listener)', () => {
  it('serves a templated INLINE body (queryParam + uuid)', async () => {
    const res = await fetch(`${base()}/api/hello?name=team`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hello: string; id: string };
    expect(body.hello).toBe('team');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/i);
    // Env default header present.
    expect(res.headers.get('x-env-header')).toBe('from-env');
  });

  it('skips zero-rule responses; serves ruled match (x-tier: vip)', async () => {
    const res = await fetch(`${base()}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tier': 'vip' },
      body: '{}',
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { tier: string }).tier).toBe('vip');
  });

  it('falls back to the default response when no rule matches', async () => {
    const res = await fetch(`${base()}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { why: string }).why).toBe('default');
  });

  it('rotates SEQUENTIAL responses in order', async () => {
    const bodies: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${base()}/api/rotate`);
      bodies.push(await res.text());
    }
    expect(bodies).toEqual(['A', 'B', 'C', 'A']);
  });

  it('serves DATABUCKET content as-is', async () => {
    const res = await fetch(`${base()}/api/bucket`);
    const items = (await res.json()) as { name: string }[];
    expect(items.map((i) => i.name)).toEqual(['alpha', 'beta']);
  });

  it('serves a FILE response with the right content-type', async () => {
    const res = await fetch(`${base()}/api/doc`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('file body content');
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('runs CRUD: GET list → POST insert → GET item → DELETE item', async () => {
    const list = (await (await fetch(`${base()}/api/items`)).json()) as { id: number; name: string }[];
    expect(list).toHaveLength(2);

    const created = await fetch(`${base()}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'gamma' }),
    });
    expect(created.status).toBe(201);
    const newItem = (await created.json()) as { id: number; name: string };
    expect(newItem.id).toBe(3); // auto-increment (existing numeric ids)
    expect(newItem.name).toBe('gamma');

    const item = await fetch(`${base()}/api/items/3`);
    expect(((await item.json()) as { name: string }).name).toBe('gamma');

    const del = await fetch(`${base()}/api/items/3`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    const after = (await (await fetch(`${base()}/api/items`)).json()) as unknown[];
    expect(after).toHaveLength(2);
  });

  it('supports CRUD query operators (_page/_limit/_sort)', async () => {
    const res = await fetch(`${base()}/api/items?_page=1&_limit=1&_sort=name&_order=desc`);
    const items = (await res.json()) as { name: string }[];
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('beta');
  });

  it('404s unknown paths (Mockoon body)', async () => {
    const res = await fetch(`${base()}/api/nope`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('Route not matched');
  });

  it('404s unknown methods on a known path (no 405 — §2.14)', async () => {
    const res = await fetch(`${base()}/api/hello`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('answers CORS preflight with 204', async () => {
    const res = await fetch(`${base()}/api/hello`, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('logs requests with sensitive headers redacted', async () => {
    await fetch(`${base()}/api/hello?x=1`, { headers: { authorization: 'Bearer supersecret' } });
    await new Promise((r) => setTimeout(r, 50));
    const all = await logs.read(undefined, 50);
    const entry = all.find((l) => l.url.includes('/api/hello') && l.url.includes('x=1'));
    expect(entry).toBeTruthy();
    expect(entry!.reqHeaders.authorization).toBe('[redacted]');
    expect(entry!.resStatus).toBe(200);
  });
});
