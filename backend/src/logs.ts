/**
 * Request log layer (DESIGN.md §2.6).
 *
 * - `redactHeaders` masks sensitive headers before anything is stored.
 * - Bodies are truncated (request 64 KB, response 256 KB).
 * - Logs go through StorageBackend (Mongo capped collection / file fallback)
 *   so the whole team can inspect them and they survive restarts.
 */
import { RequestLog } from './lib/types';
import { StorageBackend } from './storage/index';

const REDACTED = '[redacted]';

const EXACT_REDACTED_KEYS = new Set(['authorization', 'cookie', 'x-api-key']);
const PATTERN_REDACT_KEYS = /token|secret|password|api[-_]?key/i;

const REQ_BODY_LIMIT = 64 * 1024;
const RES_BODY_LIMIT = 256 * 1024;

/** Redact sensitive request headers (§2.6). Returns a new object. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    out[key] = EXACT_REDACTED_KEYS.has(lower) || PATTERN_REDACT_KEYS.test(lower) ? REDACTED : value;
  }
  return out;
}

function truncate(value: string | undefined, limit: number): string {
  if (!value) return '';
  return value.length > limit ? `${value.slice(0, limit)}…[truncated]` : value;
}

export interface LogEntryInput {
  envUuid: string;
  method: string;
  url: string;
  ip: string;
  reqHeaders: Record<string, string>;
  query: Record<string, string>;
  reqBody: string;
  resStatus: number;
  resHeaders: Record<string, string>;
  resBody: string;
  routeUuid: string;
  latencyMs: number;
}

export class LogService {
  constructor(private readonly storage: StorageBackend) {}

  /** Recent logs, most recent first (filtered by env when given). */
  async read(envUuid?: string, limit?: number): Promise<RequestLog[]> {
    return this.storage.readLogs({ envUuid, limit });
  }

  async clear(): Promise<void> {
    await this.storage.clearLogs();
  }

  /** Build a redacted, truncated entry and persist it. Never throws. */
  async write(input: LogEntryInput): Promise<void> {
    const entry: RequestLog = {
      ts: Date.now(),
      envUuid: input.envUuid,
      method: input.method,
      url: input.url,
      ip: input.ip,
      reqHeaders: redactHeaders(input.reqHeaders),
      query: input.query,
      reqBody: truncate(input.reqBody, REQ_BODY_LIMIT),
      resStatus: input.resStatus,
      resHeaders: input.resHeaders,
      resBody: truncate(input.resBody, RES_BODY_LIMIT),
      routeUuid: input.routeUuid,
      latencyMs: input.latencyMs,
    };
    try {
      await this.storage.writeLog(entry);
    } catch (err) {
      console.error('[Logs] failed to write log entry:', err instanceof Error ? err.message : err);
    }
  }
}
