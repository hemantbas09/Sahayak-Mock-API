/**
 * Unit tests for the pure mock responder (DESIGN.md §2.3/§2.4/§2.15).
 *
 * No real templating engine: `renderTemplate` is a fake that records its
 * calls and does a simple `{{x}}` → `VALUE(x)` replacement, with optional
 * per-template injected warnings. `resolveFile` and `executeCrud` are stubs;
 * `evaluateRules` and `rng` are deterministic stubs.
 */
import { describe, it, expect } from 'vitest';
import type {
  DataBucket,
  Environment,
  Route,
  RouteResponse,
  RouteRule,
} from '../src/lib/types';
import type { EngineRequest, EnvRuntime } from '../src/mock/context';
import { createEnvRuntime } from '../src/mock/context';
import type { ResponderDeps } from '../src/mock/responder';
import {
  notFoundResponse,
  resolveMockResponse,
  selectResponse,
} from '../src/mock/responder';

// ---------------------------------------------------------------------------
// Fakes & fixtures
// ---------------------------------------------------------------------------

interface RenderCall {
  template: string;
  output: string;
  warnings: string[];
}

const NO_WARNINGS: string[] = [];

/**
 * Fake renderTemplate: records every call; replaces `{{x}}` with
 * `VALUE(x)`; adds the templates listed in `warnTemplates` as warnings.
 */
function makeRenderTemplate(warnTemplates: string[] = []): {
  calls: RenderCall[];
  renderTemplate: ResponderDeps['renderTemplate'];
} {
  const calls: RenderCall[] = [];
  const renderTemplate: ResponderDeps['renderTemplate'] = (template: string) => {
    const output = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => `VALUE(${name})`);
    const warnings = warnTemplates.includes(template) ? [`warning for ${template}`] : [];
    calls.push({ template, output, warnings });
    return { output, warnings };
  };
  return { calls, renderTemplate };
}

function makeRule(uuid: string): RouteRule {
  return {
    uuid,
    target: 'query',
    property: 'q',
    modifier: '',
    operator: 'equals',
    invert: false,
    value: 'x',
  };
}

let responseCounter = 0;
function makeResponse(overrides: Partial<RouteResponse> = {}): RouteResponse {
  responseCounter += 1;
  return {
    uuid: `resp-${responseCounter}`,
    label: `response ${responseCounter}`,
    statusCode: 200,
    headers: [],
    latency: 0,
    bodyType: 'INLINE',
    body: '',
    filePath: '',
    databucketId: '',
    rules: [],
    rulesOperator: 'AND',
    defaultResponse: false,
    ...overrides,
  };
}

