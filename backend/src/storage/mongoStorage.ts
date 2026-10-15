/**
 * MongoDB storage — primary backend (DESIGN.md §4.1, B4).
 *
 * One document per environment; saves are whole-document, version-locked
 * (§4.3): `save` only succeeds when the stored version equals the expected
 * one, atomically, via a filtered replace.
 */
import { Connection } from 'mongoose';
import { Environment, RequestLog, User } from '../lib/types';
import { ensureCappedLogs, registerModels } from '../db/models';
import {
  DuplicateEnvironmentError,
  EnvironmentNotFoundError,
  LogQuery,
  StorageBackend,
  VersionConflictError,
} from './index';

const E11000_DUPLICATE = 11000;

export class MongoStorage implements StorageBackend {
  readonly name = 'mongodb' as const;

  constructor(private readonly conn: Connection) {}

  async init(): Promise<void> {
    await ensureCappedLogs(this.conn);
  }

  private models() {
    return registerModels(this.conn);
  }

  private toDoc(doc: any): Environment {
    return {
      uuid: doc.uuid,
      name: doc.name ?? '',
      port: doc.port ?? 3000,
      endpointPrefix: doc.endpointPrefix ?? '',
      headers: doc.headers ?? [],
      proxyMode: Boolean(doc.proxyMode ?? false),
      proxyHost: doc.proxyHost ?? '',
      proxyRemovePrefix: Boolean(doc.proxyRemovePrefix ?? false),
      tlsOptions: {
        enabled: Boolean(doc.tlsOptions?.enabled ?? false),
        certPath: doc.tlsOptions?.certPath ?? '',
        keyPath: doc.tlsOptions?.keyPath ?? '',
        passphrase: doc.tlsOptions?.passphrase ?? '',
      },
      routes: doc.routes ?? [],
      data: doc.data ?? [],
      version: doc.version ?? 1,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async loadAll(): Promise<Environment[]> {
    const { EnvironmentModel } = this.models();
    const docs = await EnvironmentModel.find().sort({ name: 1 });
    return docs.map((d: any) => this.toDoc(d));
  }

  async get(uuid: string): Promise<Environment | null> {
    const { EnvironmentModel } = this.models();
    const doc = await EnvironmentModel.findOne({ uuid }).lean();
    return doc ? this.toDoc(doc) : null;
  }

  async create(doc: Environment): Promise<Environment> {
    const { EnvironmentModel } = this.models();
    try {
      await EnvironmentModel.create(doc);
      return doc;
    } catch (err: any) {
      if (err?.code === E11000_DUPLICATE) throw new DuplicateEnvironmentError(doc.uuid);
      throw err;
    }
  }

  async save(uuid: string, expectedVersion: number, doc: Environment): Promise<Environment> {
    const { EnvironmentModel } = this.models();

    const stamped: Environment = {
      ...doc,
      uuid,
      version: expectedVersion + 1,
      createdAt: (await this.get(uuid))?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Atomic version check: only replace when the stored version matches.
    const result = await EnvironmentModel.updateOne(
      { uuid, version: expectedVersion },
      { $set: stamped },
    );

    if (result.matchedCount === 1) return stamped;

    // Distinguish "missing" from "conflict" for the right error (→ 404 vs 409).
    const existing = await EnvironmentModel.findOne({ uuid }).lean();
    if (!existing) throw new EnvironmentNotFoundError(uuid);
    throw new VersionConflictError(uuid, expectedVersion, (existing as any).version ?? 0);
  }

  async remove(uuid: string): Promise<void> {
    const { EnvironmentModel } = this.models();
    const result = await EnvironmentModel.deleteOne({ uuid });
    if (result.deletedCount === 0) throw new EnvironmentNotFoundError(uuid);
  }

  // --- logs (capped raw collection) ---

  async writeLog(entry: RequestLog): Promise<void> {
    await this.conn.collection('logs').insertOne(entry as any);
  }

  async readLogs(query?: LogQuery): Promise<RequestLog[]> {
    const filter = query?.envUuid ? { envUuid: query.envUuid } : {};
    const limit = Math.min(Math.max(query?.limit ?? 200, 1), 1000);
    const docs = await this.conn
      .collection('logs')
      .find(filter as any)
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    return docs as unknown as RequestLog[];
  }

  async clearLogs(): Promise<void> {
    await this.conn.collection('logs').deleteMany({});
  }

  // --- users ---

  private toUser(doc: any): User {
    return {
      email: doc.email,
      passwordHash: doc.passwordHash,
      role: doc.role ?? 'editor',
      createdAt: doc.createdAt,
    };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { UserModel } = this.models();
    const doc = await UserModel.findOne({ email: email.toLowerCase() }).lean();
    return doc ? this.toUser(doc) : null;
  }

  async listUsers(): Promise<User[]> {
    const { UserModel } = this.models();
    const docs = await UserModel.find().lean().sort({ email: 1 });
    return docs.map((d: any) => this.toUser(d));
  }

  async createUser(user: User): Promise<void> {
    const { UserModel } = this.models();
    await UserModel.create({ ...user, email: user.email.toLowerCase() });
  }

  async removeUser(email: string): Promise<void> {
    const { UserModel } = this.models();
    await UserModel.deleteOne({ email: email.toLowerCase() });
  }
}
