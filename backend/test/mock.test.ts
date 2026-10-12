import test from 'node:test';
import assert from 'node:assert/strict';

import { matchPath } from '../src/server/mock/matcher';
import { evaluateRules } from '../src/server/mock/rules';
import { validateBody } from '../src/server/mock/validation';
import { parseTemplate } from '../src/server/mock/templates';
import { resolveMockResponse, findEnvironment, stripPrefix } from '../src/server/mock/responder';
import { MockEnvironment } from '../src/types';

/* ----------------------------- matcher ----------------------------- */

test('matchPath: exact and case-insensitive match', () => {
  assert.equal(matchPath('users', 'users').matches, true);
  assert.equal(matchPath('users', 'USERS').matches, true);
});

test('matchPath: dynamic params are captured and decoded', () => {
  const result = matchPath('users/:id/profile', 'users/123/profile');
  assert.equal(result.matches, true);
  assert.deepEqual(result.params, { id: '123' });

  const encoded = matchPath('items/:slug', 'items/a%20b');
  assert.equal(encoded.params.slug, 'a b');
});

test('matchPath: trailing slash is ignored', () => {
  assert.equal(matchPath('users', '/users/').matches, true);
  assert.equal(matchPath('/users/', 'users').matches, true);
});

test('matchPath: trailing wildcard swallows all remaining segments', () => {
  assert.equal(matchPath('files/*', 'files/a/b/c').matches, true);
  assert.equal(matchPath('files/*', 'files').matches, false);
});

test('matchPath: middle wildcard matches a single segment', () => {
  assert.equal(matchPath('a/*/c', 'a/b/c').matches, true);
  assert.equal(matchPath('a/*/c', 'a/b/d').matches, false);
  assert.equal(matchPath('a/*/c', 'a/b/c/d').matches, false);
});

test('matchPath: universal * matches anything', () => {
  assert.equal(matchPath('*', 'anything/at/all').matches, true);
});

test('matchPath: segment count mismatch fails', () => {
  assert.equal(matchPath('users', 'users/123').matches, false);
  assert.equal(matchPath('users/123', 'users').matches, false);
});

/* ------------------------------ rules ------------------------------ */

test('evaluateRules: AND and OR composition', () => {
  const ctx = {
    query: { category: 'books' },
    body: { user: { id: 7 } },
    headers: { 'x-mode': 'fast' },
    params: { id: '42' },
  };

  const rules = [
    { id: '1', target: 'query' as const, property: 'category', operator: 'equals' as const, value: 'books' },
    { id: '2', target: 'header' as const, property: 'x-mode', operator: 'equals' as const, value: 'fast' },
  ];
  assert.equal(evaluateRules(rules, 'AND', ctx), true);

  rules[1] = { ...rules[1], value: 'slow' };
  assert.equal(evaluateRules(rules, 'AND', ctx), false);
  assert.equal(evaluateRules(rules, 'OR', ctx), true);
});

test('evaluateRules: nested body path, type and null operators', () => {
  const ctx = { query: {}, body: { user: { id: 7, tags: ['a'] } }, headers: {}, params: {} };

  assert.equal(
    evaluateRules([{ id: '1', target: 'body', property: 'user.id', operator: 'is_number', value: '' }], 'AND', ctx),
    true
  );
  assert.equal(
    evaluateRules([{ id: '1', target: 'body', property: 'user.missing', operator: 'null', value: '' }], 'AND', ctx),
    true
  );
  assert.equal(
    evaluateRules([{ id: '1', target: 'body', property: 'user.tags', operator: 'is_array', value: '' }], 'AND', ctx),
    true
  );
});

test('evaluateRules: empty rules never match', () => {
  assert.equal(evaluateRules([], 'AND', { query: {}, body: null, headers: {}, params: {} }), false);
  assert.equal(evaluateRules(undefined, 'OR', { query: {}, body: null, headers: {}, params: {} }), false);
});

/* --------------------------- validation ---------------------------- */

test('validateBody: TypeScript interface enforcement', () => {
  const iface = `interface Payload {
    cardId: string;
    amount: string;
    codeDeliveryMode: string[];
    otpMode: string;
    deviceDetail?: string;
  }`;

  assert.deepEqual(validateBody({ cardId: 'c1', amount: '10', codeDeliveryMode: ['SMS'], otpMode: 'AUTO' }, iface), {
    valid: true,
    errors: [],
  });

  const missing = validateBody({ amount: '10', codeDeliveryMode: ['SMS'], otpMode: 'AUTO' }, iface);
  assert.equal(missing.valid, false);
  assert.match(missing.errors[0], /cardId.*required/);

  const wrongType = validateBody({ cardId: 'c1', amount: '10', codeDeliveryMode: 'SMS', otpMode: 'AUTO' }, iface);
  assert.equal(wrongType.valid, false);
  assert.match(wrongType.errors[0], /codeDeliveryMode.*array/);

  const emptyString = validateBody({ cardId: '', amount: '10', codeDeliveryMode: ['SMS'], otpMode: 'AUTO' }, iface);
  assert.equal(emptyString.valid, false);
});

