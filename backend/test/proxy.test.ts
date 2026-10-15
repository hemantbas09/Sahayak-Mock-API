/**
 * Tests for src/mock/proxy.ts (DESIGN.md §2.8).
 *
 * buildProxyTarget / toEngineResponse are pure → bulk of the suite.
 * forwardProxy does real I/O against an ephemeral local server (and a
 * closed port / a dead server) → kept small and tolerant.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { EngineRequest } from '../src/mock/context';
import { buildProxyTarget, forwardProxy, toEngineResponse } from '../src/mock/proxy';
import type { Environment, Route } from '../src/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Environment> = {}): Environment {
  return {
    uuid: 'env-1',
    name: 'Test Env',
    port: 3000,
    endpointPrefix: '/api/v1',
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [],
    data: [],
    version: 1,
    ...overrides,
  };
}

function makeRoute(overrides: Partial<Route> = {}): Route {
  return {
    uuid: 'route-1',
    type: 'http',
    method: 'get',
    endpoint: '/proxy/*',
    documentation: '',
    responseMode: null,
    responses: [],
    proxyHost: '',
    proxyRemovePrefix: false,
    ...overrides,
  };
}

function makeReq(overrides: Partial<EngineRequest> = {}): EngineRequest {
  return {
    method: 'get',
    url: '/users/42?x=1',
    path: '/users/42',
    headers: { host: 'localhost:3000' },
    query: { x: '1' },
    body: '',
    rawBody: '',
    ip: '127.0.0.1',
    hostname: 'localhost:3000',
    requestNumber: 1,
    ...overrides,
  };
}

const PROXY_ROUTE = makeRoute({ proxyHost: 'backend.example.com', proxyRemovePrefix: true });
const PLAIN_ROUTE = makeRoute({ endpoint: '/users' });

// ---------------------------------------------------------------------------
// buildProxyTarget — pure planning
// ---------------------------------------------------------------------------

describe('buildProxyTarget — env proxy fallback', () => {
  const envProxy = makeEnv({ proxyMode: true, proxyHost: 'http://upstream.example.com' });

  it('no match + proxyMode + proxyHost → target url = host + original path', () => {
    const req = makeReq();
    const t = buildProxyTarget(envProxy, null, false, req, '/api/v1/users/42?x=1');
    expect(t).not.toBeNull();
    expect(t!.url).toBe('http://upstream.example.com/api/v1/users/42?x=1');
    expect(t!.source).toBe('env');
  });

  it('proxyRemovePrefix true → path without prefix (deps.removePrefixPath stub) + query re-appended', () => {
    const env = makeEnv({ proxyMode: true, proxyHost: 'http://upstream.example.com', proxyRemovePrefix: true });
    const req = makeReq({ url: '/users/42?x=1', path: '/users/42' });
    const t = buildProxyTarget(
      env,
      null,
      false,
      req,
      '/api/v1/users/42?x=1',
      { removePrefixPath: (p: string) => p.replace(/^\/api\/v1/, '') }
    );
    expect(t!.url).toBe('http://upstream.example.com/users/42?x=1');
  });

  it('proxyMode false → null', () => {
    const env = makeEnv({ proxyMode: false, proxyHost: 'http://upstream.example.com' });
    expect(buildProxyTarget(env, null, false, makeReq(), '/api/v1/users/42')).toBeNull();
  });

  it('no match + proxyMode but no host → null', () => {
    const env = makeEnv({ proxyMode: true, proxyHost: '' });
    expect(buildProxyTarget(env, null, false, makeReq(), '/api/v1/users/42')).toBeNull();
  });

  it('a matched route present → null (env fallback is only-on-no-match)', () => {
    const req = makeReq({ url: '/users/42', path: '/users/42', method: 'get' });
    const t = buildProxyTarget(envProxy, PLAIN_ROUTE, true, req, '/api/v1/users/42');
    expect(t).toBeNull();
  });
});

describe('buildProxyTarget — route-level proxy', () => {
  const plainEnv = makeEnv({ proxyMode: false });

  it('matched route with proxyHost → target, even with no env proxyMode', () => {
    const req = makeReq({ url: '/things/9', path: '/things/9' });
    const t = buildProxyTarget(plainEnv, PROXY_ROUTE, true, req, '/api/v1/things/9');
    expect(t).not.toBeNull();
    expect(t!.source).toBe('route');
    // route.proxyRemovePrefix = true → req.path, query re-appended
    expect(t!.url).toBe('http://backend.example.com/things/9');
  });

  it('route without proxyRemovePrefix → original path (incl. query)', () => {
    const route = makeRoute({ proxyHost: 'backend.example.com', proxyRemovePrefix: false });
    const req = makeReq({ url: '/things/9?b=2', path: '/things/9' });
    const t = buildProxyTarget(plainEnv, route, true, req, '/api/v1/things/9?b=2');
    expect(t!.url).toBe('http://backend.example.com/api/v1/things/9?b=2');
  });

  it('route without proxyHost + no env proxy → null', () => {
    const req = makeReq({ url: '/users/42', path: '/users/42' });
    const t = buildProxyTarget(plainEnv, PLAIN_ROUTE, true, req, '/api/v1/users/42');
    expect(t).toBeNull();
  });

  it('unmatched route is never a route proxy (falls through to env rules)', () => {
    const req = makeReq({ url: '/things/9', path: '/things/9' });
    expect(buildProxyTarget(plainEnv, PROXY_ROUTE, false, req, '/api/v1/things/9')).toBeNull();
  });
});

describe('buildProxyTarget — scheme defaulting', () => {
  it('scheme-less host → http:// assumed', () => {
    const req = makeReq({ url: '/x', path: '/x' });
    const t = buildProxyTarget(makeEnv(), makeRoute({ proxyHost: 'localhost:8081' }), true, req, '/x');
    expect(t!.url).toBe('http://localhost:8081/x');
  });

  it('https:// preserved', () => {
    const req = makeReq({ url: '/x', path: '/x' });
    const t = buildProxyTarget(makeEnv(), makeRoute({ proxyHost: 'https://api.example.com' }), true, req, '/x');
    expect(t!.url).toBe('https://api.example.com/x');
  });

  it('scheme-less env host → http:// assumed', () => {
    const req = makeReq();
    const t = buildProxyTarget(
      makeEnv({ proxyMode: true, proxyHost: 'localhost:8081' }),
      null,
      false,
      req,
      '/api/v1/users/42?x=1'
    );
    expect(t!.url).toBe('http://localhost:8081/api/v1/users/42?x=1');
  });
});

describe('buildProxyTarget — headers', () => {
  const route = makeRoute({ proxyHost: 'backend.example.com' });
  const headers = {
    host: 'localhost:3000',
    connection: 'close',
    'keep-alive': 'timeout=5',
    'transfer-encoding': 'chunked',
    upgrade: 'websocket',
    authorization: 'Bearer secret-token',
    'x-custom': 'yes',
    'user-agent': 'vitest',
  };

  it('Host rewritten to the target host; hop-by-hop stripped; Authorization preserved', () => {
    const req = makeReq({ url: '/x', path: '/x', headers });
    const t = buildProxyTarget(makeEnv(), route, true, req, '/x');
    expect(t!.headers['host']).toBe('backend.example.com');
    expect(t!.headers['connection']).toBeUndefined();
    expect(t!.headers['keep-alive']).toBeUndefined();
    expect(t!.headers['transfer-encoding']).toBeUndefined();
    expect(t!.headers['upgrade']).toBeUndefined();
    expect(t!.headers['authorization']).toBe('Bearer secret-token'); // forwardable, Mockoon-style
    expect(t!.headers['x-custom']).toBe('yes');
    expect(t!.headers['user-agent']).toBe('vitest');
  });

  it('scheme-less host: port is part of the rewritten Host', () => {
    const req = makeReq({ url: '/x', path: '/x', headers: { host: 'localhost:3000' } });
    const t = buildProxyTarget(makeEnv(), makeRoute({ proxyHost: 'localhost:8081' }), true, req, '/x');
    expect(t!.headers['host']).toBe('localhost:8081');
  });

  it('content-length recomputed for a known body', () => {
    const req = makeReq({ url: '/x', path: '/x', headers, rawBody: '{"a":1}', body: { a: 1 } });
    const t = buildProxyTarget(makeEnv(), route, true, req, '/x');
    expect(t!.body).toBe('{"a":1}');
    expect(t!.headers['content-length']).toBe('7');
  });

  it('body null → no content-length', () => {
    const req = makeReq({ url: '/x', path: '/x', headers: { ...headers, 'content-length': '42' }, rawBody: '' });
    const t = buildProxyTarget(makeEnv(), route, true, req, '/x');
    expect(t!.body).toBeNull();
    expect(t!.headers['content-length']).toBeUndefined();
  });

  it('te / trailer / proxy-* are stripped too', () => {
    const req = makeReq({
      url: '/x',
      path: '/x',
      headers: {
        host: 'localhost:3000',
        te: 'trailer',
        trailer: 'x-a',
        'proxy-authorization': 'Basic abc',
        'proxy-authenticate': 'Basic abc',
      },
    });
    const t = buildProxyTarget(makeEnv(), route, true, req, '/x');
    expect(t!.headers['te']).toBeUndefined();
    expect(t!.headers['trailer']).toBeUndefined();
    expect(t!.headers['proxy-authorization']).toBeUndefined();
    expect(t!.headers['proxy-authenticate']).toBeUndefined();
  });
});

describe('buildProxyTarget — method', () => {
  const route = makeRoute({ proxyHost: 'backend.example.com' });

  it.each([
    ['patch', '/p', 'PATCH'],
    ['delete', '/d', 'DELETE'],
    ['post', '/c', 'POST'],
    ['head', '/h', 'HEAD'],
  ])('method %s preserved (→ %s)', (method, path) => {
    const req = makeReq({ method, url: path, path });
    const t = buildProxyTarget(makeEnv(), route, true, req, path);
    expect(t!.method).toBe(method.toUpperCase());
    expect(t!.url).toBe(`http://backend.example.com${path}`);
  });
});

// ---------------------------------------------------------------------------
// forwardProxy — real I/O (kept small)
// ---------------------------------------------------------------------------

describe('forwardProxy — real I/O', () => {
  let server: Server;
  let url: string;
  let port: number;

  function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<void> {
    server = createServer(handler);
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        url = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  afterEach(async () => {
    if (!server) return;
    const s = server;
    server = undefined as unknown as Server;
    await new Promise<void>((resolve) => {
      // Kill any connections the test left open (e.g. the never-respond
      // timeout server) so close() can complete, then close the listener.
      s.closeAllConnections?.();
      s.close(() => resolve());
    });
  });

  it('forwards and relays status/headers/body; toEngineResponse marks X-Sahayak-Proxy', async () => {
    await listen((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      res.writeHead(200, { 'content-type': 'application/json', 'x-echo': 'yes' });
      res.end(JSON.stringify({ method: req.method, path: u.pathname, query: u.searchParams.get('q'), bodyLen: null }));
    });

    const target = buildProxyTarget(
      makeEnv(),
      makeRoute({ proxyHost: '' }),
      false,
      makeReq({ url: '/users/42?q=abc', path: '/users/42', headers: { host: 'localhost:3000' } }),
      '/api/v1/users/42?q=abc',
      undefined
    );
    // Build the target by hand for the transport test:
    const t = {
      url: `${url}/users/42?q=abc`,
      method: 'GET',
      headers: { host: `127.0.0.1:${port}` },
      body: null as string | null,
      source: 'env' as const,
    };
    expect(target).toBeNull(); // no env proxy + no matched route → planning says "do not proxy"

    const result = await forwardProxy(t);
    expect(result.error).toBeUndefined();
    expect(result.statusCode).toBe(200);
    expect(result.headers['x-echo']).toBe('yes');
    expect(JSON.parse(result.body)).toEqual({ method: 'GET', path: '/users/42', query: 'abc', bodyLen: null });

    const engine = toEngineResponse(result);
    expect(engine.headers['X-Sahayak-Proxy']).toBe('true');
    expect(engine.proxied).toBe(true);
    expect(engine.warnings).toEqual([]);
    expect(engine.statusCode).toBe(200);
  });

  it('POST body is forwarded (server echoes body length)', async () => {
    await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ bodyLength: raw.length }));
      });
    });

    const t = {
      url: `${url}/ingest`,
      method: 'POST',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': '11' },
      body: '{"a":12345}', // exactly 11 bytes — matches content-length
      source: 'route' as const,
    };
    const result = await forwardProxy(t);
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual({ bodyLength: 11 });
  });

  it('unreachable target → 500 + error + JSON error body', async () => {
    const t = {
      url: 'http://127.0.0.1:1/nope',
      method: 'GET',
      headers: { host: '127.0.0.1:1' },
      body: null as string | null,
      source: 'env' as const,
    };
    const result = await forwardProxy(t, 500);
    expect(result.statusCode).toBe(500);
    expect(result.error).toMatch(/Proxy unreachable/);
    const parsed = JSON.parse(result.body) as { error: string };
    expect(parsed.error).toBe(result.error);
    const engine = toEngineResponse(result);
    expect(engine.headers['X-Sahayak-Proxy']).toBe('true');
    expect(engine.warnings).toEqual([result.error]);
  });

  it('timeout: server accepts but never responds → 500 + error (tolerant budget)', async () => {
    // Accepts the connection but never sends a response.
    await listen(() => {
      /* intentionally no response */
    });

    const t = {
      url: `${url}/silent`,
      method: 'GET',
      headers: { host: `127.0.0.1:${port}` },
      body: null as string | null,
      source: 'env' as const,
    };
    // timeoutMs 300 as specified; the generous vitest testTimeout (20 s)
    // covers slow CI where the socket setup itself takes longer.
    const result = await forwardProxy(t, 300);
    expect(result.statusCode).toBe(500);
    expect(result.error).toMatch(/timeout after 300 ms/);
    expect(JSON.parse(result.body)).toEqual({ error: result.error });
  });
});