let envCounter = 0;
function makeEnv(
  route: Route,
  extra: { envHeaders?: { key: string; value: string }[]; data?: DataBucket[] } = {}
): Environment {
  envCounter += 1;
  return {
    uuid: `env-${envCounter}`,
    name: `env-${envCounter}`,
    port: 3000 + envCounter,
    endpointPrefix: '/api',
    headers: extra.envHeaders ?? [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [route],
    data: extra.data ?? [],
    version: 1,
  };
}

function makeRoute(overrides: Partial<Route> = {}): Route {
  return {
    uuid: `route-${responseCounter}-`,
    type: 'http',
    method: 'get',
    endpoint: '/users',
    documentation: '',
    responseMode: null,
    responses: [],
    proxyHost: '',
    proxyRemovePrefix: false,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<EngineRequest> = {}): EngineRequest {
  return {
    method: 'get',
    url: '/users',
    path: '/users',
    headers: {},
    query: {},
    body: '',
    rawBody: '',
    ip: '127.0.0.1',
    hostname: 'localhost',
    requestNumber: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ResponderDeps> = {}): {
  deps: ResponderDeps;
  render: { calls: RenderCall[] };
} {
  const render = makeRenderTemplate();
  const deps: ResponderDeps = {
    renderTemplate: render.renderTemplate,
    resolveFile: () => null,
    ...overrides,
  };
  return { deps, render };
}

/** A three-response SEQUENTIAL-ish route with distinct status codes. */
function threeResponseRoute(
  responseMode: Route['responseMode'],
  extra: Partial<Route> = {}
): Route {
  return makeRoute({
    uuid: 'route-seq',
    responseMode,
    responses: [
      makeResponse({ label: 'first', statusCode: 200, body: 'A' }),
      makeResponse({ label: 'second', statusCode: 201, body: 'B' }),
      makeResponse({ label: 'third', statusCode: 204, body: 'C' }),
    ],
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Selection algorithm (§2.3)
// ---------------------------------------------------------------------------

describe('selectResponse — §2.3 selection algorithm', () => {
  it('SEQUENTIAL: rotates 0,1,2,0,1 over 5 calls and ignores rules', () => {
    const route = threeResponseRoute('SEQUENTIAL', {
      responses: [
        makeResponse({ statusCode: 200, rules: [makeRule('r1')] }),
        makeResponse({ statusCode: 201 }),
        makeResponse({ statusCode: 204 }),
      ],
    });
    const runtime = createEnvRuntime(makeEnv(route));
    // evaluateRules ALWAYS matches — SEQUENTIAL must ignore it entirely.
    const { deps } = makeDeps({ evaluateRules: () => true });

    const seen: number[] = [];
    for (let i = 0; i < 5; i++) seen.push(selectResponse(route, runtime, deps).statusCode);
    expect(seen).toEqual([200, 201, 204, 200, 201]);
    // served indices 0,1,2,0,1 → pointer advanced to 2
    expect(runtime.sequentialIndex.get('route-seq')).toBe(2);
  });

  it('RANDOM: deterministic index sequence from the injected rng; rng is the only oracle', () => {
    const route = threeResponseRoute('RANDOM');
    const runtime = createEnvRuntime(makeEnv(route));
    // rng() → 0.0, 0.4, 0.8 → Math.floor(rng*3) % 3 = 0,1,2 → 0,1,2,0,1
    let call = 0;
    const { deps } = makeDeps({ rng: () => [0, 0.4, 0.8][call++ % 3] });

    const seen: number[] = [];
    for (let i = 0; i < 5; i++) seen.push(selectResponse(route, runtime, deps).statusCode);
    expect(seen).toEqual([200, 201, 204, 200, 201]);
    expect(call).toBe(5);
  });

  it('rules mode: serves the first (declaration order) response whose rules match', () => {
    const route = makeRoute({
      uuid: 'route-walk',
      responses: [
        makeResponse({ label: 'skip-zero', statusCode: 200 }), // zero rules → skipped
        makeResponse({ label: 'no-match', statusCode: 201, rules: [makeRule('r1')] }),
        makeResponse({ label: 'match', statusCode: 202, rules: [makeRule('r2')] }),
        makeResponse({ label: 'never', statusCode: 203, rules: [makeRule('r3')] }),
        makeResponse({ label: 'default', statusCode: 404, defaultResponse: true }),
      ],
    });
    const runtime = createEnvRuntime(makeEnv(route));
    const { deps } = makeDeps({
      evaluateRules: (rules) => rules[0].uuid === 'r2',
    });

    for (let i = 0; i < 3; i++) {
      const selected = selectResponse(route, runtime, deps);
      expect(selected.label).toBe('match');
      expect(selected.statusCode).toBe(202);
    }
  });

  it('rules mode: zero-rule responses are never selected by the walk (even if they look "matched")', () => {
    const route = makeRoute({
      responses: [
        makeResponse({ label: 'zero-rules-first', statusCode: 200 }),
        makeResponse({ label: 'default', statusCode: 404, defaultResponse: true }),
      ],
    });
    const runtime = createEnvRuntime(makeEnv(route));
    const { deps } = makeDeps({ evaluateRules: () => true });
    expect(selectResponse(route, runtime, deps).label).toBe('default');
  });

  it('rules mode: all miss → the defaultResponse is served', () => {
    const route = makeRoute({
      responses: [
        makeResponse({ statusCode: 200, rules: [makeRule('r1')] }),
        makeResponse({ statusCode: 201, rules: [makeRule('r2')] }),
        makeResponse({ statusCode: 404, defaultResponse: true }),
      ],
    });
    const runtime = createEnvRuntime(makeEnv(route));
    const { deps } = makeDeps({ evaluateRules: () => false });
    expect(selectResponse(route, runtime, deps).statusCode).toBe(404);
  });

  it('rules mode: no default flag anywhere → first response in the array (documented fallback)', () => {
    const route = makeRoute({
      responses: [
        makeResponse({ statusCode: 200, rules: [makeRule('r1')] }),
        makeResponse({ statusCode: 201, rules: [makeRule('r2')] }),
        makeResponse({ statusCode: 202 }),
      ],
    });
    const runtime = createEnvRuntime(makeEnv(route));
    const { deps } = makeDeps({ evaluateRules: () => false });
    expect(selectResponse(route, runtime, deps).statusCode).toBe(200);
  });

  it('rng is NOT called in SEQUENTIAL or rules mode', () => {
    const env = makeEnv(threeResponseRoute('SEQUENTIAL'));
    const runtime = createEnvRuntime(env);
    let rngCalls = 0;
    const rng = () => {
      rngCalls += 1;
      return 0.5;
    };

    const { deps: seqDeps } = makeDeps({ rng });
    for (let i = 0; i < 3; i++) selectResponse(env.routes[0], runtime, seqDeps);

    const rulesRoute = makeRoute({
      uuid: 'route-rng',
      responses: [makeResponse({ statusCode: 200, defaultResponse: true })],
    });
    const { deps: rulesDeps } = makeDeps({ rng });
    for (let i = 0; i < 3; i++) selectResponse(rulesRoute, runtime, rulesDeps);

    expect(rngCalls).toBe(0);
  });

  it('without an injected evaluateRules, no rule is treated as matching → default is served', () => {
    const route = makeRoute({
      responses: [
        makeResponse({ statusCode: 200, rules: [makeRule('r1')] }),
        makeResponse({ statusCode: 404, defaultResponse: true }),
      ],
    });
    const runtime = createEnvRuntime(makeEnv(route));
    const { deps } = makeDeps(); // no evaluateRules
    expect(selectResponse(route, runtime, deps).statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Body type dispatch (§2.4)
// ---------------------------------------------------------------------------

describe('resolveMockResponse — bodyType dispatch', () => {
  it('INLINE: body is rendered, default Content-Type application/json', () => {
    const env = makeEnv(makeRoute({ responses: [makeResponse({ body: 'hello {{x}}' })] }));
    const runtime = createEnvRuntime(env);
    const { deps, render } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.body).toBe('hello VALUE(x)');
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(render.calls.map((c) => c.template)).toContain('hello {{x}}');
  });

  it('INLINE: Content-Type from a response header (case-insensitive key)', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({ body: 'hi', headers: [{ key: 'Content-Type', value: 'text/plain' }] }),
        ],
      })
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.headers['Content-Type']).toBe('text/plain');
  });

  it('FILE: resolveFile is called with the RENDERED path; extension mime used; fileContentType set', () => {
    const seenPaths: string[] = [];
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({
            bodyType: 'FILE',
            filePath: 'templates/{{x}}.json',
            latency: 50,
          }),
        ],
      })
    );
    const runtime = createEnvRuntime(env);
    const { deps, render } = makeDeps({
      resolveFile: (p: string) => {
        seenPaths.push(p);
        return { body: '{"from":"file"}', contentType: 'application/json' };
      },
    });

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(seenPaths).toEqual(['templates/VALUE(x).json']);
    expect(render.calls.some((c) => c.template === 'templates/{{x}}.json')).toBe(true);
    expect(res.body).toBe('{"from":"file"}');
    expect(res.fileContentType).toBe('application/json');
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.latencyMs).toBe(50);
  });

  it('FILE: a response Content-Type header overrides the extension mime', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({
            bodyType: 'FILE',
            filePath: 'report.csv',
            headers: [{ key: 'Content-Type', value: 'text/csv' }],
          }),
        ],
      })
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps({
      resolveFile: () => ({ body: 'a,b', contentType: 'text/csv' }),
    });

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.headers['Content-Type']).toBe('text/csv');
    expect(res.fileContentType).toBe('text/csv');
  });

  it('FILE: missing file → 500, clear JSON error body, warning recorded', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({ bodyType: 'FILE', filePath: 'missing/{{x}}.json', statusCode: 200 }),
        ],
      })
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps({ resolveFile: () => null });

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.statusCode).toBe(500);
    expect(res.body).toBe(JSON.stringify({ error: 'File not found: missing/VALUE(x).json' }));
    expect(res.warnings).toEqual(['File not found: missing/VALUE(x).json']);
  });

  it('DATABUCKET: serves raw bucket content, render is NOT called on it', () => {
    const env = makeEnv(
      makeRoute({
        responses: [makeResponse({ bodyType: 'DATABUCKET', databucketId: 'b1' })],
      }),
      { data: [{ uuid: 'b1', name: 'bucket1', content: '{"raw":"{{notRendered}}"}' }] }
    );
    const runtime = createEnvRuntime(env);
    const { deps, render } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.body).toBe('{"raw":"{{notRendered}}"}');
    // render is only called for header values (none here) — never the bucket content
    expect(render.calls).toEqual([]);
    // env default Content-Type still applies when no header set
    expect(res.headers['Content-Type']).toBeUndefined();
  });

  it('DATABUCKET: missing bucket → empty body + warning', () => {
    const env = makeEnv(
      makeRoute({
        responses: [makeResponse({ bodyType: 'DATABUCKET', databucketId: 'nope' })],
      })
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.body).toBe('');
    expect(res.warnings).toEqual(['Data bucket not found: nope']);
  });

  it('NONE: empty body, no Content-Type, no render', () => {
    const env = makeEnv(makeRoute({ responses: [makeResponse({ bodyType: 'NONE' })] }));
    const runtime = createEnvRuntime(env);
    const { deps, render } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.body).toBe('');
    expect(res.headers['Content-Type']).toBeUndefined();
    expect(render.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Headers, CORS, preflight
// ---------------------------------------------------------------------------

describe('headers, CORS and preflight', () => {
  it('env default headers are merged UNDER response headers (response wins on key collision)', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({
            body: 'x',
            headers: [
              { key: 'X-Api', value: 'resp' },
              { key: 'X-Only-Resp', value: '1' },
            ],
          }),
        ],
      }),
      {
        envHeaders: [
          { key: 'X-Api', value: 'env' },
          { key: 'X-Only-Env', value: '1' },
        ],
      }
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.headers['X-Api']).toBe('resp'); // response wins on collision
    expect(res.headers['X-Only-Resp']).toBe('1');
    expect(res.headers['X-Only-Env']).toBe('1');
    expect(res.headers['Content-Type']).toBe('application/json');
  });

  it('header VALUES are rendered (env and response)', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({ body: 'x', headers: [{ key: 'X-Resp', value: 'from-{{a}}' }] }),
        ],
      }),
      { envHeaders: [{ key: 'X-Env', value: 'from-{{b}}' }] }
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.headers['X-Resp']).toBe('from-VALUE(a)');
    expect(res.headers['X-Env']).toBe('from-VALUE(b)');
  });

  it('every response carries the three permissive CORS headers', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({ body: 'x' }),
          makeResponse({ bodyType: 'FILE', filePath: 'a.txt' }),
          makeResponse({ bodyType: 'DATABUCKET', databucketId: 'b1' }),
          makeResponse({ bodyType: 'NONE' }),
        ],
      }),
      { data: [{ uuid: 'b1', name: 'b', content: 'c' }] }
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps({ resolveFile: () => ({ body: 'f', contentType: 'text/plain' }) });
    const req = makeRequest();
    const match = { route: env.routes[0], params: {}, isCrud: false };

    for (let i = 0; i < 4; i++) {
      const res = resolveMockResponse(env, match, req, runtime, deps);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(res.headers['Access-Control-Allow-Methods']).toBe('*');
      expect(res.headers['Access-Control-Allow-Headers']).toBe('*');
    }
  });

  it('OPTIONS preflight (access-control-request-method) → 204, empty body, CORS headers, zero latency', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({ body: 'should-not-be-served', latency: 9999 }),
        ],
      })
    );
    const runtime = createEnvRuntime(env);
    const { deps, render } = makeDeps();

    const res = resolveMockResponse(
      env,
      { route: env.routes[0], params: {}, isCrud: false },
      makeRequest({ method: 'options', headers: { 'access-control-request-method': 'POST' } }),
      runtime,
      deps
    );

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['Access-Control-Allow-Methods']).toBe('*');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('*');
    expect(res.latencyMs).toBe(0);
    expect(render.calls).toEqual([]); // preflight short-circuits before any render
    expect(res.routeUuid).toBe(env.routes[0].uuid);
  });

  it('OPTIONS without access-control-request-method is NOT a preflight → served normally', () => {
    const env = makeEnv(
      makeRoute({ responses: [makeResponse({ body: 'plain-options' })] })
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(
      env,
      { route: env.routes[0], params: {}, isCrud: false },
      makeRequest({ method: 'options' }),
      runtime,
      deps
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('plain-options');
  });
});

