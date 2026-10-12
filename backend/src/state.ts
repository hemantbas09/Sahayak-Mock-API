/**
 * Store — the in-memory source of truth at runtime (DESIGN.md §4, B5).
 *
 * Holds:
 *  - the environment documents (MongoDB is the durable copy, written on save)
 *  - per-env runtime state: generated bucket contents, global variables,
 *    per-route counters (request numbers, SEQUENTIAL index) — resets on
 *    restart, exactly like Mockoon desktop (§2.5/§2.10)
 *
 * `saveEnvironment` is the §4.3 contract: check version → apply to memory →
 * persist (AWAITED, no fire-and-forget) → bump version. If persistence
 * fails, the in-memory change is rolled back and the error propagates.
 */
import { Environment } from './lib/types';
import { EnvRuntime, createEnvRuntime } from './mock/context';
import {
  EnvironmentNotFoundError,
  StorageBackend,
  VersionConflictError,
} from './storage/index';

export type SaveResult =
  | { ok: true; version: number; needsListenerRestart: boolean }
  | { ok: false; error: 'not-found' | 'conflict' | 'persist-failed'; version?: number; message?: string };

export class Store {
  private envs = new Map<string, Environment>();
  private runtimes = new Map<string, EnvRuntime>();
  private listeners: ((event: 'saved' | 'deleted', env: Environment) => void)[] = [];

  setStorage(storage: StorageBackend): void {
    this.storage = storage;
  }

  private storage!: StorageBackend;

  async load(): Promise<void> {
    const envs = await this.storage.loadAll();
    this.envs = new Map(envs.map((e) => [e.uuid, e]));
    this.runtimes = new Map(envs.map((e) => [e.uuid, createEnvRuntime(e)]));
  }

  // --- reads ---

  list(): Environment[] {
    return [...this.envs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(uuid: string): Environment | null {
    return this.envs.get(uuid) ?? null;
  }

  getRuntime(uuid: string): EnvRuntime | null {
    return this.runtimes.get(uuid) ?? null;
  }

  /** Reset an env's runtime state (buckets → templated initial content, vars/counts cleared). */
  resetRuntime(uuid: string): void {
    const env = this.envs.get(uuid);
    if (env) this.runtimes.set(uuid, createEnvRuntime(env));
  }

  // --- writes ---

  /**
   * §4.3 whole-document, version-locked save.
   * Returns a result (never throws for expected failures).
   */
  async saveEnvironment(
    uuid: string,
    expectedVersion: number,
    incoming: Environment
  ): Promise<SaveResult> {
    const current = this.envs.get(uuid);
    if (!current) return { ok: false, error: 'not-found' };
    if (current.version !== expectedVersion) {
      return {
        ok: false,
        error: 'conflict',
        version: current.version,
        message: new VersionConflictError(uuid, expectedVersion, current.version).message,
      };
    }

    // Validate the incoming document before touching state.
    const stamped: Environment = {
      ...incoming,
      uuid,
      version: expectedVersion + 1,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Apply in-memory FIRST (mock endpoints read from memory — fast path),
    // then persist. Persist failure rolls back.
    const prevEnv = current;
    const prevRuntime = this.runtimes.get(uuid);
    const needsListenerRestart =
      current.port !== stamped.port ||
      current.endpointPrefix !== stamped.endpointPrefix ||
      current.tlsOptions.enabled !== stamped.tlsOptions.enabled ||
      current.tlsOptions.certPath !== stamped.tlsOptions.certPath ||
      current.tlsOptions.keyPath !== stamped.tlsOptions.keyPath;

    this.envs.set(uuid, stamped);
    this.runtimes.set(uuid, createEnvRuntime(stamped));

    try {
      await this.storage.save(uuid, expectedVersion, stamped);
    } catch (err) {
      // Roll back to the previous snapshot + runtime (DESIGN §4.3).
      this.envs.set(uuid, prevEnv);
      if (prevRuntime) this.runtimes.set(uuid, prevRuntime);
      if (err instanceof VersionConflictError) {
        return { ok: false, error: 'conflict', version: (this.envs.get(uuid)?.version ?? 0), message: err.message };
      }
      return {
        ok: false,
        error: 'persist-failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    for (const listener of this.listeners) listener('saved', stamped);
    return { ok: true, version: stamped.version, needsListenerRestart };
  }

  async createEnvironment(doc: Environment): Promise<{ ok: true; version: number } | { ok: false; error: string; message?: string }> {
    if (this.envs.has(doc.uuid)) {
      return { ok: false, error: 'conflict', message: `Environment ${doc.uuid} already exists` };
    }
    const stamped: Environment = {
      ...doc,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.envs.set(stamped.uuid, stamped);
    this.runtimes.set(stamped.uuid, createEnvRuntime(stamped));
    try {
      await this.storage.create(stamped);
    } catch (err) {
      this.envs.delete(stamped.uuid);
      this.runtimes.delete(stamped.uuid);
      return { ok: false, error: 'persist-failed', message: err instanceof Error ? err.message : String(err) };
    }
    for (const listener of this.listeners) listener('saved', stamped);
    return { ok: true, version: 1 };
  }

  async deleteEnvironment(uuid: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const env = this.envs.get(uuid);
    if (!env) return { ok: false, error: 'not-found' };
    this.envs.delete(uuid);
    this.runtimes.delete(uuid);
    try {
      await this.storage.remove(uuid);
    } catch (err) {
      this.envs.set(uuid, env);
      return { ok: false, error: 'persist-failed' };
    }
    for (const listener of this.listeners) listener('deleted', env);
    return { ok: true };
  }

  async duplicateEnvironment(uuid: string, newUuid: string): Promise<{ ok: true; version: number } | { ok: false; error: string; message?: string }> {
    const env = this.envs.get(uuid);
    if (!env) return { ok: false, error: 'not-found' };
    if (this.envs.has(newUuid)) return { ok: false, error: 'conflict', message: `Environment ${newUuid} already exists` };
    const copy: Environment = {
      ...structuredClone(env),
      uuid: newUuid,
      name: `${env.name} (copy)`,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.envs.set(newUuid, copy);
    this.runtimes.set(newUuid, createEnvRuntime(copy));
    try {
      await this.storage.create(copy);
    } catch (err) {
      this.envs.delete(newUuid);
      this.runtimes.delete(newUuid);
      return { ok: false, error: 'persist-failed', message: err instanceof Error ? err.message : String(err) };
    }
    for (const listener of this.listeners) listener('saved', copy);
    return { ok: true, version: 1 };
  }

  /** Subscribe to save/delete events (listeners reload envs, B6). */
  onChange(fn: (event: 'saved' | 'deleted', env: Environment) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
}

export { EnvironmentNotFoundError };
