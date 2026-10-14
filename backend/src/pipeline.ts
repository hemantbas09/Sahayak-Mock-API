/**
 * The shared mock-request pipeline (DESIGN.md §4: listeners run one pipeline).
 *
 * Flow: normalize → preflight short-circuit → strip prefix → match →
 * (route proxy | crud | response resolution | env proxy fallback | 404) →
 * latency applied by the caller → log.
 *
 * This is the ONE place the engine modules meet; every module stays pure
 * and individually unit-tested.
 */
import { XMLParser } from 'fast-xml-parser';
import { Environment } from './lib/types';
import {
  coerceBody,
  EngineRequest,
  EngineResponse,
  parseCookies,
  parseQueryString,
} from './mock/context';
import { findRoute, stripPrefix } from './mock/matcher';
import { resolveMockResponse, notFoundResponse } from './mock/responder';
import { buildProxyTarget, forwardProxy, toEngineResponse } from './mock/proxy';
import { render, createRenderContext } from './mock/templating';
import { evaluateRules, RuleContext } from './mock/rules';
import { handleCrud } from './mock/crud';
import { fileResolver } from './mock/files';
import { LogService } from './logs';
import { Store } from './state';

export interface RawMockRequest {
  method: string;
  /** Full request target: path + ?query */
  url: string;
  /** Lowercased header keys. */
  headers: Record<string, string>;
  rawBody: string;
  ip: string;
  hostname: string;
}

export interface PipelineDeps {
  store: Store;
  logs: LogService;
  /** Base dir for FILE bodies (DESIGN §1 deviation 2). */
  dataDir: string;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

export async function handleMockRequest(
  env: Environment,
  raw: RawMockRequest,
  deps: PipelineDeps
): Promise<EngineResponse> {
  const startedAt = Date.now();
  const runtime = deps.store.getRuntime(env.uuid);
  if (!runtime) {
    return notFoundResponse([`Environment runtime missing for ${env.uuid}`]);
  }

  // --- normalize ---
  const qIndex = raw.url.indexOf('?');
  const rawPath = qIndex === -1 ? raw.url : raw.url.slice(0, qIndex);
  const queryString = qIndex === -1 ? '' : raw.url.slice(qIndex + 1);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    decodedPath = rawPath;
  }

  const contentType = raw.headers['content-type'];
  const body = coerceBody(raw.rawBody, contentType, (xml: string) => xmlParser.parse(xml));
  const cookies = parseCookies(raw.headers.cookie);
  const query = parseQueryString(queryString);

  const effectivePrefix = env.endpointPrefix || (env.name ? `/${env.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}` : '');
  const pathAfterPrefix = stripPrefix(effectivePrefix, decodedPath);

  // --- CORS preflight: answered 204 without matching/logging (Mockoon) ---
  if (raw.method.toLowerCase() === 'options' && raw.headers['access-control-request-method']) {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: '',
      fileContentType: null,
      latencyMs: 0,
      warnings: [],
      proxied: false,
      routeUuid: null,
    };
  }

  // --- match (request counter: first request on a route = 1) ---
  const match = findRoute(env, raw.method.toLowerCase(), pathAfterPrefix);
  let requestNumber = 0;
  if (match) {
    requestNumber = (runtime.requestCounts.get(match.route.uuid) ?? 0) + 1;
    runtime.requestCounts.set(match.route.uuid, requestNumber);
  }

  const req: EngineRequest = {
    method: raw.method.toLowerCase(),
    url: raw.url,
    path: pathAfterPrefix,
    headers: raw.headers,
    query,
    body,
    rawBody: raw.rawBody,
    ip: raw.ip,
    hostname: raw.hostname,
    requestNumber,
  };

  // --- route-level proxy ---
  if (match && match.route.proxyHost) {
    const target = buildProxyTarget(env, match.route, true, req, rawPath);
    if (target) {
      const result = await forwardProxy(target);
      const response = toEngineResponse(result);
      response.routeUuid = match.route.uuid;
      await logResult(env.uuid, raw, req, response, Date.now() - startedAt, deps.logs);
      return response;
    }
  }

  // --- CRUD route ---
  if (match && match.isCrud) {
    const route = match.route;
    const bucketId = route.responses[0]?.databucketId ?? '';
    const content = runtime.buckets.get(bucketId) ?? '';
    const result = handleCrud(route, content, match.crudKind ?? 'list', match.crudId, req);
    if (result.nextContent !== content) {
      runtime.buckets.set(bucketId, result.nextContent);
    }
    const response: EngineResponse = {
      statusCode: result.statusCode,
      headers: {
        ...envHeaderMap(env),
        'Content-Type': 'application/json',
        ...corsHeaders(),
      },
      body: result.body,
      fileContentType: null,
      latencyMs: 0,
      warnings: [],
      proxied: false,
      routeUuid: route.uuid,
    };
    await logResult(env.uuid, raw, req, response, Date.now() - startedAt, deps.logs);
    return response;
  }

  // --- no match: environment proxy fallback or 404 ---
  if (!match) {
    const target = buildProxyTarget(env, null, false, req, rawPath);
    if (target) {
      const result = await forwardProxy(target);
      const response = toEngineResponse(result);
      await logResult(env.uuid, raw, req, response, Date.now() - startedAt, deps.logs);
      return response;
    }
    const response = notFoundResponse();
    await logResult(env.uuid, raw, req, response, Date.now() - startedAt, deps.logs);
    return response;
  }

  // --- standard response resolution ---
  const params = match.params ?? {};
  const renderCtx = createRenderContext({
    env,
    runtime,
    cookies,
    params,
    dataDir: deps.dataDir,
    req,
  });
  const ruleCtx: RuleContext = {
    req,
    cookies,
    params,
    runtime,
    requestNumber,
    renderValue: (val: string) => render(val, renderCtx).output,
  };
  const response = resolveMockResponse(env, match, req, runtime, {
    renderTemplate: (template: string) => render(template, renderCtx),
    resolveFile: fileResolver(deps.dataDir),
    evaluateRules: (rules, op) => evaluateRules(rules, op, ruleCtx),
    rng: Math.random,
  });
  await logResult(env.uuid, raw, req, response, Date.now() - startedAt, deps.logs);
  return response;
}

function envHeaderMap(env: Environment): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of env.headers ?? []) out[h.key] = h.value;
  return out;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
  };
}

async function logResult(
  envUuid: string,
  raw: RawMockRequest,
  req: EngineRequest,
  response: EngineResponse,
  latencyMs: number,
  logs: LogService
): Promise<void> {
  await logs.write({
    envUuid,
    method: raw.method.toUpperCase(),
    url: raw.url,
    ip: raw.ip,
    reqHeaders: raw.headers,
    query: req.query,
    reqBody: raw.rawBody,
    resStatus: response.statusCode,
    resHeaders: response.headers,
    resBody: response.body,
    routeUuid: response.routeUuid ?? '',
    latencyMs,
  });
}
