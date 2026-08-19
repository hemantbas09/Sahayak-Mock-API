import assert from 'node:assert/strict';
import {
  hydrateEnvironmentDocument,
  hydrateResponseDocument,
  hydrateRouteDocument,
  serializeEnvironmentDocument,
  serializeResponseDocument,
  serializeRouteDocument
} from '../src/lib/firestorePersistence';
import { applyEnvironmentSavePayloadToSnapshot, buildEnvironmentSavePayload, stableStringify } from '../src/lib/environmentSync';
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

const savedEnvironments: MockEnvironment[] = [
  {
    id: 'env-1',
    name: 'Saved Env 1',
    endpointPrefix: '',
    port: 3000,
    latency: 0,
    headers: [],
    routes: [
      {
        id: 'route-1',
        method: 'get',
        endpoint: 'files',
        description: 'File route',
        latency: 0,
        selectedResponseId: 'resp-1',
        responses: [
          {
            id: 'resp-1',
            statusCode: 200,
            label: 'Default',
            headers: [],
            body: '{"ok":true}',
            rules: [],
            rulesOperator: 'AND'
          }
        ]
      }
    ]
  }
];

const updatedResponseOnly: MockEnvironment[] = [
  {
    ...savedEnvironments[0],
    routes: [
      {
        ...savedEnvironments[0].routes[0],
        responses: [
          {
            ...savedEnvironments[0].routes[0].responses[0],
            body: '{"ok":false}'
          }
        ]
      }
    ]
  }
];

const responsePayload = buildEnvironmentSavePayload(updatedResponseOnly, savedEnvironments);
assert.equal(responsePayload.environmentUpserts.length, 0);
assert.equal(responsePayload.routeUpserts.length, 0);
assert.equal(responsePayload.responseUpserts.length, 1);
assert.equal(responsePayload.responseUpserts[0].response.id, 'resp-1');
assert.deepEqual(responsePayload.environmentDeletes, []);
assert.deepEqual(responsePayload.routeDeletes, []);
assert.deepEqual(responsePayload.responseDeletes, []);
assert.equal(
  stableStringify(applyEnvironmentSavePayloadToSnapshot(savedEnvironments, responsePayload)),
  stableStringify(updatedResponseOnly)
);

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
assert.equal(additionPayload.environmentUpserts.length, 1);
assert.equal(additionPayload.environmentUpserts[0].environment.id, 'env-5');
assert.equal(
  stableStringify(applyEnvironmentSavePayloadToSnapshot(savedEnvironments, additionPayload)),
  stableStringify(currentWithAddition)
);

console.log('Firestore persistence regression check passed.');
