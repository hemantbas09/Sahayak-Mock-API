/**
 * Mongoose models (DESIGN.md §4.1, B2).
 *
 * `routes` / `data` / `headers` are stored as Mixed so the environment
 * document stays byte-identical to Mockoon's file format — no schema drift,
 * lossless import/export (DESIGN.md §2.13).
 */
import { Connection, Model, Schema, Types } from 'mongoose';
import { Environment, User } from '../lib/types';

export function registerModels(conn: Connection) {
  const EnvironmentModel: Model<Environment> =
    (conn.models.Environment as Model<Environment>) ??
    conn.model<Environment>('Environment', new Schema({
      uuid: { type: String, required: true, unique: true, index: true },
      name: { type: String, default: '' },
      port: { type: Number, default: 3000 },
      endpointPrefix: { type: String, default: '' },
      headers: { type: [new Schema({ key: String, value: String }, { _id: false })], default: [] },
      proxyMode: { type: Boolean, default: false },
      proxyHost: { type: String, default: '' },
      proxyRemovePrefix: { type: Boolean, default: false },
      tlsOptions: {
        enabled: { type: Boolean, default: false },
        certPath: { type: String, default: '' },
        keyPath: { type: String, default: '' },
        passphrase: { type: String, default: '' },
      },
      // Mockoon-shaped — kept as Mixed for lossless round-trips.
      // (Casted: mongoose's SchemaDefinitionProperty typing rejects Mixed[]
      // for typed generics, but this is exactly the opaque-array case.)
      routes: { type: [Schema.Types.Mixed], default: [] } as unknown as { type: never },
      data: { type: [Schema.Types.Mixed], default: [] } as unknown as { type: never },
      version: { type: Number, default: 1 },
      createdAt: { type: String, default: () => new Date().toISOString() },
      updatedAt: { type: String, default: () => new Date().toISOString() },
    }, { _id: false }));

  const UserModel: Model<User> =
    (conn.models.User as Model<User>) ??
    conn.model<User>('User', new Schema({
      email: { type: String, required: true, unique: true, index: true },
      passwordHash: { type: String, required: true },
      role: { type: String, enum: ['admin', 'editor', 'viewer'], default: 'editor' },
      createdAt: { type: String, default: () => new Date().toISOString() },
    }, { _id: false }));

  // Logs use the raw capped collection (see MongoStorage.ensureCappedLogs).
  return { EnvironmentModel, UserModel };
}

/**
 * Ensure the capped logs collection exists (§2.6: capped, e.g. 512 MB).
 * Safe to call on every boot (collection-exists error is swallowed).
 */
export async function ensureCappedLogs(conn: Connection, sizeBytes = 512 * 1024 * 1024): Promise<void> {
  try {
    const db = conn.db;
    if (!db) throw new Error('Mongo connection has no database selected');
    await db.createCollection('logs', { capped: true, size: sizeBytes });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code !== 72 && code !== 48) throw err; // 72=CollectionAlreadyExists, 48=NamespaceExists
  }
}

export type { Types };
