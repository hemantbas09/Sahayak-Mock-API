import { MockEnvironment, MockRoute, RouteResponse } from '../types';
import type {
  EnvironmentDelete,
  EnvironmentSavePayload,
  EnvironmentUpsert,
  ResponseDelete,
  ResponseUpsert,
  RouteDelete,
  RouteUpsert
} from './environmentSync';

const FIRESTORE_SCHEMA_VERSION = 3;
const ROOT_COLLECTION = 'config';
const ROOT_DOCUMENT = 'mock-environments';

type FirestoreOperation = (writer: any) => void;

function getRootDocumentRef(db: any) {
  return db.collection(ROOT_COLLECTION).doc(ROOT_DOCUMENT);
}

function getEnvironmentsCollectionRef(db: any) {
  return getRootDocumentRef(db).collection('environments');
}

function getEnvironmentDocRef(db: any, environmentId: string) {
  return getEnvironmentsCollectionRef(db).doc(environmentId);
}

function getRouteDocRef(db: any, environmentId: string, routeId: string) {
  return getEnvironmentDocRef(db, environmentId).collection('routes').doc(routeId);
}

function getResponseDocRef(db: any, environmentId: string, routeId: string, responseId: string) {
  return getRouteDocRef(db, environmentId, routeId).collection('responses').doc(responseId);
}

async function listDocumentRefs(collectionRef: any): Promise<any[]> {
  if (typeof collectionRef.listDocuments === 'function') {
    return collectionRef.listDocuments();
  }

  const snapshot = await collectionRef.get();
  return snapshot.docs.map((doc: any) => doc.ref);
}

function stripMetadata<T extends Record<string, any>>(document: T, metadataKeys: string[]): T {
  const clone = { ...document };

  for (const key of metadataKeys) {
    delete clone[key];
  }

  return clone;
}

export function serializeEnvironmentDocument(environment: MockEnvironment, position: number, updatedAt: string) {
  const { routes, ...environmentDocument } = environment;

  return {
    ...environmentDocument,
    position,
    routeCount: routes.length,
    schemaVersion: FIRESTORE_SCHEMA_VERSION,
    updatedAt
  };
}

export function serializeRouteDocument(route: MockRoute, position: number, updatedAt: string) {
  const { responses, ...routeDocument } = route;

  return {
    ...routeDocument,
    position,
    responseCount: responses.length,
    schemaVersion: FIRESTORE_SCHEMA_VERSION,
    updatedAt
  };
}

export function serializeResponseDocument(response: RouteResponse, position: number, updatedAt: string) {
  return {
    ...response,
    position,
    schemaVersion: FIRESTORE_SCHEMA_VERSION,
    updatedAt
  };
}

export function hydrateEnvironmentDocument(data: any): MockEnvironment {
  const environment = stripMetadata(data, ['position', 'routeCount', 'schemaVersion', 'updatedAt']);

  return {
    ...environment,
    routes: Array.isArray(environment.routes) ? environment.routes : []
  } as MockEnvironment;
}

export function hydrateRouteDocument(data: any): MockRoute {
  const route = stripMetadata(data, ['position', 'responseCount', 'schemaVersion', 'updatedAt']);

  return {
    ...route,
    responses: Array.isArray(route.responses) ? route.responses : []
  } as MockRoute;
}

export function hydrateResponseDocument(data: any): RouteResponse {
  return stripMetadata(data, ['position', 'schemaVersion', 'updatedAt']) as RouteResponse;
}

function buildDeleteOperations(db: any, payload: EnvironmentSavePayload): FirestoreOperation[] {
  const operations: FirestoreOperation[] = [];

  for (const environmentDelete of payload.environmentDeletes) {
    for (const routeDelete of environmentDelete.routeDeletes) {
      for (const responseId of routeDelete.responseIds) {
        operations.push((writer) => writer.delete(getResponseDocRef(db, environmentDelete.environmentId, routeDelete.routeId, responseId)));
      }

      operations.push((writer) => writer.delete(getRouteDocRef(db, environmentDelete.environmentId, routeDelete.routeId)));
    }

    operations.push((writer) => writer.delete(getEnvironmentDocRef(db, environmentDelete.environmentId)));
  }

  for (const routeDelete of payload.routeDeletes) {
    for (const responseId of routeDelete.responseIds) {
      operations.push((writer) => writer.delete(getResponseDocRef(db, routeDelete.environmentId, routeDelete.routeId, responseId)));
    }

    operations.push((writer) => writer.delete(getRouteDocRef(db, routeDelete.environmentId, routeDelete.routeId)));
  }

  for (const responseDelete of payload.responseDeletes) {
    operations.push((writer) => writer.delete(getResponseDocRef(db, responseDelete.environmentId, responseDelete.routeId, responseDelete.responseId)));
  }

  return operations;
}

