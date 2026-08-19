import { MockEnvironment } from '../types';

export interface EnvironmentSaveUpsert {
  environment: MockEnvironment;
  position: number;
}

export interface EnvironmentSavePayload {
  upserts: EnvironmentSaveUpsert[];
  deletedIds: string[];
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

export function buildEnvironmentSavePayload(
  currentEnvironments: MockEnvironment[],
  savedEnvironments: MockEnvironment[]
): EnvironmentSavePayload {
  const savedById = new Map(savedEnvironments.map((environment) => [environment.id, environment]));
  const currentById = new Map(currentEnvironments.map((environment) => [environment.id, environment]));

  const upserts = currentEnvironments.flatMap((environment, position) => {
    const savedEnvironment = savedById.get(environment.id);

    if (!savedEnvironment || stableStringify(savedEnvironment) !== stableStringify(environment)) {
      return [{
        environment,
        position
      }];
    }

    return [];
  });

  const deletedIds = savedEnvironments
    .filter((environment) => !currentById.has(environment.id))
    .map((environment) => environment.id);

  return {
    upserts,
    deletedIds
  };
}

export function mergeEnvironmentSavePayload(
  currentEnvironments: MockEnvironment[],
  payload: EnvironmentSavePayload
): MockEnvironment[] {
  const deleted = new Set(payload.deletedIds);
  const upsertById = new Map(payload.upserts.map(({ environment }) => [environment.id, environment]));

  const retained = currentEnvironments.filter((environment) => !deleted.has(environment.id));
  const next = retained.map((environment) => upsertById.get(environment.id) ?? environment);

  const retainedIds = new Set(retained.map((environment) => environment.id));
  const inserted = payload.upserts
    .filter(({ environment }) => !retainedIds.has(environment.id))
    .sort((a, b) => a.position - b.position)
    .map(({ environment }) => environment);

  return [...next, ...inserted];
}
