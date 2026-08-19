import assert from 'node:assert/strict';
import {
  hydrateEnvironmentDocument,
  hydrateResponseDocument,
  hydrateRouteDocument,
  serializeEnvironmentDocument,
  serializeResponseDocument,
  serializeRouteDocument
} from '../src/lib/firestorePersistence';
import { buildEnvironmentSavePayload, mergeEnvironmentSavePayload, stableStringify } from '../src/lib/environmentSync';
import { MockEnvironment } from '../src/types';

const largeBody = 'x'.repeat(250_000);
const updatedAt = '2026-08-19T00:00:00.000Z';

const environment: MockEnvironment = {
  id: 'env-large',
  name: 'Large Payload Env',
  endpointPrefix: '/large',
  port: 3000,
  latency: 0,
  headers: [
    { id: 'h-1', key: 'Content-Type', value: 'application/json' }
  ],
  routes: [
    {
      id: 'route-large',
      method: 'get',
      endpoint: 'files/:id',
      description: 'Serves a large file payload',
      latency: 15,
      selectedResponseId: 'resp-large',
      responses: [
        {
          id: 'resp-large',
          statusCode: 200,
          label: 'Large file response',
          headers: [
            { id: 'rh-1', key: 'Content-Type', value: 'application/json' }
          ],
          body: largeBody,
          rules: [
            {
              id: 'rule-1',
              target: 'header',
              property: 'x-mode',
              operator: 'equals',
              value: 'download'
            }
          ],
          rulesOperator: 'AND',
          validationEnabled: true,
          validationInterface: 'interface LargeFile { id: string; }'
        }
      ]
    }
  ]
};

const envDoc = serializeEnvironmentDocument(environment, 0, updatedAt);
const routeDoc = serializeRouteDocument(environment.routes[0], 0, updatedAt);
const responseDoc = serializeResponseDocument(environment.routes[0].responses[0], 0, updatedAt);

assert.equal(Object.prototype.hasOwnProperty.call(envDoc, 'routes'), false);
assert.equal(Object.prototype.hasOwnProperty.call(routeDoc, 'responses'), false);
assert.equal(responseDoc.body, largeBody);
assert.equal(JSON.stringify(envDoc).includes(largeBody), false);
assert.equal(JSON.stringify(routeDoc).includes(largeBody), false);

const roundTrippedEnvironment: MockEnvironment = {
  ...hydrateEnvironmentDocument(envDoc),
  routes: [
    {
      ...hydrateRouteDocument(routeDoc),
      responses: [hydrateResponseDocument(responseDoc)]
    }
  ]
};

assert.deepEqual(roundTrippedEnvironment, environment);

const savedEnvironments: MockEnvironment[] = Array.from({ length: 4 }, (_, index) => ({
  id: `env-${index + 1}`,
  name: `Saved Env ${index + 1}`,
  endpointPrefix: '',
  port: 3000,
  latency: 0,
  headers: [],
  routes: []
}));

const currentWithAddition: MockEnvironment[] = [
  ...savedEnvironments,
  {
    id: 'env-5',
    name: 'Saved Env 5',
    endpointPrefix: '',
    port: 3000,
    latency: 0,
    headers: [],
    routes: []
  }
];

const additionPayload = buildEnvironmentSavePayload(currentWithAddition, savedEnvironments);
assert.equal(additionPayload.upserts.length, 1);
assert.equal(additionPayload.upserts[0].environment.id, 'env-5');
assert.deepEqual(additionPayload.deletedIds, []);
assert.equal(
  stableStringify(mergeEnvironmentSavePayload(savedEnvironments, additionPayload)),
  stableStringify(currentWithAddition)
);

const updatedExistingOnly = savedEnvironments.map((environment) => (
  environment.id === 'env-3'
    ? { ...environment, name: 'Saved Env 3 Updated' }
    : environment
));

const updatePayload = buildEnvironmentSavePayload(updatedExistingOnly, savedEnvironments);
assert.equal(updatePayload.upserts.length, 1);
assert.equal(updatePayload.upserts[0].environment.id, 'env-3');
assert.deepEqual(updatePayload.deletedIds, []);
assert.equal(
  stableStringify(mergeEnvironmentSavePayload(savedEnvironments, updatePayload)),
  stableStringify(updatedExistingOnly)
);

console.log('Firestore persistence regression check passed.');
