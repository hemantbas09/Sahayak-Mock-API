/**
 * Server configuration. Note: `.env` loading happens once in the entry
 * point (server-entry.ts imports `dotenv/config`), so this module only
 * reads already-populated process.env and stays side-effect free for tests.
 */
import path from 'path';

export interface ServerConfig {
  port: number;
  host: string;
  /** MongoDB connection string. Null when unset -> file storage fallback. */
  mongoUri: string | null;
  /** Local JSON file fallback (dev convenience / no-Mongo mode). */
  fileStoragePath: string;
  /** Optional directory of a pre-built frontend to serve (e.g. dist/sahayak/browser). */
  frontendDist: string | null;
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), 'data');

  return {
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? '0.0.0.0',
    mongoUri: process.env.MONGODB_URI?.trim() || null,
    fileStoragePath: process.env.DATA_FILE?.trim() || path.join(dataDir, 'mock-config.json'),
    frontendDist: process.env.FRONTEND_DIST?.trim() || null,
  };
}
