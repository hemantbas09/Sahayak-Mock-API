/**
 * Route matching (DESIGN.md §2.2, §4 — "the mock engine is pure").
 *
 * Pure functions only: no fs/net/process/Date. The caller (pipeline) strips
 * `env.endpointPrefix` and decodes the path before calling {@link findRoute}.
 */
import { Environment, Route } from '../lib/types';
import { pathSegments } from './context';

export interface RouteMatch {
  route: Route;
  /** Path parameters captured from the pattern (URL-decoded). */
  params: Record<string, string>;
  /** True for CRUD routes; the CRUD handler then dispatches by method. */
  isCrud: boolean;
  /** For CRUD: 'list' | 'item'; undefined for http routes. */
  crudKind?: 'list' | 'item';
  /** For CRUD item: the id segment (decoded). */
  crudId?: string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Decode a single path segment. Already-decoded paths decode to themselves
 * for the characters a path normally contains, so this is safe whether or not
 * the caller decoded the path first. Malformed percent-escapes fall back to
 * the raw segment instead of throwing (matches Mockoon's lenient decoding).
 */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Specificity rank of one pattern segment (DESIGN.md §2.2):
 * literal (exact) = 0, `:param` = 1, `*` wildcard = 2. The winning candidate
 * minimizes the lexicographic sequence of ranks; declaration order breaks ties.
 */
export function rankSegments(pattern: string): number[] {
  return pathSegments(pattern).map((s) => {
    if (s === '*') return 2;
    if (s.startsWith(':')) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// stripPrefix
// ---------------------------------------------------------------------------

/**
 * Strip `endpointPrefix` from `path` (case-insensitive, trailing-slash
 * tolerant). Strips at a segment boundary only: a prefix that only partially
 * matches a segment (or is absent) leaves `path` returned unchanged. The
 * returned remainder keeps a leading slash; the empty string means "root".
 */
export function stripPrefix(endpointPrefix: string, path: string): string {
  const prefix = endpointPrefix
    .replace(/\/+$/, '')
    .replace(/^\/+/, '')
    .toLowerCase();
  if (!prefix) return path;

  const prefixSegments = pathSegments(prefix);
  const pathSegs = pathSegments(path);
  // The path's leading segments (lowercased) must equal the prefix segments,
  // and the character right after the prefix must be a '/' or end-of-path
  // (segment-boundary check — stops '/api/v1' from stripping '/api/v1beta').
  const matches =
    pathSegs.length >= prefixSegments.length &&
    pathSegs
      .slice(0, prefixSegments.length)
      .every((s, i) => s.toLowerCase() === prefixSegments[i]);
  if (!matches) return path;

  // Rebuild the remainder from the matching path segments (normalizes
  // consecutive slashes), keeping a single leading slash.
  const remainder = pathSegs.slice(prefixSegments.length).join('/');
  return remainder ? `/${remainder}` : '';
}

// ---------------------------------------------------------------------------
// matchPath
// ---------------------------------------------------------------------------

/**
 * Match a pattern path against a concrete path.
 * Semantics (DESIGN.md §2.2): case-insensitive; trailing-slash tolerant;
 * segments:
 *  - literal segment: exact match (case-insensitive)
 *  - ':name': one segment, captured into `params` (URL-decoded)
 *  - '*': trailing catch-all — matches one or more remaining segments, or a
 *    middle wildcard matching exactly one segment
 * Returns `{ params }` or `null` when the shapes do not match.
 */
export function matchPath(pattern: string, path: string): { params: Record<string, string> } | null {
  const patternSegments = pathSegments(pattern);
  const pathSegs = pathSegments(path);

  // Root pattern matches the root path.
  if (patternSegments.length === 0) {
    return pathSegs.length === 0 ? { params: {} } : null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i];
    if (i >= pathSegs.length) return null; // path too short
    const c = pathSegs[i];
    if (p === '*') {
      if (i === patternSegments.length - 1) {
        // Trailing catch-all: one or more remaining segments (already
        // guaranteed ≥ 1 by the length guard above), swallow the rest.
        return { params };
      }
      // Middle wildcard: consumes exactly one segment (no capture).
      continue;
    }
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeSegment(c);
      continue;
    }
    if (p.toLowerCase() !== c.toLowerCase()) return null; // literal mismatch
  }
  if (pathSegs.length !== patternSegments.length) return null; // path too long
  return { params };
}

// ---------------------------------------------------------------------------
// findRoute
// ---------------------------------------------------------------------------

/**
 * Lexicographic comparison of rank sequences: fewer segments or a lower rank
 * at the first differing position is more specific → returns < 0.
 */
function compareRankSequences(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Best HTTP-route match for `method` + `path` (prefix already stripped).
 * Specificity wins (exact > :param > *); declaration order breaks ties.
 */
function httpRouteMatch(env: Environment, method: string, path: string): RouteMatch | null {
  let best: { route: Route; params: Record<string, string>; ranks: number[] } | null = null;
  for (const route of env.routes) {
    if (route.type !== 'http') continue;
    const lower = route.method.toLowerCase();
    if (lower !== method) continue;
    const m = matchPath(route.endpoint, path);
    if (!m) continue;
    const ranks = rankSegments(route.endpoint);
    if (!best || compareRankSequences(ranks, best.ranks) < 0) {
      best = { route, params: m.params, ranks };
    }
  }
  if (!best) return null;
  return { route: best.route, params: best.params, isCrud: false };
}

/**
 * Best CRUD-route match: endpoint = list op; endpoint + exactly one id
 * segment = item op. Declaration order breaks ties (CRUD routes do not
 * participate in segment specificity — the CRUD handler dispatches by method).
 */
function crudRouteMatch(env: Environment, path: string): RouteMatch | null {
  const pathSegs = pathSegments(path);
  for (const route of env.routes) {
    if (route.type !== 'crud') continue;
    const patternSegments = pathSegments(route.endpoint);

    const commonMatch =
      pathSegs.length >= patternSegments.length &&
      patternSegments.every(
        (p, i) =>
          p !== '*' &&
          !p.startsWith(':') &&
          p.toLowerCase() === pathSegs[i].toLowerCase()
      );
    if (!commonMatch) continue;

    if (pathSegs.length === patternSegments.length) {
      return { route, params: {}, isCrud: true, crudKind: 'list' };
    }
    if (pathSegs.length === patternSegments.length + 1) {
      return {
        route,
        params: {},
        isCrud: true,
        crudKind: 'item',
        crudId: decodeSegment(pathSegs[patternSegments.length]),
      };
    }
  }
  return null;
}

/**
 * Find the matching route in an environment for a method + path (prefix
 * already stripped by the caller).
 *
 * Precedence:
 *  1. HTTP routes — specificity (exact > :param > *), then declaration order.
 *     HEAD requests try 'head' routes first, then fall back to 'get' routes
 *     (Mockoon behavior).
 *  2. CRUD routes (only when no HTTP route matched this method+path) —
 *     endpoint = list op, endpoint/:id = item op; declaration order.
 *
 * Returns `null` when nothing matches (the caller 404s or proxies).
 */
export function findRoute(env: Environment, method: string, path: string): RouteMatch | null {
  const m = method.toLowerCase();
  const http = httpRouteMatch(env, m, path);
  if (http) return http;
  if (m === 'head') {
    const get = httpRouteMatch(env, 'get', path);
    if (get) return get;
  }
  return crudRouteMatch(env, path);
}
