import { MockEnvironment, MockRoute, RouteResponse } from '../types';

const FIRESTORE_SCHEMA_VERSION = 3;
const ROOT_COLLECTION = 'config';
const ROOT_DOCUMENT = 'mock-environments';

type FirestoreOperation = (writer: any) => void;

function getRootDocumentRef(db: any) {
  return db.collection(ROOT_COLLECTION).doc(ROOT_DOCUMENT);
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

async function collectDeleteRouteTreeOperations(routeDocRef: any): Promise<FirestoreOperation[]> {
  const operations: FirestoreOperation[] = [];
  const responseRefs = await listDocumentRefs(routeDocRef.collection('responses'));

  for (const responseRef of responseRefs) {
    operations.push((writer) => writer.delete(responseRef));
  }

  operations.push((writer) => writer.delete(routeDocRef));
  return operations;
}

async function collectDeleteEnvironmentTreeOperations(environmentDocRef: any): Promise<FirestoreOperation[]> {
  const operations: FirestoreOperation[] = [];
  const routeRefs = await listDocumentRefs(environmentDocRef.collection('routes'));

  for (const routeRef of routeRefs) {
    operations.push(...await collectDeleteRouteTreeOperations(routeRef));
  }

  operations.push((writer) => writer.delete(environmentDocRef));
  return operations;
}

async function collectUpsertEnvironmentTreeOperations(
  environmentDocRef: any,
  environment: MockEnvironment,
  position: number,
  updatedAt: string
): Promise<FirestoreOperation[]> {
  const operations: FirestoreOperation[] = [];
  const routesCollectionRef = environmentDocRef.collection('routes');
  const existingRouteRefs = await listDocumentRefs(routesCollectionRef);
  const nextRouteIds = new Set(environment.routes.map((route) => route.id));

  operations.push((writer) => {
    writer.set(environmentDocRef, serializeEnvironmentDocument(environment, position, updatedAt));
  });

  for (const routeRef of existingRouteRefs) {
    if (!nextRouteIds.has(routeRef.id)) {
      operations.push(...await collectDeleteRouteTreeOperations(routeRef));
    }
  }

  for (const [routeIndex, route] of environment.routes.entries()) {
    const routeDocRef = routesCollectionRef.doc(route.id);
    const responsesCollectionRef = routeDocRef.collection('responses');
    const existingResponseRefs = await listDocumentRefs(responsesCollectionRef);
    const nextResponseIds = new Set(route.responses.map((response) => response.id));

    operations.push((writer) => {
      writer.set(routeDocRef, serializeRouteDocument(route, routeIndex, updatedAt));
    });

    for (const responseRef of existingResponseRefs) {
      if (!nextResponseIds.has(responseRef.id)) {
        operations.push((writer) => writer.delete(responseRef));
      }
    }

    for (const [responseIndex, response] of route.responses.entries()) {
      operations.push((writer) => {
        writer.set(responsesCollectionRef.doc(response.id), serializeResponseDocument(response, responseIndex, updatedAt));
      });
    }
  }

  return operations;
}

async function collectSaveOperations(db: any, environments: MockEnvironment[], updatedAt: string): Promise<FirestoreOperation[]> {
  const operations: FirestoreOperation[] = [];
  const rootDocRef = getRootDocumentRef(db);
  const environmentsCollectionRef = rootDocRef.collection('environments');

  operations.push((writer) => {
    writer.set(rootDocRef, {
      environmentCount: environments.length,
      schemaVersion: FIRESTORE_SCHEMA_VERSION,
      updatedAt
    });
  });

  const existingEnvironmentRefs = await listDocumentRefs(environmentsCollectionRef);
  const nextEnvironmentIds = new Set(environments.map((environment) => environment.id));

  for (const environmentRef of existingEnvironmentRefs) {
    if (!nextEnvironmentIds.has(environmentRef.id)) {
      operations.push(...await collectDeleteEnvironmentTreeOperations(environmentRef));
    }
  }

  for (const [environmentIndex, environment] of environments.entries()) {
    const environmentDocRef = environmentsCollectionRef.doc(environment.id);
    const routesCollectionRef = environmentDocRef.collection('routes');
    const existingRouteRefs = await listDocumentRefs(routesCollectionRef);
    const nextRouteIds = new Set(environment.routes.map((route) => route.id));

    operations.push((writer) => {
      writer.set(environmentDocRef, serializeEnvironmentDocument(environment, environmentIndex, updatedAt));
    });

    for (const routeRef of existingRouteRefs) {
      if (!nextRouteIds.has(routeRef.id)) {
        operations.push(...await collectDeleteRouteTreeOperations(routeRef));
      }
    }

    for (const [routeIndex, route] of environment.routes.entries()) {
      const routeDocRef = routesCollectionRef.doc(route.id);
      const responsesCollectionRef = routeDocRef.collection('responses');
      const existingResponseRefs = await listDocumentRefs(responsesCollectionRef);
      const nextResponseIds = new Set(route.responses.map((response) => response.id));

      operations.push((writer) => {
        writer.set(routeDocRef, serializeRouteDocument(route, routeIndex, updatedAt));
      });

      for (const responseRef of existingResponseRefs) {
        if (!nextResponseIds.has(responseRef.id)) {
          operations.push((writer) => writer.delete(responseRef));
        }
      }

      for (const [responseIndex, response] of route.responses.entries()) {
        operations.push((writer) => {
          writer.set(responsesCollectionRef.doc(response.id), serializeResponseDocument(response, responseIndex, updatedAt));
        });
      }
    }
  }

  return operations;
}

export async function saveEnvironmentsToFirestore(db: any, environments: MockEnvironment[]) {
  const updatedAt = new Date().toISOString();
  const operations = await collectSaveOperations(db, environments, updatedAt);

  if (operations.length === 0) {
    return;
  }

  const writer = db.bulkWriter();

  try {
    for (const operation of operations) {
      operation(writer);
    }

    await writer.close();
  } catch (err) {
    await writer.close().catch(() => {});
    throw err;
  }
}

export async function saveEnvironmentChangesToFirestore(
  db: any,
  upserts: Array<{ environment: MockEnvironment; position: number }>,
  deletedIds: string[]
) {
  const updatedAt = new Date().toISOString();
  const operations: FirestoreOperation[] = [];
  const rootDocRef = getRootDocumentRef(db);
  const environmentsCollectionRef = rootDocRef.collection('environments');
  const existingEnvironmentRefs = await listDocumentRefs(environmentsCollectionRef);
  const existingEnvironmentIds = new Set(existingEnvironmentRefs.map((docRef: any) => docRef.id));
  const deletedIdSet = new Set(deletedIds);

  const deletedExistingCount = deletedIds.filter((id) => existingEnvironmentIds.has(id)).length;
  const addedCount = upserts.filter(({ environment }) => !existingEnvironmentIds.has(environment.id) && !deletedIdSet.has(environment.id)).length;

  operations.push((writer) => {
    writer.set(rootDocRef, {
      environmentCount: existingEnvironmentRefs.length - deletedExistingCount + addedCount,
      schemaVersion: FIRESTORE_SCHEMA_VERSION,
      updatedAt
    });
  });

  for (const deletedId of deletedIds) {
    if (!existingEnvironmentIds.has(deletedId)) {
      continue;
    }

    const environmentDocRef = environmentsCollectionRef.doc(deletedId);
    operations.push(...await collectDeleteEnvironmentTreeOperations(environmentDocRef));
  }

  for (const { environment, position } of upserts) {
    const environmentDocRef = environmentsCollectionRef.doc(environment.id);
    operations.push(...await collectUpsertEnvironmentTreeOperations(environmentDocRef, environment, position, updatedAt));
  }

  if (operations.length === 0) {
    return;
  }

  const writer = db.bulkWriter();

  try {
    for (const operation of operations) {
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
