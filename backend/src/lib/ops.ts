/**
 * Shared operation protocol for saving mock configuration.
 *
 * Instead of shipping the whole configuration on every save, the client diffs
 * its "last saved" snapshot against the current local state and sends only the
 * changed entities as explicit operations. The server applies the same pure
 * reducer, so client and server always agree on the resulting state.
 *
 * Op granularity:
 *   - env.upsert         -> environment meta only (name, prefix, headers, latency)
 *   - env.delete         -> environment + all its routes/responses
 *   - env.reorder        -> full order of environment ids
 *   - route.upsert       -> route meta only (method, endpoint, latency, ...)
 *   - route.delete       -> route + all its responses
 *   - route.reorder      -> full order of route ids within an environment
 *   - response.upsert    -> one full response document
 *   - response.delete    -> one response document
 *   - response.reorder   -> full order of response ids within a route
 *
 * So editing a single endpoint body produces a payload of exactly ONE
 * response.upsert - nothing else crosses the wire or gets written.
 */
import { MockEnvironment, MockRoute, RouteResponse } from '../types';

export const OPS_PROTOCOL_VERSION = 1;

export interface EnvMeta extends Omit<MockEnvironment, 'routes'> {}
export interface RouteMeta extends Omit<MockRoute, 'responses'> {}

export type Op =
  | { type: 'env.upsert'; env: EnvMeta }
  | { type: 'env.delete'; id: string }
  | { type: 'env.reorder'; order: string[] }
  | { type: 'route.upsert'; envId: string; route: RouteMeta }
  | { type: 'route.delete'; envId: string; id: string }
  | { type: 'route.reorder'; envId: string; order: string[] }
  | { type: 'response.upsert'; envId: string; routeId: string; response: RouteResponse }
  | { type: 'response.delete'; envId: string; routeId: string; id: string }
  | { type: 'response.reorder'; envId: string; routeId: string; order: string[] };

export interface OpsPayload {
  version: number;
  ops: Op[];
}

