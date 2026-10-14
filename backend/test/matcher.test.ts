import { describe, expect, it } from 'vitest';
import type { Environment, Route } from '../src/lib/types';
import {
  decodeSegment,
  findRoute,
  matchPath,
  rankSegments,
  stripPrefix,
} from '../src/mock/matcher';

function httpRoute(endpoint: string, method: Route['method'] = 'get', uuid = 'r'): Route {
  return {
    uuid,
    type: 'http',
    method,
    endpoint,
    documentation: '',
    responseMode: null,
    responses: [],
    proxyHost: '',
    proxyRemovePrefix: false,
  };
}

function crudRoute(endpoint: string, uuid = 'c'): Route {
  return {
    uuid,
    type: 'crud',
    method: 'get', // ignored for crud routes
    endpoint,
    documentation: '',
    responseMode: null,
    responses: [],
    proxyHost: '',
    proxyRemovePrefix: false,
  };
}

function env(routes: Route[], endpointPrefix = ''): Environment {
  return {
    uuid: 'e',
    name: 'env',
    port: 3000,
    endpointPrefix,
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes,
    data: [],
    version: 1,
  };
}

describe('stripPrefix', () => {
  it('returns the path unchanged when there is no prefix', () => {
    expect(stripPrefix('', '/users/1')).toBe('/users/1');
    expect(stripPrefix('/', '/users/1')).toBe('/users/1');
    expect(stripPrefix('/   /', '/users/1')).toBe('/users/1');
  });

  it('strips an exact prefix', () => {
    expect(stripPrefix('/api/v1', '/api/v1/users/1')).toBe('/users/1');
  });

  it('is case-insensitive', () => {
    expect(stripPrefix('/API/V1', '/api/v1/users/1')).toBe('/users/1');
    expect(stripPrefix('/api/v1', '/API/V1/users/1')).toBe('/users/1');
  });

  it('is tolerant of trailing slashes on both sides', () => {
    expect(stripPrefix('/api/v1/', '/api/v1/users/1')).toBe('/users/1');
    expect(stripPrefix('/api/v1', '/api/v1//users/1')).toBe('/users/1');
    expect(stripPrefix('/api/v1/', '/api/v1/')).toBe('');
  });

  it('returns the path unchanged when the prefix is absent', () => {
    expect(stripPrefix('/api/v1', '/other/x')).toBe('/other/x');
    expect(stripPrefix('/api/v1', '/api/v2/x')).toBe('/api/v2/x');
    expect(stripPrefix('/api/v1', '/users/1')).toBe('/users/1');
  });

  it('does NOT strip when the prefix only partially matches a segment', () => {
    expect(stripPrefix('/api/v1', '/api/v1beta/users')).toBe('/api/v1beta/users');
    expect(stripPrefix('/api', '/apix/users')).toBe('/apix/users');
    expect(stripPrefix('/api/v1', '/apiv1beta')).toBe('/apiv1beta');
  });

  it('strips to the root', () => {
    expect(stripPrefix('/api/v1', '/api/v1')).toBe('');
    expect(stripPrefix('/api/v1', '/api/v1/')).toBe('');
  });

  it('keeps the leading slash of the remainder', () => {
    expect(stripPrefix('/api', '/api/a/b')).toBe('/a/b');
  });
});

