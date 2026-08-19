import { MockEnvironment, MockRoute, RouteResponse } from '../types';

export interface EnvironmentUpsert {
  environment: MockEnvironment;
  position: number;
}

export interface RouteUpsert {
  environmentId: string;
  route: MockRoute;
  position: number;
}

export interface ResponseUpsert {
  environmentId: string;
  routeId: string;
  response: RouteResponse;
  position: number;
}

export interface RouteDelete {
  environmentId: string;
  routeId: string;
  responseIds: string[];
}

export interface EnvironmentDelete {
  environmentId: string;
  routeDeletes: RouteDelete[];
}

export interface ResponseDelete {
  environmentId: string;
  routeId: string;
  responseId: string;
}

export interface EnvironmentSavePayload {
  environmentUpserts: EnvironmentUpsert[];
  routeUpserts: RouteUpsert[];
  responseUpserts: ResponseUpsert[];
  environmentDeletes: EnvironmentDelete[];
  routeDeletes: RouteDelete[];
  responseDeletes: ResponseDelete[];
}

function sortObjectKeys(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((acc: Record<string, any>, key) => {
      acc[key] = sortObjectKeys(value[key]);
      return acc;
    }, {});
}

export function stableStringify(value: any): string {
  return JSON.stringify(sortObjectKeys(value));
}

function comparableEnvironmentDoc(environment: MockEnvironment, position: number) {
  const { routes, ...environmentDocument } = environment;

  return {
    ...environmentDocument,
    position,
    routeCount: routes.length
  };
}

function comparableRouteDoc(route: MockRoute, position: number) {
  const { responses, ...routeDocument } = route;

  return {
    ...routeDocument,
    position,
    responseCount: responses.length
  };
}

function comparableResponseDoc(response: RouteResponse, position: number) {
  return {
    ...response,
    position
  };
}

function buildEnvironmentDelete(environment: MockEnvironment): EnvironmentDelete {
  return {
    environmentId: environment.id,
    routeDeletes: environment.routes.map((route) => ({
      environmentId: environment.id,
      routeId: route.id,
      responseIds: route.responses.map((response) => response.id)
    }))
  };
}

function buildRouteDelete(environmentId: string, route: MockRoute): RouteDelete {
  return {
    environmentId,
    routeId: route.id,
    responseIds: route.responses.map((response) => response.id)
  };
}

function buildPositionMap<T extends { id: string }>(items: T[]): Map<string, number> {
  return new Map(items.map((item, index) => [item.id, index]));
}

function reorderByPosition<T extends { id: string }>(
  items: T[],
  payloadPositions: Map<string, number>,
  originalPositions: Map<string, number>
): T[] {
  return [...items].sort((left, right) => {
    const leftPosition = payloadPositions.has(left.id)
      ? payloadPositions.get(left.id)!
      : originalPositions.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = payloadPositions.has(right.id)
      ? payloadPositions.get(right.id)!
      : originalPositions.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }

    const leftOriginal = originalPositions.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOriginal = originalPositions.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOriginal - rightOriginal;
  });
}

function findEnvironment(environments: MockEnvironment[], environmentId: string) {
  return environments.find((environment) => environment.id === environmentId);
}

function findRoute(environment: MockEnvironment | undefined, routeId: string) {
  return environment?.routes.find((route) => route.id === routeId);
}