/* ------------------------------------------------------------------ */
/* stable comparison helpers                                           */
/* ------------------------------------------------------------------ */

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce((acc: Record<string, unknown>, key) => {
      acc[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

export function toEnvMeta(env: MockEnvironment): EnvMeta {
  const { routes: _routes, ...meta } = env;
  return meta;
}

export function toRouteMeta(route: MockRoute): RouteMeta {
  const { responses: _responses, ...meta } = route;
  return meta;
}

function sameEnvMeta(a: MockEnvironment, b: MockEnvironment): boolean {
  return stableStringify(toEnvMeta(a)) === stableStringify(toEnvMeta(b));
}

function sameRouteMeta(a: MockRoute, b: MockRoute): boolean {
  return stableStringify(toRouteMeta(a)) === stableStringify(toRouteMeta(b));
}

/** Same element set (ignoring order). */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const item of b) {
    if (!setA.has(item)) return false;
    setA.delete(item);
  }
  return setA.size === 0;
}

function orderDiffers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* buildOps: diff saved -> current, emit minimal ops                   */
/* ------------------------------------------------------------------ */

export function buildOps(saved: MockEnvironment[], current: MockEnvironment[]): OpsPayload {
  const ops: Op[] = [];
  const savedById = new Map(saved.map((e) => [e.id, e]));
  const currentById = new Map(current.map((e) => [e.id, e]));

  // 1. Deleted environments
  for (const env of saved) {
    if (!currentById.has(env.id)) ops.push({ type: 'env.delete', id: env.id });
  }

  // 2. New or meta-changed environments
  for (const env of current) {
    const prev = savedById.get(env.id);
    if (!prev || !sameEnvMeta(prev, env)) {
      ops.push({ type: 'env.upsert', env: toEnvMeta(env) });
    }
  }

  // 3. Environment order (only when the set is unchanged but order moved)
  const savedEnvIds = saved.map((e) => e.id);
  const currentEnvIds = current.map((e) => e.id);
  if (sameSet(savedEnvIds, currentEnvIds) && orderDiffers(savedEnvIds, currentEnvIds)) {
    ops.push({ type: 'env.reorder', order: currentEnvIds });
  }

  // 4. Routes & responses per environment
  for (const env of current) {
    const prev = savedById.get(env.id);

    if (!prev) {
      // Brand-new environment: emit every route and response.
      for (const route of env.routes) {
        ops.push({ type: 'route.upsert', envId: env.id, route: toRouteMeta(route) });
        for (const resp of route.responses) {
          ops.push({ type: 'response.upsert', envId: env.id, routeId: route.id, response: resp });
        }
      }
      continue;
    }

    const prevRouteById = new Map(prev.routes.map((r) => [r.id, r]));
    const routeIdsSaved = prev.routes.map((r) => r.id);
    const routeIdsCurrent = env.routes.map((r) => r.id);

    for (const route of prev.routes) {
      if (!routeIdsCurrent.includes(route.id)) {
        ops.push({ type: 'route.delete', envId: env.id, id: route.id });
      }
    }

    for (const route of env.routes) {
      const rPrev = prevRouteById.get(route.id);
      if (!rPrev || !sameRouteMeta(rPrev, route)) {
        ops.push({ type: 'route.upsert', envId: env.id, route: toRouteMeta(route) });
      }

      if (!rPrev) {
        // New route: emit all its responses.
        for (const resp of route.responses) {
          ops.push({ type: 'response.upsert', envId: env.id, routeId: route.id, response: resp });
        }
        continue;
      }

      const prevRespById = new Map(rPrev.responses.map((r) => [r.id, r]));
      const respIdsSaved = rPrev.responses.map((r) => r.id);
      const respIdsCurrent = route.responses.map((r) => r.id);

      for (const resp of rPrev.responses) {
        if (!respIdsCurrent.includes(resp.id)) {
          ops.push({ type: 'response.delete', envId: env.id, routeId: route.id, id: resp.id });
        }
      }

      for (const resp of route.responses) {
        const respPrev = prevRespById.get(resp.id);
        if (!respPrev || stableStringify(respPrev) !== stableStringify(resp)) {
          ops.push({ type: 'response.upsert', envId: env.id, routeId: route.id, response: resp });
        }
      }

      if (sameSet(respIdsSaved, respIdsCurrent) && orderDiffers(respIdsSaved, respIdsCurrent)) {
        ops.push({ type: 'response.reorder', envId: env.id, routeId: route.id, order: respIdsCurrent });
      }
    }

    if (sameSet(routeIdsSaved, routeIdsCurrent) && orderDiffers(routeIdsSaved, routeIdsCurrent)) {
      ops.push({ type: 'route.reorder', envId: env.id, order: routeIdsCurrent });
    }
  }

  return { version: OPS_PROTOCOL_VERSION, ops };
}

/* ------------------------------------------------------------------ */
/* applyOps: pure reducer used by the server (and verifiable locally)  */
/* ------------------------------------------------------------------ */

function cloneEnvironments(environments: MockEnvironment[]): MockEnvironment[] {
  return environments.map((env) => ({
    ...env,
    headers: env.headers.map((h) => ({ ...h })),
    routes: env.routes.map((route) => ({
      ...route,
      responses: route.responses.map((resp) => ({
        ...resp,
        headers: resp.headers.map((h) => ({ ...h })),
        rules: resp.rules.map((rule) => ({ ...rule })),
      })),
    })),
  }));
}

function reorderByIds<T extends { id: string }>(items: T[], order: string[], label: string): T[] {
  const known = new Set(items.map((i) => i.id));
  for (const id of order) {
    if (!known.has(id)) throw new Error(`${label} references unknown id "${id}"`);
  }
  if (order.length !== items.length) {
    throw new Error(`${label} must list every id exactly once (got ${order.length} of ${items.length})`);
  }
  const indexById = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (indexById.get(a.id)! - indexById.get(b.id)!));
}

