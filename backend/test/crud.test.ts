import { describe, expect, it } from 'vitest';
import { Faker, en } from '@faker-js/faker';
import { handleCrud } from '../src/mock/crud';
import type { EngineRequest } from '../src/mock/context';
import type { Route } from '../src/lib/types';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function makeRoute(databucketId = 'bucket-1'): Route {
  return {
    uuid: 'route-1',
    type: 'crud',
    method: 'get',
    endpoint: '/items',
    documentation: '',
    responseMode: null,
    responses: [
      {
        uuid: 'resp-1',
        label: 'crud',
        statusCode: 200,
        headers: [],
        latency: 0,
        bodyType: 'DATABUCKET',
        body: '',
        filePath: '',
        databucketId,
        rules: [],
        rulesOperator: 'OR',
        defaultResponse: true,
      },
    ],
    proxyHost: '',
    proxyRemovePrefix: false,
  };
}

const route = makeRoute();

/** Tiny EngineRequest factory: pass only what a case cares about. */
function req(method: string, overrides: Partial<EngineRequest> = {}): EngineRequest {
  return {
    url: '/items',
    path: '/items',
    headers: {},
    query: {},
    body: '',
    rawBody: '',
    ip: '127.0.0.1',
    hostname: 'localhost',
    requestNumber: 1,
    method,
    ...overrides,
  };
}

/** JSON request body (parsed body + matching raw body). */
function jsonBody(value: unknown): Partial<EngineRequest> {
  return { body: value, rawBody: JSON.stringify(value) };
}

// Canonical content for each of the five shapes.
const ARRAY_OBJECTS = JSON.stringify(
  [
    { id: 1, name: 'alpha', age: 20, tags: ['a', 'b'], active: true },
    { id: 2, name: 'beta', age: 30, tags: ['b', 'c'], active: false },
    { id: 3, name: 'gamma', age: 40, tags: ['c'], active: true },
  ],
  null,
  2
);
const ARRAY_PRIMITIVES = JSON.stringify(['one', 'two', 'three']);
const OBJECT_CONTENT = JSON.stringify({ a: 1, b: { c: 2 }, d: [1, 2] }, null, 2);
const PRIMITIVE_CONTENT = '42';
const RAW_CONTENT = 'plain raw text';

const NOT_FOUND_BODY = '{"error":"Item not found"}';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OBJECT_ID_24 = /^[0-9a-f]{24}$/;

// ---------------------------------------------------------------------------
// Shape: array of objects
// ---------------------------------------------------------------------------

