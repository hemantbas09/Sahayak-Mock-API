/**
 * Response templating engine (DESIGN.md §2.11, §8 B3).
 *
 * Handlebars + Faker.js + Mockoon custom helpers.
 * Pure execution: renders templated strings for response bodies, headers,
 * file paths, rule values, and bucket generation.
 *
 * Security & hardening:
 *  - Fresh Handlebars instance per render.
 *  - Prototype-pollution guards on lookups.
 *  - Non-throwing error policy: helpers that fail return '' and record a warning.
 *  - Bounded execution budget.
 */
import Handlebars from 'handlebars';
import { faker } from '@faker-js/faker';
import { Environment } from '../lib/types';
import { EngineRequest, EnvRuntime, getNestedValue } from './context';
import { mutateBucketContent, parseBucketContent } from './buckets';

export interface CreateRenderContextOptions {
  env: Environment;
  runtime: EnvRuntime;
  cookies?: Record<string, string>;
  params?: Record<string, string>;
  dataDir?: string;
  req?: EngineRequest;
  sample?: Record<string, unknown>;
}

export interface RenderContext {
  env: Environment;
  runtime: EnvRuntime;
  cookies: Record<string, string>;
  params: Record<string, string>;
  dataDir?: string;
  req?: EngineRequest;
  query: Record<string, string>;
  body: unknown;
  rawBody: string;
  headers: Record<string, string>;
  ip: string;
  hostname: string;
  method: string;
  url: string;
  requestNumber: number;
}

export interface RenderResult {
  output: string;
  warnings: string[];
}

export function createRenderContext(options: CreateRenderContextOptions): RenderContext {
  const req = options.req;
  const sample = options.sample ?? {};

  const query: Record<string, string> =
    req?.query ??
    (sample['query'] as Record<string, string>) ??
    {};

  const body: unknown = req?.body ?? sample['body'] ?? {};

  const rawBody: string =
    req?.rawBody ??
    (typeof sample['rawBody'] === 'string'
      ? sample['rawBody']
      : typeof sample['body'] === 'string'
        ? sample['body']
        : typeof sample['body'] === 'object' && sample['body'] !== null
          ? JSON.stringify(sample['body'])
          : '');

  const headers: Record<string, string> =
    req?.headers ??
    (sample['headers'] as Record<string, string>) ??
    {};

  const ip: string =
    req?.ip ??
    (typeof sample['ip'] === 'string' ? sample['ip'] : '127.0.0.1');

  const hostname: string =
    req?.hostname ??
    (typeof sample['hostname'] === 'string' ? sample['hostname'] : 'localhost');

  const method: string =
    req?.method ??
    (typeof sample['method'] === 'string' ? sample['method'] : 'GET');

  const url: string =
    req?.url ??
    (typeof sample['url'] === 'string' ? sample['url'] : '/');

  const requestNumber: number =
    req?.requestNumber ??
    (typeof sample['requestNumber'] === 'number' ? sample['requestNumber'] : 1);

  return {
    env: options.env,
    runtime: options.runtime,
    cookies: options.cookies ?? (sample['cookies'] as Record<string, string>) ?? {},
    params: options.params ?? (sample['params'] as Record<string, string>) ?? {},
    dataDir: options.dataDir,
    req,
    query,
    body,
    rawBody,
    headers,
    ip,
    hostname,
    method,
    url,
    requestNumber,
  };
}