export function buildEnvironmentSavePayload(
  currentEnvironments: MockEnvironment[],
  savedEnvironments: MockEnvironment[]
): EnvironmentSavePayload {
  const currentEnvironmentById = new Map(currentEnvironments.map((environment) => [environment.id, environment]));
  const savedEnvironmentById = new Map(savedEnvironments.map((environment) => [environment.id, environment]));
  const savedEnvironmentPositions = buildPositionMap(savedEnvironments);

  const environmentUpserts: EnvironmentUpsert[] = [];
  const routeUpserts: RouteUpsert[] = [];
  const responseUpserts: ResponseUpsert[] = [];
  const environmentDeletes: EnvironmentDelete[] = [];
  const routeDeletes: RouteDelete[] = [];
  const responseDeletes: ResponseDelete[] = [];

  for (const savedEnvironment of savedEnvironments) {
    if (!currentEnvironmentById.has(savedEnvironment.id)) {
      environmentDeletes.push(buildEnvironmentDelete(savedEnvironment));
    }
  }

  for (const [environmentPosition, environment] of currentEnvironments.entries()) {
    const savedEnvironment = savedEnvironmentById.get(environment.id);
    const currentComparableEnvironment = comparableEnvironmentDoc(environment, environmentPosition);
    const savedComparableEnvironment = savedEnvironment
      ? comparableEnvironmentDoc(savedEnvironment, savedEnvironmentPositions.get(savedEnvironment.id) ?? environmentPosition)
      : null;

    if (!savedComparableEnvironment || stableStringify(savedComparableEnvironment) !== stableStringify(currentComparableEnvironment)) {
      environmentUpserts.push({
        environment,
        position: environmentPosition
      });
    }

    const savedRouteById = new Map((savedEnvironment?.routes || []).map((route) => [route.id, route]));
    const savedRoutePositions = buildPositionMap(savedEnvironment?.routes || []);
    const currentRoutePositions = buildPositionMap(environment.routes);

    for (const savedRoute of savedEnvironment?.routes || []) {
      if (!currentRoutePositions.has(savedRoute.id)) {
        routeDeletes.push(buildRouteDelete(environment.id, savedRoute));
      }
    }

    for (const [routePosition, route] of environment.routes.entries()) {
      const savedRoute = savedRouteById.get(route.id);
      const currentComparableRoute = comparableRouteDoc(route, routePosition);
      const savedComparableRoute = savedRoute
        ? comparableRouteDoc(savedRoute, savedRoutePositions.get(savedRoute.id) ?? routePosition)
        : null;

      if (!savedComparableRoute || stableStringify(savedComparableRoute) !== stableStringify(currentComparableRoute)) {
        routeUpserts.push({
          environmentId: environment.id,
          route,
          position: routePosition
        });
      }

      const savedResponseById = new Map((savedRoute?.responses || []).map((response) => [response.id, response]));
      const savedResponsePositions = buildPositionMap(savedRoute?.responses || []);
      const currentResponsePositions = buildPositionMap(route.responses);

      for (const savedResponse of savedRoute?.responses || []) {
        if (!currentResponsePositions.has(savedResponse.id)) {
          responseDeletes.push({
            environmentId: environment.id,
            routeId: route.id,
            responseId: savedResponse.id
          });
        }
      }

      for (const [responsePosition, response] of route.responses.entries()) {
        const savedResponse = savedResponseById.get(response.id);
        const currentComparableResponse = comparableResponseDoc(response, responsePosition);
        const savedComparableResponse = savedResponse
          ? comparableResponseDoc(savedResponse, savedResponsePositions.get(savedResponse.id) ?? responsePosition)
          : null;

        if (!savedComparableResponse || stableStringify(savedComparableResponse) !== stableStringify(currentComparableResponse)) {
          responseUpserts.push({
            environmentId: environment.id,
            routeId: route.id,
            response,
            position: responsePosition
          });
        }
      }
    }
  }

  return {
    environmentUpserts,
    routeUpserts,
    responseUpserts,
    environmentDeletes,
    routeDeletes,
    responseDeletes
  };
}

function removeEnvironmentById(environments: MockEnvironment[], environmentId: string) {
  return environments.filter((environment) => environment.id !== environmentId);
}

function removeRouteById(environment: MockEnvironment, routeId: string) {
  return {
    ...environment,
    routes: environment.routes.filter((route) => route.id !== routeId)
  };
}

function removeResponseById(route: MockRoute, responseId: string) {
  return {
    ...route,
    responses: route.responses.filter((response) => response.id !== responseId)
  };
}

function upsertEnvironment(environments: MockEnvironment[], environment: MockEnvironment): MockEnvironment[] {
  const existingIndex = environments.findIndex((item) => item.id === environment.id);

  if (existingIndex === -1) {
    return [...environments, environment];
  }

  const next = [...environments];
  next[existingIndex] = environment;
  return next;
}

function upsertRoute(environment: MockEnvironment, route: MockRoute): MockEnvironment {
  const existingIndex = environment.routes.findIndex((item) => item.id === route.id);

  if (existingIndex === -1) {
    return {
      ...environment,
      routes: [...environment.routes, route]
    };
  }

  const routes = [...environment.routes];
  routes[existingIndex] = route;

  return {
    ...environment,
    routes
  };
}

function upsertResponse(route: MockRoute, response: RouteResponse): MockRoute {
  const existingIndex = route.responses.findIndex((item) => item.id === response.id);

  if (existingIndex === -1) {
    return {
      ...route,
      responses: [...route.responses, response]
    };
  }

  const responses = [...route.responses];
  responses[existingIndex] = response;

  return {
    ...route,
    responses
  };
}

