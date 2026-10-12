/**
 * Central in-memory state + the single mutation point for configuration.
 *
 * All changes go through `Store.applyOps`: the snapshot is updated first
 * (so the mock endpoints serve fresh data immediately), then the changed
 * entities are persisted to whichever storage backend is configured.
 */
import { MockEnvironment } from '../types';
import { applyOps, buildOps, Op, OpsPayload } from '../lib/ops';
import { StorageBackend, Touched } from './storage';

export class Store {
  private environments: MockEnvironment[] = [];
  private storage: StorageBackend | null = null;
  /** Serializes persistence writes so bulk saves never interleave. */
  private persistenceQueue: Promise<unknown> = Promise.resolve();

  setStorage(storage: StorageBackend | null): void {
    this.storage = storage;
  }

  hasStorage(): boolean {
    return this.storage !== null;
  }

  list(): MockEnvironment[] {
    return this.environments;
  }

  async load(): Promise<void> {
    if (!this.storage) return;
    this.environments = await this.storage.loadAll();
  }

  /**
   * Apply a batch of client ops. Returns the number of ops persisted.
   * Throws when an op is malformed (unknown parent references) - the
   * snapshot is already updated in memory, which matches what the
   * client is now showing.
   */
  async applyOps(ops: Op[]): Promise<number> {
    if (ops.length === 0) return 0;

    // Expand deletes into all child entity paths BEFORE applying, using the
    // pre-update snapshot (after applying, the children are already gone and
    // a document-based backend would not know what to delete).
    const deletes = this.expandDeletes(this.environments, ops);

    this.environments = applyOps(this.environments, ops);
    const touched = this.extractTouchedEntities(ops, deletes);

    if (this.storage) {
      const snapshot = this.environments;
      this.persistenceQueue = this.persistenceQueue
        .then(() => this.storage!.save(snapshot, touched))
        .catch((err) => {
          console.error('[Store] Persistence failed:', err);
        });
    }

    return ops.length;
  }

  /**
   * Convenience for the UI save flow: diff two snapshots and apply the
   * resulting ops. (Kept for compatibility; the API accepts raw ops too.)
   */
  async applyDiff(saved: MockEnvironment[], current: MockEnvironment[]): Promise<number> {
    const payload: OpsPayload = buildOps(saved, current);
    return this.applyOps(payload.ops);
  }

  /**
   * Expand logical deletes into every child entity path, using a snapshot of
   * the state (must be called before the ops are applied, when children still
   * exist). env:x deletes -> env:x + route:x:* + response:x:*:* etc.
   */
  private expandDeletes(snapshot: MockEnvironment[], ops: Op[]): Set<string> {
    const deletes = new Set<string>();

    const envById = new Map(snapshot.map((e) => [e.id, e]));

    for (const op of ops) {
      if (op.type === 'env.delete') {
        const env = envById.get(op.id);
        if (env) {
          for (const route of env.routes) {
            for (const resp of route.responses) {
              deletes.add(`response:${op.id}:${route.id}:${resp.id}`);
            }
            deletes.add(`route:${op.id}:${route.id}`);
          }
        }
        deletes.add(`env:${op.id}`);
      } else if (op.type === 'route.delete') {
        const env = envById.get(op.envId);
        const route = env?.routes.find((r) => r.id === op.id);
        if (route) {
          for (const resp of route.responses) {
            deletes.add(`response:${op.envId}:${op.id}:${resp.id}`);
          }
        }
        deletes.add(`route:${op.envId}:${op.id}`);
      } else if (op.type === 'response.delete') {
        deletes.add(`response:${op.envId}:${op.routeId}:${op.id}`);
      }
    }

    return deletes;
  }

  /**
   * Compute the set of entity paths to (re)write. Deletes come in already
   * expanded.
   */
  private extractTouchedEntities(ops: Op[], deletes: Set<string>): Touched {
    const writes = new Set<string>();

    for (const op of ops) {
      switch (op.type) {
        case 'env.upsert':
          writes.add(`env:${op.env.id}`);
          break;
        case 'env.reorder':
          for (const id of op.order) writes.add(`env:${id}`);
          break;
        case 'route.upsert':
          writes.add(`route:${op.envId}:${op.route.id}`);
          break;
        case 'route.reorder':
          for (const id of op.order) writes.add(`route:${op.envId}:${id}`);
          break;
        case 'response.upsert':
          writes.add(`response:${op.envId}:${op.routeId}:${op.response.id}`);
          break;
        case 'response.reorder':
          for (const id of op.order) writes.add(`response:${op.envId}:${op.routeId}:${id}`);
          break;
        default:
          break;
      }
    }

    return { writes: [...writes], deletes: [...deletes] };
  }
}
