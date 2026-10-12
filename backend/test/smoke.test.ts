import { describe, expect, it } from 'vitest';
import { getNestedValue, hasPath, setNestedValue, parseCookies, parseQueryString, pathSegments, clampLatency } from '../src/mock/context';

describe('context helpers', () => {
  it('resolves dot paths', () => {
    const data = { a: { b: [{ c: 1 }, { c: 2 }] } };
    expect(getNestedValue(data, 'a.b.0.c')).toBe(1);
    expect(getNestedValue(data, 'a.b.1.c')).toBe(2);
    expect(getNestedValue(data, 'a.x')).toBeUndefined();
  });

  it('blocks prototype pollution paths', () => {
    const data: Record<string, unknown> = { a: { b: 1 } };
    expect(getNestedValue(data, 'a.__proto__.polluted')).toBeUndefined();
    expect(setNestedValue(data, 'a.__proto__.polluted', 1)).toBe(false);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('hasPath distinguishes missing vs null', () => {
    expect(hasPath({ a: null }, 'a')).toBe(true);
    expect(hasPath({ a: { b: 1 } }, 'a.c')).toBe(false);
  });

  it('setNestedValue creates intermediates', () => {
    const data: Record<string, unknown> = {};
    expect(setNestedValue(data, 'x.y.z', 5)).toBe(true);
    expect((data as any).x.y.z).toBe(5);
  });

  it('parses query strings and cookies', () => {
    expect(parseQueryString('a=1&b=x%20y&a=2')).toEqual({ a: '1', b: 'x y' });
    expect(parseCookies('sid=abc; theme=dark')).toEqual({ sid: 'abc', theme: 'dark' });
  });

  it('splits path segments and clamps latency', () => {
    expect(pathSegments('/users/42/')).toEqual(['users', '42']);
    expect(clampLatency(-5)).toBe(0);
    expect(clampLatency(999999)).toBe(60000);
    expect(clampLatency(120.4)).toBe(120);
  });
});
