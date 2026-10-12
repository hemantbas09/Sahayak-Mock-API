/**
 * Response templating. Supported tags inside response bodies and headers:
 *
 *   {{query name "default"}}        value from the query string
 *   {{body user.name "default"}}    dot-path into the request body
 *   {{header x-token "default"}}    request header (case-insensitive)
 *   {{param id "default"}}          captured route parameter
 *   {{uuid}}                        fresh UUID v4
 *   {{randomInt 1 100}}             random integer in range
 *   {{date iso}} | {{date utc}} | {{date time}}
 *
 * Defaults must be quoted: {{query name "N/A"}}.
 */
import { getNestedValue } from './rules';

export interface TemplateContext {
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
  params: Record<string, string>;
}

const TAG_REGEX = /\{\{\s*([a-zA-Z0-9_]+)((?:\s+(?:[^{}'"\\]|\\.)*)?)\s*\}\}/g;

/**
 * Split a tag's argument list into (firstArg, default).
 *   "name N/A"        -> { arg1: 'name',  arg2: 'N/A' }
 *   'name "N/A"'      -> { arg1: 'name',  arg2: 'N/A' }
 *   "user.name"       -> { arg1: 'user.name', arg2: null }
 *   "1 100"           -> { arg1: '1',     arg2: '100' }
 */
function splitTagArgs(rawArgs: string): { arg1: string; arg2: string | null } {
  const text = rawArgs.trim();
  if (!text) return { arg1: '', arg2: null };

  const tokens = text.split(/\s+/);
  const arg1 = tokens[0];
  let arg2: string | null = tokens.length > 1 ? tokens.slice(1).join(' ') : null;

  if (arg2 !== null) {
    const quoted = arg2.match(/^(['"])(.*)\1$/);
    if (quoted) arg2 = quoted[2];
  }

  return { arg1, arg2 };
}

export function parseTemplate(template: string, ctx: TemplateContext): string {
  if (!template) return '';

  return template.replace(TAG_REGEX, (match, command: string, rawArgs: string) => {
    try {
      const { arg1, arg2 } = splitTagArgs(rawArgs);
      const nums = rawArgs.trim().match(/^(\d+)\s+(\d+)$/);
      const num1 = nums ? nums[1] : /^\d+$/.test(arg1) ? arg1 : undefined;
      const num2 = nums ? nums[2] : undefined;

      switch (command) {
        case 'query': {
          if (!arg1) return '';
          const val = ctx.query[arg1];
          if (val === undefined || val === null) return arg2 ?? '';
          return typeof val === 'object' ? JSON.stringify(val) : String(val);
        }
        case 'body': {
          if (!arg1) return '';
          const val = getNestedValue(ctx.body, arg1);
          if (val === undefined || val === null) return arg2 ?? '';
          return typeof val === 'object' ? JSON.stringify(val) : String(val);
        }
        case 'header': {
          if (!arg1) return '';
          const searchKey = arg1.toLowerCase();
          const actualKey = Object.keys(ctx.headers).find((k) => k.toLowerCase() === searchKey);
          const val = actualKey ? ctx.headers[actualKey] : undefined;
          if (val === undefined || val === null) return arg2 ?? '';
          return String(val);
        }
        case 'routeParam':
        case 'param': {
          if (!arg1) return '';
          const val = ctx.params[arg1];
          if (val === undefined || val === null) return arg2 ?? '';
          return String(val);
        }
        case 'uuid': {
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
        }
        case 'randomInt': {
          const min = num1 !== undefined ? parseInt(num1, 10) : arg1 !== undefined ? parseInt(arg1, 10) : 0;
          const max = num2 !== undefined ? parseInt(num2, 10) : arg2 != null ? parseInt(arg2, 10) : 100;
          if (isNaN(min) || isNaN(max)) return '0';
          const rand = Math.floor(Math.random() * (max - min + 1)) + min;
          return String(rand);
        }
        case 'date': {
          const date = new Date();
          if (arg1 === 'iso') return date.toISOString();
          if (arg1 === 'utc') return date.toUTCString();
          if (arg1 === 'time') return date.toLocaleTimeString();
          return date.toLocaleDateString();
        }
        default:
          return match; // unknown command - leave untouched
      }
    } catch (err) {
      console.error('[Mock] Error parsing template tag:', match, err);
      return '';
    }
  });
}