describe('matchPath', () => {
  it('matches an exact path (case-insensitive)', () => {
    expect(matchPath('/users', '/users')).toEqual({ params: {} });
    expect(matchPath('/Users/Profile', '/users/profile')).toEqual({ params: {} });
    expect(matchPath('/users', '/users/extra')).toBeNull();
    expect(matchPath('/users/extra', '/users')).toBeNull();
  });

  it('is tolerant of trailing slashes', () => {
    expect(matchPath('/users/', '/users')).toEqual({ params: {} });
    expect(matchPath('/users', '/users/')).toEqual({ params: {} });
  });

  it('captures a :param (URL-decoded)', () => {
    expect(matchPath('/users/:id', '/users/a%20b')).toEqual({ params: { id: 'a b' } });
    expect(matchPath('/users/:id', '/users/42')).toEqual({ params: { id: '42' } });
  });

  it('captures multiple params', () => {
    expect(matchPath('/users/:uid/posts/:pid', '/users/5/posts/9')).toEqual({
      params: { uid: '5', pid: '9' },
    });
    expect(matchPath('/a/:x/b/:y', '/a/1/b/2')).toEqual({ params: { x: '1', y: '2' } });
  });

  it('trailing catch-all matches multiple remaining segments', () => {
    expect(matchPath('/files/*', '/files/a/b/c')).toEqual({ params: {} });
    expect(matchPath('/files/*', '/files/one')).toEqual({ params: {} });
  });

  it('trailing catch-all requires at least one remaining segment', () => {
    expect(matchPath('/files/*', '/files')).toBeNull();
    expect(matchPath('/files/*', '/files/')).toBeNull();
  });

  it('middle wildcard matches exactly one segment', () => {
    expect(matchPath('/a/*/c', '/a/b/c')).toEqual({ params: {} });
    expect(matchPath('/a/*/c', '/a/b/d/c')).toBeNull();
    expect(matchPath('/a/*/c', '/a/c')).toBeNull();
  });

  it('is case-insensitive for literal segments', () => {
    expect(matchPath('/Users', '/users')).toEqual({ params: {} });
  });

  it('returns null on mismatch', () => {
    expect(matchPath('/users/:id', '/posts/1')).toBeNull();
    expect(matchPath('/users/:id', '/users')).toBeNull();
    expect(matchPath('/users', '/users/1/2')).toBeNull();
    expect(matchPath('/a/:x', '/a/:x')).toEqual({ params: { x: ':x' } }); // ':x' is a value here
  });

  it('empty path vs "/"', () => {
    expect(matchPath('', '')).toEqual({ params: {} });
    expect(matchPath('/', '')).toEqual({ params: {} });
    expect(matchPath('', '/')).toEqual({ params: {} });
    expect(matchPath('/', '/')).toEqual({ params: {} });
    expect(matchPath('', '/a')).toBeNull();
    expect(matchPath('/', '/a')).toBeNull();
    expect(matchPath('/a', '')).toBeNull();
  });

  it('rankSegments assigns exact=0, param=1, wildcard=2', () => {
    expect(rankSegments('/users')).toEqual([0]);
    expect(rankSegments('/users/:id')).toEqual([0, 1]);
    expect(rankSegments('/files/*')).toEqual([0, 2]);
    expect(rankSegments('/a/*/c')).toEqual([0, 2, 0]);
  });

  it('decodeSegment falls back to the raw value on malformed input', () => {
    expect(decodeSegment('a%20b')).toBe('a b');
    expect(decodeSegment('100%zz')).toBe('100%zz');
  });
});

