/**
 * Mock response responder (DESIGN.md §2.3, §2.4, §2.15 — engine purity §4).
 *
 * PURE module: no fs, no templating engine, no rule evaluation, no CRUD
 * execution. Every impure capability is dependency-injected through
 * `ResponderDeps`:
 *   - `renderTemplate`  → templating.ts (Handlebars engine)
 *   - `resolveFile`     → files.ts (the one impure engine module, bound to DATA_DIR)
 *   - `executeCrud`     → crud.ts
 *   - `evaluateRules`   → rules.ts (injected to avoid a circular dependency;
 *                          when absent, no rule is treated as matching)
 *   - `rng`             → tests inject a deterministic RNG
 *
 * Response selection (§2.3, verbatim Mockoon):
 *   1. `responseMode === 'SEQUENTIAL'` → serve responses[index % length] and
 *      advance `runtime.sequentialIndex[route.uuid]`; rules are ignored.
 *   2. `responseMode === 'RANDOM'`     → random index via the injected rng
 *      (default `Math.random`); rules are ignored.
 *   3. rules mode (responseMode null)  → walk responses IN DECLARATION ORDER;
 *      the FIRST response whose rules all match is served. Responses with
 *      ZERO rules are SKIPPED (a rule-less response is reachable only as the
 *      default).
 *   4. No ruled match → the response with `defaultResponse === true`.
 *   5. No default flag anywhere → the FIRST response in the array
 *      (documented fallback — selection is never undefined).
 *
 * Note: §2.3 step 5 of the design (the route-level "rules disabled" toggle →
 * always the default response) has no field on the current `Route` type yet;
 * when the field lands, a rules-disabled route should short-circuit to step 4.
 *
 * Body types (§2.4):
 *   - INLINE     → rendered body; Content-Type from a (case-insensitive)
 *                  response header, else env default header, else
 *                  'application/json'.
 *   - FILE       → path is templated (Mockoon templates file paths), then
 *                  resolved via `deps.resolveFile`; Content-Type from the
 *                  extension (per `resolveFile`) unless a response header
 *                  overrides it. Missing file → 500 with
 *                  `{"error":"File not found: <path>"}` + warning (documented
 *                  choice: a missing file is a server-side configuration
 *                  error, not a client error).
 *   - DATABUCKET → the linked bucket's generated content served RAW (no
 *                  templating — Mockoon serves generated bucket content
 *                  as-is). Missing bucket → '' + warning.
 *   - NONE       → ''.
 *
 * CRUD routes (§2.5): a `match.isCrud` match goes straight to
 * `deps.executeCrud` with the linked bucket's content
 * (`route.responses[0].databucketId` → runtime state); rule selection is
 * SKIPPED (extra ruled responses may override CRUD behavior per §2.5, but
 * are out of scope for the v1 engine).
 *
 * Proxying (§2.8) is decided by the pipeline BEFORE this module runs; the
 * responder only produces mock responses.
 */
import type {
  Environment,
  Route,
  RouteResponse,
  RouteRule,
  RulesOperator,
} from '../lib/types';
import type { EngineRequest, EngineResponse, EnvRuntime } from './context';
import { clampLatency } from './context';

/**
 * Structural mirror of the matcher's match result.
 *
 * `matcher.ts` is being written in parallel; once it lands, its `RouteMatch`
 * satisfies this shape and this module can switch to
 * `import { RouteMatch } from './matcher'` — structural typing keeps the two
 * compatible in the meantime.
 */
export interface RouteMatchLike {
  route: Route;
  params: Record<string, string>;
  isCrud: boolean;
  crudKind?: 'list' | 'item';
  crudId?: string;
}

/** Impure capabilities injected into the pure responder. */
export interface ResponderDeps {
  /** Renders a template string; returns { output, warnings }. (The templating engine.) */
  renderTemplate: (template: string) => { output: string; warnings: string[] };
  /** Resolves a FILE body: returns { body, contentType } or null when missing. Caller does fs. */
  resolveFile: (filePath: string) => { body: string; contentType: string } | null;
  /** Executes a CRUD operation; returns { statusCode, body, nextContent }. */
  executeCrud?: (
    content: string,
    kind: 'list' | 'item',
    id: string | undefined
  ) => { statusCode: number; body: string; nextContent: string };
  /** Injectable RNG (default Math.random) for RANDOM mode — tests pass a deterministic one. */
  rng?: () => number;
  /**
   * Evaluates a response's rule set (rules + AND/OR operator). Injected to
   * avoid a circular dependency on rules.ts. When not provided, no rule is
   * treated as matching — the walk falls through to the default (or first)
   * response.
   */
  evaluateRules?: (rules: RouteRule[], operator: RulesOperator) => boolean;
}

/** Permissive CORS headers on every mock response (DESIGN.md §2.15). */
const CORS_HEADERS: ReadonlyArray<[string, string]> = [
  ['Access-Control-Allow-Origin', '*'],
  ['Access-Control-Allow-Methods', '*'],
  ['Access-Control-Allow-Headers', '*'],
];

/** 404 body per DESIGN.md §2.2 — byte-exact. */
const NOT_FOUND_BODY = '{"error":"Route not matched"}';

function corsHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of CORS_HEADERS) out[key] = value;
  return out;
}

// ---------------------------------------------------------------------------
// Response selection (§2.3)
// ---------------------------------------------------------------------------

/**
 * §2.3 selection algorithm (SEQUENTIAL rotation / RANDOM / rules walk /
 * default / first-response fallback).
 *
 * Precondition: `route.responses` is non-empty — `resolveMockResponse`
 * guards the empty case with the §2.2 404 body before calling this.
 */
export function selectResponse(
  route: Route,
  runtime: EnvRuntime,
  deps: ResponderDeps
): RouteResponse {
  const responses = route.responses;

  // 1) SEQUENTIAL — rotate one response per request, ignoring rules.
  if (route.responseMode === 'SEQUENTIAL') {
    const index = (runtime.sequentialIndex.get(route.uuid) ?? 0) % responses.length;
    const response = responses[index];
    runtime.sequentialIndex.set(route.uuid, (index + 1) % responses.length);
    return response;
  }

  // 2) RANDOM — random index via the injected rng, ignoring rules.
  if (route.responseMode === 'RANDOM') {
    const rng = deps.rng ?? Math.random;
    const index = Math.floor(rng() * responses.length) % responses.length;
    return responses[index];
  }

  // 3) Rules mode — walk IN DECLARATION ORDER; first fully-matching RUled
  //    response wins. Zero-rule responses are SKIPPED.
  for (const response of responses) {
    if (response.rules.length === 0) continue;
    if (deps.evaluateRules !== undefined && deps.evaluateRules(response.rules, response.rulesOperator)) {
      return response;
    }
  }

  // 4) No ruled match → the response flagged defaultResponse.
  const defaultResponse = responses.find((r) => r.defaultResponse);
  if (defaultResponse !== undefined) return defaultResponse;

  // 5) No default flag anywhere → first response (documented fallback).
  return responses[0];
}

// ---------------------------------------------------------------------------
// Full response build
// ---------------------------------------------------------------------------

/**
 * Build the full EngineResponse for a matched route.
 *
 * Steps: (1) per-route request counter increment (runtime.requestCounts),
 * (2) response selection — or the §2.2 404 body when the route carries no
 * responses at all, (3) bodyType dispatch (INLINE render / FILE via
 * deps.resolveFile / DATABUCKET raw / NONE ''), (4) headers: env defaults +
 * response headers (rendered, response wins on case-insensitive key
 * collision), Content-Type per §2.4, (5) permissive CORS headers on EVERY
 * response, (6) preflight: OPTIONS + access-control-request-method → 204,
 * no body, (7) latency = clampLatency(response.latency),
 * (8) warnings aggregated from all renders and file/bucket failures.
 *
 * Note: the request counter is incremented BEFORE the preflight shortcut, so
 * OPTIONS requests count toward the route's request_number like any other
 * request (Mockoon counts every request).
 */
export function resolveMockResponse(
  env: Environment,
  match: RouteMatchLike,
  req: EngineRequest,
  runtime: EnvRuntime,
  deps: ResponderDeps
): EngineResponse {
  const route = match.route;

  // (1) Per-route request counter (request_number rule target / requestNumber).
  runtime.requestCounts.set(route.uuid, (runtime.requestCounts.get(route.uuid) ?? 0) + 1);

  // (6) CORS preflight — answered before body/latency handling: 204, no body.
  if (req.method === 'options' && req.headers['access-control-request-method'] !== undefined) {
    return {
      statusCode: 204,
      headers: { ...corsHeaders() },
      body: '',
      fileContentType: null,
      latencyMs: 0,
      warnings: [],
      proxied: false,
      routeUuid: route.uuid,
    };
  }

  // A route with zero responses cannot serve anything → §2.2 404 body.
  if (route.responses.length === 0) {
    return notFoundResponse();
  }

  // CRUD routes (§2.5): the bucket link (responses[0]) IS the CRUD handler.
  // Rule selection is SKIPPED — extra ruled responses are out of scope for
  // the v1 engine (documented above).
  if (match.isCrud && deps.executeCrud !== undefined) {
    return resolveCrud(route, match, runtime, deps.executeCrud);
  }

  // (2)–(5), (7), (8).
  const selected = selectResponse(route, runtime, deps);
  return buildResponse(env, route, selected, runtime, deps);
}

/**
 * Build the EngineResponse for one selected route response: bodyType
 * dispatch, header merge, Content-Type, CORS, latency, warnings.
 */
