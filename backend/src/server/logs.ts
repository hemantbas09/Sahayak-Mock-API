/**
 * In-memory ring buffer for mock request logs.
 * Sensitive headers are redacted before storage.
 */
import { RequestLog } from '../types';

const MAX_LOGS = 200;

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'xp-token',
];

const REDACTED = '[redacted]';

function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = isSensitiveKey(key) ? REDACTED : value;
  }
  return result;
}

function isSensitiveKey(key: string): boolean {
  if (SENSITIVE_HEADER_KEYS.includes(key.toLowerCase())) return true;
  // Catch token-ish query params / headers not in the explicit list.
  return /token|secret|password|api[-_]?key/i.test(key);
}

export class LogBuffer {
  private logs: RequestLog[] = [];

  record(entry: RequestLog): void {
    this.logs.unshift(entry);
    if (this.logs.length > MAX_LOGS) this.logs.pop();
  }

  list(): RequestLog[] {
    return this.logs;
  }

  clear(): void {
    this.logs = [];
  }

  static buildEntry(input: {
    envId: string;
    method: string;
    url: string;
    ip?: string;
    headers: Record<string, unknown>;
    query: Record<string, unknown>;
    body: unknown;
    responseStatus: number;
    responseHeaders: Record<string, string>;
    responseBody: string;
    matchedRoute: string;
    latencyMs: number;
    warning?: string;
  }): RequestLog {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (isSensitiveKey(key)) {
        query[key] = REDACTED;
      } else if (typeof value === 'string') {
        query[key] = value;
      } else {
        query[key] = String(value);
      }
    }

    return {
      id: 'log-' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      envId: input.envId,
      method: input.method,
      url: input.url,
      ip: input.ip || '127.0.0.1',
      headers: redactHeaders(input.headers) as Record<string, string>,
      queryParams: query,
      body: input.body,
      responseStatus: input.responseStatus,
      responseHeaders: input.responseHeaders,
      responseBody: input.responseBody,
      matchedRoute: input.matchedRoute,
      latency: input.latencyMs,
      warning: input.warning,
    };
  }
}
