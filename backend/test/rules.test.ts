import { describe, expect, it } from 'vitest';
import { RouteRule, RuleTarget } from '../src/lib/types';
import {
  evaluateRules,
  evaluateSingleRule,
  RULE_OPERATORS,
  RULE_TARGETS,
  type RuleContext,
} from '../src/mock/rules';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    req: {
      method: 'post',
      url: '/users/7?debug=1',
      path: '/users/7',
      headers: {
        'content-type': 'application/json',
        'x-custom': 'custom-value',
        authorization: 'Bearer token-123',
      },
      query: { debug: '1', page: '2' },
      body: { user: { name: 'alice', age: 30, tags: ['admin', 'beta'], meta: { role: 'admin' } }, note: 'hello world' },
      rawBody: '{"user":{"name":"alice"}}',
      ip: '127.0.0.1',
      hostname: 'localhost:3001',
      requestNumber: 42,
    },
    cookies: { sid: 'abc123', Theme: 'dark' },
    params: { id: '7' },
    runtime: {
      buckets: new Map<string, string>([
        ['b-json', '{"items":[10,20,30],"flag":"on","nested":{"deep":7}}'],
        ['b-raw', 'plain bucket content'],
        ['b-nulljson', 'null'],
      ]),
      globalVars: new Map<string, unknown>([
        ['count', 7],
        ['name', 'bob'],
        ['nothing', null],
        ['flag', true],
      ]),
      requestCounts: new Map<string, number>(),
      sequentialIndex: new Map<string, number>(),
    },
    requestNumber: 42,
    renderValue: (v) => v,
    ...overrides,
  };
}

