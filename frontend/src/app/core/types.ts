/**
 * Mockoon-compatible domain types (DESIGN.md §5, §6).
 *
 * These mirror the backend's `Environment` document 1:1 so a save is a
 * whole-document PUT with optimistic concurrency (`version`). The frontend
 * never invents its own shapes: what the store holds is what the server
 * persists.
 */

export interface KeyValue {
  key: string;
  value: string;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export type RouteType = 'http' | 'crud';

/** null = rules mode (Mockoon's default); otherwise a fixed selection mode. */
export type ResponseMode = null | 'RANDOM' | 'SEQUENTIAL';

export type BodyType = 'INLINE' | 'FILE' | 'DATABUCKET' | 'NONE';

export type RulesOperator = 'AND' | 'OR';

export type RuleTarget =
  | 'body'
  | 'query'
  | 'params'
  | 'headers'
  | 'cookie'
  | 'global_var'
  | 'request_number'
  | 'data_bucket';

/** One conditional response rule (round-trips `RouteRule[]` from the API). */
export interface RouteRule {
  uuid: string;
  target: RuleTarget;
  /** Property name/path; for `data_bucket` this is the bucket uuid. */
  property: string;
  /** Secondary path — used by data_bucket rules to dig into the bucket. */
  modifier: string;
  /** Operator id (see the full list in rule-editor). */
  operator: string;
  invert: boolean;
  /** Expected value; templating allowed (rendered by the engine before compare). */
  value: string;
}

export interface PayloadValidation {
  enabled: boolean;
  schema: string;
  errorStatus: number;
  errorBody: string;
}

export interface RouteResponse {
  uuid: string;
  label: string;
  statusCode: number;
  /** Header values are templated at render time. */
  headers: KeyValue[];
  /** Per-response latency in ms. */
  latency: number;
  bodyType: BodyType;
  /** INLINE template text. */
  body: string;
  /** FILE path (templated). */
  filePath: string;
  /** DATABUCKET id. */
  databucketId: string;
  rules: RouteRule[];
  rulesOperator: RulesOperator;
  /** Exactly one default response per route (Mockoon convention). */
  defaultResponse: boolean;
  payloadValidation?: PayloadValidation;
}

export interface Route {
  uuid: string;
  type: RouteType;
  /** HTTP method; ignored for CRUD routes. */
  method: HttpMethod;
  /** Path pattern, e.g. "/users/:id" or "/users". */
  endpoint: string;
  documentation: string;
  responseMode: ResponseMode;
  /** Declaration order matters: matching + rules walk follow this order. */
  responses: RouteResponse[];
  /** Route-level proxy (pure proxy or fallback for this route). */
  proxyHost: string;
  proxyRemovePrefix: boolean;
}

export interface DataBucket {
  uuid: string;
  name: string;
  /** Templated once at generation time (server start / first reference). */
  content: string;
}

export interface TlsOptions {
  enabled: boolean;
  certPath: string;
  keyPath: string;
  passphrase: string;
}

export interface Environment {
  uuid: string;
  name: string;
  /** Real listening port for this environment's mock listener. */
  port: number;
  /** Stripped before route matching (e.g. "/api/v1"). */
  endpointPrefix: string;
  /** Default response headers, merged under per-response headers. */
  headers: KeyValue[];
  proxyMode: boolean;
  proxyHost: string;
  proxyRemovePrefix: boolean;
  tlsOptions: TlsOptions;
  routes: Route[];
  /** Data buckets: CRUD sources + `{{data name "path"}}` payloads. */
  data: DataBucket[];
  /** Optimistic-concurrency version; the PUT body must echo it. */
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface AuthUser {
  email: string;
  role: UserRole;
}

/** Summary shape returned by GET /api/environments. */
export interface EnvironmentSummary {
  uuid: string;
  name: string;
  port: number;
  endpointPrefix: string;
  routeCount: number;
  version: number;
  listener: 'listening' | 'stopped' | 'error' | string;
}

export interface RequestLog {
  ts: number;
  envUuid: string;
  method: string;
  url: string;
  ip: string;
  reqHeaders: Record<string, string>;
  query: Record<string, string>;
  /** Raw body, truncated to 64 KB server-side. */
  reqBody: string;
  resStatus: number;
  resHeaders: Record<string, string>;
  /** Truncated to 256 KB server-side. */
  resBody: string;
  routeUuid: string;
  latencyMs: number;
}

export interface ServerStatus {
  ok: boolean;
  storage: string;
  environments: number;
  listeners: { uuid: string; state: string }[];
}

/** Optimistic-concurrency conflict (PUT response, HTTP 409). */
export interface ConflictInfo {
  message: string;
  serverVersion: number;
}
