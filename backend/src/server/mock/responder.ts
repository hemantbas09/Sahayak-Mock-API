/**
 * Pure mock resolution: given an environment and an incoming request, decide
 * what to send back. No Express types in here - the HTTP layer (api.ts) turns
 * the result into an actual response and log entry.
 */
import { MockEnvironment, MockRoute, RouteResponse } from '../../types';
import { findMatchingRoute, findAnyMethodRoute } from './matcher';
import { evaluateRules, RequestContext } from './rules';
import { validateBody } from './validation';
import { parseTemplate, TemplateContext } from './templates';
import { slugify } from '../../lib/slugify';

export interface IncomingMockRequest {
  method: string;
  /** Path after /mock/:envId, environment prefix already stripped. */
  path: string;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
}

export type ResolvedResponse =
  | { kind: 'response'; statusCode: number; headers: Record<string, string>; body: string; delayMs: number; matchedRoute: string; warnings: string[] }
  | { kind: 'not_found'; statusCode: number; body: string; matchedRoute: string }
  | { kind: 'method_mismatch'; statusCode: number; headers: Record<string, string>; body: string; matchedRoute: string; warning: string }
  | { kind: 'validation_failed'; statusCode: number; headers: Record<string, string>; body: string; matchedRoute: string };

export function findEnvironment(environments: MockEnvironment[], identifier: string): MockEnvironment | null {
  const wantedSlug = slugify(identifier);
  return (
    environments.find((e) => e.id === identifier) ||
    environments.find((e) => slugify(e.name) === wantedSlug && wantedSlug !== '') ||
    null
  );
}

/** Strip the environment's endpoint prefix from the raw path, segment by segment. */
export function stripPrefix(env: MockEnvironment, rawPath: string): string {
  let mockPath = rawPath;
  const prefix = env.endpointPrefix ? env.endpointPrefix.replace(/^\/+|\/+$/g, '').trim() : '';
  if (!prefix) return mockPath;

  const cleanMockPath = mockPath.replace(/^\/+|\/+$/g, '');
  const prefixSegments = prefix.split('/');
  const pathSegments = cleanMockPath.split('/');

  let matchesPrefix = true;
  for (let i = 0; i < prefixSegments.length; i++) {
    if (pathSegments[i] !== prefixSegments[i]) {
      matchesPrefix = false;
      break;
    }
  }

  if (matchesPrefix) {
    mockPath = pathSegments.slice(prefixSegments.length).join('/');
  }
  return mockPath;
}

function resolveValidationSchema(route: MockRoute, matchedResponse: RouteResponse): string | null {
  if (matchedResponse.validationEnabled === false) return null;
  if (matchedResponse.validationInterface && matchedResponse.validationInterface.trim() !== '') {
    return matchedResponse.validationInterface;
  }
  // Fall back to the default/selected response's schema so GET-style defaults
  // can still enforce contracts for other responses on the same route.
  const defaultSchema = route.responses
    .find((r) => r.id === route.selectedResponseId)?.validationInterface ||
    route.responses.find((r) => r.validationInterface && r.validationInterface.trim() !== '')?.validationInterface;
  return defaultSchema && defaultSchema.trim() !== '' ? defaultSchema : null;
}

/** Build the CORS headers for an OPTIONS preflight on this environment. */
export function buildPreflightHeaders(env: MockEnvironment): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'Access-Control-Max-Age': '86400',
  };

  // Only allow credentialed requests together with a concrete origin;
  // browsers reject the combination of * with credentials.
  const originHeader = env.headers?.find(
    (h) => h.key && h.key.toLowerCase() === 'access-control-allow-origin' && h.value
  );
  if (originHeader) {
    headers['Access-Control-Allow-Origin'] = originHeader.value;
    if (originHeader.value !== '*') {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }

  headers['Access-Control-Allow-Headers'] = env.headers?.find(
    (h) => h.key && h.key.toLowerCase() === 'access-control-allow-headers' && h.value
  )?.value ||
    'Content-Type, Origin, Accept, Authorization, Content-Length, X-Requested-With';

  return headers;
}

/**
 * Resolve the mock response for a request.
 */