describe('handleCrud — array of objects', () => {
  it('GET list returns the whole array, content unchanged', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(JSON.parse(ARRAY_OBJECTS));
    expect(res.nextContent).toBe(ARRAY_OBJECTS);
  });

  it('GET list _eq matches numeric and string fields', () => {
    const byId = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { id_eq: '2' } }));
    expect(JSON.parse(byId.body)).toHaveLength(1);
    expect(JSON.parse(byId.body)[0].id).toBe(2);
    const byName = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { name_eq: 'beta' } }));
    expect(JSON.parse(byName.body)[0].name).toBe('beta');
  });

  it('GET list _ne excludes matches', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { active_ne: 'false' } }));
    const out = JSON.parse(res.body) as Array<{ name: string }>;
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.name).sort()).toEqual(['alpha', 'gamma']);
  });

  it('GET list _gt / _lt compare numerically', () => {
    const gt = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { age_gt: '25' } })).body
    ) as Array<{ name: string }>;
    expect(gt.map((o) => o.name).sort()).toEqual(['beta', 'gamma']);
    const lt = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { age_lt: '35' } })).body
    ) as Array<{ name: string }>;
    expect(lt.map((o) => o.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('GET list _gte / _lte are inclusive', () => {
    const gte = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { age_gte: '30' } })).body
    ) as Array<{ name: string }>;
    expect(gte.map((o) => o.name).sort()).toEqual(['beta', 'gamma']);
    const lte = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { age_lte: '20' } })).body
    ) as Array<{ name: string }>;
    expect(lte.map((o) => o.name)).toEqual(['alpha']);
  });

  it('GET list _like treats % as a wildcard', () => {
    const res = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { name_like: '%a%' } })).body
    ) as Array<{ name: string }>;
    // alpha, beta, gamma all contain "a"
    expect(res.map((o) => o.name).sort()).toEqual(['alpha', 'beta', 'gamma']);
    const prefix = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { name_like: 'b%' } })).body
    ) as Array<{ name: string }>;
    expect(prefix.map((o) => o.name)).toEqual(['beta']);
  });

  it('GET list _in matches a comma-separated list', () => {
    const res = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { name_in: 'alpha,gamma' } })).body
    ) as Array<{ name: string }>;
    expect(res.map((o) => o.name).sort()).toEqual(['alpha', 'gamma']);
  });

  it('GET list _contains / _startswith / _endswith', () => {
    const contains = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { name_contains: 'amm' } })).body
    ) as Array<{ name: string }>;
    expect(contains.map((o) => o.name)).toEqual(['gamma']);
    const starts = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { name_startswith: 'al' } })).body
    ) as Array<{ name: string }>;
    expect(starts.map((o) => o.name)).toEqual(['alpha']);
    const ends = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { name_endswith: 'eta' } })).body
    ) as Array<{ name: string }>;
    expect(ends.map((o) => o.name)).toEqual(['beta']);
  });

  it('GET list matches array fields on ANY element', () => {
    const contains = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { tags_contains: 'a' } })).body
    ) as Array<{ name: string }>;
    // only alpha has tag "a"
    expect(contains.map((o) => o.name)).toEqual(['alpha']);
    const inList = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { tags_in: 'b' } })).body
    ) as Array<{ name: string }>;
    expect(inList.map((o) => o.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('GET list _sort asc/desc (default asc)', () => {
    const desc = JSON.parse(
      handleCrud(
        route,
        ARRAY_OBJECTS,
        'list',
        undefined,
        req('get', { query: { _sort: 'name', _order: 'desc' } })
      ).body
    ) as Array<{ name: string }>;
    expect(desc.map((o) => o.name)).toEqual(['gamma', 'beta', 'alpha']);
    const ascAge = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { _sort: 'age' } })).body
    ) as Array<{ name: string }>;
    expect(ascAge.map((o) => o.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('GET list _page/_limit paginate (1-based page)', () => {
    const page1 = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { _limit: '2', _page: '1' } })).body
    ) as Array<{ name: string }>;
    expect(page1.map((o) => o.name)).toEqual(['alpha', 'beta']);
    const page2 = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { _limit: '2', _page: '2' } })).body
    ) as Array<{ name: string }>;
    expect(page2.map((o) => o.name)).toEqual(['gamma']);
    const page3 = JSON.parse(
      handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('get', { query: { _limit: '2', _page: '3' } })).body
    );
    expect(page3).toEqual([]);
  });

  it('GET list applies filter → sort → paginate in that order', () => {
    // age > 25 → {beta 30, gamma 40}; sort desc → [gamma, beta]; limit 1 → [gamma]
    const res = JSON.parse(
      handleCrud(
        route,
        ARRAY_OBJECTS,
        'list',
        undefined,
        req('get', { query: { age_gt: '25', _sort: 'age', _order: 'desc', _limit: '1' } })
      ).body
    ) as Array<{ name: string }>;
    expect(res.map((o) => o.name)).toEqual(['gamma']);
    // second page of the same pipeline → [beta]
    const page2 = JSON.parse(
      handleCrud(
        route,
        ARRAY_OBJECTS,
        'list',
        undefined,
        req('get', { query: { age_gt: '25', _sort: 'age', _order: 'desc', _limit: '1', _page: '2' } })
      ).body
    ) as Array<{ name: string }>;
    expect(page2.map((o) => o.name)).toEqual(['beta']);
  });

  it('GET item found: String-compared id match (numeric id vs string segment)', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'item', '2', req('get'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ id: 2, name: 'beta', age: 30, tags: ['b', 'c'], active: false });
    expect(res.nextContent).toBe(ARRAY_OBJECTS);
  });

  it('GET item missing → 404 {"error":"Item not found"}', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'item', '999', req('get'));
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(NOT_FOUND_BODY);
    expect(res.nextContent).toBe(ARRAY_OBJECTS);
  });

  it('POST inserts with 201, appends to bucket, returns the item', () => {
    const res = handleCrud(
      route,
      ARRAY_OBJECTS,
      'list',
      undefined,
      req('post', jsonBody({ name: 'delta', age: 50 }))
    );
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toMatchObject({ name: 'delta', age: 50 });
    const next = JSON.parse(res.nextContent) as Array<{ id: unknown; name: string }>;
    expect(next).toHaveLength(4);
    expect(next[3].name).toBe('delta');
    expect(next[0].id).toBe(1); // existing items untouched
  });

  it('POST with an explicit id keeps it (no overwrite)', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('post', jsonBody({ id: 42, name: 'x' })));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).id).toBe(42);
  });

  it('POST rejects non-object bodies with 400 (string, number, array)', () => {
    for (const body of ['plain text', 5, [1, 2]]) {
      const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('post', jsonBody(body)));
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('invalid payload');
      expect(res.nextContent).toBe(ARRAY_OBJECTS); // unchanged
    }
  });

  it('PUT list replaces the whole bucket with the array body', () => {
    const replacement = [{ id: 9, name: 'fresh' }];
    const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('put', jsonBody(replacement)));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual(replacement);
    expect(JSON.parse(res.body)).toEqual(replacement);
  });

  it('PUT list with a non-array body → 400', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('put', jsonBody({ a: 1 })));
    expect(res.statusCode).toBe(400);
    expect(res.nextContent).toBe(ARRAY_OBJECTS);
  });

  it('PUT /:id fully replaces the matched object (other fields dropped)', () => {
    const res = handleCrud(
      route,
      ARRAY_OBJECTS,
      'item',
      '2',
      req('put', jsonBody({ name: 'BETA', age: 31 }))
    );
    expect(res.statusCode).toBe(200);
    const next = JSON.parse(res.nextContent) as Array<Record<string, unknown>>;
    expect(next[1]).toEqual({ name: 'BETA', age: 31 }); // full replace, not merge
    expect(next[0].name).toBe('alpha');
    expect(JSON.parse(res.body)).toEqual({ name: 'BETA', age: 31 });
  });

  it('PUT /:id missing → 404', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'item', 'nope', req('put', jsonBody({ name: 'x' })));
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(NOT_FOUND_BODY);
  });

  it('PATCH list concatenates the body array onto the bucket', () => {
    const res = handleCrud(
      route,
      ARRAY_OBJECTS,
      'list',
      undefined,
      req('patch', jsonBody([{ id: 4, name: 'delta' }]))
    );
    expect(res.statusCode).toBe(200);
    const next = JSON.parse(res.nextContent) as Array<{ name: string }>;
    expect(next).toHaveLength(4);
    expect(next[3].name).toBe('delta');
    expect(JSON.parse(res.body)).toHaveLength(4);
  });

  it('PATCH list with a non-array body → 400', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('patch', jsonBody({ name: 'x' })));
    expect(res.statusCode).toBe(400);
    expect(res.nextContent).toBe(ARRAY_OBJECTS);
  });

  it('PATCH /:id shallow-merges into the matched object, preserving id', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'item', '1', req('patch', jsonBody({ age: 21 })));
    expect(res.statusCode).toBe(200);
    const next = JSON.parse(res.nextContent) as Array<Record<string, unknown>>;
    expect(next[0]).toEqual({ id: 1, name: 'alpha', age: 21, tags: ['a', 'b'], active: true });
  });

  it('PATCH /:id missing → 404', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'item', '77', req('patch', jsonBody({ age: 1 })));
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(NOT_FOUND_BODY);
  });

  it('DELETE list clears the bucket to []', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('[]');
    expect(res.body).toBe('[]');
  });

  it('DELETE /:id removes the matched object', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'item', '2', req('delete'));
    expect(res.statusCode).toBe(200);
    const next = JSON.parse(res.nextContent) as Array<{ name: string }>;
    expect(next.map((o) => o.name)).toEqual(['alpha', 'gamma']);
    expect(JSON.parse(res.body)).toHaveLength(2);
  });

  it('DELETE /:id missing → 404, bucket unchanged', () => {
    const res = handleCrud(route, ARRAY_OBJECTS, 'item', 'nope', req('delete'));
    expect(res.statusCode).toBe(404);
    expect(res.nextContent).toBe(ARRAY_OBJECTS);
  });
});

