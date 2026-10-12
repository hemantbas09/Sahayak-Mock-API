/**
 * Hierarchical Cloud Firestore storage.
 *
 * Layout (same document tree as before, so existing data keeps working):
 *
 *   config/mock-environments                        (root marker doc)
 *     environments/{envId}                          (env meta: name, prefix, headers, latency, position)
 *       routes/{routeId}                            (route meta: method, endpoint, ..., position)
 *         responses/{responseId}                    (full response document, position)
 *
 * Only touched entities are written: `save` diffs the touched paths against
 * the documents currently in the database and issues set/delete calls only
 * for the difference - editing one endpoint touches exactly one document.
 */
import { MockEnvironment, MockRoute } from '../../types';
import { StorageBackend, Touched, parseTouchedPath } from './index';

const SCHEMA_VERSION = 3;
const ROOT_COLLECTION = 'config';
const ROOT_DOCUMENT = 'mock-environments';

const ENV_META_KEYS = ['name', 'endpointPrefix', 'port', 'latency', 'headers'];
const ROUTE_META_KEYS = ['method', 'endpoint', 'description', 'latency', 'selectedResponseId'];

function positionFor(items: { id: string }[]): Map<string, number> {
  return new Map(items.map((item, index) => [item.id, index]));
}

export class FirestoreStorage implements StorageBackend {
  readonly name = 'firestore';

  /** db: firebase-admin Firestore instance (typed as any to avoid coupling). */
  constructor(private readonly db: any) {}

  private envRef(envId: string) {
    return this.db.collection(`${ROOT_COLLECTION}/${ROOT_DOCUMENT}/environments`).doc(envId);
  }

  private routeRef(envId: string, routeId: string) {
    return this.envRef(envId).collection('routes').doc(routeId);
  }

  private responseRef(envId: string, routeId: string, responseId: string) {
    return this.routeRef(envId, routeId).collection('responses').doc(responseId);
  }

  async loadAll(): Promise<MockEnvironment[]> {
    const environmentsCol = this.db.collection(`${ROOT_COLLECTION}/${ROOT_DOCUMENT}/environments`);
    const envSnapshot = await environmentsCol.orderBy('position', 'asc').get();

    if (envSnapshot.empty) return [];

    const environments = await Promise.all(
      envSnapshot.docs.map(async (envDoc: any) => {
        const data = envDoc.data();
        const env: MockEnvironment = {
          id: envDoc.id,
          name: data.name ?? '',
          endpointPrefix: data.endpointPrefix ?? '',
          port: data.port ?? 3000,
          latency: data.latency ?? 0,
          headers: Array.isArray(data.headers) ? data.headers : [],
          routes: [],
        };

        const routesSnapshot = await envDoc.ref.collection('routes').orderBy('position', 'asc').get();
        env.routes = await Promise.all(
          routesSnapshot.docs.map(async (routeDoc: any) => {
            const rdata = routeDoc.data();
            const route: MockRoute = {
              id: routeDoc.id,
              method: rdata.method ?? 'get',
              endpoint: rdata.endpoint ?? '',
              description: rdata.description ?? '',
              latency: rdata.latency ?? 0,
              selectedResponseId: rdata.selectedResponseId ?? '',
              responses: [],
            };

            const responsesSnapshot = await routeDoc.ref.collection('responses').orderBy('position', 'asc').get();
            route.responses = responsesSnapshot.docs.map((responseDoc: any) => {
              const r = responseDoc.data();
              return {
                id: responseDoc.id,
                statusCode: r.statusCode ?? 200,
                label: r.label ?? '',
                headers: Array.isArray(r.headers) ? r.headers : [],
                body: typeof r.body === 'string' ? r.body : '',
                rules: Array.isArray(r.rules) ? r.rules : [],
                rulesOperator: r.rulesOperator === 'OR' ? 'OR' : 'AND',
                validationInterface: typeof r.validationInterface === 'string' ? r.validationInterface : undefined,
                validationEnabled: typeof r.validationEnabled === 'boolean' ? r.validationEnabled : undefined,
              };
            });

            return route;
          })
        );

        return env;
      })
    );

    return environments;
  }

  async save(snapshot: MockEnvironment[], touched: Touched): Promise<void> {
    const updatedAt = new Date().toISOString();
    const writer = this.db.bulkWriter();
    const rootRef = this.db.collection(ROOT_COLLECTION).doc(ROOT_DOCUMENT);

    try {
      writer.set(rootRef, {
        environmentCount: snapshot.length,
        schemaVersion: SCHEMA_VERSION,
        updatedAt,
      });

      // Deletions (children first is not required for Firestore; sub-collections
      // are removed automatically when a parent doc is deleted, but we delete
      // explicitly for clarity and to cover the no-parent case).
      for (const pathStr of touched.deletes) {
        const parsed = parseTouchedPath(pathStr);
        if (parsed.kind === 'env') {
          writer.delete(this.envRef(parsed.envId));
        } else if (parsed.kind === 'route') {
          writer.delete(this.routeRef(parsed.envId, parsed.routeId));
        } else {
          writer.delete(this.responseRef(parsed.envId, parsed.routeId, parsed.responseId));
        }
      }

      // Writes: exactly the touched entities, nothing more. The op protocol
      // guarantees that when a child is created, its parent's upsert is part
      // of the same batch, so parents never have to be synthesized here.
      const envById = new Map(snapshot.map((e) => [e.id, e]));
      const envPositions = positionFor(snapshot);

      for (const pathStr of touched.writes) {
        const parsed = parseTouchedPath(pathStr);

        if (parsed.kind === 'env') {
          const env = envById.get(parsed.envId);
          if (!env) continue;
          const meta: Record<string, unknown> = { position: envPositions.get(env.id) ?? 0 };
          for (const key of ENV_META_KEYS) meta[key] = (env as unknown as Record<string, unknown>)[key];
          meta.routeCount = env.routes.length;
          meta.schemaVersion = SCHEMA_VERSION;
          meta.updatedAt = updatedAt;
          writer.set(this.envRef(env.id), meta);
          continue;
        }

        if (parsed.kind === 'route') {
          const env = envById.get(parsed.envId);
          const route = env?.routes.find((r) => r.id === parsed.routeId);
          if (!env || !route) continue;
          const routePositions = positionFor(env.routes);
          const meta: Record<string, unknown> = { position: routePositions.get(route.id) ?? 0 };
          for (const key of ROUTE_META_KEYS) meta[key] = (route as unknown as Record<string, unknown>)[key];
          meta.responseCount = route.responses.length;
          meta.schemaVersion = SCHEMA_VERSION;
          meta.updatedAt = updatedAt;
          writer.set(this.routeRef(env.id, route.id), meta);
          continue;
        }

        const env = envById.get(parsed.envId);
        const route = env?.routes.find((r) => r.id === parsed.routeId);
        const response = route?.responses.find((r) => r.id === parsed.responseId);
        if (!env || !route || !response) continue;

        const responsePositions = positionFor(route.responses);
        const meta: Record<string, unknown> = { ...response, position: responsePositions.get(response.id) ?? 0 };
        (meta as Record<string, unknown>).schemaVersion = SCHEMA_VERSION;
        (meta as Record<string, unknown>).updatedAt = updatedAt;
        writer.set(this.responseRef(env.id, route.id, response.id), meta);
      }

      await writer.close();
    } catch (err) {
      await writer.close().catch(() => {});
      throw err;
    }
  }
}
