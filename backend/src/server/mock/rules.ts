/**
 * Response rule evaluation. A response with rules is a "conditional" response:
 * it is served only when its rules (combined with AND or OR) evaluate true for
 * the incoming request. Responses without rules act as the fallback default.
 */
import { RouteRule } from '../../types';

export interface RequestContext {
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
  params: Record<string, string>;
}

/** Get a value by dot-notation path, e.g. "user.profile.name" or "items.0.id". */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (!isNaN(index)) {
        current = current[index];
        continue;
      }
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function lookupTarget(rule: RouteRule, ctx: RequestContext): unknown {
  switch (rule.target) {
    case 'header': {
      const headerKey = String(rule.property).toLowerCase();
      const foundKey = Object.keys(ctx.headers).find((k) => k.toLowerCase() === headerKey);
      return foundKey ? ctx.headers[foundKey] : undefined;
    }
    case 'query':
      return ctx.query[rule.property];
    case 'body':
      return getNestedValue(ctx.body, rule.property);
    case 'route_param':
      return ctx.params[rule.property];
    default:
      return undefined;
  }
}

function evaluateSingleRule(rule: RouteRule, ctx: RequestContext): boolean {
  const targetValue = lookupTarget(rule, ctx);
  const valueStr = String(targetValue ?? '');
  const ruleValueStr = String(rule.value ?? '');

  switch (rule.operator) {
    case 'equals':
      return valueStr === ruleValueStr;
    case 'not_equals':
      return valueStr !== ruleValueStr;
    case 'contains':
      return valueStr.toLowerCase().includes(ruleValueStr.toLowerCase());
    case 'not_contains':
      return !valueStr.toLowerCase().includes(ruleValueStr.toLowerCase());
    case 'regex':
      try {
        return new RegExp(ruleValueStr, 'i').test(valueStr);
      } catch {
        return false;
      }
    case 'null':
      return targetValue === undefined || targetValue === null || targetValue === '';
    case 'not_null':
      return targetValue !== undefined && targetValue !== null && targetValue !== '';
    case 'is_string':
      return targetValue !== undefined && targetValue !== null && typeof targetValue === 'string';
    case 'not_is_string':
      return targetValue === undefined || targetValue === null || typeof targetValue !== 'string';
    case 'is_optional_string':
      if (targetValue === undefined || targetValue === null || targetValue === '') return true;
      return typeof targetValue === 'string';
    case 'is_number': {
      if (targetValue === undefined || targetValue === null) return false;
      if (typeof targetValue === 'number') return !isNaN(targetValue);
      if (typeof targetValue === 'string') return targetValue.trim() !== '' && !isNaN(Number(targetValue));
      return false;
    }
    case 'not_is_number': {
      if (targetValue === undefined || targetValue === null) return true;
      if (typeof targetValue === 'number') return isNaN(targetValue);
      if (typeof targetValue === 'string') return targetValue.trim() === '' || isNaN(Number(targetValue));
      return true;
    }
    case 'is_optional_number': {
      if (targetValue === undefined || targetValue === null || targetValue === '') return true;
      if (typeof targetValue === 'number') return !isNaN(targetValue);
      if (typeof targetValue === 'string') return targetValue.trim() !== '' && !isNaN(Number(targetValue));
      return false;
    }
    case 'is_boolean':
      return typeof targetValue === 'boolean' || targetValue === 'true' || targetValue === 'false';
    case 'not_is_boolean':
      return typeof targetValue !== 'boolean' && targetValue !== 'true' && targetValue !== 'false';
    case 'is_optional_boolean':
      if (targetValue === undefined || targetValue === null || targetValue === '') return true;
      return typeof targetValue === 'boolean' || targetValue === 'true' || targetValue === 'false';
    case 'is_array':
      return Array.isArray(targetValue);
    case 'not_is_array':
      return !Array.isArray(targetValue);
    case 'is_object':
      return targetValue !== null && typeof targetValue === 'object' && !Array.isArray(targetValue);
    case 'not_is_object':
      return targetValue === null || typeof targetValue !== 'object' || Array.isArray(targetValue);
    case 'has_property':
      return targetValue !== undefined;
    case 'missing_property':
      return targetValue === undefined;
    case 'body_required': {
      const body = ctx.body;
      return body !== undefined && body !== null && (
        (typeof body === 'object' && Object.keys(body as object).length > 0) ||
        (typeof body === 'string' && body.trim() !== '') ||
        (typeof body === 'number') ||
        (typeof body === 'boolean')
      );
    }
    case 'body_empty': {
      const body = ctx.body;
      return body === undefined || body === null || (
        (typeof body === 'object' && Object.keys(body as object).length === 0) ||
        (typeof body === 'string' && body.trim() === '')
      );
    }
    default:
      return false;
  }
}

/**
 * Evaluate all rules of a response against a request context.
 * Empty rule lists never match (such responses only act as fallbacks).
 */
export function evaluateRules(
  rules: RouteRule[] | undefined,
  rulesOperator: 'AND' | 'OR',
  ctx: RequestContext
): boolean {
  if (!rules || rules.length === 0) return false;
  const results = rules.map((rule) => evaluateSingleRule(rule, ctx));
  return rulesOperator === 'OR' ? results.some((r) => r === true) : results.every((r) => r === true);
}
