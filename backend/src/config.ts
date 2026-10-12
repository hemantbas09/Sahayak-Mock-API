/**
 * Server configuration (DESIGN.md §4.1: loadConfig reads env, side-effect free).
 * `.env` loading happens once in server.ts via `import 'dotenv/config'`.
 */
import path from 'path';

export interface ServerConfig {
  /** Main API port (config API + static frontend + optional path routing). */
  port: number;
  host: string;
  /** MongoDB connection string; null → file storage fallback. */
  mongoUri: string | null;
  /** Local file storage fallback root (envs/, users.json, logs.json). */
  dataDir: string;
  /** Base dir for FILE responses and TLS cert resolution (§1 deviation 2, §2.9). */
  filesDir: string;
  /**
   * Allowlisted origins for strict /api CORS (§2.15). Comma-separated.
   * Empty list = no cross-origin /api access (same-origin only).
   */
  appUrls: string[];
  /** JWT signing secret. Required when auth is on. */
  jwtSecret: string;
  /** When true, auth is enforced on /api (dev shortcut: off = open access). */
  authEnabled: boolean;
  /** Seed admin account created on first boot (email:password). */
  seedAdmin: { email: string; password: string } | null;
  /** Optional: serve the built Angular app from this directory. */
  frontendDist: string | null;
  /** PATH_ROUTING: also serve ANY /mock/:uuid/* on the main port (§6). */
  pathRouting: boolean;
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), 'data');
  const [seedEmail, seedPassword] = (process.env.SEED_ADMIN?.trim() || ':').split(':');

  return {
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? '0.0.0.0',
    mongoUri: process.env.MONGODB_URI?.trim() || null,
    dataDir,
    filesDir: process.env.FILES_DIR?.trim() || path.join(dataDir, 'files'),
    appUrls: (process.env.APP_URLS?.trim() || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwtSecret: process.env.JWT_SECRET?.trim() || 'sahayak-dev-secret-change-me',
    authEnabled: (process.env.AUTH_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    seedAdmin: seedEmail && seedEmail !== seedPassword
      ? { email: seedEmail, password: seedPassword ?? '' }
      : null,
    frontendDist: process.env.FRONTEND_DIST?.trim() || null,
    pathRouting: (process.env.PATH_ROUTING ?? 'false').trim().toLowerCase() === 'true',
  };
}
