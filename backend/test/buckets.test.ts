import { describe, expect, it } from 'vitest';
import { Faker, en, faker } from '@faker-js/faker';
import {
  classifyShape,
  detectIdStrategy,
  generateId,
  isPlainObject,
  mutateBucketContent,
  parseBucketContent,
  resetBucket,
} from '../src/mock/buckets';
import { DataBucket } from '../src/lib/types';

// ---------------------------------------------------------------------------
// parseBucketContent
// ---------------------------------------------------------------------------

describe('parseBucketContent', () => {
  it('classifies an array of objects', () => {
    const data = parseBucketContent('[{"id": 1, "name": "a"}, {"id": 2}]');
    expect(data.shape).toBe('array-objects');
    expect(data.value).toEqual([
      { id: 1, name: 'a' },
      { id: 2 },
    ]);
  });

  it('classifies arrays of primitives / numbers / booleans / nulls', () => {
    expect(parseBucketContent('["a", "b"]').shape).toBe('array-primitives');
    expect(parseBucketContent('[1, 2, 3]').shape).toBe('array-primitives');
    expect(parseBucketContent('[true, null, 4]').shape).toBe('array-primitives');
  });

  it('treats empty and null-only arrays as array-primitives', () => {
    expect(parseBucketContent('[]').shape).toBe('array-primitives');
    expect(parseBucketContent('[null, null]').shape).toBe('array-primitives');
  });

  it('classifies objects', () => {
    expect(parseBucketContent('{"a": 1, "b": {"c": [1]}}').shape).toBe('object');
    expect(parseBucketContent('{}').shape).toBe('object');
  });

  it('classifies primitives (number, string, boolean, null)', () => {
    expect(parseBucketContent('42').shape).toBe('primitive');
    expect(parseBucketContent('42.5').value).toBe(42.5);
    expect(parseBucketContent('"hello"').shape).toBe('primitive');
    expect(parseBucketContent('"hello"').value).toBe('hello');
    expect(parseBucketContent('true').value).toBe(true);
    expect(parseBucketContent('null').value).toBeNull();
  });

  it('JSON that is a number is primitive data, not raw', () => {
    const data = parseBucketContent('123');
    expect(data.shape).toBe('primitive');
    expect(data.value).toBe(123);
  });

  it('non-JSON content is raw with the original string', () => {
    expect(parseBucketContent('hello world')).toEqual({ shape: 'raw', value: 'hello world' });
    expect(parseBucketContent('<xml><a>1</a></xml>')).toEqual({
      shape: 'raw',
      value: '<xml><a>1</a></xml>',
    });
    expect(parseBucketContent('42abc')).toEqual({ shape: 'raw', value: '42abc' });
  });

  it('empty string is raw with an empty string value', () => {
    expect(parseBucketContent('')).toEqual({ shape: 'raw', value: '' });
  });

  it('classifyShape and isPlainObject basics', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(classifyShape([{ id: 1 }])).toBe('array-objects');
    expect(classifyShape([1])).toBe('array-primitives');
    expect(classifyShape({})).toBe('object');
    expect(classifyShape(3)).toBe('primitive');
  });
});

// ---------------------------------------------------------------------------
// mutateBucketContent — set
// ---------------------------------------------------------------------------

describe('mutateBucketContent: set', () => {
  it('sets a nested path, creating intermediates, and re-stringifies with 2-space indent', () => {
    const res = mutateBucketContent('{"a": {"b": 1}}', 'a.c.d', 'set', '2');
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content)).toEqual({ a: { b: 1, c: { d: 2 } } });
    expect(res.content).toBe(JSON.stringify({ a: { b: 1, c: { d: 2 } } }, null, 2));
  });

  it('set with empty path replaces the whole bucket (JSON)', () => {
    const res = mutateBucketContent('{"a": 1}', '', 'set', '[1, 2]');
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content)).toEqual([1, 2]);
  });

  it('sets into arrays via numeric path segments', () => {
    const res = mutateBucketContent('[{"id": 1}, {"id": 2}]', '1.id', 'set', '99');
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content)).toEqual([{ id: 1 }, { id: 99 }]);
  });

  it('set on raw content replaces the whole bucket and ignores the path', () => {
    expect(mutateBucketContent('old', 'whatever', 'set', 'new text')).toEqual({
      content: 'new text',
      ok: true,
    });
    expect(mutateBucketContent('old', '', 'set', 'new text')).toEqual({
      content: 'new text',
      ok: true,
    });
  });

  it('rejects forbidden prototype-pollution paths without mutating', () => {
    const res = mutateBucketContent('{"a": 1}', '__proto__.polluted', 'set', '1');
    expect(res.ok).toBe(false);
    expect(res.content).toBe('{"a": 1}');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('path writes fail on primitive buckets (only whole-bucket set allowed)', () => {
    const res = mutateBucketContent('42', 'x', 'set', '1');
    expect(res.ok).toBe(false);
    expect(res.content).toBe('42');
    // but whole-bucket set works
    expect(mutateBucketContent('42', '', 'set', '99').content).toBe('99');
  });

  it('coerces the value: numbers, booleans, objects, arrays, quoted strings, fallback raw', () => {
    const base = '{}';
    expect(JSON.parse(mutateBucketContent(base, 'n', 'set', '5').content)).toEqual({ n: 5 });
    expect(JSON.parse(mutateBucketContent(base, 'b', 'set', 'true').content)).toEqual({ b: true });
    expect(JSON.parse(mutateBucketContent(base, 'o', 'set', '{"x":1}').content)).toEqual({
      o: { x: 1 },
    });
    expect(JSON.parse(mutateBucketContent(base, 'a', 'set', '[1]').content)).toEqual({ a: [1] });
    expect(JSON.parse(mutateBucketContent(base, 's', 'set', '"hi"').content)).toEqual({ s: 'hi' });
    expect(JSON.parse(mutateBucketContent(base, 's', 'set', 'plain text').content)).toEqual({
      s: 'plain text',
    });
  });
});

