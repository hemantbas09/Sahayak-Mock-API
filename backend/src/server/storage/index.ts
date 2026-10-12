/**
 * Pluggable configuration storage.
 *
 *  - FileStorage:        local JSON file (default, zero-config)
 *  - FirestoreStorage:   hierarchical Cloud Firestore documents (when a
 *                        service account is configured)
 *
 * `save` receives the full snapshot plus the set of touched entity paths so a
 * backend can write only what actually changed (the local file backend just
 * rewrites the file atomically).
 */
import { MockEnvironment } from '../../types';

export interface Touched {
  /** Entity paths to write: "env:id" | "route:envId:routeId" | "response:envId:routeId:respId" */
  writes: string[];
  /** Entity paths to remove (children removed recursively by the backend). */
  deletes: string[];
}

export interface StorageBackend {
  readonly name: string;
  loadAll(): Promise<MockEnvironment[]>;
  save(snapshot: MockEnvironment[], touched: Touched): Promise<void>;
}

export function parseTouchedPath(path: string):
  | { kind: 'env'; envId: string }
  | { kind: 'route'; envId: string; routeId: string }
  | { kind: 'response'; envId: string; routeId: string; responseId: string } {
  const parts = path.split(':');
  switch (parts[0]) {
    case 'env':
      return { kind: 'env', envId: parts[1] };
    case 'route':
      return { kind: 'route', envId: parts[1], routeId: parts[2] };
    case 'response':
      return { kind: 'response', envId: parts[1], routeId: parts[2], responseId: parts[3] };
    default:
      throw new Error(`Unknown touched path: ${path}`);
  }
}