export function applyEnvironmentSavePayloadToSnapshot(
  currentEnvironments: MockEnvironment[],
  payload: EnvironmentSavePayload
): MockEnvironment[] {
  const originalEnvironmentPositions = buildPositionMap(currentEnvironments);
  const originalRoutePositions = new Map<string, Map<string, number>>();
  const originalResponsePositions = new Map<string, Map<string, Map<string, number>>>();

  for (const environment of currentEnvironments) {
    originalRoutePositions.set(environment.id, buildPositionMap(environment.routes));
    const responsePositionsByRoute = new Map<string, Map<string, number>>();

    for (const route of environment.routes) {
      responsePositionsByRoute.set(route.id, buildPositionMap(route.responses));
    }

    originalResponsePositions.set(environment.id, responsePositionsByRoute);
  }

  let nextEnvironments = currentEnvironments.map((environment) => ({
    ...environment,
    headers: environment.headers.map((header) => ({ ...header })),
    routes: environment.routes.map((route) => ({
      ...route,
      responses: route.responses.map((response) => ({
        ...response,
        headers: response.headers.map((header) => ({ ...header })),
        rules: response.rules.map((rule) => ({ ...rule }))
      }))
    }))
  }));

  for (const deletion of payload.environmentDeletes) {
    nextEnvironments = removeEnvironmentById(nextEnvironments, deletion.environmentId);
  }

  for (const deletion of payload.routeDeletes) {
    const environment = findEnvironment(nextEnvironments, deletion.environmentId);
    if (!environment) continue;
    const existingRoute = findRoute(environment, deletion.routeId);
    if (!existingRoute) continue;

    const nextRoute = removeRouteById(environment, deletion.routeId);
    nextEnvironments = upsertEnvironment(nextEnvironments, nextRoute);
  }

  for (const deletion of payload.responseDeletes) {
    const environment = findEnvironment(nextEnvironments, deletion.environmentId);
    const route = findRoute(environment, deletion.routeId);
    if (!environment || !route) continue;

    const nextRoute = removeResponseById(route, deletion.responseId);
    const nextEnvironment = upsertRoute(environment, nextRoute);
    nextEnvironments = upsertEnvironment(nextEnvironments, nextEnvironment);
  }

  for (const upsert of payload.environmentUpserts) {
    nextEnvironments = upsertEnvironment(nextEnvironments, upsert.environment);
  }

  for (const upsert of payload.routeUpserts) {
    const environment = findEnvironment(nextEnvironments, upsert.environmentId);
    if (!environment) continue;
    const nextEnvironment = upsertRoute(environment, upsert.route);
    nextEnvironments = upsertEnvironment(nextEnvironments, nextEnvironment);
  }

  for (const upsert of payload.responseUpserts) {
    const environment = findEnvironment(nextEnvironments, upsert.environmentId);
    const route = findRoute(environment, upsert.routeId);
    if (!environment || !route) continue;

    const nextRoute = upsertResponse(route, upsert.response);
    const nextEnvironment = upsertRoute(environment, nextRoute);
    nextEnvironments = upsertEnvironment(nextEnvironments, nextEnvironment);
  }

  const environmentPositions = new Map(payload.environmentUpserts.map((upsert) => [upsert.environment.id, upsert.position]));
  nextEnvironments = reorderByPosition(nextEnvironments, environmentPositions, originalEnvironmentPositions);

  nextEnvironments = nextEnvironments.map((environment) => {
    const routePositions = new Map<string, number>(
      payload.routeUpserts
        .filter((upsert) => upsert.environmentId === environment.id)
        .map((upsert) => [upsert.route.id, upsert.position])
    );
    const originalRoutes = originalRoutePositions.get(environment.id) || new Map<string, number>();
    const reorderedRoutes = reorderByPosition(environment.routes, routePositions, originalRoutes);

    return {
      ...environment,
      routes: reorderedRoutes.map((route) => {
        const responsePositions = new Map<string, number>(
          payload.responseUpserts
            .filter((upsert) => upsert.environmentId === environment.id && upsert.routeId === route.id)
            .map((upsert) => [upsert.response.id, upsert.position])
        );
        const originalResponses = originalResponsePositions.get(environment.id)?.get(route.id) || new Map<string, number>();
        const reorderedResponses = reorderByPosition(route.responses, responsePositions, originalResponses);

        return {
          ...route,
          responses: reorderedResponses
        };
      })
    };
  });

  return nextEnvironments;
}