export function resolveMockResponse(
  env: MockEnvironment,
  req: IncomingMockRequest
): ResolvedResponse {
  const mockPath = stripPrefix(env, req.path);
  const incomingMethod = req.method.toLowerCase();

  const context: RequestContext & TemplateContext = {
    query: req.query,
    body: req.body,
    headers: req.headers,
    params: {},
  };

  const match = findMatchingRoute(env.routes, incomingMethod, mockPath);

  if (!match) {
    const alternative = findAnyMethodRoute(env.routes, mockPath);
    if (alternative) {
      const altMethod = alternative.method.toUpperCase();
      const requestedMethod = req.method.toUpperCase();
      const warning = `Method Mismatch: Expected ${altMethod}`;
      const errorBody = JSON.stringify(
        {
          success: false,
          message: `Method Mismatch: You requested ${requestedMethod} but this endpoint is configured for ${altMethod}.`,
          data: {
            responseCode: 'METHOD_MISMATCH',
            configuredMethod: altMethod,
            requestedMethod,
          },
        },
        null,
        2
      );
      return {
        kind: 'method_mismatch',
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: errorBody,
        matchedRoute: `${altMethod} /${alternative.endpoint} (Method Mismatch)`,
        warning,
      };
    }

    return {
      kind: 'not_found',
      statusCode: 404,
      body: `Mock route [${req.method.toUpperCase()} /${mockPath}] not found in environment "${env.name}".`,
      matchedRoute: 'None (No matching endpoints)',
    };
  }

  const { route, params } = match;
  context.params = params;

  // 1) Pick a response: first one whose rules match, else the default.
  let matchedResponse: RouteResponse | null = null;
  for (const resp of route.responses) {
    if (resp.rules && resp.rules.length > 0 && evaluateRules(resp.rules, resp.rulesOperator, context)) {
      matchedResponse = resp;
      break;
    }
  }
  if (!matchedResponse) {
    matchedResponse = route.responses.find((r) => r.id === route.selectedResponseId) || route.responses[0] || null;
  }

  if (!matchedResponse) {
    return {
      kind: 'not_found',
      statusCode: 404,
      body: `Route [${route.method.toUpperCase()} /${route.endpoint}] exists but has no responses configured.`,
      matchedRoute: `${route.method.toUpperCase()} /${route.endpoint}`,
    };
  }

  // 2) Payload validation (non-GET only).
  if (req.method.toUpperCase() !== 'GET') {
    const schema = resolveValidationSchema(route, matchedResponse);
    if (schema) {
      const validation = validateBody(req.body, schema);
      if (!validation.valid) {
        return {
          kind: 'validation_failed',
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            {
              success: false,
              message: 'Payload validation failed: request body does not match the required interface/schema contract.',
              errors: validation.errors,
            },
            null,
            2
          ),
          matchedRoute: `${route.method.toUpperCase()} /${route.endpoint}`,
        };
      }
    }
  }

  // 3) Latency: route override, else environment fallback.
  const delayMs =
    route.latency !== undefined && route.latency !== null && route.latency >= 0 ? route.latency : env.latency || 0;

  // 4) Headers: environment globals, then response overrides.
  const responseHeaders: Record<string, string> = {};
  for (const h of env.headers || []) {
    if (h.key && h.value) responseHeaders[h.key] = parseTemplate(h.value, context);
  }
  for (const h of matchedResponse.headers || []) {
    if (h.key && h.value) responseHeaders[h.key] = parseTemplate(h.value, context);
  }

  // 5) Body (templated).
  const warnings: string[] = [];
  const body = parseTemplate(matchedResponse.body || '', context);

  if (
    body &&
    Object.entries(responseHeaders).some(
      ([k, v]) => k.toLowerCase() === 'content-type' && String(v).toLowerCase().includes('application/json')
    )
  ) {
    try {
      JSON.parse(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(
        `Content-Type is 'application/json' but the body is not valid JSON (clients may fail to parse it). Error: ${message}. Raw body: "${body}"`
      );
      console.warn(`[Mock] Route [${route.method.toUpperCase()} /${route.endpoint}] returned invalid JSON:`, body);
    }
  }

  return {
    kind: 'response',
    statusCode: matchedResponse.statusCode || 200,
    headers: responseHeaders,
    body,
    delayMs,
    matchedRoute: `${route.method.toUpperCase()} /${route.endpoint}`,
    warnings,
  };
}
