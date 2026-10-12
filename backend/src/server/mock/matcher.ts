/**
 * Route matching: pattern (e.g. "users/:id/files") vs requested path ("users/456/files").
 *
 * Rules:
 *  - segments are compared case-insensitively
 *  - ":name" captures a path param (decoded)
 *  - "*" as the last segment is a catch-all for all remaining segments
 *  - "*" in the middle matches exactly one segment
 */

export interface PathMatchResult {
  matches: boolean;
  params: Record<string, string>;
}

function cleanPath(path: string | undefined | null): string {
  return (path || '').split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '').trim();
}

export function matchPath(routeEndpoint: string, requestPath: string): PathMatchResult {
  const cleanRoute = cleanPath(routeEndpoint);
  const cleanRequest = cleanPath(requestPath);

  if (cleanRoute === '*') return { matches: true, params: {} };
  if (cleanRoute === '') return { matches: cleanRequest === '', params: {} };

  const routeSegments = cleanRoute.split('/');
  const requestSegments = cleanRequest.split('/');
  const params: Record<string, string> = {};

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i];

    if (routeSeg === '*') {
      if (i === routeSegments.length - 1) {
        // Trailing catch-all: requires at least one remaining request segment.
        return requestSegments.length > i
          ? { matches: true, params }
          : { matches: false, params: {} };
      }
      if (i >= requestSegments.length) return { matches: false, params: {} };
      continue;
    }

    if (i >= requestSegments.length) return { matches: false, params: {} };

    const reqSeg = requestSegments[i];

    if (routeSeg.startsWith(':')) {
      params[routeSeg.slice(1)] = decodeURIComponent(reqSeg);
    } else if (routeSeg.toLowerCase() !== reqSeg.toLowerCase()) {
      return { matches: false, params: {} };
    }
  }

  if (routeSegments.length !== requestSegments.length) {
    return { matches: false, params: {} };
  }

  return { matches: true, params };
}

/**
 * Find the first route (in order) whose method and endpoint match the request.
 */
export function findMatchingRoute<TRoute extends { method: string; endpoint: string }>(
  routes: TRoute[],
  method: string,
  mockPath: string
): { route: TRoute; params: Record<string, string> } | null {
  const normalized = method.toLowerCase();
  for (const route of routes) {
    if (String(route.method || 'get').toLowerCase() !== normalized) continue;
    const result = matchPath(route.endpoint, mockPath);
    if (result.matches) return { route, params: result.params };
  }
  return null;
}

/**
 * Find any route (any method) whose endpoint matches - used for 405 diagnostics.
 */
export function findAnyMethodRoute<TRoute extends { method: string; endpoint: string }>(
  routes: TRoute[],
  mockPath: string
): TRoute | null {
  for (const route of routes) {
    if (matchPath(route.endpoint, mockPath).matches) return route;
  }
  return null;
}
