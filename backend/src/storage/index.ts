/**
 * Storage contract (DESIGN.md §4.1, B4).
 *
 * One document per environment, Mockoon-shaped (DESIGN.md §5). Saves are
 * whole-document with optimistic concurrency: `save` atomically checks the
 * expected version and rejects with VersionConflictError (→ HTTP 409, §4.3).
 *
 * Implementations: MongoStorage (primary), FileStorage (dev fallback —
 * one JSON file per env under DATA_DIR, still Mockoon format).
 */
import { Environment, RequestLog, User } from '../lib/types';

export class VersionConflictError extends Error {
  constructor(uuid: string, expected: number, actual: number) {
    super(
      `Environment ${uuid} was modified by someone else (expected version ${expected}, found ${actual}). Reload to see the latest.`
    );
    this.name = 'VersionConflictError';
  }
}

export class EnvironmentNotFoundError extends Error {
  constructor(uuid: string) {
    super(`Environment ${uuid} not found`);
    this.name = 'EnvironmentNotFoundError';
  }
}

export class DuplicateEnvironmentError extends Error {
  constructor(uuid: string) {
    super(`Environment ${uuid} already exists`);
    this.name = 'DuplicateEnvironmentError';
  }
}

export interface LogQuery {
  envUuid?: string;
  limit?: number;
}

export interface StorageBackend {
  readonly name: 'mongodb' | 'file';

  // --- environments (whole document, version-locked) ---
  loadAll(): Promise<Environment[]>;
  get(uuid: string): Promise<Environment | null>;
  /** Insert a new environment (version starts at 1). Throws DuplicateEnvironmentError. */
  create(doc: Environment): Promise<Environment>;
  /**
   * Atomically replace the environment only when its stored version equals
   * `expectedVersion`; stores `doc` with `version: expectedVersion + 1`.
   * Throws VersionConflictError / EnvironmentNotFoundError.
   */
  save(uuid: string, expectedVersion: number, doc: Environment): Promise<Environment>;
  remove(uuid: string): Promise<void>;

  // --- request logs (capped) ---
  writeLog(entry: RequestLog): Promise<void>;
  readLogs(query?: LogQuery): Promise<RequestLog[]>;
  clearLogs(): Promise<void>;

  // --- users (auth, §2.7) ---
  getUserByEmail(email: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(user: User): Promise<void>;
  removeUser(email: string): Promise<void>;
}

/** Strip Sahayak-only fields for Mockoon export (DESIGN.md §2.13). */
export function toMockoonExport(env: Environment): Environment {
  const { version: _v, createdAt: _c, updatedAt: _u, ...rest } = env;
  return rest as Environment;
}

/** Normalize an imported Mockoon environment: default Sahayak fields. */
export function fromMockoonImport(raw: unknown): Environment {
  const env = raw as Partial<Environment>;
  if (!env || typeof env !== 'object' || typeof env.uuid !== 'string') {
    throw new Error('Invalid Mockoon environment: missing uuid');
  }
  return {
    uuid: env.uuid,
    name: env.name ?? '',
    port: Number(env.port ?? 3000),
    endpointPrefix: env.endpointPrefix ?? '',
    headers: env.headers ?? [],
    proxyMode: Boolean(env.proxyMode ?? false),
    proxyHost: env.proxyHost ?? '',
    proxyRemovePrefix: Boolean(env.proxyRemovePrefix ?? false),
    tlsOptions: {
      enabled: Boolean(env.tlsOptions?.enabled ?? false),
      certPath: env.tlsOptions?.certPath ?? '',
      keyPath: env.tlsOptions?.keyPath ?? '',
      passphrase: env.tlsOptions?.passphrase ?? '',
    },
    routes: (env.routes ?? []).map((r) => ({
      uuid: r.uuid,
      type: r.type === 'crud' ? ('crud' as const) : ('http' as const),
      method: (r.method ?? 'get') as never,
      endpoint: r.endpoint ?? '',
      documentation: r.documentation ?? '',
      responseMode: r.responseMode === 'RANDOM' || r.responseMode === 'SEQUENTIAL' ? r.responseMode : null,
      responses: (r.responses ?? []).map((res) => ({
        uuid: res.uuid,
        label: res.label ?? '',
        statusCode: Number(res.statusCode ?? 200),
        headers: res.headers ?? [],
        latency: Number(res.latency ?? 0),
        bodyType: (res.bodyType ?? 'INLINE') as never,
        body: res.body ?? '',
        filePath: res.filePath ?? '',
        databucketId: res.databucketId ?? '',
        rules: res.rules ?? [],
        rulesOperator: res.rulesOperator === 'OR' ? ('OR' as const) : ('AND' as const),
        defaultResponse: Boolean(res.defaultResponse ?? false),
      })),
      proxyHost: r.proxyHost ?? '',
      proxyRemovePrefix: Boolean(r.proxyRemovePrefix ?? false),
    })),
    data: env.data ?? [],
    version: 1,
  };
}
