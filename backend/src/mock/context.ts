/**
 * Shared engine contract (DESIGN.md §4: "the mock engine is pure").
 *
 * Every engine module operates on `EngineRequest` (input, normalized by the
 * HTTP layer) and produces/derives `EngineResponse` (output). No module in
 * this folder may do I/O — fs, net, and timers-injection are handled by the
 * caller (listeners/pipeline). This keeps the whole engine unit-testable.
 */
import { DataBucket, Environment } from '../lib/types';

/**
 * A normalized incoming mock request. The listener builds this AFTER
 * stripping `endpointPrefix` and parsing the body by content-type.
 */
export interface EngineRequest {
  /** Lowercased HTTP method. */
  method: string;
  /** Original request target (path + query string), prefix already stripped. */
  url: string;
  /** Path without query string, URL-decoded. Prefix stripped. */
  path: string;
  /** Request headers, lowercased keys. */
  headers: Record<string, string>;
  /** Parsed query params (string values). */
  query: Record<string, string>;
  /**
   * Parsed body: JSON object/array, urlencoded record, XML object, or the
   * raw string when unparseable (Mockoon behavior).
   */
  body: unknown;
  /** Raw request body string (for logging; truncated by the log layer). */
  rawBody: string;
  /** Client IP. */
  ip: string;
  /** Request Host header value. */
  hostname: string;
  /** 1-based per-route request counter (rules target: request_number). */
  requestNumber: number;
}

/** The engine's output — the listener sends this back to the client. */
export interface EngineResponse {
  statusCode: number;
  headers: Record<string, string>;
  /** Response body text (already templated / resolved). */
  body: string;
  /** Set when the body came from a FILE (mime by extension) — else null. */
  fileContentType: string | null;
  /** Requested latency in ms (already clamped to [0, 60000]). */
  latencyMs: number;
  /** Non-fatal problems (templating warnings etc.) — surfaced in logs/UI. */
  warnings: string[];
  /** True when the response was produced by proxying (§2.8). */
  proxied: boolean;
  /** Uuid of the matched route, or null (404 / proxy fallback). */
  routeUuid: string | null;
}

/**
 * Per-environment runtime state, owned by the Store (DESIGN.md §4):
 * bucket contents after generation, global variables, and per-route
 * counters (request numbers, SEQUENTIAL rotation index).
 */
export interface EnvRuntime {
  /** bucket uuid -> generated (parsed-if-valid-JSON kept as raw string). */
  buckets: Map<string, string>;
  /** Global variables (§2.10), mutated by {{setVar}}. */
  globalVars: Map<string, unknown>;
  /** route uuid -> 1-based request counter. */
  requestCounts: Map<string, number>;
  /** route uuid -> next response index for SEQUENTIAL mode. */
  sequentialIndex: Map<string, number>;
}

export function createEnvRuntime(env: Environment): EnvRuntime {
  return {
    buckets: new Map(env.data.map((b: DataBucket) => [b.uuid, b.content])),
    globalVars: new Map(),
    requestCounts: new Map(),
    sequentialIndex: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resolve a dot path (`a.b.0.c`) against a value, with prototype-pollution
 * guards (DESIGN.md §2.11 security). Returns undefined when the path is not
 * present or a forbidden segment is encountered.
 */
export function getNestedValue(target: unknown, path: string): unknown {
  if (target == null || path === '') return target;
  const segments = path.split('.');
  let current: unknown = target;
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** True when the full dot path exists (value may be null/undefined). */
export function hasPath(target: unknown, path: string): boolean {
  if (target == null || path === '') return target != null;
  const segments = path.split('.');
  let current: unknown = target;
  for (const segment of segments) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return false;
    if (current == null || typeof current !== 'object') return false;
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return false;
  }
  return true;
}

/**
 * Set a value at a dot path, creating intermediate plain objects/arrays as
 * needed. Forbidden segments are rejected (returns false, no mutation).
 * Returns true when the write happened.
 */
export function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): boolean {
  if (path === '') return false;
  const segments = path.split('.');
  let current: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (FORBIDDEN_SEGMENTS.has(segment)) return false;
    const next = current[segment];
    if (next == null || typeof next !== 'object') {
      const created: Record<string, unknown> = {};
      (current as Record<string, unknown>)[segment] = created;
      current = created;
    } else {
      current = next as Record<string, unknown>;
    }
  }
  const last = segments[segments.length - 1];
  if (FORBIDDEN_SEGMENTS.has(last)) return false;
  (current as Record<string, unknown>)[last] = value;
  return true;
}

/** Split a URL path into segments (no decoding here — path is pre-decoded). */
export function pathSegments(path: string): string[] {
  return path
    .split('/')
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Body coercion
// ---------------------------------------------------------------------------

/**
 * Parse a raw request body according to its Content-Type (DESIGN.md §2.15):
 * JSON, urlencoded, XML (via an injected parser fn). Anything unparseable
 * stays a raw string — Mockoon behavior, the user's invalid body is the
 * user's signal.
 */
export function coerceBody(
  rawBody: string,
  contentType: string | undefined,
  xmlParser: (xml: string) => Promise<unknown> | unknown
): unknown {
  if (rawBody === undefined || rawBody === '') return '';
  const ct = (contentType ?? '').toLowerCase();

  if (ct.includes('application/json') || ct === '') {
    if (ct === 'application/json' || looksLikeJson(rawBody)) {
      try {
        return JSON.parse(rawBody);
      } catch {
        return rawBody;
      }
    }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    try {
      const params = new URLSearchParams(rawBody);
      const record: Record<string, string> = {};
      for (const [key, value] of params) record[key] = value;
      return record;
    } catch {
      return rawBody;
    }
  }
  if (ct.includes('xml')) {
    const parsed = xmlParser(rawBody);
    if (parsed instanceof Promise) return rawBody; // synchronous path: keep raw
    if (parsed !== undefined && parsed !== null) return parsed;
    return rawBody;
  }
  return rawBody;
}

function looksLikeJson(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/** Parse a query string into a string record (first value per key). */
export function parseQueryString(queryString: string): Record<string, string> {
  const record: Record<string, string> = {};
  if (!queryString) return record;
  const qs = queryString.startsWith('?') ? queryString.slice(1) : queryString;
  const params = new URLSearchParams(qs);
  for (const [key, value] of params) {
    if (!(key in record)) record[key] = value;
  }
  return record;
}

/** Parse a Cookie header into a record. */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  if (!cookieHeader) return record;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      try {
        record[key] = decodeURIComponent(value);
      } catch {
        record[key] = value;
      }
    }
  }
  return record;
}

/** Clamp latency to Mockoon's [0, 60000] ms cap (DESIGN.md §2.15). */
export function clampLatency(latencyMs: number): number {
  if (!Number.isFinite(latencyMs)) return 0;
  return Math.min(60000, Math.max(0, Math.round(latencyMs)));
}
