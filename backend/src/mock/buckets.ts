/**
 * Data bucket runtime helpers (DESIGN.md §2.10, §2.5).
 *
 * Pure module: parse + classify bucket content, apply `setData` mutations to
 * a bucket content string, decide/generate CRUD insert ids, and reset a
 * bucket to its templated initial content. No I/O, no globals mutated.
 */
import { randomUUID } from 'node:crypto';
import { faker as defaultFaker, type Faker } from '@faker-js/faker';
import { DataBucket } from '../lib/types';
import { getNestedValue, hasPath, setNestedValue } from './context';

export type BucketShape = 'array-objects' | 'array-primitives' | 'object' | 'primitive' | 'raw';

export interface BucketData {
  shape: BucketShape;
  value: unknown;
}

const OBJECT_ID_SHAPE = /^[0-9a-f]{24}$/i;

/** True for plain objects (not arrays, not null, not class instances). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Classify a parsed (non-raw) JSON value into a BucketShape. */
export function classifyShape(value: unknown): Exclude<BucketShape, 'raw'> {
  if (Array.isArray(value)) {
    const nonNull = value.filter((v) => v !== null);
    if (nonNull.length > 0 && nonNull.every(isPlainObject)) return 'array-objects';
    return 'array-primitives';
  }
  if (isPlainObject(value)) return 'object';
  return 'primitive';
}

/**
 * Classify + parse bucket content. Content that parses as JSON is kept as
 * data (shape per its JSON type); anything else — including the empty
 * string — is `raw` with the original string as value.
 */
export function parseBucketContent(content: string): BucketData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { shape: 'raw', value: content };
  }
  return { shape: classifyShape(parsed), value: parsed };
}

/**
 * Parse the raw string from a template helper into a JSON value when
 * possible (number / boolean / null / object / array / quoted string),
 * else keep the raw string. Mirrors how `setData 'path' value` receives
 * its value argument.
 */