describe('findRoute', () => {
  it('precedence: exact path segment > :param > * wildcard', () => {
    const e = env([
      httpRoute('/users/*', 'get', 'w'),
      httpRoute('/users/:id', 'get', 'p'),
      httpRoute('/users/me', 'get', 'e2'),
    ]);
    expect(findRoute(e, 'get', '/users/me')?.route.uuid).toBe('e2');
    expect(findRoute(e, 'get', '/users/42')?.route.uuid).toBe('p');
    expect(findRoute(e, 'get', '/users/42/extra')?.route.uuid).toBe('w');
  });

  it('declaration order breaks ties within a specificity class', () => {
    const e = env([
      httpRoute('/users/:id', 'get', 'first'),
      httpRoute('/users/:uid', 'get', 'second'),
    ]);
    expect(findRoute(e, 'get', '/users/1')?.route.uuid).toBe('first');
  });

  it('an HTTP route overrides a CRUD route for the operation it declares', () => {
    const e = env([crudRoute('/users', 'c1'), httpRoute('/users', 'get', 'h1')]);
    // same path + method → http wins
    expect(findRoute(e, 'get', '/users')?.isCrud).toBe(false);
    expect(findRoute(e, 'get', '/users')?.route.uuid).toBe('h1');
    // different method → crud (method-agnostic)
    const post = findRoute(e, 'post', '/users');
    expect(post?.isCrud).toBe(true);
    expect(post?.crudKind).toBe('list');
    // item op falls through to crud too
    const item = findRoute(e, 'get', '/users/1');
    expect(item?.isCrud).toBe(true);
    expect(item?.crudKind).toBe('item');
    expect(item?.crudId).toBe('1');
  });

  it('detects crud list vs item (crudId, decoded)', () => {
    const e = env([crudRoute('/items', 'c')]);
    expect(findRoute(e, 'get', '/items')).toEqual(
      expect.objectContaining({ isCrud: true, crudKind: 'list' })
    );
    expect(findRoute(e, 'get', '/items/42')).toEqual(
      expect.objectContaining({ isCrud: true, crudKind: 'item', crudId: '42' })
    );
    expect(findRoute(e, 'put', '/items/42')?.crudId).toBe('42');
    expect(findRoute(e, 'delete', '/items/a%20b')?.crudId).toBe('a b');
    expect(findRoute(e, 'get', '/items/1/2')).toBeNull(); // too deep
  });

  it('HEAD requests fall back to GET routes (Mockoon)', () => {
    const e = env([httpRoute('/a', 'get', 'g')]);
    expect(findRoute(e, 'head', '/a')?.route.uuid).toBe('g');
    expect(findRoute(e, 'get', '/a')?.route.uuid).toBe('g');
  });

  it('HEAD prefers a dedicated HEAD route over the GET fallback', () => {
    const e = env([httpRoute('/a', 'head', 'h'), httpRoute('/a', 'get', 'g')]);
    expect(findRoute(e, 'head', '/a')?.route.uuid).toBe('h');
  });

  it('method mismatch returns null', () => {
    const e = env([httpRoute('/a', 'get', 'g')]);
    expect(findRoute(e, 'post', '/a')).toBeNull();
    expect(findRoute(e, 'put', '/a')).toBeNull();
    expect(findRoute(e, 'delete', '/a')).toBeNull();
  });

  it('unknown env prefix: caller strips it first; matching runs on the remainder', () => {
    const e = env([httpRoute('/users', 'get', 'g')], '/api/v1');
    // caller does: stripPrefix('/api/v1', '/api/v1/users') === '/users'
    expect(findRoute(e, 'get', stripPrefix(e.endpointPrefix, '/api/v1/users'))?.route.uuid).toBe('g');
    // unstripped path does NOT match
    expect(findRoute(e, 'get', '/api/v1/users')).toBeNull();
  });

  it('an explicit OPTIONS route matches OPTIONS (no fallback)', () => {
    const e = env([httpRoute('/a', 'options', 'o'), httpRoute('/a', 'get', 'g')]);
    expect(findRoute(e, 'options', '/a')?.route.uuid).toBe('o');
    expect(findRoute(e, 'get', '/a')?.route.uuid).toBe('g');
  });

  it('returns null when nothing matches', () => {
    const e = env([httpRoute('/a', 'get', 'g')]);
    expect(findRoute(e, 'get', '/b')).toBeNull();
    expect(findRoute(e, 'get', '')).toBeNull();
    expect(findRoute(e, 'post', '/a')).toBeNull();
  });

  it('HEAD fallback still applies specificity (most specific GET wins)', () => {
    const e = env([
      httpRoute('/users/*', 'get', 'w'),
      httpRoute('/users/:id', 'get', 'p'),
      httpRoute('/users/me', 'get', 'e2'),
    ]);
    expect(findRoute(e, 'head', '/users/me')?.route.uuid).toBe('e2');
    expect(findRoute(e, 'head', '/users/7')?.route.uuid).toBe('p');
  });

  it('http specificity still wins over crud when both match the same path+method', () => {
    const e = env([
      crudRoute('/files', 'c'),
      httpRoute('/files/:name', 'get', 'p'),
      httpRoute('/files/*', 'get', 'w'),
    ]);
    // /files/x → http :param (specificity) beats crud item
    const m = findRoute(e, 'get', '/files/x');
    expect(m?.isCrud).toBe(false);
    expect(m?.route.uuid).toBe('p');
    expect(m?.params).toEqual({ name: 'x' });
  });
});