test('validateBody: union literal types', () => {
  const iface = `interface Msg {
  channel: 'SMS' | 'EMAIL'
}`;
  assert.equal(validateBody({ channel: 'SMS' }, iface).valid, true);
  assert.equal(validateBody({ channel: 'CARRIER' }, iface).valid, false);
});

test('validateBody: JSON definition with optional keys', () => {
  const opt = 'nickname?';
  const def = JSON.stringify({ name: 'string', age: 'number', [opt]: 'string' });
  assert.equal(validateBody({ name: 'x', age: 30 }, def).valid, true);
  assert.equal(validateBody({ age: 30 }, def).valid, false);
  assert.equal(validateBody({ name: 'x', age: 'not-a-number' }, def).valid, false);
});

test('validateBody: empty definition passes; string body is JSON-parsed first', () => {
  assert.equal(validateBody({ anything: 1 }, '').valid, true);
  // String bodies must be valid JSON
  assert.equal(validateBody('plain string', 'interface A { a: string }').valid, false);
  assert.equal(validateBody('{"a":"x"}', 'interface A { a: string }').valid, true);
  // Non-object JSON bodies fail the object contract
  assert.equal(validateBody([1, 2, 3], 'interface A { a: string }').valid, false);
});

/* ---------------------------- templates ---------------------------- */

test('parseTemplate: all tag types', () => {
  const out = parseTemplate(
    'q={{query name N/A}} b={{body user.name}} h={{header x-token none}} p={{param id}} u={{uuid}} r={{randomInt 1 2}} d={{date iso}}',
    {
      query: { name: 'alice' },
      body: { user: { name: 'bob' } },
      headers: { 'X-TOKEN': 'tok123' },
      params: { id: '77' },
    }
  );
  assert.match(out, /^q=alice b=bob h=tok123 p=77 u=[0-9a-f-]{36} r=[12] d=\d{4}-\d{2}-\d{2}T/);
});

test('parseTemplate: unknown tags stay untouched', () => {
  assert.equal(parseTemplate('x={{unknown}} y', { query: {}, body: null, headers: {}, params: {} }), 'x={{unknown}} y');
});

/* ---------------------------- responder ---------------------------- */

function testEnv(overrides: Partial<MockEnvironment> = {}): MockEnvironment {
  return {
    id: 'env-1',
    name: 'Test Env',
    endpointPrefix: '/api',
    port: 3000,
    latency: 0,
    headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json' }],
    routes: [
      {
        id: 'route-1',
        method: 'get',
        endpoint: 'users/:id',
        description: '',
        latency: 0,
        selectedResponseId: 'resp-1',
        responses: [
          {
            id: 'resp-1',
            statusCode: 200,
            label: 'default',
            headers: [],
            body: '{"id":"{{param id}}"}',
            rules: [],
            rulesOperator: 'AND',
          },
        ],
      },
    ],
    ...overrides,
  };
}

test('stripPrefix: removes the environment prefix', () => {
  const env = testEnv();
  assert.equal(stripPrefix(env, 'users/1'), 'users/1');
  const bare = testEnv({ endpointPrefix: '' });
  assert.equal(stripPrefix(bare, 'api/users/1'), 'api/users/1');
});

test('findEnvironment: by id and by slug', () => {
  const envs = [testEnv({ id: 'env-1', name: 'All Bankxp1' })];
  assert.equal(findEnvironment(envs, 'env-1')?.id, 'env-1');
  assert.equal(findEnvironment(envs, 'all-bankxp1')?.id, 'env-1');
  assert.equal(findEnvironment(envs, 'nope'), null);
});

test('resolveMockResponse: serves templated response with env headers', () => {
  const resolved = resolveMockResponse(testEnv(), {
    method: 'GET',
    path: 'users/42',
    query: {},
    body: undefined,
    headers: {},
  });
  assert.equal(resolved.kind, 'response');
  if (resolved.kind === 'response') {
    assert.equal(resolved.statusCode, 200);
    assert.equal(resolved.body, '{"id":"42"}');
    assert.equal(resolved.headers['Content-Type'], 'application/json');
    assert.equal(resolved.matchedRoute, 'GET /users/:id');
  }
});

