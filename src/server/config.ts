/**
 * Server configuration. Note: `.env` loading happens once in the entry
 * point (server.ts imports `dotenv/config`), so this module only reads
 * already-populated process.env and stays side-effect free for tests.
 */
import path from 'path';

export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  fileStoragePath: string;
  appUrl: string;
  firestore: {
    enabled: boolean;
    serviceAccount: Record<string, unknown> | null;
    databaseId: string | null;
  };
}

/**
 * Parse FIREBASE_SERVICE_ACCOUNT_JSON - either raw JSON or base64-encoded JSON.
 * Returns null when unset or unparsable (the server then falls back to file storage).
 */
export function parseServiceAccount(raw: string | undefined): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' ? parsed : null;
    }
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.DATA_DIR?.trim() || path.join(process.cwd(), 'data');
  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    dataDir,
    fileStoragePath: process.env.DATA_FILE?.trim() || path.join(dataDir, 'mock-config.json'),
    appUrl: process.env.APP_URL?.trim() ?? '',
    firestore: {
      enabled: serviceAccount !== null,
      serviceAccount,
      databaseId: process.env.FIRESTORE_DATABASE_ID?.trim() || null,
    },
  };
}