function buildUpsertOperations(db: any, payload: EnvironmentSavePayload, updatedAt: string): FirestoreOperation[] {
  const operations: FirestoreOperation[] = [];

  for (const { environment, position } of payload.environmentUpserts) {
    operations.push((writer) => writer.set(
      getEnvironmentDocRef(db, environment.id),
      serializeEnvironmentDocument(environment, position, updatedAt)
    ));
  }

  for (const { environmentId, route, position } of payload.routeUpserts) {
    operations.push((writer) => writer.set(
      getRouteDocRef(db, environmentId, route.id),
      serializeRouteDocument(route, position, updatedAt)
    ));
  }

  for (const { environmentId, routeId, response, position } of payload.responseUpserts) {
    operations.push((writer) => writer.set(
      getResponseDocRef(db, environmentId, routeId, response.id),
      serializeResponseDocument(response, position, updatedAt)
    ));
  }

  return operations;
}

export async function saveEnvironmentChangesToFirestore(db: any, payload: EnvironmentSavePayload, environmentCount: number) {
  const updatedAt = new Date().toISOString();
  const writer = db.bulkWriter();
  const rootDocRef = getRootDocumentRef(db);

  try {
    writer.set(rootDocRef, {
      environmentCount,
      schemaVersion: FIRESTORE_SCHEMA_VERSION,
      updatedAt
    });

    for (const operation of buildDeleteOperations(db, payload)) {
      operation(writer);
    }

    for (const operation of buildUpsertOperations(db, payload, updatedAt)) {
      operation(writer);
    }

    await writer.close();
  } catch (err) {
    await writer.close().catch(() => {});
    throw err;
  }
}

async function loadModernEnvironments(db: any): Promise<MockEnvironment[]> {
  const rootDocRef = getRootDocumentRef(db);
  const environmentsCollectionRef = rootDocRef.collection('environments');
  const snapshot = await environmentsCollectionRef.orderBy('position', 'asc').get();

  if (snapshot.empty) {
    return [];
  }

  const environments = await Promise.all(snapshot.docs.map(async (environmentDoc: any) => {
    const environmentData = hydrateEnvironmentDocument(environmentDoc.data());
    const routesSnapshot = await environmentDoc.ref.collection('routes').orderBy('position', 'asc').get();

    const routes = await Promise.all(routesSnapshot.docs.map(async (routeDoc: any) => {
      const routeData = hydrateRouteDocument(routeDoc.data());
      const responsesSnapshot = await routeDoc.ref.collection('responses').orderBy('position', 'asc').get();

      const responses = responsesSnapshot.docs.map((responseDoc: any) => hydrateResponseDocument(responseDoc.data()));

      return {
        ...routeData,
        responses
      } as MockRoute;
    }));

    return {
      ...environmentData,
      routes
    } as MockEnvironment;
  }));

  return environments;
}

async function loadLegacyEnvironments(db: any): Promise<MockEnvironment[]> {
  const rootDocRef = getRootDocumentRef(db);
  const snapshot = await rootDocRef.get();

  if (!snapshot.exists) {
    return [];
  }

  const data = snapshot.data();

  if (!data || !Array.isArray(data.environments)) {
    return [];
  }

  return data.environments as MockEnvironment[];
}

export async function loadPersistedEnvironments(db: any): Promise<{ environments: MockEnvironment[]; storageFormat: 'modern' | 'legacy' | 'empty' }> {
  const modernEnvironments = await loadModernEnvironments(db);

  if (modernEnvironments.length > 0) {
    return {
      environments: modernEnvironments,
      storageFormat: 'modern'
    };
  }

  const legacyEnvironments = await loadLegacyEnvironments(db);

  if (legacyEnvironments.length > 0) {
    return {
      environments: legacyEnvironments,
      storageFormat: 'legacy'
    };
  }

  return {
    environments: [],
    storageFormat: 'empty'
  };
}