export function coerceHelperValue(raw: string): unknown {
  if (raw === '') return '';
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Apply a `setData` mutation (DESIGN.md §2.10) to a bucket content string
 * and return the new string. JSON content is mutated as data and
 * re-stringified with 2-space indent; raw content only supports `set`
 * (the value replaces the whole bucket, path ignored).
 *
 * Operations:
 * - `set`        write value at path (path '' replaces the whole bucket)
 * - `push`       append value to the array at path
 * - `increment`  number at path + 1 (missing path → 1)
 * - `decrement`  number at path − 1 (missing path → −1)
 * - `invert`     boolean at path flipped
 *
 * Never throws: bad path/type yields `{ content: <unchanged>, ok: false, error }`.
 */
export function mutateBucketContent(
  content: string,
  path: string,
  operation: string,
  value: string
): { content: string; ok: boolean; error?: string } {
  const fail = (error: string): { content: string; ok: boolean; error: string } => ({
    content,
    ok: false,
    error,
  });

  const data = parseBucketContent(content);
  if (data.shape === 'raw') {
    if (operation === 'set') {
      return { content: value, ok: true };
    }
    return fail(`operation "${operation}" not supported on raw (non-JSON) bucket content`);
  }

  if (path === '') {
    // Empty path = the bucket root. `set` replaces the whole bucket;
    // `push` is allowed when the root itself is an array (appends to it).
    if (operation === 'push' && Array.isArray(data.value)) {
      data.value.push(coerceHelperValue(value));
      return { content: JSON.stringify(data.value, null, 2), ok: true };
    }
    if (operation !== 'set') {
      return fail(`empty path only supports "set" (or "push" on an array bucket), got "${operation}"`);
    }
    const next = coerceHelperValue(value);
    return { content: JSON.stringify(next, null, 2), ok: true };
  }

  // Path writes require an object or array root; a scalar (primitive) bucket
  // only supports whole-bucket `set` with an empty path (handled above).
  const writableRoot =
    typeof data.value === 'object' && data.value !== null ? (data.value as object) : null;

  if (operation === 'set') {
    if (writableRoot === null) return fail(`invalid path "${path}" on primitive bucket`);
    const ok = setNestedValue(
      writableRoot as unknown as Record<string, unknown>,
      path,
      coerceHelperValue(value)
    );
    if (!ok) return fail(`invalid path "${path}"`);
    return { content: JSON.stringify(writableRoot, null, 2), ok: true };
  }

  if (operation === 'push') {
    const target = getNestedValue(data.value, path);
    if (!Array.isArray(target)) {
      return fail(`path "${path}" does not reference an array`);
    }
    target.push(coerceHelperValue(value));
    return { content: JSON.stringify(data.value, null, 2), ok: true };
  }

  if (operation === 'increment' || operation === 'decrement') {
    if (writableRoot === null) return fail(`invalid path "${path}" on primitive bucket`);
    const delta = operation === 'increment' ? 1 : -1;
    const root = writableRoot as unknown as Record<string, unknown>;
    if (!hasPath(data.value, path)) {
      // Missing path → starts from 0 (DESIGN: missing → ±1).
      if (!setNestedValue(root, path, delta)) return fail(`invalid path "${path}"`);
      return { content: JSON.stringify(root, null, 2), ok: true };
    }
    const current = getNestedValue(data.value, path);
    if (typeof current !== 'number' || !Number.isFinite(current)) {
      return fail(`path "${path}" is not a finite number`);
    }
    if (!setNestedValue(root, path, current + delta)) return fail(`invalid path "${path}"`);
    return { content: JSON.stringify(root, null, 2), ok: true };
  }

  if (operation === 'invert') {
    if (writableRoot === null) return fail(`invalid path "${path}" on primitive bucket`);
    const current = getNestedValue(data.value, path);
    if (typeof current !== 'boolean') return fail(`path "${path}" is not a boolean`);
    const ok = setNestedValue(writableRoot as unknown as Record<string, unknown>, path, !current);
    if (!ok) return fail(`invalid path "${path}"`);
    return { content: JSON.stringify(writableRoot, null, 2), ok: true };
  }

  return fail(`unknown operation "${operation}"`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function arrayIds(data: BucketData): unknown[] {
  if (!Array.isArray(data.value)) return [];
  return data.value
    .filter((el): el is Record<string, unknown> => isPlainObject(el))
    .map((el) => el['id']);
}

/**
 * Decide the id strategy for CRUD inserts (DESIGN.md §2.5 "IDs"):
 * - all existing ids finite numbers → 'increment' (max+1)
 * - all existing ids match /^[0-9a-f]{24}$/i → 'objectId'
 * - else (incl. empty bucket / non-array) → 'uuid'
 */
export function detectIdStrategy(data: BucketData): 'increment' | 'objectId' | 'uuid' {
  const ids = arrayIds(data);
  if (ids.length > 0 && ids.every(isFiniteNumber)) return 'increment';
  if (ids.length > 0 && ids.every((v) => typeof v === 'string' && OBJECT_ID_SHAPE.test(v))) {
    return 'objectId';
  }
  return 'uuid';
}

/** Generate a new id per strategy (faker injected for deterministic tests). */
export function generateId(
  strategy: 'increment' | 'objectId' | 'uuid',
  existingIds: unknown[],
  faker?: Faker
): string | number {
  switch (strategy) {
    case 'increment': {
      let max = 0;
      let any = false;
      for (const id of existingIds) {
        if (isFiniteNumber(id)) {
          any = true;
          if (id > max) max = id;
        }
      }
      // No finite ids (e.g. empty bucket): first id is 1.
      return any ? max + 1 : 1;
    }
    case 'objectId':
      // faker 8.4.1 API: database.mongodbObjectId() (renamed from objectId in v9).
      return (faker ?? defaultFaker).database.mongodbObjectId();
    case 'uuid':
      return randomUUID();
  }
}

/** Reset a bucket to its templated initial content (restart semantics, §2.10). */
export function resetBucket(bucket: DataBucket): string {
  return bucket.content;
}