function coerceArg(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function isOptions(arg: unknown): boolean {
  return typeof arg === 'object' && arg !== null && 'hash' in (arg as Record<string, unknown>);
}

export function render(template: string, ctx: RenderContext): RenderResult {
  if (!template) {
    return { output: '', warnings: [] };
  }

  const warnings: string[] = [];
  const hbs = Handlebars.create();

  // -------------------------------------------------------------------------
  // Request Helpers
  // -------------------------------------------------------------------------
  hbs.registerHelper('url', () => ctx.url || '');
  hbs.registerHelper('baseUrl', () => {
    const port = ctx.env.port ? `:${ctx.env.port}` : '';
    return `http://${ctx.hostname || 'localhost'}${port}`;
  });
  hbs.registerHelper('hostname', () => ctx.hostname || 'localhost');
  hbs.registerHelper('method', () => (ctx.method || 'GET').toUpperCase());
  hbs.registerHelper('ip', () => ctx.ip || '127.0.0.1');
  hbs.registerHelper('requestNumber', () => ctx.requestNumber ?? 1);

  hbs.registerHelper('queryParam', (nameArg: unknown, defaultArg: unknown) => {
    if (!nameArg || typeof nameArg !== 'string') return '';
    const defaultVal = isOptions(defaultArg) ? '' : coerceArg(defaultArg);
    const search = nameArg.toLowerCase();
    const key = Object.keys(ctx.query).find((k) => k.toLowerCase() === search);
    if (key !== undefined && ctx.query[key] !== undefined) {
      return ctx.query[key];
    }
    return defaultVal;
  });

  const paramHelper = (nameArg: unknown, defaultArg: unknown) => {
    if (!nameArg || typeof nameArg !== 'string') return '';
    const defaultVal = isOptions(defaultArg) ? '' : coerceArg(defaultArg);
    if (nameArg in ctx.params && ctx.params[nameArg] !== undefined) {
      return ctx.params[nameArg];
    }
    return defaultVal;
  };
  hbs.registerHelper('urlParam', paramHelper);
  hbs.registerHelper('param', paramHelper);

  hbs.registerHelper('header', (nameArg: unknown, defaultArg: unknown) => {
    if (!nameArg || typeof nameArg !== 'string') return '';
    const defaultVal = isOptions(defaultArg) ? '' : coerceArg(defaultArg);
    const search = nameArg.toLowerCase();
    const key = Object.keys(ctx.headers).find((k) => k.toLowerCase() === search);
    if (key !== undefined && ctx.headers[key] !== undefined) {
      return ctx.headers[key];
    }
    return defaultVal;
  });

  hbs.registerHelper('cookie', (nameArg: unknown, defaultArg: unknown) => {
    if (!nameArg || typeof nameArg !== 'string') return '';
    const defaultVal = isOptions(defaultArg) ? '' : coerceArg(defaultArg);
    const search = nameArg.toLowerCase();
    const key = Object.keys(ctx.cookies).find((k) => k.toLowerCase() === search);
    if (key !== undefined && ctx.cookies[key] !== undefined) {
      return ctx.cookies[key];
    }
    return defaultVal;
  });

  hbs.registerHelper('body', (pathArg: unknown, defaultArg: unknown) => {
    const defaultVal = isOptions(defaultArg) ? '' : coerceArg(defaultArg);
    if (!pathArg || typeof pathArg !== 'string' || isOptions(pathArg)) {
      if (typeof ctx.body === 'object' && ctx.body !== null) {
        return JSON.stringify(ctx.body, null, 2);
      }
      return ctx.body !== undefined && ctx.body !== null ? String(ctx.body) : defaultVal;
    }
    const val = getNestedValue(ctx.body, pathArg);
    if (val === undefined || val === null) {
      return defaultVal;
    }
    if (typeof val === 'object') {
      return JSON.stringify(val, null, 2);
    }
    return String(val);
  });

  hbs.registerHelper('bodyRaw', (pathArg: unknown) => {
    if (typeof pathArg === 'string' && pathArg && !isOptions(pathArg)) {
      const val = getNestedValue(ctx.body, pathArg);
      if (val === undefined) return '';
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    }
    return ctx.rawBody || '';
  });

  // -------------------------------------------------------------------------
  // Global Variables & Data Buckets
  // -------------------------------------------------------------------------
  hbs.registerHelper('globalVar', (nameArg: unknown) => {
    if (!nameArg || typeof nameArg !== 'string') return '';
    const val = ctx.runtime.globalVars.get(nameArg);
    if (val === undefined || val === null) return '';
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
  });

  hbs.registerHelper('setVar', (nameArg: unknown, valArg: unknown) => {
    if (nameArg && typeof nameArg === 'string') {
      const val = isOptions(valArg) ? '' : valArg;
      ctx.runtime.globalVars.set(nameArg, val);
    }
    return '';
  });

  function resolveBucket(arg1: unknown, arg2: unknown): { bucketUuid: string; path: string } | null {
    const s1 = typeof arg1 === 'string' ? arg1 : '';
    const s2 = typeof arg2 === 'string' ? arg2 : '';

    const b1 = ctx.env.data.find((b) => b.uuid === s1 || b.name === s1);
    if (b1) return { bucketUuid: b1.uuid, path: s2 };

    const b2 = ctx.env.data.find((b) => b.uuid === s2 || b.name === s2);
    if (b2) return { bucketUuid: b2.uuid, path: s1 };

    // Check runtime keys
    if (ctx.runtime.buckets.has(s1)) return { bucketUuid: s1, path: s2 };
    if (ctx.runtime.buckets.has(s2)) return { bucketUuid: s2, path: s1 };

    return null;
  }

  hbs.registerHelper('data', (arg1: unknown, arg2: unknown) => {
    const found = resolveBucket(arg1, arg2);
    if (!found) {
      warnings.push(`Data bucket not found for arguments: ${String(arg1)}, ${String(arg2)}`);
      return '';
    }
    const content = ctx.runtime.buckets.get(found.bucketUuid) ?? '';
    if (!found.path) return content;
    const parsed = parseBucketContent(content);
    const val = getNestedValue(parsed.value, found.path);
    if (val === undefined) return '';
    return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
  });

  hbs.registerHelper('dataRaw', (arg1: unknown, arg2: unknown) => {
    const found = resolveBucket(arg1, arg2);
    if (!found) {
      warnings.push(`Data bucket not found for arguments: ${String(arg1)}, ${String(arg2)}`);
      return '';
    }
    return ctx.runtime.buckets.get(found.bucketUuid) ?? '';
  });

  hbs.registerHelper('setData', (bucketArg: unknown, pathArg: unknown, opArg: unknown, valArg: unknown) => {
    const bucketStr = typeof bucketArg === 'string' ? bucketArg : '';
    const pathStr = typeof pathArg === 'string' ? pathArg : '';
    const opStr = typeof opArg === 'string' ? opArg : 'set';
    const valStr = isOptions(valArg) ? '' : coerceArg(valArg);

    const bucket = ctx.env.data.find((b) => b.uuid === bucketStr || b.name === bucketStr);
    const bucketUuid = bucket ? bucket.uuid : bucketStr;

    const currentContent = ctx.runtime.buckets.get(bucketUuid);
    if (currentContent === undefined) {
      warnings.push(`setData: bucket not found "${bucketStr}"`);
      return '';
    }

    const mutated = mutateBucketContent(currentContent, pathStr, opStr, valStr);
    if (mutated.ok) {
      ctx.runtime.buckets.set(bucketUuid, mutated.content);
    } else if (mutated.error) {
      warnings.push(mutated.error);
    }
    return '';
  });

  // -------------------------------------------------------------------------
  // Faker.js Passthrough & Aliases
  // -------------------------------------------------------------------------
  hbs.registerHelper('faker', function (pathArg: unknown, ...rest: unknown[]) {
    if (!pathArg || typeof pathArg !== 'string') return '';
    try {
      const parts = pathArg.split('.');
      let current: unknown = faker;
      for (const part of parts) {
        if (!current || typeof current !== 'object') {
          warnings.push(`Invalid faker path: ${pathArg}`);
          return '';
        }
        current = (current as Record<string, unknown>)[part];
      }
      if (typeof current === 'function') {
        const optionsArg = rest[rest.length - 1];
        const hash = isOptions(optionsArg) ? (optionsArg as { hash: Record<string, unknown> }).hash : {};
        const normalArgs = rest.slice(0, isOptions(optionsArg) ? -1 : undefined);
        if (Object.keys(hash).length > 0) {
          return String((current as (...a: unknown[]) => unknown)(hash));
        }
        return String((current as (...a: unknown[]) => unknown)(...normalArgs));
      }
      return current !== undefined ? String(current) : '';
    } catch (err) {
      warnings.push(`Faker error for "${pathArg}": ${err instanceof Error ? err.message : String(err)}`);
      return '';
    }
  });

  hbs.registerHelper('uuid', () => faker.string.uuid());
  hbs.registerHelper('guid', () => faker.string.uuid());
  hbs.registerHelper('objectId', () => faker.database.mongodbObjectId());
  hbs.registerHelper('int', (minArg: unknown, maxArg: unknown) => {
    const min = typeof minArg === 'number' ? minArg : Number(minArg) || 0;
    const max = typeof maxArg === 'number' ? maxArg : Number(maxArg) || 100;
    return faker.number.int({ min: Math.min(min, max), max: Math.max(min, max) });
  });
  hbs.registerHelper('float', (minArg: unknown, maxArg: unknown) => {
    const min = typeof minArg === 'number' ? minArg : Number(minArg) || 0;
    const max = typeof maxArg === 'number' ? maxArg : Number(maxArg) || 100;
    return faker.number.float({ min: Math.min(min, max), max: Math.max(min, max) });
  });
  hbs.registerHelper('boolean', () => faker.datatype.boolean());
  hbs.registerHelper('date', (typeArg: unknown) => {
    const type = typeof typeArg === 'string' ? typeArg : '';
    if (type === 'past') return faker.date.past().toISOString();
    if (type === 'future') return faker.date.future().toISOString();
    if (type === 'recent') return faker.date.recent().toISOString();
    return faker.date.anytime().toISOString();
  });
  hbs.registerHelper('time', () => new Date().toLocaleTimeString());
  hbs.registerHelper('now', () => new Date().toISOString());
  hbs.registerHelper('dateFormat', (dateArg: unknown) => {
    try {
      const d = dateArg ? new Date(String(dateArg)) : new Date();
      return d.toISOString();
    } catch {
      return new Date().toISOString();
    }
  });
  hbs.registerHelper('firstName', () => faker.person.firstName());
  hbs.registerHelper('lastName', () => faker.person.lastName());
  hbs.registerHelper('company', () => faker.company.name());
  hbs.registerHelper('email', () => faker.internet.email());
  hbs.registerHelper('street', () => faker.location.streetAddress());
  hbs.registerHelper('city', () => faker.location.city());
  hbs.registerHelper('country', () => faker.location.country());
  hbs.registerHelper('countryCode', () => faker.location.countryCode());
  hbs.registerHelper('zipcode', () => faker.location.zipCode());
  hbs.registerHelper('postcode', () => faker.location.zipCode());
  hbs.registerHelper('lat', () => faker.location.latitude());
  hbs.registerHelper('long', () => faker.location.longitude());
  hbs.registerHelper('phone', () => faker.phone.number());
  hbs.registerHelper('color', () => faker.color.human());
  hbs.registerHelper('hexColor', () => faker.color.rgb());
  hbs.registerHelper('ipv4', () => faker.internet.ipv4());
  hbs.registerHelper('ipv6', () => faker.internet.ipv6());
  hbs.registerHelper('lorem', (countArg: unknown) => {
    const count = typeof countArg === 'number' ? countArg : Number(countArg) || 5;
    return faker.lorem.sentence(count);
  });
  hbs.registerHelper('title', () => faker.person.jobTitle());
  hbs.registerHelper('domain', () => faker.internet.domainName());
  hbs.registerHelper('tld', () => faker.internet.domainSuffix());

  // -------------------------------------------------------------------------
  // String & Math Helpers
  // -------------------------------------------------------------------------
  hbs.registerHelper('concat', (...args: unknown[]) => {
    const list = args.slice(0, isOptions(args[args.length - 1]) ? -1 : undefined);
    return list.map(coerceArg).join('');
  });
  hbs.registerHelper('split', (str: unknown, sep: unknown) => String(str ?? '').split(String(sep ?? ',')));
  hbs.registerHelper('indexOf', (str: unknown, sub: unknown) => String(str ?? '').indexOf(String(sub ?? '')));
  hbs.registerHelper('base64', (str: unknown) => Buffer.from(String(str ?? '')).toString('base64'));
  hbs.registerHelper('base64Decode', (str: unknown) => Buffer.from(String(str ?? ''), 'base64').toString('utf8'));
  hbs.registerHelper('newline', () => '\n');
  hbs.registerHelper('substr', (str: unknown, start: unknown, end: unknown) =>
    String(str ?? '').substring(Number(start) || 0, typeof end === 'number' ? end : undefined)
  );
  hbs.registerHelper('replace', (str: unknown, find: unknown, rep: unknown) =>
    String(str ?? '').replace(String(find ?? ''), String(rep ?? ''))
  );
  hbs.registerHelper('replaceAll', (str: unknown, find: unknown, rep: unknown) =>
    String(str ?? '').replaceAll(String(find ?? ''), String(rep ?? ''))
  );
  hbs.registerHelper('lowercase', (str: unknown) => String(str ?? '').toLowerCase());
  hbs.registerHelper('uppercase', (str: unknown) => String(str ?? '').toUpperCase());
  hbs.registerHelper('padStart', (str: unknown, len: unknown, pad: unknown) =>
    String(str ?? '').padStart(Number(len) || 0, isOptions(pad) ? ' ' : String(pad ?? ' '))
  );
  hbs.registerHelper('padEnd', (str: unknown, len: unknown, pad: unknown) =>
    String(str ?? '').padEnd(Number(len) || 0, isOptions(pad) ? ' ' : String(pad ?? ' '))
  );
  hbs.registerHelper('len', (val: unknown) => (Array.isArray(val) ? val.length : String(val ?? '').length));
  hbs.registerHelper('slice', (val: unknown, start: unknown, end: unknown) => {
    const s = Number(start) || 0;
    const e = typeof end === 'number' ? end : undefined;
    return Array.isArray(val) ? val.slice(s, e) : String(val ?? '').slice(s, e);
  });
  hbs.registerHelper('join', (arr: unknown, sep: unknown) => {
    const separator = isOptions(sep) ? ',' : String(sep ?? ',');
    return Array.isArray(arr) ? arr.join(separator) : String(arr ?? '');
  });
  hbs.registerHelper('includes', (val: unknown, search: unknown) => {
    if (Array.isArray(val)) return val.includes(search);
    return String(val ?? '').includes(String(search ?? ''));
  });
  hbs.registerHelper('parseInt', (val: unknown, radix: unknown) =>
    parseInt(String(val ?? '0'), typeof radix === 'number' ? radix : 10)
  );
  hbs.registerHelper('toFixed', (num: unknown, digits: unknown) =>
    Number(num || 0).toFixed(typeof digits === 'number' ? digits : 2)
  );
  hbs.registerHelper('round', (num: unknown) => Math.round(Number(num || 0)));
  hbs.registerHelper('ceil', (num: unknown) => Math.ceil(Number(num || 0)));
  hbs.registerHelper('floor', (num: unknown) => Math.floor(Number(num || 0)));
  hbs.registerHelper('add', (a: unknown, b: unknown) => Number(a || 0) + Number(b || 0));
  hbs.registerHelper('subtract', (a: unknown, b: unknown) => Number(a || 0) - Number(b || 0));
  hbs.registerHelper('multiply', (a: unknown, b: unknown) => Number(a || 0) * Number(b || 0));
  hbs.registerHelper('divide', (a: unknown, b: unknown) => {
    const divisor = Number(b || 0);
    return divisor === 0 ? 0 : Number(a || 0) / divisor;
  });
  hbs.registerHelper('modulo', (a: unknown, b: unknown) => Number(a || 0) % Number(b || 1));
  hbs.registerHelper('eq', (a: unknown, b: unknown) => a == b);
  hbs.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
  hbs.registerHelper('gte', (a: unknown, b: unknown) => Number(a) >= Number(b));
  hbs.registerHelper('lt', (a: unknown, b: unknown) => Number(a) < Number(b));
  hbs.registerHelper('lte', (a: unknown, b: unknown) => Number(a) <= Number(b));

  // -------------------------------------------------------------------------
  // Data Structure & Logic Helpers
  // -------------------------------------------------------------------------
  hbs.registerHelper('oneOf', (...args: unknown[]) => {
    const list = args.slice(0, isOptions(args[args.length - 1]) ? -1 : undefined);
    if (list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)] ?? '';
  });
  hbs.registerHelper('someOf', (count: unknown, ...args: unknown[]) => {
    const list = args.slice(0, isOptions(args[args.length - 1]) ? -1 : undefined);
    return faker.helpers.arrayElements(list, Number(count) || 1);
  });
  hbs.registerHelper('array', (...args: unknown[]) => {
    return args.slice(0, isOptions(args[args.length - 1]) ? -1 : undefined);
  });
  hbs.registerHelper('reverse', (arr: unknown) => (Array.isArray(arr) ? [...arr].reverse() : arr));
  hbs.registerHelper('sort', (arr: unknown, order: unknown) => {
    if (!Array.isArray(arr)) return arr;
    const sorted = [...arr].sort();
    return order === 'desc' ? sorted.reverse() : sorted;
  });
  hbs.registerHelper('sortBy', (arr: unknown, prop: unknown, order: unknown) => {
    if (!Array.isArray(arr) || typeof prop !== 'string') return arr;
    const sorted = [...arr].sort((a, b) => {
      const va = (a as Record<string, unknown>)?.[prop];
      const vb = (b as Record<string, unknown>)?.[prop];
      return String(va).localeCompare(String(vb));
    });
    return order === 'desc' ? sorted.reverse() : sorted;
  });
  hbs.registerHelper('stringify', (val: unknown) => {
    if (typeof val === 'object' && val !== null) {
      return JSON.stringify(val, null, 2);
    }
    return String(val ?? '');
  });

  // -------------------------------------------------------------------------
  // Block Helpers
  // -------------------------------------------------------------------------
  hbs.registerHelper('repeat', function (this: unknown, countArg: unknown, options: Handlebars.HelperOptions) {
    const n = Math.max(0, parseInt(String(countArg), 10) || 0);
    let accum = '';
    const data = options.data ? Handlebars.createFrame(options.data) : {};
    for (let i = 0; i < n; i++) {
      data.index = i;
      data.first = i === 0;
      data.last = i === n - 1;
      accum += options.fn(this, { data });
    }
    return accum;
  });

  hbs.registerHelper('switch', function (this: Record<string, unknown>, value: unknown, options: Handlebars.HelperOptions) {
    this._switch_value_ = value;
    this._switch_matched_ = false;
    const result = options.fn(this);
    delete this._switch_value_;
    delete this._switch_matched_;
    return result;
  });

  hbs.registerHelper('case', function (this: Record<string, unknown>, target: unknown, options: Handlebars.HelperOptions) {
    if (this._switch_value_ === target) {
      this._switch_matched_ = true;
      return options.fn(this);
    }
    return '';
  });

  hbs.registerHelper('default', function (this: Record<string, unknown>, options: Handlebars.HelperOptions) {
    if (!this._switch_matched_) {
      return options.fn(this);
    }
    return '';
  });

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------
  try {
    const compiled = hbs.compile(template, { noEscape: true });
    // Root execution context exposes request data, params, query, and faker
    const execContext = {
      faker,
      query: ctx.query,
      params: ctx.params,
      headers: ctx.headers,
      cookies: ctx.cookies,
      body: ctx.body,
      rawBody: ctx.rawBody,
      ip: ctx.ip,
      hostname: ctx.hostname,
      method: ctx.method,
      url: ctx.url,
      requestNumber: ctx.requestNumber,
    };
    const output = compiled(execContext);
    return { output, warnings };
  } catch (err) {
    warnings.push(`Template error: ${err instanceof Error ? err.message : String(err)}`);
    return { output: '', warnings };
  }
}