function buildResponse(
  env: Environment,
  route: Route,
  response: RouteResponse,
  runtime: EnvRuntime,
  deps: ResponderDeps
): EngineResponse {
  const warnings: string[] = [];

  // (3) Body dispatch by bodyType (§2.4).
  let body: string;
  let fileContentType: string | null = null;
  let fileFailed = false;
  let statusCode = response.statusCode;

  switch (response.bodyType) {
    case 'INLINE': {
      const rendered = deps.renderTemplate(response.body);
      body = rendered.output;
      warnings.push(...rendered.warnings);
      break;
    }
    case 'FILE': {
      // Mockoon templates FILE paths too (§2.11: templating runs on FILE paths).
      const renderedPath = deps.renderTemplate(response.filePath);
      warnings.push(...renderedPath.warnings);
      const file = deps.resolveFile(renderedPath.output);
      if (file === null) {
        // Documented choice: missing/unreadable file → 500 + clear body +
        // warning (server-side configuration error, not a client error).
        fileFailed = true;
        statusCode = 500;
        body = JSON.stringify({ error: `File not found: ${renderedPath.output}` });
        warnings.push(`File not found: ${renderedPath.output}`);
      } else {
        body = file.body;
        fileContentType = file.contentType;
      }
      break;
    }
    case 'DATABUCKET': {
      // NO templating: bucket content is already generated (templated once at
      // generation time) — Mockoon serves it as-is.
      const content = runtime.buckets.get(response.databucketId);
      if (content === undefined) {
        body = '';
        warnings.push(`Data bucket not found: ${response.databucketId}`);
      } else {
        body = content;
      }
      break;
    }
    case 'NONE':
    default:
      body = '';
      break;
  }

  // (4) Headers: env defaults, then response headers. Response wins on
  //     case-insensitive key collision (the later key also sets the spelling).
  //     Content-Type entries are tracked separately and assigned once below.
  const headers: Record<string, string> = {};
  const putHeader = (key: string, value: string): void => {
    const lower = key.toLowerCase();
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === lower) delete headers[existing];
    }
    headers[key] = value;
  };

  let envContentType: string | undefined;
  let responseContentType: string | undefined;

  for (const kv of env.headers) {
    const rendered = deps.renderTemplate(kv.value);
    warnings.push(...rendered.warnings);
    if (kv.key.toLowerCase() === 'content-type') {
      envContentType = rendered.output;
    } else {
      putHeader(kv.key, rendered.output);
    }
  }
  for (const kv of response.headers) {
    const rendered = deps.renderTemplate(kv.value);
    warnings.push(...rendered.warnings);
    if (kv.key.toLowerCase() === 'content-type') {
      responseContentType = rendered.output;
    } else {
      putHeader(kv.key, rendered.output);
    }
  }

  // Content-Type precedence:
  //   response header (any case)
  //   > FILE extension mime (from resolveFile)
  //   > env default header
  //   > 'application/json' — the implicit default for INLINE (and for the
  //     JSON error body of a failed FILE).
  let contentType: string | undefined;
  if (responseContentType !== undefined) {
    contentType = responseContentType;
  } else if (fileContentType !== null) {
    contentType = fileContentType;
  } else if (response.bodyType === 'INLINE' || fileFailed) {
    contentType = envContentType ?? 'application/json';
  } else {
    contentType = envContentType;
  }
  if (contentType !== undefined) headers['Content-Type'] = contentType;

  // (5) Permissive CORS on EVERY response (§2.15) — added unless the user
  //     defined the same header (a mock author may still tighten it).
  for (const [key, value] of CORS_HEADERS) {
    const alreadySet = Object.keys(headers).some((k) => k.toLowerCase() === key.toLowerCase());
    if (!alreadySet) headers[key] = value;
  }

  // (7) Latency clamped to [0, 60000] (§2.15). (8) warnings aggregated.
  return {
    statusCode,
    headers,
    body,
    fileContentType,
    latencyMs: clampLatency(response.latency),
    warnings,
    proxied: false,
    routeUuid: route.uuid,
  };
}

/**
 * CRUD route handler response (§2.5): the bucket-linked responses[0] is the
 * CRUD handler. `executeCrud` returns { statusCode, body, nextContent };
 * `nextContent` is applied to the runtime bucket state by the pipeline/Store
 * (kept out of the EngineResponse — the engine result is sendable data).
 */
function resolveCrud(
  route: Route,
  match: RouteMatchLike,
  runtime: EnvRuntime,
  executeCrud: NonNullable<ResponderDeps['executeCrud']>
): EngineResponse {
  const warnings: string[] = [];
  const first = route.responses[0];
  const bucketId = first !== undefined ? first.databucketId : '';
  const content = runtime.buckets.get(bucketId);
  if (first !== undefined && content === undefined) {
    warnings.push(`CRUD route data bucket not found: ${bucketId}`);
  }
  const result = executeCrud(content ?? '', match.crudKind ?? 'list', match.crudId);
  return {
    statusCode: result.statusCode,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: result.body,
    fileContentType: null,
    latencyMs: clampLatency(first !== undefined ? first.latency : 0),
    warnings,
    proxied: false,
    routeUuid: route.uuid,
  };
}

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

/**
 * 404 response body per DESIGN.md §2.2 — exact body
 * `{"error":"Route not matched"}` (statusCode 404, permissive CORS, JSON
 * content type). `warnings` are passed through (e.g. from an upstream stage).
 */
export function notFoundResponse(warnings: string[] = []): EngineResponse {
  return {
    statusCode: 404,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: NOT_FOUND_BODY,
    fileContentType: null,
    latencyMs: 0,
    warnings,
    proxied: false,
    routeUuid: null,
  };
}