// ---------------------------------------------------------------------------
// mutateBucketContent — push
// ---------------------------------------------------------------------------

describe('mutateBucketContent: push', () => {
  it('appends to a top-level array', () => {
    const res = mutateBucketContent('[1, 2]', '', 'push', '3');
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content)).toEqual([1, 2, 3]);
  });

  it('push with a path references the array at that path (empty path = root array)', () => {
    const res = mutateBucketContent('{"items": [1]}', 'items', 'push', '{"id": 9}');
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content)).toEqual({ items: [1, { id: 9 }] });
  });

  it('fails when the path does not reference an array', () => {
    const res = mutateBucketContent('{"a": 1}', 'a', 'push', '2');
    expect(res.ok).toBe(false);
    expect(res.content).toBe('{"a": 1}');
    expect(res.error).toContain('array');
  });

  it('fails on raw content', () => {
    const res = mutateBucketContent('raw', '', 'push', '1');
    expect(res.ok).toBe(false);
    expect(res.content).toBe('raw');
  });
});

// ---------------------------------------------------------------------------
// mutateBucketContent — increment / decrement
// ---------------------------------------------------------------------------

describe('mutateBucketContent: increment / decrement', () => {
  it('increments a present number', () => {
    const res = mutateBucketContent('{"count": 5}', 'count', 'increment', '');
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content)).toEqual({ count: 6 });
  });

  it('decrements a present number, including to negative', () => {
    const res = mutateBucketContent('{"count": 5}', 'count', 'decrement', '');
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.content)).toEqual({ count: 4 });
    const res2 = mutateBucketContent('{"count": 0}', 'count', 'decrement', '');
    expect(JSON.parse(res2.content)).toEqual({ count: -1 });
  });

  it('missing path → ±1 (starting from 0)', () => {
    const inc = mutateBucketContent('{"a": 1}', 'counter', 'increment', '');
    expect(inc.ok).toBe(true);
    expect(JSON.parse(inc.content)).toEqual({ a: 1, counter: 1 });
    const dec = mutateBucketContent('{"a": 1}', 'counter', 'decrement', '');
    expect(JSON.parse(dec.content)).toEqual({ a: 1, counter: -1 });
  });

  it('works on floats and nested paths', () => {
    const res = mutateBucketContent('{"v": 1.5}', 'v', 'increment', '');
    expect(JSON.parse(res.content)).toEqual({ v: 2.5 });
    const nested = mutateBucketContent('{"a": {"b": {"n": 10}}}', 'a.b.n', 'decrement', '');
    expect(JSON.parse(nested.content)).toEqual({ a: { b: { n: 9 } } });
  });

  it('fails when the path holds a non-number', () => {
    const res = mutateBucketContent('{"s": "5"}', 's', 'increment', '');
    expect(res.ok).toBe(false);
    expect(res.content).toBe('{"s": "5"}');
  });

  it('fails on raw content', () => {
    expect(mutateBucketContent('raw', 'x', 'increment', '').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mutateBucketContent — invert
// ---------------------------------------------------------------------------

describe('mutateBucketContent: invert', () => {
  it('flips true → false and false → true', () => {
    expect(JSON.parse(mutateBucketContent('{"flag": true}', 'flag', 'invert', '').content)).toEqual({
      flag: false,
    });
    expect(JSON.parse(mutateBucketContent('{"flag": false}', 'flag', 'invert', '').content)).toEqual({
      flag: true,
    });
  });

  it('fails on a non-boolean value', () => {
    const res = mutateBucketContent('{"n": 1}', 'n', 'invert', '');
    expect(res.ok).toBe(false);
    expect(res.content).toBe('{"n": 1}');
  });

  it('fails on raw content and unknown operations', () => {
    expect(mutateBucketContent('raw', 'flag', 'invert', '').ok).toBe(false);
    expect(mutateBucketContent('{"a": 1}', 'a', 'explode', '1').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectIdStrategy
// ---------------------------------------------------------------------------

describe('detectIdStrategy', () => {
  it('numeric ids (all finite) → increment', () => {
    expect(detectIdStrategy(parseBucketContent('[{"id": 1}, {"id": 2}]'))).toBe('increment');
    expect(
      detectIdStrategy(parseBucketContent('[{"id": 1}, {"id": 2.5}, {"id": 10}]'))
    ).toBe('increment');
  });

  it('24-hex ids, mixed case → objectId', () => {
    const ids = JSON.stringify([
      { id: '64b2f0a1c3d4e5f60718293a' },
      { id: '64B2F0A1C3D4E5F60718293A' },
      { id: '64b2f0a1c3d4e5f60718293b' },
    ]);
    expect(detectIdStrategy(parseBucketContent(ids))).toBe('objectId');
  });

  it('mixed numeric + string → uuid', () => {
    expect(
      detectIdStrategy(parseBucketContent('[{"id": 1}, {"id": "abc"}]'))
    ).toBe('uuid');
  });

  it('mixed numeric + ObjectId-shaped → uuid', () => {
    expect(
      detectIdStrategy(
        parseBucketContent('[{"id": 1}, {"id": "64b2f0a1c3d4e5f60718293a"}]')
      )
    ).toBe('uuid');
  });

  it('non-ObjectId-shaped strings → uuid', () => {
    expect(
      detectIdStrategy(parseBucketContent('[{"id": "64b2f0a1c3d4e5f60718293"}, {"id": "abc"}]'))
    ).toBe('uuid');
  });

  it('empty array → uuid; non-array buckets → uuid', () => {
    expect(detectIdStrategy(parseBucketContent('[]'))).toBe('uuid');
    expect(detectIdStrategy(parseBucketContent('{"id": 1}'))).toBe('uuid');
    expect(detectIdStrategy(parseBucketContent('42'))).toBe('uuid');
    expect(detectIdStrategy(parseBucketContent('raw text'))).toBe('uuid');
  });

  it('objects without an id property → uuid', () => {
    expect(detectIdStrategy(parseBucketContent('[{"name": "a"}, {"name": "b"}]'))).toBe('uuid');
  });
});

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe('generateId', () => {
  it('increment: max+1 over finite ids', () => {
    expect(generateId('increment', [1, 3, 7])).toBe(8);
    expect(generateId('increment', [2.5, 1])).toBe(3.5);
  });

  it('increment with no finite ids → 1', () => {
    expect(generateId('increment', [])).toBe(1);
    expect(generateId('increment', ['abc'])).toBe(1);
  });

  it('objectId: 24-hex, deterministic with an injected seeded faker', () => {
    const injected = new Faker({ locale: en });
    injected.seed(42);
    const id1 = generateId('objectId', [], injected);
    const id2 = generateId('objectId', [], injected);
    expect(typeof id1).toBe('string');
    expect(id1).toMatch(/^[0-9a-f]{24}$/);
    expect(id2).toMatch(/^[0-9a-f]{24}$/);
    expect(id1).not.toBe(id2);
    // two instances seeded identically produce the same id
    const a = new Faker({ locale: en });
    a.seed(7);
    const b = new Faker({ locale: en });
    b.seed(7);
    expect(generateId('objectId', [], a)).toBe(generateId('objectId', [], b));
  });

  it('objectId without injected faker uses the default faker', () => {
    const id = generateId('objectId', []);
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    void faker; // default export still resolves (module-level import check)
  });

  it('uuid: v4 format', () => {
    for (let i = 0; i < 5; i++) {
      const id = generateId('uuid', []);
      expect(typeof id).toBe('string');
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    }
  });
});

// ---------------------------------------------------------------------------
// resetBucket
// ---------------------------------------------------------------------------

describe('resetBucket', () => {
  it('returns the bucket\u2019s original templated content', () => {
    const bucket: DataBucket = {
      uuid: 'b1',
      name: 'users',
      content: '[{"id": 1, "name": "Ada"}]',
    };
    expect(resetBucket(bucket)).toBe('[{"id": 1, "name": "Ada"}]');
  });
});
