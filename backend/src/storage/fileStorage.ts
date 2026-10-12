/**
 * File storage — dev fallback (DESIGN.md B4).
 *
 * One JSON file per environment under DATA_DIR (envs/<uuid>.json), plus a
 * users.json and logs.json. Documents stay in Mockoon format so the same
 * files can be opened by Mockoon desktop.
 *
 * NOT concurrency-safe (single process, dev only). Version locking is still
 * enforced (read-compare-write) so the 409 code paths are exercisable
 * without MongoDB.
 */
import fs from 'fs/promises';
import path from 'path';
import { Environment, RequestLog, User } from '../lib/types';
import {
  DuplicateEnvironmentError,
  EnvironmentNotFoundError,
  LogQuery,
  StorageBackend,
  VersionConflictError,
} from './index';

const LOG_LIMIT = 1000;

export class FileStorage implements StorageBackend {
  readonly name = 'file' as const;

  constructor(private readonly dataDir: string) {}

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.dataDir, 'envs'), { recursive: true });
  }

  private envFile(uuid: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(uuid)) throw new Error(`Invalid environment id: ${uuid}`);
    return path.join(this.dataDir, 'envs', `${uuid}.json`);
  }

  private get usersFile(): string {
    return path.join(this.dataDir, 'users.json');
  }

  private get logsFile(): string {
    return path.join(this.dataDir, 'logs.json');
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  async loadAll(): Promise<Environment[]> {
    const dir = path.join(this.dataDir, 'envs');
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const envs = await Promise.all(files.map((f) => this.readJson<Environment>(path.join(dir, f), null as never)));
    return envs.filter((e): e is Environment => e !== null && e !== undefined).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(uuid: string): Promise<Environment | null> {
    return this.readJson<Environment>(this.envFile(uuid), null as never) as Promise<Environment | null>;
  }

  async create(doc: Environment): Promise<Environment> {
    const file = this.envFile(doc.uuid);
    try {
      await fs.access(file);
      // File exists → duplicate.
      throw new DuplicateEnvironmentError(doc.uuid);
    } catch (err: any) {
      if (err instanceof DuplicateEnvironmentError) throw err;
      // ENOENT: fine — the file doesn't exist yet.
    }
    await this.writeJson(file, doc);
    return doc;
  }

  async save(uuid: string, expectedVersion: number, doc: Environment): Promise<Environment> {
    const file = this.envFile(uuid);
    const existing = await this.readJson<Environment | null>(file, null as never);
    if (!existing) throw new EnvironmentNotFoundError(uuid);
    if (existing.version !== expectedVersion) {
      throw new VersionConflictError(uuid, expectedVersion, existing.version);
    }
    const stamped: Environment = {
      ...doc,
      uuid,
      version: expectedVersion + 1,
      createdAt: existing.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.writeJson(file, stamped);
    return stamped;
  }

  async remove(uuid: string): Promise<void> {
    const file = this.envFile(uuid);
    try {
      await fs.unlink(file);
    } catch {
      throw new EnvironmentNotFoundError(uuid);
    }
  }

  async writeLog(entry: RequestLog): Promise<void> {
    const logs = await this.readJson<RequestLog[]>(this.logsFile, []);
    logs.unshift(entry);
    await this.writeJson(this.logsFile, logs.slice(0, LOG_LIMIT));
  }

  async readLogs(query?: LogQuery): Promise<RequestLog[]> {
    const logs = await this.readJson<RequestLog[]>(this.logsFile, []);
    const filtered = query?.envUuid ? logs.filter((l) => l.envUuid === query.envUuid) : logs;
    const limit = Math.min(Math.max(query?.limit ?? 200, 1), 1000);
    return filtered.slice(0, limit);
  }

  async clearLogs(): Promise<void> {
    await this.writeJson(this.logsFile, []);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const users = await this.readJson<User[]>(this.usersFile, []);
    return users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async listUsers(): Promise<User[]> {
    const users = await this.readJson<User[]>(this.usersFile, []);
    return users.sort((a, b) => a.email.localeCompare(b.email));
  }

  async createUser(user: User): Promise<void> {
    const users = await this.readJson<User[]>(this.usersFile, []);
    if (users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
      throw new DuplicateEnvironmentError(user.email);
    }
    await this.writeJson(this.usersFile, [...users, user]);
  }

  async removeUser(email: string): Promise<void> {
    const users = await this.readJson<User[]>(this.usersFile, []);
    await this.writeJson(
      this.usersFile,
      users.filter((u) => u.email.toLowerCase() !== email.toLowerCase())
    );
  }
}
