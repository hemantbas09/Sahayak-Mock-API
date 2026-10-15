/**
 * Mockoon-compatible domain types (DESIGN.md §5).
 *
 * These mirror Mockoon's environment document so import/export is a
 * pass-through: a Sahayak environment exports to a file Mockoon desktop can
 * open and vice versa. The only Sahayak-only fields are `version`,
 * `createdAt`, `updatedAt` (optimistic concurrency + audit) — stripped on
 * export, defaulted on import.
 */

export interface KeyValue {
  key: string;
  value: string;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export type RouteType = 'http' | 'crud';

/** Per-route response selection mode. null = rules mode (Mockoon's default). */
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

export interface RouteRule {
  uuid: string;
  target: RuleTarget;
  /** Property name/path; for data_bucket rules this is the bucket uuid. */
  property: string;
  /** Secondary path — used by data_bucket rules to dig into the bucket. */
  modifier: string;
  /** Operator name (see mock/rules.ts for the full set). */
  operator: string;
  /** Mockoon's "invert" toggle — negates the operator's result. */
  invert: boolean;
  /** Expected value. Templating allowed (rendered before evaluation). */
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
  /** Values are templated at render time. */
  headers: KeyValue[];
  /** Per-response latency in ms (Mockoon replaced env/route latency). */
  latency: number;
  bodyType: BodyType;
  body: string;
  filePath: string;
  databucketId: string;
  rules: RouteRule[];
  rulesOperator: RulesOperator;
  /** Exactly one default response per route is the Mockoon convention. */
  defaultResponse: boolean;
  payloadValidation?: PayloadValidation;
}

export interface Route {
  uuid: string;
  type: RouteType;
  /** HTTP method; ignored for CRUD routes. */
  method: HttpMethod;
  endpoint: string;
  documentation: string;
  responseMode: ResponseMode;
  responses: RouteResponse[];
  /** Route-level proxy (pure proxy route or proxy fallback for this route). */
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
  /** Ordered — declaration order matters for matching and response walk. */
  routes: Route[];
  data: DataBucket[];
  /** Sahayak-only: optimistic-concurrency version. Stripped on export. */
  version: number;
  /** Sahayak-only audit fields. Stripped on export. */
  createdAt?: string;
  updatedAt?: string;
}

export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt?: string;
}

export interface RequestLog {
  ts: number;
  envUuid: string;
  method: string;
  url: string;
  ip: string;
  reqHeaders: Record<string, string>;
  query: Record<string, string>;
  /** Raw body, truncated to 64 KB. */
  reqBody: string;
  resStatus: number;
  resHeaders: Record<string, string>;
  /** Truncated to 256 KB. */
  resBody: string;
  routeUuid: string;
  latencyMs: number;
}

/**
 * Mockoon single/collection file shape (DESIGN.md §2.13).
 * Real Mockoon files also carry `_mockoonKey` / `_mockoonVersion` on the
 * environment; unknown `_`-prefixed fields are stripped on import.
 */
export interface MockoonFile {
  application: 'mockoon';
  date?: string;
  data: Environment[];
  _mockoonKey?: string;
  _mockoonVersion?: string;
}