// ---------------------------------------------------------------------------
// Latency, warnings, request counter
// ---------------------------------------------------------------------------

describe('latency, warnings and request counting', () => {
  it('latency is clamped: negative → 0', () => {
    const env = makeEnv(
      makeRoute({ responses: [makeResponse({ body: 'x', latency: -50 })] })
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);
    expect(res.latencyMs).toBe(0);
  });

  it('latency is clamped: 999999 → 60000', () => {
    const env = makeEnv(
      makeRoute({ responses: [makeResponse({ body: 'x', latency: 999999 })] })
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);
    expect(res.latencyMs).toBe(60000);
  });

  it('warnings are aggregated from all render calls (body + headers)', () => {
    const env = makeEnv(
      makeRoute({
        responses: [
          makeResponse({
            body: 'body {{x}}',
            headers: [{ key: 'X-H', value: '{{x}}' }],
          }),
        ],
      }),
      { envHeaders: [{ key: 'X-E', value: '{{x}}' }] }
    );
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps({
      renderTemplate: (template) => ({
        output: 'out',
        warnings: [`warn:${template}`],
      }),
    });

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    // render order in buildResponse: body first, then env headers, then response headers
    expect(res.warnings).toEqual([
      'warn:body {{x}}', // body
      'warn:{{x}}', // env header
      'warn:{{x}}', // response header
    ]);
  });

  it('runtime.requestCounts is incremented per route across calls', () => {
    const routeA = makeRoute({ uuid: 'route-a', responses: [makeResponse({ body: 'a' })] });
    const routeB = makeRoute({ uuid: 'route-b', responses: [makeResponse({ body: 'b' })] });
    const env = makeEnv(routeA);
    env.routes.push(routeB);
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const matchA = { route: routeA, params: {}, isCrud: false };
    const matchB = { route: routeB, params: {}, isCrud: false };

    resolveMockResponse(env, matchA, makeRequest(), runtime, deps);
    resolveMockResponse(env, matchB, makeRequest(), runtime, deps);
    resolveMockResponse(env, matchA, makeRequest(), runtime, deps);

    expect(runtime.requestCounts.get('route-a')).toBe(2);
    expect(runtime.requestCounts.get('route-b')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

describe('notFoundResponse (§2.2)', () => {
  it('404 with the exact body {"error":"Route not matched"}', () => {
    const res = notFoundResponse();
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('{"error":"Route not matched"}');
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.routeUuid).toBeNull();
    expect(res.proxied).toBe(false);
    expect(res.warnings).toEqual([]);
  });

  it('passes warnings through', () => {
    const res = notFoundResponse(['w1']);
    expect(res.warnings).toEqual(['w1']);
  });

  it('a route with zero responses yields the §2.2 404 body', () => {
    const env = makeEnv(makeRoute({ uuid: 'route-empty', responses: [] }));
    const runtime = createEnvRuntime(env);
    const { deps } = makeDeps();

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: false }, makeRequest(), runtime, deps);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('{"error":"Route not matched"}');
  });
});

// ---------------------------------------------------------------------------
// CRUD routes (§2.5)
// ---------------------------------------------------------------------------

describe('CRUD routes', () => {
  const bucketContent = JSON.stringify([{ id: 1, name: 'alice' }]);

  function crudSetup(overrides: Partial<ResponderDeps> = {}) {
    const env = makeEnv(
      makeRoute({
        uuid: 'route-crud',
        type: 'crud',
        responses: [
          makeResponse({ bodyType: 'DATABUCKET', databucketId: 'b1', latency: 20 }),
        ],
      }),
      { data: [{ uuid: 'b1', name: 'users', content: bucketContent }] }
    );
    const runtime = createEnvRuntime(env);
    const match = {
      route: env.routes[0],
      params: {},
      isCrud: true,
      crudKind: 'list' as const,
    };
    return { env, runtime, match, ...makeDeps(overrides) };
  }

  it('delegates to executeCrud with the bucket content; JSON content-type; skips rule selection', () => {
    const calls: Array<{ content: string; kind: 'list' | 'item'; id: string | undefined }> = [];
    const { env, runtime, match, deps } = crudSetup({
      executeCrud: (content, kind, id) => {
        calls.push({ content, kind, id });
        return { statusCode: 200, body: '[{"id":2}]', nextContent: '[{"id":2}]' };
      },
    });

    const res = resolveMockResponse(env, match, makeRequest(), runtime, deps);

    expect(calls).toEqual([{ content: bucketContent, kind: 'list', id: undefined }]);
    expect(calls.length).toBe(1); // CRUD skips rule selection — exactly one execution
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('[{"id":2}]');
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.latencyMs).toBe(20); // clamped latency of the linked response
  });

  it('item kind and id are passed through', () => {
    const calls: Array<{ kind: 'list' | 'item'; id: string | undefined }> = [];
    const { env, runtime, deps } = crudSetup({
      executeCrud: (content, kind, id) => {
        calls.push({ kind, id });
        return { statusCode: 200, body: '{"id":1}', nextContent: content };
      },
    });
    const match = { route: env.routes[0], params: { id: '7' }, isCrud: true, crudKind: 'item' as const, crudId: '7' };

    const res = resolveMockResponse(env, match, makeRequest({ method: 'get' }), runtime, deps);

    expect(calls).toEqual([{ kind: 'item', id: '7' }]);
    expect(calls.length).toBe(1);
    expect(res.statusCode).toBe(200);
  });

  it('missing linked bucket → empty content passed, warning recorded', () => {
    const calls: Array<{ content: string }> = [];
    const { env, runtime, deps } = crudSetup({
      executeCrud: (content, kind, id) => {
        calls.push({ content });
        return { statusCode: 200, body: '[]', nextContent: content };
      },
    });
    runtime.buckets.clear(); // simulate a bucket that was never generated

    const res = resolveMockResponse(env, { route: env.routes[0], params: {}, isCrud: true, crudKind: 'list' }, makeRequest(), runtime, deps);

    expect(calls).toEqual([{ content: '' }]);
    expect(res.warnings).toEqual(['CRUD route data bucket not found: b1']);
  });
});
