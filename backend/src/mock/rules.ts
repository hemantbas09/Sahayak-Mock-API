/**
 * Rule evaluation (DESIGN.md §2.3, §5, §8 B3, §9).
 *
 * Pure functions over (rules, operator, RuleContext) -> boolean: no I/O, no
 * Date, no Math.random. Rule values are a templated surface (§2.11), so the
 * caller renders them via `renderValue` before this module evaluates — the
 * templating engine is dependency-injected and never called here.
 *
 * Mockoon-faithful semantics:
 *  - An empty rules array NEVER matches (a rule-less response is reachable
 *    only as the default response — §2.3 step 3).
 *  - AND: every rule matches; OR: at least one rule matches.
 *  - `invert` negates the single-rule result.
 *  - `exists` = the target resolves to something other than `undefined`
 *    (null counts as present); `not_exists` is the negation.
 */
import { RouteRule, RuleTarget, RulesOperator } from '../lib/types';
import { EngineRequest, EnvRuntime, getNestedValue } from './context';

/** Everything a rule evaluation needs. `renderValue` is dependency-injected
 *  (the templating engine renders rule values before evaluation). */
export interface RuleContext {
  req: EngineRequest;
  /** Parsed cookies — keys in the exact case sent; lookups are case-insensitive. */
  cookies: Record<string, string>;
  /** Path params captured by the matcher. */
  params: Record<string, string>;
  runtime: EnvRuntime;
  /** 1-based per-route request counter. */
  requestNumber: number;
  /** Renders a templated rule value (no-op passthrough if not templating). */
  renderValue: (value: string) => string;
}

/** All rule targets, stable order. */
export const RULE_TARGETS: RuleTarget[] = [
  'body',
  'query',
  'params',
  'headers',
  'cookie',
  'global_var',
  'request_number',
  'data_bucket',
];

/** The full operator list, stable order. `id` is the RouteRule.operator value. */
export const RULE_OPERATORS: { id: string; label: string }[] = [
  { id: 'equals', label: 'Equals' },
  { id: 'not_equals', label: 'Not equals' },
  { id: 'gt', label: 'Greater than' },
  { id: 'gte', label: 'Greater than or equals' },
  { id: 'lt', label: 'Less than' },
  { id: 'lte', label: 'Less than or equals' },
  { id: 'contains', label: 'Contains' },
  { id: 'not_contains', label: 'Not contains' },
  { id: 'starts_with', label: 'Starts with' },
  { id: 'ends_with', label: 'Ends with' },
  { id: 'regex', label: 'Matches regular expression' },
  { id: 'exists', label: 'Exists' },
  { id: 'not_exists', label: 'Not exists' },
  { id: 'is_null', label: 'Is null' },
  { id: 'is_not_null', label: 'Is not null' },
  { id: 'is_string', label: 'Is string' },
  { id: 'is_number', label: 'Is number' },
  { id: 'is_boolean', label: 'Is boolean' },
  { id: 'is_array', label: 'Is array' },
  { id: 'is_object', label: 'Is object' },
  { id: 'has_property', label: 'Has property' },
  { id: 'missing_property', label: 'Missing property' },
  { id: 'array_contains', label: 'Array contains' },
  { id: 'body_empty', label: 'Body is empty' },
];

/** Mockoon-ish aliases for the eq/ne operator ids (normalized before dispatch). */
const OPERATOR_ALIASES: Record<string, string> = {
  equal: 'equals',
  '=': 'equals',
  not_equal: 'not_equals',
  '!=': 'not_equals',
};

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** Finite number parsed from a string/number; undefined when not parsable.
 *  Empty/whitespace strings and booleans/objects are not numbers. */