let seq = 0;
function rule(over: Partial<RouteRule> = {}): RouteRule {
  seq += 1;
  return {
    uuid: `r-${seq}`,
    target: 'body',
    property: '',
    modifier: '',
    operator: 'equals',
    invert: false,
    value: '',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// evaluateRules: empty, AND/OR, invert, aliases
// ---------------------------------------------------------------------------

describe('evaluateRules', () => {
  it('empty rules -> false for AND and OR (rule-less responses are default-only, §2.3)', () => {
    const ctx = makeCtx();
    expect(evaluateRules([], 'AND', ctx)).toBe(false);
    expect(evaluateRules([], 'OR', ctx)).toBe(false);
  });

  it('AND: every rule must match; one failing rule fails the set', () => {
    const ctx = makeCtx();
    const matching = rule({ target: 'query', property: 'page', value: '2' });
    const failing = rule({ target: 'query', property: 'page', value: '3' });
    expect(evaluateRules([matching], 'AND', ctx)).toBe(true);
    expect(evaluateRules([matching, failing], 'AND', ctx)).toBe(false);
    expect(evaluateRules([failing, matching], 'AND', ctx)).toBe(false);
    expect(evaluateRules([failing], 'AND', ctx)).toBe(false);
  });

  it('OR: at least one rule must match', () => {
    const ctx = makeCtx();
    const matching = rule({ target: 'query', property: 'page', value: '2' });
    const failing = rule({ target: 'query', property: 'page', value: '3' });
    expect(evaluateRules([failing], 'OR', ctx)).toBe(false);
    expect(evaluateRules([failing, matching], 'OR', ctx)).toBe(true);
    expect(evaluateRules([matching], 'OR', ctx)).toBe(true);
    expect(evaluateRules([matching, failing], 'OR', ctx)).toBe(true);
  });

  it('AND/OR combination logic across distinct targets', () => {
    const ctx = makeCtx();
    const bodyRule = rule({ target: 'body', property: 'user.name', value: 'alice' });
    const queryRule = rule({ target: 'query', property: 'debug', value: '1' });
    expect(evaluateRules([bodyRule, queryRule], 'AND', ctx)).toBe(true);
    expect(evaluateRules([bodyRule, queryRule], 'OR', ctx)).toBe(true);
    const badBody = rule({ target: 'body', property: 'user.name', value: 'carol' });
    expect(evaluateRules([badBody, queryRule], 'AND', ctx)).toBe(false);
    expect(evaluateRules([badBody, queryRule], 'OR', ctx)).toBe(true);
  });

  it('invert negates a matching rule and a non-matching rule', () => {
    const ctx = makeCtx();
    const matching = rule({ target: 'query', property: 'page', value: '2' });
    const nonMatching = rule({ target: 'query', property: 'page', value: '99' });
    expect(evaluateSingleRule(matching, ctx)).toBe(true);
    expect(evaluateSingleRule({ ...matching, invert: true }, ctx)).toBe(false);
    expect(evaluateSingleRule(nonMatching, ctx)).toBe(false);
    expect(evaluateSingleRule({ ...nonMatching, invert: true }, ctx)).toBe(true);
    expect(evaluateRules([{ ...matching, invert: true }], 'AND', ctx)).toBe(false);
    expect(evaluateRules([{ ...nonMatching, invert: true }], 'OR', ctx)).toBe(true);
  });

  it('normalizes Mockoon-ish aliases equal/= -> equals, not_equal/!= -> not_equals', () => {
    const ctx = makeCtx();
    const target = rule({ target: 'query', property: 'page' });
    expect(evaluateSingleRule({ ...target, operator: 'equal', value: '2' }, ctx)).toBe(true);
    expect(evaluateSingleRule({ ...target, operator: '=', value: '2' }, ctx)).toBe(true);
    expect(evaluateSingleRule({ ...target, operator: 'equal', value: '3' }, ctx)).toBe(false);
    expect(evaluateSingleRule({ ...target, operator: 'not_equal', value: '3' }, ctx)).toBe(true);
    expect(evaluateSingleRule({ ...target, operator: '!=', value: '2' }, ctx)).toBe(false); // matches
    expect(evaluateSingleRule({ ...target, operator: '!=', value: '3' }, ctx)).toBe(true);
  });

  it('unknown operator never matches (and invert flips it to true)', () => {
    const ctx = makeCtx();
    const unknown = rule({ target: 'query', property: 'page', operator: 'does_not_exist', value: '2' });
    expect(evaluateSingleRule(unknown, ctx)).toBe(false);
    expect(evaluateSingleRule({ ...unknown, invert: true }, ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderValue: rule values are rendered BEFORE evaluation
// ---------------------------------------------------------------------------

describe('renderValue', () => {
  it('renders the raw value before evaluation', () => {
    const calls: string[] = [];
    const ctx = makeCtx({
      renderValue: (v: string) => {
        calls.push(v);
        return `{{v}}` === v ? '2' : v;
      },
    });
    const r = rule({ target: 'query', property: 'page', value: '{{v}}' });
    expect(evaluateSingleRule(r, ctx)).toBe(true); // raw '{{v}}' renders to '2' -> equals '2'
    expect(calls).toEqual(['{{v}}']); // the RAW value was passed, not the rendered one
  });

  it('passes plain (non-templated) values through untouched', () => {
    const calls: string[] = [];
    const ctx = makeCtx({
      renderValue: (v: string) => {
        calls.push(v);
        return v;
      },
    });
    expect(evaluateSingleRule(rule({ target: 'query', property: 'page', value: '2' }), ctx)).toBe(true);
    expect(calls).toEqual(['2']);
  });

  it('renders exactly once per rule inside evaluateRules', () => {
    const calls: string[] = [];
    const ctx = makeCtx({
      renderValue: (v: string) => {
        calls.push(v);
        return v;
      },
    });
    const r1 = rule({ target: 'query', property: 'page', value: '2' });
    const r2 = rule({ target: 'query', property: 'debug', value: '1' });
    expect(evaluateRules([r1, r2], 'AND', ctx)).toBe(true);
    expect(calls).toEqual(['2', '1']);
  });
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

describe('targets', () => {
  it('body: nested path resolution', () => {
    const ctx = makeCtx();
    expect(
      evaluateSingleRule(rule({ target: 'body', property: 'user.name', operator: 'equals', value: 'alice' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'body', property: 'user.meta.role', operator: 'equals', value: 'admin' }), ctx)
    ).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user.missing', operator: 'exists' }), ctx)).toBe(false);
    expect(
      evaluateSingleRule(rule({ target: 'body', property: 'user.missing', operator: 'not_exists' }), ctx)
    ).toBe(true);
  });

  it('body: property "" resolves the whole body (is_object, contains on JSON text)', () => {
    const ctx = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'is_object' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'is_array' }), ctx)).toBe(false);
    // substring operators run on String(actual) — '[object Object]' for a body object
    expect(
      evaluateSingleRule(rule({ target: 'body', property: '', operator: 'contains', value: 'object' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'body', property: '', operator: 'contains', value: 'name' }), ctx)
    ).toBe(false);
  });

  it('body: unparseable raw string body — whole string regardless of property', () => {
    const ctx = makeCtx({ req: { ...makeCtx().req, body: 'plain text not json', rawBody: 'plain text not json' } });
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'equals', value: 'plain text not json' }), ctx)).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'body', property: 'some.path', operator: 'equals', value: 'plain text not json' }), ctx)
    ).toBe(true); // property must be '' semantically; string body behaves on the raw string
    expect(evaluateSingleRule(rule({ target: 'body', property: 'x', operator: 'contains', value: 'plain' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'x', operator: 'starts_with', value: 'plain' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'x', operator: 'ends_with', value: 'json' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'x', operator: 'is_string' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'x', operator: 'is_object' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'x', operator: 'regex', value: '^plain' }), ctx)).toBe(true);
  });

  it('query: present and missing keys', () => {
    const ctx = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'query', property: 'page', operator: 'equals', value: '2' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'query', property: 'page', operator: 'equals', value: '3' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'query', property: 'absent', operator: 'not_exists' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'query', property: 'absent', operator: 'exists' }), ctx)).toBe(false);
  });

  it('params: value from matcher-captured params', () => {
    const ctx = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'params', property: 'id', operator: 'equals', value: '7' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'params', property: 'id', operator: 'gt', value: '6' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'params', property: 'id', operator: 'lt', value: '6' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'params', property: 'nope', operator: 'not_exists' }), ctx)).toBe(true);
  });

  it('headers: case-insensitive lookup', () => {
    const ctx = makeCtx();
    // stored lowercase in EngineRequest; rule property given in any case
    expect(evaluateSingleRule(rule({ target: 'headers', property: 'X-CUSTOM', operator: 'equals', value: 'custom-value' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'headers', property: 'x-custom', operator: 'equals', value: 'custom-value' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'headers', property: 'Authorization', operator: 'equals', value: 'Bearer token-123' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'headers', property: 'missing-header', operator: 'not_exists' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'headers', property: 'X-Custom', operator: 'contains', value: 'ustom' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'headers', property: 'X-Custom', operator: 'contains', value: 'zzz' }), ctx)).toBe(false);
  });

  it('cookie: case-insensitive lookup against cookies in exact case', () => {
    const ctx = makeCtx(); // cookies: { sid: 'abc123', Theme: 'dark' }
    expect(evaluateSingleRule(rule({ target: 'cookie', property: 'SID', operator: 'equals', value: 'abc123' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'cookie', property: 'theme', operator: 'equals', value: 'dark' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'cookie', property: 'THEME', operator: 'equals', value: 'dark' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'cookie', property: 'Theme', operator: 'equals', value: 'light' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'cookie', property: 'ghost', operator: 'not_exists' }), ctx)).toBe(true);
  });

  it('global_var: values from the runtime map (number, string, null, missing)', () => {
    const ctx = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'count', operator: 'equals', value: '7' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'count', operator: 'gt', value: '5' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'name', operator: 'equals', value: 'bob' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'name', operator: 'is_string' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'flag', operator: 'is_boolean' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'nothing', operator: 'is_null' }), ctx)).toBe(true); // present, null
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'nothing', operator: 'exists' }), ctx)).toBe(true); // null is present
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'never_set', operator: 'not_exists' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'global_var', property: 'never_set', operator: 'is_null' }), ctx)).toBe(true); // undefined too
  });

  it('request_number: String(ctx.requestNumber)', () => {
    const ctx = makeCtx({ requestNumber: 7 });
    expect(evaluateSingleRule(rule({ target: 'request_number', operator: 'equals', value: '7' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'request_number', operator: 'equals', value: '8' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'request_number', operator: 'gte', value: '5' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'request_number', operator: 'lt', value: '5' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'request_number', operator: 'is_string' }), ctx)).toBe(true);
    const ctx1 = makeCtx({ requestNumber: 1 });
    expect(evaluateSingleRule(rule({ target: 'request_number', operator: 'equals', value: '1' }), ctx1)).toBe(true);
  });

  it('data_bucket: modifier into JSON content', () => {
    const ctx = makeCtx();
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: 'items.1', operator: 'equals', value: '20' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: 'nested.deep', operator: 'equals', value: '7' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: 'flag', operator: 'equals', value: 'on' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: 'flag', operator: 'equals', value: 'off' }), ctx)
    ).toBe(false);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: 'items', operator: 'is_array' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: 'items', operator: 'array_contains', value: '30' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: 'items', operator: 'array_contains', value: '99' }), ctx)
    ).toBe(false);
    // empty modifier -> the raw string content is the value (even when the
    // content is valid JSON): is_string true, is_object false
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: '', operator: 'is_string' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', modifier: '', operator: 'is_object' }), ctx)
    ).toBe(false);
  });

  it('data_bucket: without modifier the raw string content is the value', () => {
    const ctx = makeCtx();
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', operator: 'contains', value: '"flag"' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', operator: 'contains', value: 'zzz-nope' }), ctx)
    ).toBe(false);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', operator: 'starts_with', value: '{"items"' }), ctx)
    ).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-json', operator: 'is_string' }), ctx)).toBe(true);
  });

  it('data_bucket: non-JSON content — raw string, modifier ignored', () => {
    const ctx = makeCtx();
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-raw', modifier: 'anything', operator: 'equals', value: 'plain bucket content' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-raw', modifier: '', operator: 'contains', value: 'bucket' }), ctx)
    ).toBe(true);
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-raw', modifier: 'x', operator: 'equals', value: 'wrong' }), ctx)
    ).toBe(false);
  });

  it('data_bucket: JSON literal "null" content — modifier resolves null, not missing', () => {
    const ctx = makeCtx();
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-nulljson', modifier: 'x', operator: 'is_null' }), ctx)
    ).toBe(true); // getNestedValue(null,'x') === null
    expect(
      evaluateSingleRule(rule({ target: 'data_bucket', property: 'b-nulljson', modifier: '', operator: 'is_string' }), ctx)
    ).toBe(true); // without modifier: raw string 'null'
  });

  it('data_bucket: missing bucket is undefined (not_exists true, exists false)', () => {
    const ctx = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'data_bucket', property: 'nope', operator: 'not_exists' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'data_bucket', property: 'nope', operator: 'exists' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'data_bucket', property: 'nope', operator: 'is_null' }), ctx)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Operators — every operator at least twice (match + non-match)
