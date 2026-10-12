export interface KeyValue {
  id: string;
  key: string;
  value: string;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options';

export type RuleTarget = 'header' | 'query' | 'body' | 'route_param';

export type RuleOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'contains' 
  | 'not_contains' 
  | 'regex' 
  | 'null' 
  | 'not_null'
  | 'is_string'
  | 'not_is_string'
  | 'is_number'
  | 'not_is_number'
  | 'is_boolean'
  | 'not_is_boolean'
  | 'is_array'
  | 'not_is_array'
  | 'is_object'
  | 'not_is_object'
  | 'has_property'
  | 'missing_property'
  | 'body_required'
  | 'body_empty'
  | 'is_optional_string'
  | 'is_optional_number'
  | 'is_optional_boolean';

export interface RouteRule {
  id: string;
  target: RuleTarget;
  property: string;
  operator: RuleOperator;
  value: string;
}

export interface RouteResponse {
  id: string;
  statusCode: number;
  label: string;
  headers: KeyValue[];
  body: string;
  rules: RouteRule[];
  rulesOperator: 'AND' | 'OR';
  validationInterface?: string;
  validationEnabled?: boolean;
}

export interface MockRoute {
  id: string;
  method: HttpMethod;
  endpoint: string;
  description: string;
  latency: number; // in ms
  responses: RouteResponse[];
  selectedResponseId: string;
}

export interface MockEnvironment {
  id: string;
  name: string;
  endpointPrefix: string;
  port: number;
  latency: number; // global fallback delay
  headers: KeyValue[];
  routes: MockRoute[];
}

export interface RequestLog {
  id: string;
  timestamp: string;
  envId: string;
  method: string;
  url: string;
  ip: string;
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  body: any;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  matchedRoute: string;
  latency: number;
  warning?: string;
}
