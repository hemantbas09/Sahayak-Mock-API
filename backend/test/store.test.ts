import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/state';
import { FileStorage } from '../src/storage/fileStorage';
import { Environment } from '../src/lib/types';
import { redactHeaders } from '../src/logs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sahayak-store-'));
const storage = new FileStorage(tmp);

function envDoc(uuid: string, over: Partial<Environment> = {}): Environment {
  return {
    uuid,
    name: `Env ${uuid}`,
    port: 3000 + Number(uuid.replace(/\D/g, '') || 0),
    endpointPrefix: '',
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [],
    data: [{ uuid: `bucket-${uuid}`, name: 'seed', content: '[1,2]' }],
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('Store', () => {
  let store: Store;

  beforeAll(async () => {
    await storage.init();
    store = new Store();
    store.setStorage(storage);
    await store.load();
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates, reads, lists, deletes, duplicates', async () => {
    expect((await store.createEnvironment(envDoc('1'))).ok).toBe(true);
    expect(store.get('1')?.name).toBe('Env 1');
    expect(store.list()).toHaveLength(1);

    const dup = await store.duplicateEnvironment('1', '1-copy');
    expect(dup.ok).toBe(true);
    expect(store.get('1-copy')?.name).toBe('Env 1 (copy)');
    expect(store.get('1-copy')?.version).toBe(1);

    expect((await store.deleteEnvironment('1-copy')).ok).toBe(true);
    expect(store.get('1-copy')).toBeNull();
    expect((await store.deleteEnvironment('nope')).ok).toBe(false);
  });

  it('rejects duplicate create', async () => {
    const result = await store.createEnvironment(envDoc('1'));
    expect(result.ok).toBe(false);
  });

  it('saves with matching version; bumps and persists', async () => {
    const result = await store.saveEnvironment('1', 1, { ...envDoc('1'), name: 'renamed' });
    expect(result).toMatchObject({ ok: true, version: 2, needsListenerRestart: false });
    expect(store.get('1')?.name).toBe('renamed');
    // Persisted to storage.
    expect((await storage.get('1'))?.version).toBe(2);
  });

  it('rejects stale saves with conflict + server version; state intact', async () => {
    const result = await store.saveEnvironment('1', 1, { ...envDoc('1'), name: 'stale write' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('conflict');
      expect(result.version).toBe(2);
    }
    expect(store.get('1')?.name).toBe('renamed');
  });

  it('detects listener-restart triggers (port change)', async () => {
    const result = await store.saveEnvironment('1', 2, { ...envDoc('1', { port: 4567 }) });
    expect(result).toMatchObject({ ok: true, version: 3, needsListenerRestart: true });
    await store.saveEnvironment('1', 3, envDoc('1', { port: 3000 }));
  });

  it('rolls back in-memory state when persistence fails', async () => {
    const document = envDoc('2');
    await storage.create(document);

    // Storage whose save() always throws — simulates a MongoDB outage.
    const failingStorage = new FailingSaveStorage(storage);
    const isolated = new Store();
    isolated.setStorage(failingStorage);
    await isolated.load();
    expect(isolated.get('2')).toBeTruthy();

    const result = await isolated.saveEnvironment('2', 1, { ...document, name: 'will fail' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('persist-failed');
    // In-memory state rolled back to the pre-save snapshot.
    expect(isolated.get('2')?.name).toBe('Env 2');
    // And the stored doc is untouched too.
    expect((await storage.get('2'))?.name).toBe('Env 2');

    await storage.remove('2');
  });

  it('resets runtime state (buckets back to templated content)', async () => {
    const runtime = store.getRuntime('1');
    expect(runtime?.buckets.get('bucket-1')).toBe('[1,2]');
    runtime?.buckets.set('bucket-1', 'MUTATED');
    store.resetRuntime('1');
    expect(store.getRuntime('1')?.buckets.get('bucket-1')).toBe('[1,2]');
  });

  it('notifies change subscribers on save and delete', async () => {
    const events: string[] = [];
    const unsub = store.onChange((event, env) => events.push(`${event}:${env.uuid}`));
    await store.createEnvironment(envDoc('3'));
    await store.deleteEnvironment('3');
    unsub();
    expect(events).toEqual(['saved:3', 'deleted:3']);
  });
});

/** Storage wrapper whose save() always rejects — simulates a database outage. */
class FailingSaveStorage {
  constructor(private readonly inner: FileStorage) {}

  get name() {
    return 'file' as const;
  }

  loadAll() {
    return this.inner.loadAll();
  }
  get(uuid: string) {
    return this.inner.get(uuid);
  }
  create(doc: Environment) {
    return this.inner.create(doc);
  }
  async save(_uuid: string, _expectedVersion: number, _doc: Environment): Promise<never> {
    throw new Error('simulated persistence outage');
  }
  remove(uuid: string) {
    return this.inner.remove(uuid);
  }
  writeLog(entry: import('../src/lib/types').RequestLog) {
    return this.inner.writeLog(entry);
  }
  readLogs(query?: import('../src/storage/index').LogQuery) {
    return this.inner.readLogs(query);
  }
  clearLogs() {
    return this.inner.clearLogs();
  }
  getUserByEmail(email: string) {
    return this.inner.getUserByEmail(email);
  }
  listUsers() {
    return this.inner.listUsers();
  }
  createUser(user: import('../src/lib/types').User) {
    return this.inner.createUser(user);
  }
  removeUser(email: string) {
    return this.inner.removeUser(email);
  }
}

describe('redactHeaders (§2.6)', () => {
  it('redacts sensitive headers, keeps normal ones', () => {
    const out = redactHeaders({
      Authorization: 'Bearer abc',
      Cookie: 'sid=1',
      'x-api-key': 'k',
      'x-request-id': '123',
      'X-Auth-Token': 't',
      'Content-Type': 'application/json',
    });
    expect(out.Authorization).toBe('[redacted]');
    expect(out.Cookie).toBe('[redacted]');
    expect(out['x-api-key']).toBe('[redacted]');
    expect(out['X-Auth-Token']).toBe('[redacted]');
    expect(out['x-request-id']).toBe('123');
    expect(out['Content-Type']).toBe('application/json');
  });
});
