import test from 'node:test';
import assert from 'node:assert/strict';

import { MockEnvironment, MockRoute, RouteResponse } from '../src/types';
import { applyOps, buildOps, stableStringify } from '../src/lib/ops';

function makeResponse(id: string, body: string): RouteResponse {
  return {
    id,
    statusCode: 200,
    label: 'resp',
    headers: [{ id: 'h1', key: 'Content-Type', value: 'application/json' }],
    body,
    rules: [],
    rulesOperator: 'AND',
  };
}

function makeRoute(id: string, endpoint: string, responses: RouteResponse[]): MockRoute {
  return {
    id,
    method: 'get',
    endpoint,
    description: 'route',
    latency: 0,
    responses,
    selectedResponseId: responses[0]?.id ?? '',
  };
}

function makeEnv(id: string, name: string, routes: MockRoute[]): MockEnvironment {
  return {
    id,
    name,
    endpointPrefix: '',
    port: 3000,
    latency: 0,
    headers: [],
    routes,
  };
}

test('buildOps: editing one response body emits exactly one response.upsert', () => {
  const saved = [makeEnv('env-1', 'Env One', [
    makeRoute('route-1', 'users', [makeResponse('resp-1', '{"ok":true}')]),
    makeRoute('route-2', 'orders', [makeResponse('resp-2', '{"ok":true}')]),
  ])];

  const current = [makeEnv('env-1', 'Env One', [
    makeRoute('route-1', 'users', [makeResponse('resp-1', '{"ok":false}')]),
    makeRoute('route-2', 'orders', [makeResponse('resp-2', '{"ok":true}')]),
  ])];

  const payload = buildOps(saved, current);

  assert.equal(payload.ops.length, 1);
  assert.deepEqual(payload.ops, [
    { type: 'response.upsert', envId: 'env-1', routeId: 'route-1', response: makeResponse('resp-1', '{"ok":false}') },
  ]);

  // The payload must NOT contain any unrelated entity.
  const serialized = stableStringify(payload);
  assert.ok(!serialized.includes('route-2'));
  assert.ok(!serialized.includes('resp-2'));
});

test('buildOps + applyOps roundtrip: single response edit', () => {
  const saved = [makeEnv('env-1', 'Env One', [makeRoute('route-1', 'users', [makeResponse('resp-1', 'A')])])];
  const current = [makeEnv('env-1', 'Env One', [makeRoute('route-1', 'users', [makeResponse('resp-1', 'B')])])];

  const result = applyOps(saved, buildOps(saved, current).ops);
  assert.equal(stableStringify(result), stableStringify(current));
});

test('buildOps: no changes emits zero ops', () => {
  const env = makeEnv('env-1', 'Env One', [makeRoute('route-1', 'users', [makeResponse('resp-1', 'A')])]);
  assert.equal(buildOps([env], [env]).ops.length, 0);
});

test('buildOps: editing route meta emits only route.upsert (no response ops)', () => {
  const saved = [makeEnv('env-1', 'Env One', [
    makeRoute('route-1', 'users', [makeResponse('resp-1', 'A')]),
  ])];
  const current = [makeEnv('env-1', 'Env One', [
    { ...makeRoute('route-1', 'users-v2', [makeResponse('resp-1', 'A')]), latency: 150 },
  ])];

  const payload = buildOps(saved, current);
  assert.deepEqual(payload.ops.map((o) => o.type), ['route.upsert']);
});

test('buildOps: adding an environment emits env.upsert + route.upserts + response.upserts (parents first)', () => {
  const saved: MockEnvironment[] = [];
  const newEnv = makeEnv('env-9', 'New', [makeRoute('route-9', 'ping', [makeResponse('resp-9', 'pong')])]);
  const current = [newEnv];

  const payload = buildOps(saved, current);
  assert.deepEqual(payload.ops.map((o) => o.type), ['env.upsert', 'route.upsert', 'response.upsert']);
  assert.deepEqual(applyOps(saved, payload.ops), current);
});