// ---------------------------------------------------------------------------

describe('operators', () => {
  // Each case: operator, actual value, rule value, expected.
  const operatorCases: { op: string; actual: unknown; value: string; expected: boolean }[] = [
    // equals — string match/non-match
    { op: 'equals', actual: 'alice', value: 'alice', expected: true },
    { op: 'equals', actual: 'alice', value: 'bob', expected: false },
    // equals — numeric when both sides numeric
    { op: 'equals', actual: 30, value: '30', expected: true },
    { op: 'equals', actual: 30, value: '31', expected: false },
    { op: 'equals', actual: '30', value: '30', expected: true },
    // equals — mixed (number vs non-numeric string) -> string compare
    { op: 'equals', actual: 5, value: 'abc', expected: false },
    // not_equals
    { op: 'not_equals', actual: 'alice', value: 'bob', expected: true },
    { op: 'not_equals', actual: 'alice', value: 'alice', expected: false },
    { op: 'not_equals', actual: 30, value: '31', expected: true },
    // gt / gte
    { op: 'gt', actual: 10, value: '9', expected: true },
    { op: 'gt', actual: 9, value: '10', expected: false },
    { op: 'gt', actual: 10, value: 'abc', expected: false }, // unparsable -> false
    { op: 'gte', actual: 10, value: '10', expected: true },
    { op: 'gte', actual: 10, value: '11', expected: false },
    { op: 'gte', actual: '5', value: '5', expected: true }, // string numeric vs numeric
    // lt / lte
    { op: 'lt', actual: 5, value: '6', expected: true },
    { op: 'lt', actual: 6, value: '5', expected: false },
    { op: 'lt', actual: 'x', value: '5', expected: false },
    { op: 'lte', actual: 5, value: '5', expected: true },
    { op: 'lte', actual: '6', value: '5', expected: false },
    // contains / not_contains
    { op: 'contains', actual: 'hello world', value: 'world', expected: true },
    { op: 'contains', actual: 'hello world', value: 'zzz', expected: false },
    { op: 'not_contains', actual: 'hello world', value: 'zzz', expected: true },
    { op: 'not_contains', actual: 'hello world', value: 'world', expected: false },
    // starts_with / ends_with
    { op: 'starts_with', actual: 'hello world', value: 'hello', expected: true },
    { op: 'starts_with', actual: 'hello world', value: 'world', expected: false },
    { op: 'ends_with', actual: 'hello world', value: 'world', expected: true },
    { op: 'ends_with', actual: 'hello world', value: 'hello', expected: false },
    // regex — valid match / valid non-match / invalid regex -> false
    { op: 'regex', actual: 'abc123', value: '^abc\\d+$', expected: true },
    { op: 'regex', actual: 'abc123', value: '^xyz', expected: false },
    { op: 'regex', actual: 'abc123', value: '([unclosed', expected: false }, // invalid regex
    { op: 'regex', actual: 42, value: '^4\\d$', expected: true }, // String(actual)
    // exists / not_exists — undefined vs present-but-null/empty
    { op: 'exists', actual: undefined, value: '', expected: false },
    { op: 'exists', actual: null, value: '', expected: true },
    { op: 'exists', actual: '', value: '', expected: true },
    { op: 'exists', actual: 0, value: '', expected: true },
    { op: 'not_exists', actual: undefined, value: '', expected: true },
    { op: 'not_exists', actual: null, value: '', expected: false },
    { op: 'not_exists', actual: '', value: '', expected: false },
    // is_null / is_not_null
    { op: 'is_null', actual: null, value: '', expected: true },
    { op: 'is_null', actual: undefined, value: '', expected: true },
    { op: 'is_null', actual: 0, value: '', expected: false },
    { op: 'is_not_null', actual: 0, value: '', expected: true },
    { op: 'is_not_null', actual: null, value: '', expected: false },
    { op: 'is_not_null', actual: undefined, value: '', expected: false },
    // type checks
    { op: 'is_string', actual: 'x', value: '', expected: true },
    { op: 'is_string', actual: 1, value: '', expected: false },
    { op: 'is_number', actual: 1.5, value: '', expected: true },
    { op: 'is_number', actual: Number.NaN, value: '', expected: false },
    { op: 'is_number', actual: '1.5', value: '', expected: false },
    { op: 'is_boolean', actual: true, value: '', expected: true },
    { op: 'is_boolean', actual: 'true', value: '', expected: false },
    { op: 'is_array', actual: [1, 2], value: '', expected: true },
    { op: 'is_array', actual: { a: 1 }, value: '', expected: false },
    { op: 'is_array', actual: null, value: '', expected: false },
    { op: 'is_object', actual: { a: 1 }, value: '', expected: true },
    { op: 'is_object', actual: [1, 2], value: '', expected: false },
    { op: 'is_object', actual: null, value: '', expected: false },
    // has_property / missing_property
    { op: 'has_property', actual: { a: 1, b: 2 }, value: 'a', expected: true },
    { op: 'has_property', actual: { a: 1, b: 2 }, value: 'c', expected: false },
    { op: 'has_property', actual: 'not-an-object', value: 'a', expected: false },
    { op: 'missing_property', actual: { a: 1, b: 2 }, value: 'c', expected: true },
    { op: 'missing_property', actual: { a: 1, b: 2 }, value: 'a', expected: false },
    { op: 'missing_property', actual: null, value: 'a', expected: false },
    // array_contains
    { op: 'array_contains', actual: ['a', 'b'], value: 'a', expected: true },
    { op: 'array_contains', actual: ['a', 'b'], value: 'z', expected: false },
    { op: 'array_contains', actual: [1, 2, 3], value: '2', expected: true }, // String- equals
    { op: 'array_contains', actual: [1, 2, 3], value: '9', expected: false },
    { op: 'array_contains', actual: 'a,b', value: 'a', expected: false }, // not an array
    // body_empty
    { op: 'body_empty', actual: '', value: '', expected: true },
    { op: 'body_empty', actual: 'x', value: '', expected: false },
    { op: 'body_empty', actual: undefined, value: '', expected: true },
  ];

  it.each(operatorCases)('operator $op: actual=$actual value=$value -> $expected', ({ op, actual, value, expected }) => {
    // Every case evaluates through the body target with property '':
    //  - string actuals arrive as an unparseable raw-string body (the whole
    //    string is the value — operators behave on the string);
    //  - non-string actuals resolve via getNestedValue(body, '') to the body.
    const ctx = makeCtx({ req: { ...makeCtx().req, body: actual, rawBody: typeof actual === 'string' ? actual : '' } });
    const r = rule({ target: 'body', property: '', operator: op, value });
    expect(evaluateSingleRule(r, ctx)).toBe(expected);
  });

  it('numeric vs string coercion details for eq/gt/lt', () => {
    const ctx = makeCtx({ req: { ...makeCtx().req, body: { n: 42 } } });
    // number actual vs numeric string value -> numeric compare
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'equals', value: '42' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'equals', value: '43' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'gt', value: '41' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'lt', value: '41' }), ctx)).toBe(false);
    // string numeric actual vs numeric string value
    const ctx2 = makeCtx({ req: { ...makeCtx().req, body: { s: '42' } } });
    expect(evaluateSingleRule(rule({ target: 'body', property: 's', operator: 'equals', value: '42' }), ctx2)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 's', operator: 'gt', value: '41' }), ctx2)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 's', operator: 'lt', value: '43' }), ctx2)).toBe(true);
    // mixed: number actual vs non-numeric string -> string compare (no crash)
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'equals', value: 'abc' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'equals', value: '42abc' }), ctx)).toBe(false);
    // '42 ' still parses as the number 42 -> numeric compare
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'equals', value: '42 ' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'gt', value: 'abc' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'n', operator: 'lt', value: 'abc' }), ctx)).toBe(false);
  });

  it('regex: invalid regex -> false, even inverted -> true', () => {
    const ctx = makeCtx();
    const bad = rule({ target: 'query', property: 'page', operator: 'regex', value: '(' });
    expect(evaluateSingleRule(bad, ctx)).toBe(false);
    expect(evaluateSingleRule({ ...bad, invert: true }, ctx)).toBe(true);
  });

  it('has_property / missing_property via object body target', () => {
    const ctx = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user', operator: 'has_property', value: 'name' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user', operator: 'has_property', value: 'ghost' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user', operator: 'missing_property', value: 'ghost' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user', operator: 'missing_property', value: 'name' }), ctx)).toBe(false);
    // non-object target -> both false
    expect(evaluateSingleRule(rule({ target: 'body', property: 'note', operator: 'has_property', value: 'a' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'note', operator: 'missing_property', value: 'a' }), ctx)).toBe(false);
  });

  it('array_contains via body array property', () => {
    const ctx = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user.tags', operator: 'array_contains', value: 'admin' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user.tags', operator: 'array_contains', value: 'nope' }), ctx)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user.tags', operator: 'is_array' }), ctx)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: 'user.tags', operator: 'is_object' }), ctx)).toBe(false);
  });

  it('body_empty: empty string body true, non-empty false, raw empty true', () => {
    const empty = makeCtx({ req: { ...makeCtx().req, body: '', rawBody: '' } });
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'body_empty' }), empty)).toBe(true);
    const withBody = makeCtx();
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'body_empty' }), withBody)).toBe(false);
    const rawEmpty = makeCtx({ req: { ...makeCtx().req, body: '', rawBody: '' } });
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'body_empty' }), rawEmpty)).toBe(true);
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'body_empty' }), rawEmpty)).toBe(true);
    // inverted
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'body_empty', invert: true }), empty)).toBe(false);
    expect(evaluateSingleRule(rule({ target: 'body', property: '', operator: 'body_empty', invert: true }), withBody)).toBe(true);
  });

  it('exists vs not_exists with undefined (query absent) and null (global var)', () => {
    const ctx = makeCtx();
    const qRule = rule({ target: 'query', property: 'ghost' });
    expect(evaluateSingleRule({ ...qRule, operator: 'exists' }, ctx)).toBe(false);
    expect(evaluateSingleRule({ ...qRule, operator: 'not_exists' }, ctx)).toBe(true);
    const gvNull = rule({ target: 'global_var', property: 'nothing' });
    expect(evaluateSingleRule({ ...gvNull, operator: 'exists' }, ctx)).toBe(true); // null is present
    expect(evaluateSingleRule({ ...gvNull, operator: 'not_exists' }, ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RULE_TARGETS / RULE_OPERATORS exports
// ---------------------------------------------------------------------------

describe('exports', () => {
  it('RULE_TARGETS lists all 8 targets in stable order', () => {
    expect(RULE_TARGETS).toEqual([
      'body',
      'query',
      'params',
      'headers',
      'cookie',
      'global_var',
      'request_number',
      'data_bucket',
    ]);
  });

  it('RULE_OPERATORS lists all 24 operator ids in stable order', () => {
    const ids = RULE_OPERATORS.map((o) => o.id);
    expect(ids).toEqual([
      'equals',
      'not_equals',
      'gt',
      'gte',
      'lt',
      'lte',
      'contains',
      'not_contains',
      'starts_with',
      'ends_with',
      'regex',
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
      'array_contains',
      'body_empty',
    ]);
    // every entry has a non-empty label
    for (const op of RULE_OPERATORS) {
      expect(op.label.length).toBeGreaterThan(0);
    }
  });

  it('every RULE_TARGETS entry is a valid RuleTarget', () => {
    const valid: RuleTarget[] = RULE_TARGETS;
    expect(valid.length).toBe(8);
  });
});