test('resolveMockResponse: 404 for unknown path, 405 for wrong method', () => {
  const nf = resolveMockResponse(testEnv(), { method: 'GET', path: 'nope', query: {}, body: undefined, headers: {} });
  assert.equal(nf.kind, 'not_found');

  const mm = resolveMockResponse(testEnv(), { method: 'POST', path: 'users/42', query: {}, body: undefined, headers: {} });
  assert.equal(mm.kind, 'method_mismatch');
  if (mm.kind === 'method_mismatch') {
    assert.equal(mm.statusCode, 405);
    assert.match(mm.body, /POST.*GET/);
  }
});

test('resolveMockResponse: rule-matched response wins over default', () => {
  const env = testEnv({
    routes: [
      {
        id: 'route-1',
        method: 'post',
        endpoint: 'transfer',
        description: '',
        latency: 0,
        selectedResponseId: 'resp-default',
        responses: [
          {
            id: 'resp-rule',
            statusCode: 402,
            label: 'declined',
            headers: [],
            body: '{"error":"DECLINED"}',
            rules: [{ id: 'r1', target: 'body', property: 'amount', operator: 'is_number', value: '' }],
            rulesOperator: 'AND',
          },
          {
            id: 'resp-default',
            statusCode: 200,
            label: 'default',
            headers: [],
            body: '{"ok":true}',
            rules: [],
            rulesOperator: 'AND',
          },
        ],
      },
    ],
  });

  const hit = resolveMockResponse(env, {
    method: 'POST',
    path: 'transfer',
    query: {},
    body: { amount: 10 },
    headers: {},
  });
  assert.equal(hit.kind, 'response');
  if (hit.kind === 'response') assert.equal(hit.statusCode, 402);

  const miss = resolveMockResponse(env, {
    method: 'POST',
    path: 'transfer',
    query: {},
    body: { amount: 'N/A' },
    headers: {},
  });
  assert.equal(miss.kind, 'response');
  if (miss.kind === 'response') assert.equal(miss.statusCode, 200);
});

test('resolveMockResponse: validation failure returns 400 with errors', () => {
  const env = testEnv({
    routes: [
      {
        id: 'route-1',
        method: 'post',
        endpoint: 'pay',
        description: '',
        latency: 0,
        selectedResponseId: 'resp-1',
        responses: [
          {
            id: 'resp-1',
            statusCode: 200,
            label: 'ok',
            headers: [],
            body: '{"ok":true}',
            rules: [],
            rulesOperator: 'AND',
            validationInterface: `interface Pay {
  cardId: string;
  amount: string;
}`,
          },
        ],
      },
    ],
  });

  const bad = resolveMockResponse(env, {
    method: 'POST',
    path: 'pay',
    query: {},
    body: { cardId: 123 },
    headers: {},
  });
  assert.equal(bad.kind, 'validation_failed');

  const good = resolveMockResponse(env, {
    method: 'POST',
    path: 'pay',
    query: {},
    body: { cardId: 'c', amount: '5' },
    headers: {},
  });
  assert.equal(good.kind, 'response');
});

test('resolveMockResponse: GET never validates', () => {
  const env = testEnv({
    routes: [
      {
        id: 'route-1',
        method: 'get',
        endpoint: 'users/:id',
        description: '',
        latency: 0,
        selectedResponseId: 'resp-1',
        responses: [
          {
            id: 'resp-1',
            statusCode: 200,
            label: 'ok',
            headers: [],
            body: '{}',
            rules: [],
            rulesOperator: 'AND',
            validationInterface: 'interface U { a: string }',
          },
        ],
      },
    ],
  });
  const resolved = resolveMockResponse(env, { method: 'GET', path: 'users/1', query: {}, body: undefined, headers: {} });
  assert.equal(resolved.kind, 'response');
});

test('resolveMockResponse: invalid JSON body with json content-type produces a warning', () => {
  const env = testEnv({
    routes: [
      {
        id: 'route-1',
        method: 'get',
        endpoint: 'users/:id',
        description: '',
        latency: 0,
        selectedResponseId: 'resp-1',
        responses: [
          {
            id: 'resp-1',
            statusCode: 200,
            label: 'ok',
            headers: [],
            body: 'not json',
            rules: [],
            rulesOperator: 'AND',
          },
        ],
      },
    ],
  });
  const resolved = resolveMockResponse(env, { method: 'GET', path: 'users/1', query: {}, body: undefined, headers: {} });
  assert.equal(resolved.kind, 'response');
  if (resolved.kind === 'response') {
    assert.equal(resolved.warnings.length, 1);
    assert.match(resolved.warnings[0], /not valid JSON/);
  }
});

test('resolveMockResponse: route latency overrides environment latency', () => {
  const env = testEnv({ latency: 999 });
  env.routes[0].latency = 12;
  const resolved = resolveMockResponse(env, { method: 'GET', path: 'users/1', query: {}, body: undefined, headers: {} });
  assert.equal(resolved.kind, 'response');
  if (resolved.kind === 'response') assert.equal(resolved.delayMs, 12);
});