test('buildOps: deleting an environment emits env.delete (children expanded later by the store)', () => {
  const saved = [makeEnv('env-1', 'Env One', [makeRoute('route-1', 'users', [makeResponse('resp-1', 'A')])])];
  const current: MockEnvironment[] = [];

  const payload = buildOps(saved, current);
  assert.deepEqual(payload.ops, [{ type: 'env.delete', id: 'env-1' }]);
  assert.deepEqual(applyOps(saved, payload.ops), []);
});

test('buildOps: deleting a route emits route.delete only', () => {
  const saved = [makeEnv('env-1', 'E', [
    makeRoute('route-1', 'a', [makeResponse('r1', 'x')]),
    makeRoute('route-2', 'b', [makeResponse('r2', 'y')]),
  ])];
  const current = [makeEnv('env-1', 'E', [makeRoute('route-1', 'a', [makeResponse('r1', 'x')])])];

  const payload = buildOps(saved, current);
  assert.deepEqual(payload.ops, [{ type: 'route.delete', envId: 'env-1', id: 'route-2' }]);
});

test('buildOps: reordering environments emits a single env.reorder', () => {
  const saved = [makeEnv('env-1', 'A', []), makeEnv('env-2', 'B', [])];
  const current = [makeEnv('env-2', 'B', []), makeEnv('env-1', 'A', [])];

  const payload = buildOps(saved, current);
  assert.deepEqual(payload.ops, [{ type: 'env.reorder', order: ['env-2', 'env-1'] }]);
  assert.deepEqual(applyOps(saved, payload.ops).map((e) => e.id), ['env-2', 'env-1']);
});

test('buildOps: reordering responses emits response.reorder (no upserts)', () => {
  const saved = [makeEnv('env-1', 'E', [{
    ...makeRoute('route-1', 'a', [makeResponse('r1', 'x'), makeResponse('r2', 'y')]),
    selectedResponseId: 'r1',
  }])];
  const current = [makeEnv('env-1', 'E', [{
    ...makeRoute('route-1', 'a', [makeResponse('r2', 'y'), makeResponse('r1', 'x')]),
    selectedResponseId: 'r1',
  }])];

  const payload = buildOps(saved, current);
  assert.deepEqual(payload.ops, [{ type: 'response.reorder', envId: 'env-1', routeId: 'route-1', order: ['r2', 'r1'] }]);
  assert.deepEqual(applyOps(saved, payload.ops)[0].routes[0].responses.map((r) => r.id), ['r2', 'r1']);
});

test('applyOps: env.upsert on existing env preserves routes', () => {
  const env = makeEnv('env-1', 'Old Name', [makeRoute('route-1', 'a', [makeResponse('r1', 'x')])]);
  const next = applyOps([env], [
    { type: 'env.upsert', env: { id: 'env-1', name: 'New Name', endpointPrefix: '/api', port: 3000, latency: 5, headers: [] } },
  ]);
  assert.equal(next[0].name, 'New Name');
  assert.equal(next[0].endpointPrefix, '/api');
  assert.equal(next[0].latency, 5);
  assert.equal(next[0].routes.length, 1);
  assert.equal(next[0].routes[0].responses[0].body, 'x');
});

test('applyOps: unknown parent references throw', () => {
  const routeMeta = { id: 'r', method: 'get' as const, endpoint: 'a', description: '', latency: 0, selectedResponseId: '' };
  assert.throws(
    () => applyOps([], [{ type: 'route.upsert', envId: 'nope', route: routeMeta }]),
    /unknown environment/
  );
  assert.throws(
    () => applyOps([makeEnv('env-1', 'E', [])], [{ type: 'response.upsert', envId: 'env-1', routeId: 'ghost', response: makeResponse('x', 'y') }]),
    /unknown route/
  );
});

test('applyOps: reorder ops validate membership', () => {
  const saved = [makeEnv('env-1', 'A', []), makeEnv('env-2', 'B', [])];
  assert.throws(() => applyOps(saved, [{ type: 'env.reorder', order: ['env-1'] }]), /must list every id/);
  assert.throws(() => applyOps(saved, [{ type: 'env.reorder', order: ['env-1', 'env-3'] }]), /unknown id/);
});