/**
 * Apply a list of operations to a snapshot and return the new snapshot.
 * Throws a descriptive error when an op references unknown parents.
 */
export function applyOps(state: MockEnvironment[], ops: Op[]): MockEnvironment[] {
  let envs = cloneEnvironments(state);

  for (const op of ops) {
    switch (op.type) {
      case 'env.delete': {
        envs = envs.filter((e) => e.id !== op.id);
        break;
      }
      case 'env.upsert': {
        const idx = envs.findIndex((e) => e.id === op.env.id);
        if (idx === -1) {
          envs = [...envs, { ...op.env, headers: op.env.headers.map((h) => ({ ...h })), routes: [] }];
        } else {
          // Merge meta only; routes are managed by their own ops.
          const existing = envs[idx];
          envs[idx] = {
            ...existing,
            name: op.env.name,
            endpointPrefix: op.env.endpointPrefix,
            port: op.env.port,
            latency: op.env.latency,
            headers: op.env.headers.map((h) => ({ ...h })),
          };
        }
        break;
      }
      case 'env.reorder': {
        envs = reorderByIds(envs, op.order, 'env.reorder');
        break;
      }
      case 'route.upsert': {
        const env = envs.find((e) => e.id === op.envId);
        if (!env) throw new Error(`route.upsert references unknown environment "${op.envId}"`);
        const idx = env.routes.findIndex((r) => r.id === op.route.id);
        if (idx === -1) {
          env.routes = [...env.routes, { ...op.route, responses: [] }];
        } else {
          const existing = env.routes[idx];
          env.routes[idx] = {
            ...existing,
            method: op.route.method,
            endpoint: op.route.endpoint,
            description: op.route.description,
            latency: op.route.latency,
            selectedResponseId: op.route.selectedResponseId,
          };
        }
        break;
      }
      case 'route.delete': {
        const env = envs.find((e) => e.id === op.envId);
        if (!env) throw new Error(`route.delete references unknown environment "${op.envId}"`);
        env.routes = env.routes.filter((r) => r.id !== op.id);
        break;
      }
      case 'route.reorder': {
        const env = envs.find((e) => e.id === op.envId);
        if (!env) throw new Error(`route.reorder references unknown environment "${op.envId}"`);
        env.routes = reorderByIds(env.routes, op.order, `route.reorder for "${op.envId}"`);
        break;
      }
      case 'response.upsert': {
        const env = envs.find((e) => e.id === op.envId);
        if (!env) throw new Error(`response.upsert references unknown environment "${op.envId}"`);
        const route = env.routes.find((r) => r.id === op.routeId);
        if (!route) throw new Error(`response.upsert references unknown route "${op.routeId}"`);
        const idx = route.responses.findIndex((r) => r.id === op.response.id);
        if (idx === -1) {
          route.responses = [...route.responses, { ...op.response }];
        } else {
          route.responses[idx] = { ...op.response };
        }
        break;
      }
      case 'response.delete': {
        const env = envs.find((e) => e.id === op.envId);
        if (!env) throw new Error(`response.delete references unknown environment "${op.envId}"`);
        const route = env.routes.find((r) => r.id === op.routeId);
        if (!route) throw new Error(`response.delete references unknown route "${op.routeId}"`);
        route.responses = route.responses.filter((r) => r.id !== op.id);
        break;
      }
      case 'response.reorder': {
        const env = envs.find((e) => e.id === op.envId);
        if (!env) throw new Error(`response.reorder references unknown environment "${op.envId}"`);
        const route = env.routes.find((r) => r.id === op.routeId);
        if (!route) throw new Error(`response.reorder references unknown route "${op.routeId}"`);
        route.responses = reorderByIds(route.responses, op.order, `response.reorder for "${op.routeId}"`);
        break;
      }
      default: {
        const exhaustive: never = op;
        throw new Error(`Unknown op: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  return envs;
}
