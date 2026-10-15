/**
 * MongoDB connection management.
 *
 * The server connects a standalone mongoose Connection (not the default
 * global one) so tests can open connections to different databases without
 * interfering with each other.
 */
import mongoose from 'mongoose';

export interface MongoConnectOptions {
  /** How long to wait for the server before failing (ms). Default 5000. */
  serverSelectionTimeoutMS?: number;
  maxPoolSize?: number;
}

export async function connectMongo(
  uri: string,
  options: MongoConnectOptions = {}
): Promise<mongoose.Connection> {
  const conn = new mongoose.Connection();
  await conn.openUri(uri, {
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 5000,
    maxPoolSize: options.maxPoolSize ?? 10,
  });
  return conn;
}

/** Remove credentials for safe logging: mongodb://user:pass@host → mongodb://***@host. */
export function maskMongoUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//***@');
}
