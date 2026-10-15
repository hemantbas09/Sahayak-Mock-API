import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../src/storage/fileStorage';
import {
  DuplicateEnvironmentError,
  EnvironmentNotFoundError,
  VersionConflictError,
  fromMockoonImport,
  toMockoonExport,
} from '../src/storage/index';
import { Environment } from '../src/lib/types';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sahayak-storage-'));
const storage = new FileStorage(tmp);

function envDoc(over: Partial<Environment> = {}): Environment {
  return {
    uuid: 'env-1',
    name: 'Env One',
    port: 3001,
    endpointPrefix: '/api',
    headers: [{ key: 'X-Default', value: 'yes' }],
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
            uuid: 'resp-1',
            label: 'ok',
            statusCode: 200,
            headers: [],
            latency: 0,
            bodyType: 'INLINE',
            body: '{}',
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

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('FileStorage', () => {
  it('creates, reads, lists, and deletes environments', async () => {
    await storage.init();
    await storage.create(envDoc());
    expect((await storage.get('env-1'))?.name).toBe('Env One');

    await storage.create(envDoc({ uuid: 'env-2', name: 'Env Two' }));
    const all = await storage.loadAll();
    expect(all.map((e) => e.name)).toEqual(['Env One', 'Env Two']); // sorted by name

    await storage.remove('env-2');
    expect(await storage.get('env-2')).toBeNull();
    await storage.remove('env-1');
  });

  it('rejects duplicate create', async () => {
    await storage.create(envDoc());
    await expect(storage.create(envDoc())).rejects.toBeInstanceOf(DuplicateEnvironmentError);
    await storage.remove('env-1');
  });

  it('saves with version lock: bump on match, 409-style conflict on stale', async () => {
    await storage.create(envDoc());
    const saved = await storage.save('env-1', 1, { ...envDoc(), name: 'v2' });
    expect(saved.version).toBe(2);

    await expect(storage.save('env-1', 1, { ...envDoc(), name: 'stale' })).rejects.toBeInstanceOf(
      VersionConflictError
    );
    // Original version-2 doc intact.
    expect((await storage.get('env-1'))?.name).toBe('v2');
    await storage.remove('env-1');
  });

  it('saves to a missing env -> not found', async () => {
    await expect(storage.save('ghost', 1, envDoc({ uuid: 'ghost' }))).rejects.toBeInstanceOf(
      EnvironmentNotFoundError
    );
  });

  it('removing a missing env -> not found', async () => {
    await expect(storage.remove('ghost')).rejects.toBeInstanceOf(EnvironmentNotFoundError);
  });

  it('writes, reads, filters, and clears logs', async () => {
    const mkLog = (envUuid: string, ts: number) => ({
      ts,
      envUuid,
      method: 'GET',
      url: '/x',
      ip: '1.2.3.4',
      reqHeaders: {},
      query: {},
      reqBody: '',
      resStatus: 200,
      resHeaders: {},
      resBody: '',
      routeUuid: '',
      latencyMs: 1,
    });
    await storage.writeLog(mkLog('env-a', 1));
    await storage.writeLog(mkLog('env-b', 2));
    await storage.writeLog(mkLog('env-a', 3));

    const all = await storage.readLogs();
    expect(all).toHaveLength(3);
    expect(all[0].ts).toBe(3); // most recent first

    const filtered = await storage.readLogs({ envUuid: 'env-a', limit: 1 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].ts).toBe(3);

    await storage.clearLogs();
    expect(await storage.readLogs()).toHaveLength(0);
  });

  it('manages users (case-insensitive email)', async () => {
    await storage.createUser({ email: 'A@x.io', passwordHash: 'h', role: 'editor', createdAt: 't' });
    expect((await storage.getUserByEmail('a@x.io'))?.role).toBe('editor');
    await expect(storage.createUser({ email: 'a@x.io', passwordHash: 'h2', role: 'admin' })).rejects.toThrow();
    expect(await storage.listUsers()).toHaveLength(1);
    await storage.removeUser('A@x.io');
    expect(await storage.getUserByEmail('a@x.io')).toBeNull();
  });
});

describe('Mockoon import/export normalization', () => {
  it('export strips Sahayak-only fields', () => {
    const env = envDoc();
    env.createdAt = '2026-01-01T00:00:00Z';
    env.updatedAt = '2026-01-02T00:00:00Z';
    const exported = toMockoonExport(env);
    expect(exported.version).toBeUndefined();
    expect(exported.createdAt).toBeUndefined();
    expect(exported.updatedAt).toBeUndefined();
    expect(exported.routes).toHaveLength(1);
  });

  it('import fills defaults and starts at version 1', () => {
    const raw = {
      uuid: 'imp-1',
      name: 'Imported',
      port: 3100,
      routes: [
        {
          uuid: 'r',
          endpoint: 'x',
          responses: [{ uuid: 'r1', statusCode: 201, body: 'hi', rules: [] }],
        },
      ],
    };
    const env = fromMockoonImport(raw);
    expect(env.version).toBe(1);
    expect(env.routes[0].type).toBe('http');
    expect(env.routes[0].method).toBe('get');
    expect(env.routes[0].responseMode).toBeNull();
    expect(env.routes[0].responses[0].bodyType).toBe('INLINE');
    expect(env.routes[0].responses[0].defaultResponse).toBe(false);
    expect(env.tlsOptions.enabled).toBe(false);
    expect(env.data).toEqual([]);
  });

  it('import rejects documents without a uuid', () => {
    expect(() => fromMockoonImport({ name: 'no uuid' })).toThrow(/uuid/);
  });

  it('import/export round-trips a full document losslessly', () => {
    const env = envDoc({
      name: 'Round Trip',
      routes: [
        {
          uuid: 'r2',
          type: 'crud',
          method: 'get',
          endpoint: 'things',
          documentation: 'crud doc',
          responseMode: 'RANDOM',
          responses: [
            {
              uuid: 'resp2',
              label: 'crud',
              statusCode: 200,
              headers: [],
              latency: 120,
              bodyType: 'DATABUCKET',
              body: '',
              filePath: '',
              databucketId: 'bucket-9',
              rules: [
                {
                  uuid: 'rule-1',
                  target: 'data_bucket',
                  property: 'bucket-9',
                  modifier: 'items.0.id',
                  operator: 'equals',
                  invert: true,
                  value: '42',
                },
              ],
              rulesOperator: 'OR',
              defaultResponse: true,
            },
          ],
          proxyHost: 'http://backend:9000',
          proxyRemovePrefix: true,
        },
      ],
      data: [{ uuid: 'bucket-9', name: 'things', content: '[]' }],
    });
    const roundTrip = fromMockoonImport(toMockoonExport(env));
    expect(roundTrip.uuid).toBe(env.uuid);
    expect(roundTrip.routes).toEqual(env.routes);
    expect(roundTrip.data).toEqual(env.data);
    expect(roundTrip.version).toBe(1); // import always restarts version
  });
});