function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (value.trim() === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** True for objects and arrays (not null, not primitives). */
function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/** JSON.parse with a null sentinel so the JSON literal `null` is not lost. */
function tryParseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

/** Case-insensitive cookie lookup (record keys stay in the case sent). */
function lookupCookie(cookies: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(cookies)) {
    if (key.toLowerCase() === wanted) return cookies[key];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the actual value an operator compares against. `undefined` means
 * "missing" (distinguished from present-but-empty by `exists`/`not_exists`).
 */
function resolveTarget(rule: RouteRule, ctx: RuleContext): unknown {
  switch (rule.target) {
    case 'body': {
      const body = ctx.req.body;
      // An unparseable body stays a raw string (Mockoon behavior): the whole
      // string is the value regardless of `property` — operators behave on
      // that string. For structured bodies, property '' resolves to the body.
      if (typeof body === 'string') return body;
      return getNestedValue(body, rule.property);
    }
    case 'query':
      return ctx.req.query[rule.property];
    case 'params':
      return ctx.params[rule.property];
    case 'headers':
      // EngineRequest headers already carry lowercased keys.
      return ctx.req.headers[rule.property.toLowerCase()];
    case 'cookie':
      return lookupCookie(ctx.cookies, rule.property);
    case 'global_var':
      return ctx.runtime.globalVars.get(rule.property);
    case 'request_number':
      return String(ctx.requestNumber);
    case 'data_bucket': {
      const raw = ctx.runtime.buckets.get(rule.property);
      if (raw === undefined) return undefined;
      if (rule.modifier !== '') {
        const parsed = tryParseJson(raw);
        if (parsed !== null) return getNestedValue(parsed.value, rule.modifier);
        // Content does not parse as JSON: compare the raw string, modifier ignored.
      }
      // No modifier: the bucket's raw string content is the value.
      return raw;
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

/** String compare unless BOTH sides parse as finite numbers -> numeric compare. */
function valuesEqual(actual: unknown, value: string): boolean {
  const a = toFiniteNumber(actual);
  const v = toFiniteNumber(value);
  if (a !== undefined && v !== undefined) return a === v;
  return String(actual) === value;
}

/** Numeric compare; if either side is unparsable -> false. */
function compareNumeric(
  actual: unknown,
  value: string,
  cmp: (a: number, b: number) => boolean
): boolean {
  const a = toFiniteNumber(actual);
  const v = toFiniteNumber(value);
  if (a === undefined || v === undefined) return false;
  return cmp(a, v);
}

function applyOperator(operator: string, actual: unknown, value: string): boolean {
  switch (operator) {
    case 'equals':
      return valuesEqual(actual, value);
    case 'not_equals':
      return !valuesEqual(actual, value);
    case 'gt':
      return compareNumeric(actual, value, (a, b) => a > b);
    case 'gte':
      return compareNumeric(actual, value, (a, b) => a >= b);
    case 'lt':
      return compareNumeric(actual, value, (a, b) => a < b);
    case 'lte':
      return compareNumeric(actual, value, (a, b) => a <= b);
    case 'contains':
      return String(actual).includes(value);
    case 'not_contains':
      return !String(actual).includes(value);
    case 'starts_with':
      return String(actual).startsWith(value);
    case 'ends_with':
      return String(actual).endsWith(value);
    case 'regex': {
      try {
        return new RegExp(value).test(String(actual));
      } catch {
        // An invalid regex never matches.
        return false;
      }
    }
    case 'exists':
      return actual !== undefined;
    case 'not_exists':
      return actual === undefined;
    case 'is_null':
      return actual === null || actual === undefined;
    case 'is_not_null':
      return actual !== null && actual !== undefined;
    case 'is_string':
      return typeof actual === 'string';
    case 'is_number':
      return typeof actual === 'number' && Number.isFinite(actual);
    case 'is_boolean':
      return typeof actual === 'boolean';
    case 'is_array':
      return Array.isArray(actual);
    case 'is_object':
      return isObject(actual) && !Array.isArray(actual);
    case 'has_property':
      // Object target; `value` holds the property name to check.
      return isObject(actual) && Object.hasOwn(actual, value);
    case 'missing_property':
      return isObject(actual) && !Object.hasOwn(actual, value);
    case 'array_contains':
      return Array.isArray(actual) && actual.some((el) => String(el) === value);
    case 'body_empty':
      return actual === '' || actual === undefined;
    default:
      // Unknown operators never match.
      return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Evaluate one rule: render value -> resolve target -> operator -> invert. */
export function evaluateSingleRule(rule: RouteRule, ctx: RuleContext): boolean {
  // §2.11: rule values are a templated surface — render BEFORE evaluation.
  const value = ctx.renderValue(rule.value);
  const actual = resolveTarget(rule, ctx);
  let result = applyOperator(OPERATOR_ALIASES[rule.operator] ?? rule.operator, actual, value);
  if (rule.invert) result = !result;
  return result;
}

/**
 * Evaluate a response's rule set. AND: every rule must match; OR: at least
 * one. An empty rules array never matches (§2.3 step 3).
 */
export function evaluateRules(
  rules: RouteRule[],
  operator: RulesOperator,
  ctx: RuleContext
): boolean {
  if (rules.length === 0) return false;
  if (operator === 'OR') return rules.some((r) => evaluateSingleRule(r, ctx));
  return rules.every((r) => evaluateSingleRule(r, ctx));
}
