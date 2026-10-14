/**
 * Factories for fresh editor documents (DESIGN §5 shapes).
 * The backend normalizes/defaults anything missing, but the UI builds
 * complete documents so saves are predictable.
 */
import { DataBucket, Environment, Route, RouteResponse } from './types';
import { newUuid } from './utils';

/** A fresh HTTP route with one default 200 JSON response. */
export function createHttpRoute(method: Route['method'] = 'get', endpoint = ''): Route {
  return {
    uuid: newUuid(),
    type: 'http',
    method,
    endpoint,
    documentation: '',
    responseMode: null,
    responses: [createRouteResponse()],
    proxyHost: '',
    proxyRemovePrefix: false,
  };
}

/** A fresh CRUD route; the editor wires it to a bucket afterwards. */
export function createCrudRoute(endpoint = ''): Route {
  return {
    uuid: newUuid(),
    type: 'crud',
    method: 'get',
    endpoint,
    documentation: '',
    responseMode: null,
    responses: [
      {
        ...createRouteResponse(),
        bodyType: 'DATABUCKET',
        body: '',
        databucketId: '',
      },
    ],
    proxyHost: '',
    proxyRemovePrefix: false,
  };
}

/** A fresh response: default flag on, 200, JSON content type. */
export function createRouteResponse(label = 'Default'): RouteResponse {
  return {
    uuid: newUuid(),
    label,
    statusCode: 200,
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    latency: 0,
    bodyType: 'INLINE',
    body: '',
    filePath: '',
    databucketId: '',
    rules: [],
    rulesOperator: 'AND',
    defaultResponse: true,
  };
}

/** A fresh data bucket with a small array-of-objects sample (CRUD-friendly). */
export function createDataBucket(name = 'items'): DataBucket {
  return {
    uuid: newUuid(),
    name,
    content: JSON.stringify(
      [
        { id: 1, name: 'first item', active: true },
        { id: 2, name: 'second item', active: false },
      ],
      null,
      2,
    ),
  };
}

/**
 * A brand-new environment document. Port 3000 is the Mockoon convention;
 * the store re-checks for port conflicts on save (server returns 409).
 */
export function createEnvironment(name = 'New environment', port = 3000, endpointPrefix = ''): Environment {
  const defaultPrefix = name ? `/${name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}` : '';
  const rawPrefix = endpointPrefix.trim();
  const prefix = rawPrefix ? (rawPrefix.startsWith('/') ? rawPrefix : `/${rawPrefix}`) : defaultPrefix;
  return {
    uuid: newUuid(),
    name,
    port,
    endpointPrefix: prefix,
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [],
    data: [],
    version: 0, // server assigns version 1 on create
  };
}
