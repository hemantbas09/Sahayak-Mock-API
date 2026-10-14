/**
 * CRUD route operations matrix (DESIGN.md §2.5).
 *
 * Pure function over (route, bucket content, request) → result. The bucket is
 * linked as `route.responses[0].databucketId`; its runtime content string is
 * passed in and the (possibly mutated) next content comes back so the Store
 * can persist it. The only non-injected dependency is `generateId`'s faker
 * (default faker, injectable via `deps` for tests).
 *
 * Shape handling per the §2.5 table, for all five bucket shapes:
 * array-objects, array-primitives (`:id` = index), object, primitive, raw.
 */
import { Route } from '../lib/types';
import { EngineRequest } from './context';
import {
  detectIdStrategy,
  generateId,
  isPlainObject,
  parseBucketContent,
  type BucketData,
} from './buckets';

export interface CrudResult {
  statusCode: number;
  /** New bucket content after the mutation (reads leave it unchanged). */
  nextContent: string;
  /** Response body (string, JSON-stringified where applicable). */
  body: string;
}

const ITEM_NOT_FOUND_BODY = '{"error":"Item not found"}';
const BAD_BODY_BODY = '{"error":"Bad request: invalid payload"}';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** JSON.stringify with 2-space indent (matches bucket re-stringification). */
function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Parse a raw request body into a JSON value, or undefined when unparseable. */
function tryParseBody(raw: string): unknown {
  if (raw === '' || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** The request payload: the parsed body when available, else the raw string. */
function requestPayload(req: EngineRequest): { value: unknown; raw: string } {
  const { body, rawBody } = req;
  if (body !== undefined && body !== '' && typeof body !== 'string') {
    return { value: body, raw: rawBody };
  }
  return { value: rawBody, raw: rawBody };
}

function bodyIsPlainObject(body: unknown): body is Record<string, unknown> {
  return isPlainObject(body);
}

function bodyIsArray(body: unknown): body is unknown[] {
  return Array.isArray(body);
}

// ---------------------------------------------------------------------------
// Query operators (GET list, array-objects only) — DESIGN.md §2.5
// ---------------------------------------------------------------------------

const QUERY_OPERATORS = [
  '_eq',
  '_ne',
  '_gt',
  '_gte',
  '_lt',
  '_lte',
  '_like',
  '_in',
  '_contains',
  '_startswith',
  '_endswith',
] as const;

type QueryOperator = (typeof QUERY_OPERATORS)[number];

/** True when the key is a `field_op` style query operator key. */
function parseOperatorKey(key: string): { field: string; op: QueryOperator } | null {
  // Longest suffix first so e.g. `name_endswith` is not misparsed by a
  // shorter suffix. Operators are single-suffix; field names may contain
  // underscores themselves.
  const sorted = [...QUERY_OPERATORS].sort((a, b) => b.length - a.length);
  for (const op of sorted) {
    if (key.endsWith(op) && key.length > op.length) {
      return { field: key.slice(0, key.length - op.length), op };
    }
  }
  return null;
}

/** Escape a string for use in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a (possibly nested) field value on an object. Dot paths resolve
 * into plain objects; numeric segments also resolve into arrays.
 */
function fieldValue(item: unknown, field: string): unknown {
  const segments = field.split('.');
  let current: unknown = item;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Apply a single `_op` comparison between a (possibly array) field value and
 * the query value string. Array fields match when ANY element matches
 * (DESIGN.md §2.5). For numeric ops, non-numeric field values never match.
 */
function compareOp(fieldVal: unknown, op: QueryOperator, queryValue: string): boolean {
  const elements: unknown[] = Array.isArray(fieldVal) ? fieldVal : [fieldVal];

  switch (op) {
    case '_eq': {
      const n = Number(queryValue);
      const numeric = queryValue.trim() !== '' && !Number.isNaN(n);
      return elements.some((e) =>
        typeof e === 'number' && numeric ? e === n : String(e) === queryValue
      );
    }
    case '_ne':
      return !compareOp(fieldVal, '_eq', queryValue);
    case '_gt':
    case '_gte':
    case '_lt':
    case '_lte': {
      const n = Number(queryValue);
      if (Number.isNaN(n)) return false;
      return elements.some((e) => {
        if (typeof e !== 'number' || !Number.isFinite(e)) return false;
        if (op === '_gt') return e > n;
        if (op === '_gte') return e >= n;
        if (op === '_lt') return e < n;
        return e <= n;
      });
    }
    case '_like': {
      // SQL-ish: % → any run, _ → any single char.
      const pattern = queryValue
        .split('%')
        .map(escapeRegExp)
        .join('.*')
        .replace(/_/g, '.');
      const re = new RegExp(`^${pattern}$`, 'i');
      return elements.some((e) => typeof e === 'string' && re.test(e));
    }
    case '_in': {
      const list = queryValue.split(',').map((s) => s.trim());
      return elements.some((e) => {
        const n = Number(String(e));
        if (typeof e === 'number') {
          return list.some((s) => s !== '' && !Number.isNaN(Number(s)) && e === Number(s));
        }
        return list.includes(String(e));
      });
    }
    case '_contains':
      return elements.some((e) => typeof e === 'string' && e.includes(queryValue));
    case '_startswith':
      return elements.some((e) => typeof e === 'string' && e.startsWith(queryValue));
    case '_endswith':
      return elements.some((e) => typeof e === 'string' && e.endsWith(queryValue));
  }
}

interface Pagination {
  page: number;
  limit: number | null;
}

function parsePagination(query: Record<string, string>): Pagination {
  const rawPage = query['_page'];
  const page = rawPage !== undefined && rawPage !== '' ? Number(rawPage) : 1;
  const validPage =
    Number.isInteger(page) && page >= 1 ? page : 1;

  const rawLimit = query['_limit'];
  let limit: number | null = null;
  if (rawLimit !== undefined && rawLimit !== '') {
    const n = Number(rawLimit);
    if (Number.isInteger(n) && n > 0) limit = n;
  }
  return { page: validPage, limit };
}

function parseOrder(query: Record<string, string>): 'asc' | 'desc' {
  return query['_order'] === 'desc' ? 'desc' : 'asc';
}

/**
 * Sort items by `_sort` field (dot path). Non-numeric values compare as
 * strings; numeric vs numeric compare numerically. Missing → 0 → stable.
 */
function sortItems(items: unknown[], field: string, order: 'asc' | 'desc'): void {
  const dir = order === 'desc' ? -1 : 1;
  items.sort((a, b) => {
    const av = fieldValue(a, field);
    const bv = fieldValue(b, field);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    const as = String(av ?? '');
    const bs = String(bv ?? '');
    if (as === bs) return 0;
    return (as < bs ? -1 : 1) * dir;
  });
}

/**
 * Apply the full GET-list pipeline on an array-objects value:
 * filter (all `field_op` query params) → sort (`_sort`/`_order`) →
 * paginate (`_page`/`_limit`). Returns a new array (original untouched).
 */
function filterSortPaginate(data: BucketData, query: Record<string, string>): unknown[] {
  const items: unknown[] = Array.isArray(data.value)
    ? data.value.map((el) =>
        isPlainObject(el) ? { ...el } : el
      )
    : [];

  // 1. Filter.
  const filters: Array<{ field: string; op: QueryOperator; value: string }> = [];
  for (const [key, value] of Object.entries(query)) {
    const parsed = parseOperatorKey(key);
    if (parsed) filters.push({ field: parsed.field, op: parsed.op, value });
  }
  let result = items;
  for (const { field, op, value } of filters) {
    result = result.filter((item) =>
      compareOp(isPlainObject(item) ? fieldValue(item, field) : undefined, op, value)
    );
  }

  // 2. Sort.
  const sortField = query['_sort'];
  if (sortField !== undefined && sortField !== '') {
    sortItems(result, sortField, parseOrder(query));
  }

  // 3. Paginate. `_page` only takes effect together with a positive `_limit`
  // (no page size → nothing to window over).
  const { page, limit } = parsePagination(query);
  if (limit !== null) {
    const start = (page - 1) * limit;
    result = result.slice(start, start + limit);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Body coercion per shape
// ---------------------------------------------------------------------------

/** Coerce a request payload for `primitive` overwrite: number/bool/string/JSON. */
function coercePrimitivePayload(body: unknown, raw: string): unknown {
  if (typeof body === 'number' || typeof body === 'boolean') return body;
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return raw;
  return body; // objects/arrays fall through as JSON data
}

// ---------------------------------------------------------------------------
// The operation matrix
// ---------------------------------------------------------------------------

export function handleCrud(
  route: Route,
  content: string,
  kind: 'list' | 'item',
  id: string | undefined,
  req: EngineRequest,
  deps?: { faker?: import('@faker-js/faker').Faker }
): CrudResult {
  const method = req.method.toLowerCase();
  const data = parseBucketContent(content);
  // `route` is part of the contract (the bucket is linked as
  // responses[0].databucketId) but the content string is passed in directly,
  // so the operation matrix operates on the content alone.

  // ------------------------------------------------------------------ GET --
  if (method === 'get') {
    if (kind === 'list') {
      if (data.shape === 'array-objects') {
        const result = filterSortPaginate(data, req.query);
        return { statusCode: 200, nextContent: content, body: stringifyValue(result) };
      }
      // array-primitives / object / primitive / raw → content as-is
      return { statusCode: 200, nextContent: content, body: content };
    }
    // GET item
    if (data.shape === 'array-objects') {
      const arr = data.value as unknown[];
      const idx = findObjectIndex(arr, id);
      if (idx === -1) return notFound(content);
      return { statusCode: 200, nextContent: content, body: stringifyValue(arr[idx]) };
    }
    if (data.shape === 'array-primitives') {
      const arr = data.value as unknown[];
      const idx = Number(id);
      if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return notFound(content);
      return { statusCode: 200, nextContent: content, body: stringifyValue(arr[idx]) };
    }
    // object / primitive / raw → content as-is
    return { statusCode: 200, nextContent: content, body: content };
  }

  // --------------------------------------------------------------- POST --
  if (method === 'post') {
    const { value: body, raw } = requestPayload(req);
    switch (data.shape) {
      case 'array-objects': {
        if (!bodyIsPlainObject(body)) return badBody(content);
        const arr = data.value as Array<Record<string, unknown>>;
        const existingIds = arr
          .filter((el) => isPlainObject(el))
          .map((el) => el['id']);
        // DESIGN §2.5: autogenerated id IF ABSENT — an explicit `id` in the
        // body is kept as-is.
        const strategy = detectIdStrategy(data);
        const item =
          body['id'] === undefined
            ? { ...body, id: generateId(strategy, existingIds, deps?.faker) }
            : { ...body };
        const nextArr = [...arr, item];
        return {
          statusCode: 201,
          nextContent: stringifyValue(nextArr),
          body: stringifyValue(item),
        };
      }
      case 'array-primitives': {
        const arr = data.value as unknown[];
        // Empty bucket + object payload: an empty array cannot be
        // classified as objects vs primitives — treat it as array-objects and
        // insert with a generated id (uuid strategy: no existing ids).
        if (arr.length === 0 && bodyIsPlainObject(body)) {
          const item = { ...body, id: generateId('uuid', [], deps?.faker) };
          return {
            statusCode: 201,
            nextContent: stringifyValue([item]),
            body: stringifyValue(item),
          };
        }
        const item = coerceArrayItem(body, raw);
        const nextArr = [...arr, item];
        return {
          statusCode: 201,
          nextContent: stringifyValue(nextArr),
          body: stringifyValue(item),
        };
      }
      case 'object': {
        // Table: "overwrite content" — replace the bucket with the payload as-is
        // (a non-object payload becomes the new bucket content; the table only
        // mandates array/object payload shape for array buckets).
        return {
          statusCode: 200,
          nextContent: stringifyValue(body),
          body: stringifyValue(body),
        };
      }
      case 'primitive': {
        const value = coercePrimitivePayload(body, raw);
        return {
          statusCode: 200,
          nextContent: stringifyValue(value),
          body: stringifyValue(value),
        };
      }
      case 'raw': {
        return {
          statusCode: 200,
          nextContent: raw,
          body: raw,
        };
      }
    }
  }

  // ---------------------------------------------------------------- PUT --
  if (method === 'put') {
    if (kind === 'list') {
      const { value: body, raw } = requestPayload(req);
      switch (data.shape) {
        case 'array-objects':
        case 'array-primitives': {
          if (!bodyIsArray(body)) return badBody(content);
          return {
            statusCode: 200,
            nextContent: stringifyValue(body),
            body: stringifyValue(body),
          };
        }
        case 'object': {
          // Table: "overwrite content" — unconditional.
          return {
            statusCode: 200,
            nextContent: stringifyValue(body),
            body: stringifyValue(body),
          };
        }
        case 'primitive': {
          const value = coercePrimitivePayload(body, raw);
          return {
            statusCode: 200,
            nextContent: stringifyValue(value),
            body: stringifyValue(value),
          };
        }
        case 'raw': {
          return {
            statusCode: 200,
            nextContent: raw,
            body: raw,
          };
        }
      }
    }
    // PUT /:id
    if (data.shape === 'array-objects') {
      const { value: body } = requestPayload(req);
      if (!bodyIsPlainObject(body)) return badBody(content);
      const arr = data.value as Array<Record<string, unknown>>;
      const idx = findObjectIndex(arr, id);
      if (idx === -1) return notFound(content);
      const nextArr = [...arr];
      nextArr[idx] = { ...body };
      return {
        statusCode: 200,
        nextContent: stringifyValue(nextArr),
        body: stringifyValue(nextArr[idx]),
      };
    }
    if (data.shape === 'array-primitives') {
      const { value: body, raw } = requestPayload(req);
      const arr = data.value as unknown[];
      const idx = Number(id);
      if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return notFound(content);
      const item = coerceArrayItem(body, raw);
      const nextArr = [...arr];
      nextArr[idx] = item;
      return {
        statusCode: 200,
        nextContent: stringifyValue(nextArr),
        body: stringifyValue(item),
      };
    }
    // object / primitive / raw → overwrite (id ignored)
    return overwriteFromRequest(data, req, content);
  }

  // -------------------------------------------------------------- PATCH --
  if (method === 'patch') {
    if (kind === 'list') {
      const { value: body, raw } = requestPayload(req);
      switch (data.shape) {
        case 'array-objects':
        case 'array-primitives': {
          if (!bodyIsArray(body)) return badBody(content);
          const arr = data.value as unknown[];
          const nextArr = [...arr, ...body];
          return {
            statusCode: 200,
            nextContent: stringifyValue(nextArr),
            body: stringifyValue(nextArr),
          };
        }
        case 'object': {
          if (!bodyIsPlainObject(body)) return badBody(content);
          const target = isPlainObject(data.value) ? (data.value as Record<string, unknown>) : {};
          // Shallow merge (documented): top-level keys of body win.
          const next = { ...target, ...body };
          return {
            statusCode: 200,
            nextContent: stringifyValue(next),
            body: stringifyValue(next),
          };
        }
        case 'primitive': {
          const cur = typeof data.value === 'string' ? (data.value as string) : String(data.value ?? '');
          const nextStr = cur + raw;
          return {
            statusCode: 200,
            nextContent: nextStr,
            body: nextStr,
          };
        }
        case 'raw': {
          const nextStr = (data.value as string) + raw;
          return {
            statusCode: 200,
            nextContent: nextStr,
            body: nextStr,
          };
        }
      }
    }
    // PATCH /:id
    if (data.shape === 'array-objects') {
      const { value: body } = requestPayload(req);
      if (!bodyIsPlainObject(body)) return badBody(content);
      const arr = data.value as Array<Record<string, unknown>>;
      const idx = findObjectIndex(arr, id);
      if (idx === -1) return notFound(content);
      const nextArr = [...arr];
      // Shallow merge into matched object; its `id` is preserved.
      nextArr[idx] = { ...arr[idx], ...body, id: arr[idx]['id'] };
      return {
        statusCode: 200,
        nextContent: stringifyValue(nextArr),
        body: stringifyValue(nextArr[idx]),
      };
    }
    if (data.shape === 'array-primitives') {
      const { value: body, raw } = requestPayload(req);
      const arr = data.value as unknown[];
      const idx = Number(id);
      if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return notFound(content);
      const item = coerceArrayItem(body, raw);
      const nextArr = [...arr];
      nextArr[idx] = item;
      return {
        statusCode: 200,
        nextContent: stringifyValue(nextArr),
        body: stringifyValue(item),
      };
    }
    if (data.shape === 'object') {
      const { value: body } = requestPayload(req);
      if (!bodyIsPlainObject(body)) return badBody(content);
      const target = isPlainObject(data.value) ? (data.value as Record<string, unknown>) : {};
      const next = { ...target, ...body };
      return {
        statusCode: 200,
        nextContent: stringifyValue(next),
        body: stringifyValue(next),
      };
    }
    if (data.shape === 'raw') {
      const { raw } = requestPayload(req);
      const nextStr = (data.value as string) + raw;
      return {
        statusCode: 200,
        nextContent: nextStr,
        body: nextStr,
      };
    }
    // primitive → treat as overwrite with request payload
    return overwriteFromRequest(data, req, content);
  }

  // ------------------------------------------------------------ DELETE --
  if (method === 'delete') {
    if (kind === 'list') {
      switch (data.shape) {
        case 'array-objects':
        case 'array-primitives':
          return emptyResult('[]');
        case 'object':
          return emptyResult('{}');
        case 'primitive':
        case 'raw':
          return emptyResult('');
      }
    }
    // DELETE /:id
    if (data.shape === 'array-objects') {
      const arr = data.value as unknown[];
      const idx = findObjectIndex(arr, id);
      if (idx === -1) return notFound(content);
      const nextArr = arr.filter((_, i) => i !== idx);
      return { statusCode: 200, nextContent: stringifyValue(nextArr), body: stringifyValue(nextArr) };
    }
    if (data.shape === 'array-primitives') {
      const arr = data.value as unknown[];
      const idx = Number(id);
      if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return notFound(content);
      const nextArr = arr.filter((_, i) => i !== idx);
      return { statusCode: 200, nextContent: stringifyValue(nextArr), body: stringifyValue(nextArr) };
    }
    // object / primitive / raw → delete content (id ignored)
    return emptyResult('');
  }

  // Unknown method — should never happen (matcher guarantees CRUD verbs).
  return { statusCode: 405, nextContent: content, body: '{"error":"Method not allowed"}' };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function notFound(content: string): CrudResult {
  return { statusCode: 404, nextContent: content, body: ITEM_NOT_FOUND_BODY };
}

function badBody(content: string): CrudResult {
  return { statusCode: 400, nextContent: content, body: BAD_BODY_BODY };
}

function emptyResult(nextContent: string): CrudResult {
  return { statusCode: 200, nextContent, body: nextContent };
}

/** Find the index of the object whose `id` property String-compares to `id`. */
function findObjectIndex(arr: unknown[], id: string | undefined): number {
  if (!Array.isArray(arr) || id === undefined) return -1;
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (isPlainObject(el) && String(el['id']) === String(id)) return i;
  }
  return -1;
}

/** Coerce a payload into an item for array-primitives: JSON value, else raw. */
function coerceArrayItem(body: unknown, raw: string): unknown {
  if (body === undefined || body === '') return raw;
  if (typeof body !== 'string') return body; // parsed JSON (number/bool/null/obj/arr)
  const parsed = tryParseBody(body);
  return parsed === undefined ? body : parsed;
}

/** Overwrite an object/primitive/raw bucket from the request payload. */
function overwriteFromRequest(
  data: BucketData,
  req: EngineRequest,
  content: string
): CrudResult {
  const { value: body, raw } = requestPayload(req);
  switch (data.shape) {
    case 'object': {
      // Table: "overwrite content" — unconditional.
      return { statusCode: 200, nextContent: stringifyValue(body), body: stringifyValue(body) };
    }
    case 'primitive': {
      const value = coercePrimitivePayload(body, raw);
      return { statusCode: 200, nextContent: stringifyValue(value), body: stringifyValue(value) };
    }
    case 'raw':
    default:
      return { statusCode: 200, nextContent: raw, body: raw };
  }
}
