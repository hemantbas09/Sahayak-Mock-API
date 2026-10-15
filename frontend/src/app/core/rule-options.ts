/**
 * Rule option lists — mirror the engine's RULE_TARGETS / RULE_OPERATORS
 * (backend/src/mock/rules.ts) so the editor can't produce what the engine
 * can't evaluate.
 */
import { RuleTarget } from './types';

export const RULE_TARGET_OPTIONS: { id: RuleTarget; label: string; hint: string }[] = [
  { id: 'body', label: 'Body', hint: 'Request body (parsed)' },
  { id: 'query', label: 'Query', hint: 'Query string param' },
  { id: 'params', label: 'Path param', hint: ':param from the path' },
  { id: 'headers', label: 'Header', hint: 'Request header name' },
  { id: 'cookie', label: 'Cookie', hint: 'Cookie name' },
  { id: 'global_var', label: 'Global var', hint: 'Name of a global variable' },
  { id: 'request_number', label: 'Request number', hint: '1-based per-route counter' },
];

export const RULE_OPERATOR_OPTIONS: { id: string; label: string }[] = [
  { id: 'equals', label: 'equals' },
  { id: 'not_equals', label: 'not equals' },
  { id: 'gt', label: 'greater than' },
  { id: 'gte', label: 'greater or equal' },
  { id: 'lt', label: 'less than' },
  { id: 'lte', label: 'less or equal' },
  { id: 'contains', label: 'contains' },
  { id: 'not_contains', label: 'does not contain' },
  { id: 'starts_with', label: 'starts with' },
  { id: 'ends_with', label: 'ends with' },
  { id: 'regex', label: 'matches regex' },
  { id: 'exists', label: 'exists' },
  { id: 'not_exists', label: 'does not exist' },
  { id: 'is_null', label: 'is null' },
  { id: 'is_not_null', label: 'is not null' },
  { id: 'is_string', label: 'is string' },
  { id: 'is_number', label: 'is number' },
  { id: 'is_boolean', label: 'is boolean' },
  { id: 'is_array', label: 'is array' },
  { id: 'is_object', label: 'is object' },
  { id: 'has_property', label: 'has property' },
  { id: 'missing_property', label: 'missing property' },
  { id: 'array_contains', label: 'array contains' },
  { id: 'body_empty', label: 'body is empty' },
];

/** Operators that don't need an expected value (exists / is_* / body_empty). */
export const VALUELESS_OPERATORS = new Set([
  'exists',
  'not_exists',
  'is_null',
  'is_not_null',
  'is_string',
  'is_number',
  'is_boolean',
  'is_array',
  'is_object',
  'has_property',
  'missing_property',
  'body_empty',
]);
