/**
 * Mongoose schemas for mock configuration.
 *
 * Collections:
 *   environments  - one document per environment (meta + headers)
 *   routes        - one document per route, unique (envId, routeId)
 *   responses     - one document per response, unique (envId, routeId, responseId)
 *
 * Documents are written with `replaceOne(..., { upsert: true })` against those
 * unique keys, so a save touches exactly the entities that changed - editing
 * one response body writes exactly one document.
 */
import { Connection, Model, Schema } from 'mongoose';

export interface KeyValueDoc {
  id: string;
  key: string;
  value: string;
}

export interface RuleDoc {
  id: string;
  target: string;
  property: string;
  operator: string;
  value: string;
}

export interface EnvironmentDoc {
  _id?: unknown;
  envId: string;
  name: string;
  endpointPrefix: string;
  port: number;
  latency: number;
  headers: KeyValueDoc[];
  position: number;
  routeCount: number;
  schemaVersion: number;
  updatedAt: string;
}

export interface RouteDoc {
  _id?: unknown;
  envId: string;
  routeId: string;
  method: string;
  endpoint: string;
  description: string;
  latency: number;
  selectedResponseId: string;
  responseCount: number;
  position: number;
  schemaVersion: number;
  updatedAt: string;
}

export interface ResponseDoc {
  _id?: unknown;
  envId: string;
  routeId: string;
  responseId: string;
  statusCode: number;
  label: string;
  headers: KeyValueDoc[];
  body: string;
  rules: RuleDoc[];
  rulesOperator: 'AND' | 'OR';
  validationInterface?: string;
  validationEnabled?: boolean;
  position: number;
  schemaVersion: number;
  updatedAt: string;
}

const keyValueSchema = new Schema<KeyValueDoc>(
  { id: String, key: String, value: String },
  { _id: false, id: false }
);

const ruleSchema = new Schema<RuleDoc>(
  { id: String, target: String, property: String, operator: String, value: String },
  { _id: false, id: false }
);

const environmentSchema = new Schema<EnvironmentDoc>(
  {
    envId: { type: String, required: true },
    name: { type: String, default: '' },
    endpointPrefix: { type: String, default: '' },
    port: { type: Number, default: 3000 },
    latency: { type: Number, default: 0 },
    headers: { type: [keyValueSchema], default: [] },
    position: { type: Number, default: 0 },
    routeCount: { type: Number, default: 0 },
    schemaVersion: { type: Number, default: 1 },
    updatedAt: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
environmentSchema.index({ envId: 1 }, { unique: true });

const routeSchema = new Schema<RouteDoc>(
  {
    envId: { type: String, required: true },
    routeId: { type: String, required: true },
    method: { type: String, default: 'get' },
    endpoint: { type: String, default: '' },
    description: { type: String, default: '' },
    latency: { type: Number, default: 0 },
    selectedResponseId: { type: String, default: '' },
    responseCount: { type: Number, default: 0 },
    position: { type: Number, default: 0 },
    schemaVersion: { type: Number, default: 1 },
    updatedAt: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
routeSchema.index({ envId: 1, routeId: 1 }, { unique: true });

const responseSchema = new Schema<ResponseDoc>(
  {
    envId: { type: String, required: true },
    routeId: { type: String, required: true },
    responseId: { type: String, required: true },
    statusCode: { type: Number, default: 200 },
    label: { type: String, default: '' },
    headers: { type: [keyValueSchema], default: [] },
    body: { type: String, default: '' },
    rules: { type: [ruleSchema], default: [] },
    rulesOperator: { type: String, enum: ['AND', 'OR'], default: 'AND' },
    validationInterface: { type: String, default: undefined },
    validationEnabled: { type: Boolean, default: undefined },
    position: { type: Number, default: 0 },
    schemaVersion: { type: Number, default: 1 },
    updatedAt: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
responseSchema.index({ envId: 1, routeId: 1, responseId: 1 }, { unique: true });

export interface MongoModels {
  Environment: Model<EnvironmentDoc>;
  Route: Model<RouteDoc>;
  Response: Model<ResponseDoc>;
}

/**
 * Register (or reuse) the models on a connection. Safe to call twice on the
 * same connection - required because each connection keeps its own models.
 */
export function registerModels(conn: Connection): MongoModels {
  return {
    Environment: (conn.models['Environment'] as Model<EnvironmentDoc> | undefined) ?? conn.model('Environment', environmentSchema),
    Route: (conn.models['Route'] as Model<RouteDoc> | undefined) ?? conn.model('Route', routeSchema),
    Response: (conn.models['Response'] as Model<ResponseDoc> | undefined) ?? conn.model('Response', responseSchema),
  };
}