// ---------------------------------------------------------------------------
// Shape: array of primitives (:id = index)
// ---------------------------------------------------------------------------

describe('handleCrud — array of primitives', () => {
  it('GET list returns the whole array', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(ARRAY_PRIMITIVES);
    expect(res.nextContent).toBe(ARRAY_PRIMITIVES);
  });

  it('GET item by index (0-based); primitives render via String(value)', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', '1', req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('two');
  });

  it('GET item out of range / non-integer index → 404', () => {
    for (const id of ['5', '-1', '1.5', 'abc']) {
      const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', id, req('get'));
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(NOT_FOUND_BODY);
    }
  });

  it('POST inserts a JSON value (number) with 201', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('post', jsonBody(42)));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.nextContent)).toEqual(['one', 'two', 'three', 42]);
    expect(res.body).toBe('42');
  });

  it('POST inserts a raw (unparseable) string', () => {
    const res = handleCrud(
      route,
      ARRAY_PRIMITIVES,
      'list',
      undefined,
      req('post', { body: 'hello world', rawBody: 'hello world' })
    );
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.nextContent)).toEqual(['one', 'two', 'three', 'hello world']);
  });

  it('POST inserts a JSON-quoted string as a string item', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('post', jsonBody('q')));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.nextContent)).toEqual(['one', 'two', 'three', 'q']);
  });

  it('PUT list replaces the whole bucket (array body)', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('put', jsonBody(['only'])));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual(['only']);
  });

  it('PUT list with a non-array body → 400', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('put', jsonBody({ a: 1 })));
    expect(res.statusCode).toBe(400);
    expect(res.nextContent).toBe(ARRAY_PRIMITIVES);
  });

  it('PUT /:id replaces by index', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', '0', req('put', jsonBody(99)));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual([99, 'two', 'three']);
    expect(res.body).toBe('99');
  });

  it('PUT /:id out of range → 404', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', '9', req('put', jsonBody(1)));
    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(NOT_FOUND_BODY);
  });

  it('PATCH list concatenates arrays', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('patch', jsonBody(['four'])));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('PATCH list with a non-array body → 400', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('patch', jsonBody('x')));
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /:id replaces by index', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', '2', req('patch', jsonBody('THREE')));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual(['one', 'two', 'THREE']);
  });

  it('PATCH /:id out of range → 404', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', '9', req('patch', jsonBody('x')));
    expect(res.statusCode).toBe(404);
  });

  it('DELETE list clears the bucket to []', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'list', undefined, req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('[]');
  });

  it('DELETE /:id removes by index', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', '1', req('delete'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual(['one', 'three']);
  });

  it('DELETE /:id out of range → 404, bucket unchanged', () => {
    const res = handleCrud(route, ARRAY_PRIMITIVES, 'item', '9', req('delete'));
    expect(res.statusCode).toBe(404);
    expect(res.nextContent).toBe(ARRAY_PRIMITIVES);
  });
});

