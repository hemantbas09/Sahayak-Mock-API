/**
 * Proxy forwarding (DESIGN.md §2.8 — proxy semantics are Mockoon-identical;
 * §14 deviation 1 covers per-env listeners, not proxying).
 *
 * Two layers, mirroring the "pure engine" rule (DESIGN.md §4):
 *
 * - `buildProxyTarget` and `toEngineResponse` are PURE: they decide (and
 *   where) to proxy and wrap the outcome. No I/O, deterministic — fully
 *   unit-testable.
 * - `forwardProxy` is the ONLY impure function here: it opens the outgoing
 *   request via node:http / node:https (chosen by the target url scheme).
 *
 * Header policy (Mockoon-style forwarding):
 * - Hop-by-hop headers are stripped: connection, keep-alive,
 *   proxy-authenticate, proxy-authorization, te, trailer,
 *   transfer-encoding, upgrade, host (host is rewritten to the target).
 * - Authorization is DELIBERATELY preserved: Mockoon forwards auth headers
 *   through the proxy, and the upstream is exactly what the user wants to
 *   reach with the user's credentials.
 * - Content-Length is recomputed from the forwarded body.
 *
 * v1 limitation (documented per contract): response bodies are collected as
 * Buffer and decoded as UTF-8. Binary payloads may be corrupted on relay;
 * a chunk-level binary pass-through is a possible v2 refinement.
 */
import http from 'node:http';
import https from 'node:https';
import type { Environment, Route } from '../lib/types';
import type { EngineRequest, EngineResponse } from './context';

/** A fully-resolved proxy target (pure computation). */
export interface ProxyTarget {
  /** Absolute URL to forward to. */
  url: string;
  /** Original method (normalized to uppercase for the wire). */
  method: string;
  /** Forwarded headers (Host rewritten, hop-by-hop stripped). */
  headers: Record<string, string>;
  /** Raw body, forwarded as-is; null when there is no body. */
  body: string | null;
  /** Which proxy setting produced this target. */
  source: 'env' | 'route';
}

/** Hop-by-hop headers that must not be forwarded (RFC 7230 §6.1 + host). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * Decide whether (and where) to proxy.
 *
 * - route-level: a MATCHED route with `proxyHost` set proxies everything
 *   that reaches it (Mockoon "pure proxy route" / "proxy everything except
 *   these routes"). The caller invokes this for matched proxy routes.
 * - env fallback: only when NO route matched (caller passes
 *   matched=false / route=null) and `env.proxyMode` is on with a host.
 *
 * Returns null when there is no proxy target.
 *
 * URL construction: target = proxyHost (with scheme; `http://` assumed when
 * missing) + path. Path used: `req.path` (prefix already stripped) when
 * removePrefix is on — or `deps.removePrefixPath(req.path)` when the caller
 * supplies the strip function — else the ORIGINAL request path (the caller
 * passes `originalPath` explicitly for the non-strip case, query string
 * included if present).
 *
 * removePrefix flag: `env.proxyRemovePrefix` for env proxy,
 * `route.proxyRemovePrefix` for route proxy.
 */
