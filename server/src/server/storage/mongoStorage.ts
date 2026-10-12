/**
 * MongoDB storage (primary backend).
 *
 * Three flat collections - environments, routes, responses (see
 * src/db/models.ts). A save deletes and re-writes ONLY the touched entity
 * documents via unique-key upserts, so editing one response body writes
 * exactly one document.
 *
 * `loadAll` queries each collection in `position` order and re-nests them
 * into the MockEnvironment[] tree the rest of the server uses.
 */
import type { Connection } from 'mongoose';
import { MockEnvironment, MockRoute, RouteRule } from '../../types';
import { EnvironmentDoc, ResponseDoc, RouteDoc, registerModels } from '../../db/models';
import { StorageBackend, Touched, parseTouchedPath } from './index';

const SCHEMA_VERSION = 1;

function positionFor(items: { id: string }[]): Map<string, number> {
  return new Map(items.map((item, index) => [item.id, index]));
}

const pairKey = (envId: string, routeId: string) => `${envId}::${routeId}`;

export class MongoStorage implements StorageBackend {
  readonly name = 'mongodb';

  constructor(private readonly conn: Connection) {}

  async loadAll(): Promise<MockEnvironment[]> {
    const { Environment, Route, Response } = registerModels(this.conn);

    const envDocs: EnvironmentDoc[] = await Environment.find().sort({ position: 1, envId: 1 });
    if (envDocs.length === 0) return [];

    const envIds = envDocs.map((e) => e.envId);
    const routeDocs: RouteDoc[] = await Route.find({ envId: { $in: envIds } }).sort({ position: 1, routeId: 1 });
    const responseDocs: ResponseDoc[] =
      routeDocs.length > 0
        ? await Response.find({
            $or: routeDocs.map((r) => ({ envId: r.envId, routeId: r.routeId })),
          }).sort({ position: 1, responseId: 1 })
        : [];

    const routesByEnv = new Map<string, RouteDoc[]>();
    for (const doc of routeDocs) {
      const list = routesByEnv.get(doc.envId) ?? [];
      list.push(doc);
      routesByEnv.set(doc.envId, list);
    }

    const responsesByPair = new Map<string, ResponseDoc[]>();
    for (const doc of responseDocs) {
      const key = pairKey(doc.envId, doc.routeId);
      const list = responsesByPair.get(key) ?? [];
      list.push(doc);
      responsesByPair.set(key, list);
    }

    return envDocs.map((env) => {
      const envResult: MockEnvironment = {
        id: env.envId,
        name: env.name ?? '',
        endpointPrefix: env.endpointPrefix ?? '',
        port: env.port ?? 3000,
        latency: env.latency ?? 0,
        headers: (env.headers ?? []).map((h) => ({ id: h.id, key: h.key, value: h.value })),
        routes: [],
      };

      envResult.routes = (routesByEnv.get(env.envId) ?? []).map((route) => {
        const routeResult: MockRoute = {
          id: route.routeId,
          method: (route.method as MockRoute['method']) ?? 'get',
          endpoint: route.endpoint ?? '',
          description: route.description ?? '',
          latency: route.latency ?? 0,
          selectedResponseId: route.selectedResponseId ?? '',
          responses: [],
        };

        routeResult.responses = (responsesByPair.get(pairKey(route.envId, route.routeId)) ?? []).map((resp) => ({
          id: resp.responseId,
          statusCode: resp.statusCode ?? 200,
          label: resp.label ?? '',
          headers: (resp.headers ?? []).map((h) => ({ id: h.id, key: h.key, value: h.value })),
          body: typeof resp.body === 'string' ? resp.body : '',
          rules: (resp.rules ?? []).map((r) => ({
            id: r.id,
            target: r.target as RouteRule['target'],
            property: r.property,
            operator: r.operator as RouteRule['operator'],
            value: r.value,
          })),
          rulesOperator: resp.rulesOperator === 'OR' ? ('OR' as const) : ('AND' as const),
          validationInterface:
            typeof resp.validationInterface === 'string' ? resp.validationInterface : undefined,
          validationEnabled: typeof resp.validationEnabled === 'boolean' ? resp.validationEnabled : undefined,
        }));

        return routeResult;
      });

      return envResult;
    });
  }

  async save(snapshot: MockEnvironment[], touched: Touched): Promise<void> {
    const { Environment, Route, Response } = registerModels(this.conn);
    const updatedAt = new Date().toISOString();

    const envById = new Map(snapshot.map((e) => [e.id, e]));

    // Deletes: exactly the touched entity paths (already expanded by the Store).
    for (const pathStr of touched.deletes) {
      const parsed = parseTouchedPath(pathStr);
      if (parsed.kind === 'env') {
        await Environment.deleteOne({ envId: parsed.envId });
      } else if (parsed.kind === 'route') {
        await Route.deleteOne({ envId: parsed.envId, routeId: parsed.routeId });
      } else {
        await Response.deleteOne({
          envId: parsed.envId,
          routeId: parsed.routeId,
          responseId: parsed.responseId,
        });
      }
    }

    // Writes: exactly the touched entities, nothing more.
    const envPositions = positionFor(snapshot);
    for (const pathStr of touched.writes) {
      const parsed = parseTouchedPath(pathStr);

      if (parsed.kind === 'env') {
        const env = envById.get(parsed.envId);
        if (!env) continue;
        await Environment.replaceOne(
          { envId: env.id },
          {
            envId: env.id,
            name: env.name,
            endpointPrefix: env.endpointPrefix,
            port: env.port,
            latency: env.latency,
            headers: env.headers,
            position: envPositions.get(env.id) ?? 0,
            routeCount: env.routes.length,
            schemaVersion: SCHEMA_VERSION,
            updatedAt,
          },
          { upsert: true }
        );
        continue;
      }

      if (parsed.kind === 'route') {
        const env = envById.get(parsed.envId);
        const route = env?.routes.find((r) => r.id === parsed.routeId);
        if (!env || !route) continue;
        const routePositions = positionFor(env.routes);
        await Route.replaceOne(
          { envId: env.id, routeId: route.id },
          {
            envId: env.id,
            routeId: route.id,
            method: route.method,
            endpoint: route.endpoint,
            description: route.description,
            latency: route.latency,
            selectedResponseId: route.selectedResponseId,
            responseCount: route.responses.length,
            position: routePositions.get(route.id) ?? 0,
            schemaVersion: SCHEMA_VERSION,
            updatedAt,
          },
          { upsert: true }
        );
        continue;
      }

      const env = envById.get(parsed.envId);
      const route = env?.routes.find((r) => r.id === parsed.routeId);
      const response = route?.responses.find((r) => r.id === parsed.responseId);
      if (!env || !route || !response) continue;
      const responsePositions = positionFor(route.responses);
      await Response.replaceOne(
        { envId: env.id, routeId: route.id, responseId: response.id },
        {
          envId: env.id,
          routeId: route.id,
          responseId: response.id,
          statusCode: response.statusCode,
          label: response.label,
          headers: response.headers,
          body: response.body,
          rules: response.rules,
          rulesOperator: response.rulesOperator,
          validationInterface: response.validationInterface,
          validationEnabled: response.validationEnabled,
          position: responsePositions.get(response.id) ?? 0,
          schemaVersion: SCHEMA_VERSION,
          updatedAt,
        },
        { upsert: true }
      );
    }
  }
}