// ---------------------------------------------------------------------------
// Shape: object
// ---------------------------------------------------------------------------

describe('handleCrud — object', () => {
  it('GET list returns content as-is', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'list', undefined, req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(OBJECT_CONTENT);
    expect(res.nextContent).toBe(OBJECT_CONTENT);
  });

  it('GET item returns content as-is (id ignored)', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'item', 'anything', req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(OBJECT_CONTENT);
  });

  it('POST overwrites the content with the payload', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'list', undefined, req('post', jsonBody({ x: 1, y: 2 })));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual({ x: 1, y: 2 });
    expect(JSON.parse(res.body)).toEqual({ x: 1, y: 2 });
  });

  it('PUT list overwrites the content', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'list', undefined, req('put', jsonBody({ z: 9 })));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual({ z: 9 });
  });

  it('PUT /:id overwrites the content (id ignored)', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'item', 'k', req('put', jsonBody({ q: 3 })));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual({ q: 3 });
  });

  it('PATCH list merges top-level keys (shallow merge, body wins)', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'list', undefined, req('patch', jsonBody({ b: 99, e: 5 })));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual({ a: 1, b: 99, d: [1, 2], e: 5 });
  });

  it('PATCH list with a non-object body → 400', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'list', undefined, req('patch', jsonBody([1, 2])));
    expect(res.statusCode).toBe(400);
    expect(res.nextContent).toBe(OBJECT_CONTENT);
  });

  it('PATCH /:id merges top-level keys (id ignored)', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'item', 'k', req('patch', jsonBody({ d: [3] })));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.nextContent)).toEqual({ a: 1, b: { c: 2 }, d: [3] });
  });

  it('DELETE list clears the bucket to {}', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'list', undefined, req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('{}');
    expect(res.body).toBe('{}');
  });

  it('DELETE /:id empties the content (id ignored)', () => {
    const res = handleCrud(route, OBJECT_CONTENT, 'item', 'k', req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('');
    expect(res.body).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Shape: primitive
// ---------------------------------------------------------------------------

describe('handleCrud — primitive', () => {
  it('GET list returns content as-is', () => {
    const res = handleCrud(route, PRIMITIVE_CONTENT, 'list', undefined, req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('42');
    expect(res.nextContent).toBe('42');
  });

  it('GET item returns content as-is (id ignored)', () => {
    const res = handleCrud(route, PRIMITIVE_CONTENT, 'item', '3', req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('42');
  });

  it('POST overwrites with a parsed JSON number', () => {
    const res = handleCrud(route, PRIMITIVE_CONTENT, 'list', undefined, req('post', jsonBody(99)));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('99');
    expect(res.body).toBe('99');
  });

  it('POST overwrites with a raw text body', () => {
    const res = handleCrud(
      route,
      PRIMITIVE_CONTENT,
      'list',
      undefined,
      req('post', { body: 'now text', rawBody: 'now text' })
    );
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('now text');
    expect(res.body).toBe('now text');
  });

  it('PUT list overwrites', () => {
    const res = handleCrud(route, PRIMITIVE_CONTENT, 'list', undefined, req('put', jsonBody(true)));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('true');
  });

  it('PUT /:id overwrites (id ignored)', () => {
    const res = handleCrud(route, PRIMITIVE_CONTENT, 'item', 'x', req('put', jsonBody('str')));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('"str"');
  });

  it('PATCH list concatenates the raw body string', () => {
    const res = handleCrud(
      route,
      PRIMITIVE_CONTENT,
      'list',
      undefined,
      req('patch', { body: 'more', rawBody: 'more' })
    );
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('42more');
    expect(res.body).toBe('42more');
  });

  it('DELETE list empties the content', () => {
    const res = handleCrud(route, PRIMITIVE_CONTENT, 'list', undefined, req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('');
    expect(res.body).toBe('');
  });

  it('DELETE /:id empties the content (id ignored)', () => {
    const res = handleCrud(route, PRIMITIVE_CONTENT, 'item', 'x', req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Shape: raw (non-JSON string)
// ---------------------------------------------------------------------------

describe('handleCrud — raw (non-JSON)', () => {
  it('GET list returns content as-is', () => {
    const res = handleCrud(route, RAW_CONTENT, 'list', undefined, req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(RAW_CONTENT);
    expect(res.nextContent).toBe(RAW_CONTENT);
  });

  it('GET item returns content as-is (id ignored)', () => {
    const res = handleCrud(route, RAW_CONTENT, 'item', '1', req('get'));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(RAW_CONTENT);
  });

  it('POST replaces with the raw body string', () => {
    const res = handleCrud(
      route,
      RAW_CONTENT,
      'list',
      undefined,
      req('post', { body: 'replacement', rawBody: 'replacement' })
    );
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('replacement');
    expect(res.body).toBe('replacement');
  });

  it('PUT list replaces with the raw body', () => {
    const res = handleCrud(route, RAW_CONTENT, 'list', undefined, req('put', { body: 'new raw', rawBody: 'new raw' }));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('new raw');
  });

  it('PUT /:id replaces with the raw body (id ignored)', () => {
    const res = handleCrud(route, RAW_CONTENT, 'item', '1', req('put', { body: 'r2', rawBody: 'r2' }));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('r2');
  });

  it('PATCH list appends the raw body string', () => {
    const res = handleCrud(
      route,
      RAW_CONTENT,
      'list',
      undefined,
      req('patch', { body: ' + extra', rawBody: ' + extra' })
    );
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('plain raw text + extra');
  });

  it('PATCH /:id appends the raw body string (id ignored)', () => {
    const res = handleCrud(route, RAW_CONTENT, 'item', '1', req('patch', { body: '!', rawBody: '!' }));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('plain raw text!');
  });

  it('DELETE list empties the content', () => {
    const res = handleCrud(route, RAW_CONTENT, 'list', undefined, req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('');
    expect(res.body).toBe('');
  });

  it('DELETE /:id empties the content (id ignored)', () => {
    const res = handleCrud(route, RAW_CONTENT, 'item', '1', req('delete'));
    expect(res.statusCode).toBe(200);
    expect(res.nextContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// POST id auto-generation strategies
// ---------------------------------------------------------------------------

describe('handleCrud — POST id auto-generation', () => {
  it('numeric ids → increment (max+1)', () => {
    const res = handleCrud(
      route,
      JSON.stringify([{ id: 1, n: 'a' }, { id: 3, n: 'b' }]),
      'list',
      undefined,
      req('post', jsonBody({ n: 'c' }))
    );
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).id).toBe(4);
  });

  it('empty array → uuid v4', () => {
    const res = handleCrud(route, '[]', 'list', undefined, req('post', jsonBody({ n: 'c' })));
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).id).toMatch(UUID_V4);
    expect(JSON.parse(res.nextContent)).toHaveLength(1);
  });

  it('ObjectId-shaped ids → 24-hex id via injected seeded faker (deterministic)', () => {
    const content = JSON.stringify([{ id: '64b2f0a1c3d4e5f60718293a', n: 'a' }]);
    const f1 = new Faker({ locale: en });
    f1.seed(42);
    const f2 = new Faker({ locale: en });
    f2.seed(42);
    const r1 = handleCrud(route, content, 'list', undefined, req('post', jsonBody({ n: 'b' })), { faker: f1 });
    const r2 = handleCrud(route, content, 'list', undefined, req('post', jsonBody({ n: 'b' })), { faker: f2 });
    expect(r1.statusCode).toBe(201);
    const id1 = JSON.parse(r1.body).id;
    expect(id1).toMatch(OBJECT_ID_24);
    expect(id1).not.toBe('64b2f0a1c3d4e5f60718293a');
    expect(JSON.parse(r2.body).id).toBe(id1); // same seed → same id
  });

  it('ObjectId-shaped ids → 24-hex via default faker (no injection)', () => {
    const content = JSON.stringify([{ id: '64b2f0a1c3d4e5f60718293a', n: 'a' }]);
    const res = handleCrud(route, content, 'list', undefined, req('post', jsonBody({ n: 'b' })));
    expect(JSON.parse(res.body).id).toMatch(OBJECT_ID_24);
  });

  it('mixed id shapes → uuid', () => {
    const content = JSON.stringify([{ id: 1 }, { id: '64b2f0a1c3d4e5f60718293a' }]);
    const res = handleCrud(route, content, 'list', undefined, req('post', jsonBody({ n: 'c' })));
    expect(JSON.parse(res.body).id).toMatch(UUID_V4);
  });

  it('objects without ids → uuid', () => {
    const res = handleCrud(route, JSON.stringify([{ n: 'a' }]), 'list', undefined, req('post', jsonBody({ n: 'b' })));
    expect(JSON.parse(res.body).id).toMatch(UUID_V4);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: nextContent correctness & reads never mutate
// ---------------------------------------------------------------------------

describe('handleCrud — nextContent semantics', () => {
  it('GET (list & item) never changes the content', () => {
    for (const content of [ARRAY_OBJECTS, ARRAY_PRIMITIVES, OBJECT_CONTENT, PRIMITIVE_CONTENT, RAW_CONTENT]) {
      expect(handleCrud(route, content, 'list', undefined, req('get')).nextContent).toBe(content);
      expect(handleCrud(route, content, 'item', '0', req('get')).nextContent).toBe(content);
    }
  });

  it('404 responses leave the content unchanged', () => {
    expect(handleCrud(route, ARRAY_OBJECTS, 'item', 'nope', req('delete')).nextContent).toBe(ARRAY_OBJECTS);
    expect(handleCrud(route, ARRAY_PRIMITIVES, 'item', '99', req('get')).nextContent).toBe(ARRAY_PRIMITIVES);
  });

  it('400 responses leave the content unchanged', () => {
    expect(handleCrud(route, ARRAY_OBJECTS, 'list', undefined, req('post', jsonBody(1))).nextContent).toBe(
      ARRAY_OBJECTS
    );
    expect(handleCrud(route, OBJECT_CONTENT, 'list', undefined, req('patch', jsonBody(1))).nextContent).toBe(
      OBJECT_CONTENT
    );
  });

  it('mutations re-stringify with 2-space indent', () => {
    const res = handleCrud(
      route,
      JSON.stringify([{ id: 1 }]),
      'list',
      undefined,
      req('post', jsonBody({ id: 2 }))
    );
    expect(res.nextContent).toBe(JSON.stringify([{ id: 1 }, { id: 2 }], null, 2));
  });
});
