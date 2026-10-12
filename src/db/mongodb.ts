/**
 * MongoDB connection management.
 *
 * The server connects a standalone mongoose `Connection` (not the default
 * global one) so tests can open connections to different databases without
 * interfering with each other.
 */
import mongoose from 'mongoose';

export interface MongoConnectOptions {
  /** How long to wait for the server before failing (ms). Default 5000. */
  serverSelectionTimeoutMS?: number;
  maxPoolSize?: number;
}

/**
 * Open a connection to MongoDB. Throws on failure - the caller decides
 * whether to fall back to local file storage.
 */
export async function connectMongo(
  uri: string,
  options: MongoConnectOptions = {}
): Promise<mongoose.Connection> {
  const conn = new mongoose.Connection(true);
  await conn.openUri(uri, {
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 5000,
    maxPoolSize: options.maxPoolSize ?? 10,
  });
  return conn;
}

/** Strip credentials from a URI so it is safe to log. */
export function maskMongoUri(uri: string): string {
  return uri.replace(/\/\/([^/@]+)@/, '//***@');
}