export function buildProxyTarget(
  env: Environment,
  route: Route | null,
  matched: boolean,
  req: EngineRequest,
  originalPath: string,
  deps?: { removePrefixPath?: (p: string) => string }
): ProxyTarget | null {
  let proxyHost = '';
  let removePrefix = false;
  let source: 'env' | 'route' = 'env';

  if (matched && route !== null && route.proxyHost) {
    proxyHost = route.proxyHost;
    removePrefix = route.proxyRemovePrefix;
    source = 'route';
  } else if (!matched && env.proxyMode && env.proxyHost) {
    proxyHost = env.proxyHost;
    removePrefix = env.proxyRemovePrefix;
  } else {
    return null;
  }

  let path: string;
  if (removePrefix) {
    // req.path is the path WITHOUT its query string. deps.removePrefixPath,
    // when supplied by the caller's pipeline, performs the prefix strip;
    // without it, req.path is already prefix-stripped (EngineRequest
    // contract). Re-append the query string so it is not lost on forward.
    path = deps?.removePrefixPath ? deps.removePrefixPath(req.path) : req.path;
    const q = req.url.indexOf('?');
    if (q >= 0) path += req.url.slice(q);
  } else {
    // Non-strip case: forward the original request target as-is. The caller
    // is responsible for passing the full original target (path + query).
    path = originalPath;
  }

  const base = withScheme(proxyHost);
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = base.endsWith('/') && p.startsWith('/') ? `${base.slice(0, -1)}${p}` : `${base}${p}`;

  const targetHost = new URL(url).host;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers[key] = value; // Authorization etc. are intentionally forwarded.
  }
  headers['host'] = targetHost; // rewritten to the upstream host[:port]

  // Body: raw string forwarded as-is; empty treated as "no body".
  const body = req.rawBody != null && req.rawBody !== '' ? req.rawBody : null;
  if (body != null) {
    headers['content-length'] = String(Buffer.byteLength(body, 'utf8'));
  } else {
    // No body is forwarded — a stale upstream-facing content-length would
    // make the target wait for bytes that never come, so drop it.
    delete headers['content-length'];
  }

  // EngineRequest stores the method lowercased; the wire form is uppercase.
  return { url, method: req.method.toUpperCase(), headers, body, source };
}

/** A resolved proxy response (or the mapped 500 error). */
export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  /** Set when the forward failed (timeout/unreachable) — error mapped per §2.8. */
  error?: string;
}

/**
 * Forward a request. Uses node:http / node:https (chosen by target url
 * scheme). `timeoutMs` (default 10000) applies to socket idle between
 * events (connect AND response streaming). On timeout / connect error the
 * request is aborted and mapped to:
 * `{ statusCode: 500, body: '{"error":"Proxy unreachable: <reason>"}', error }`.
 *
 * Response bodies are collected as Buffer and decoded as UTF-8
 * (v1 limitation, documented above).
 */
export function forwardProxy(target: ProxyTarget, timeoutMs: number = 10000): Promise<ProxyResult> {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;

    const fail = (reason: string): void => {
      if (settled) return;
      settled = true;
      const message = `Proxy unreachable: ${reason}`;
      resolve({
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: message }),
        error: message,
      });
    };

    let targetUrl: URL;
    try {
      targetUrl = new URL(target.url);
    } catch (err) {
      fail(`invalid proxy URL: ${(err as Error).message}`);
      return;
    }

    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: target.method,
        headers: target.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            headers[key] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({
            // Undefined only for malformed responses; map to a 500.
            statusCode: res.statusCode ?? 500,
            headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (err) => fail(err.message));
      }
    );

    // Socket idle timer between events (covers connect + response streaming).
    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      fail(`timeout after ${timeoutMs} ms`);
      req.destroy();
    });
    req.on('error', (err) => {
      fail(timedOut ? `timeout after ${timeoutMs} ms` : err.message);
    });

    if (target.body != null) req.write(target.body);
    req.end();
  });
}

/**
 * Wrap a ProxyResult into an EngineResponse (DESIGN.md §2.8: response marked
 * with `X-Sahayak-Proxy: true`). A mapped proxy error is also surfaced in
 * `warnings` so it shows up in the request logs / UI.
 */
export function toEngineResponse(result: ProxyResult): EngineResponse {
  return {
    statusCode: result.statusCode,
    headers: { ...result.headers, 'X-Sahayak-Proxy': 'true' },
    body: result.body,
    fileContentType: null,
    latencyMs: 0,
    warnings: result.error ? [result.error] : [],
    proxied: true,
    routeUuid: null,
  };
}

/** Ensure a proxyHost value carries a scheme (assume http:// when missing). */
function withScheme(host: string): string {
  const h = host.trim();
  if (/^https?:\/\//i.test(h)) return h;
  return `http://${h}`;
}
