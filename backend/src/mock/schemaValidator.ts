/**
 * Request payload schema validator (DESIGN §2).
 *
 * Validates incoming JSON / object request bodies against a schema defined
 * in TypeScript interface syntax (e.g. id: number, name: string, address?: string,
 * tags: string[], items: { id: number; title: string }[]) or JSON Schema.
 */

export type SchemaType =
  | { kind: 'primitive'; type: 'string' | 'number' | 'boolean' | 'any' }
  | { kind: 'array'; elementType: SchemaType }
  | { kind: 'object'; properties: Record<string, { type: SchemaType; optional: boolean }> }
  | { kind: 'union'; types: SchemaType[] };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates `payload` against `schemaDef`.
 * If `schemaDef` is empty or whitespace, always returns { valid: true, errors: [] }.
 */
export function validatePayload(payload: unknown, schemaDef: string): ValidationResult {
  const trimmed = (schemaDef || '').trim();
  if (!trimmed) {
    return { valid: true, errors: [] };
  }

  let parsedBody = payload;
  if (typeof payload === 'string') {
    const s = payload.trim();
    if (!s) {
      parsedBody = undefined;
    } else {
      try {
        parsedBody = JSON.parse(s);
      } catch {
        return {
          valid: false,
          errors: ['Request payload is not valid JSON'],
        };
      }
    }
  }

  let schema: SchemaType;
  try {
    schema = parseSchema(trimmed);
  } catch (err) {
    return {
      valid: false,
      errors: [`Invalid schema definition: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const errors: string[] = [];
  validateValue(parsedBody, schema, '', false, errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export const SAMPLE_PAYLOAD_SCHEMA = `id: number;
name: string;
address?: string;
tags?: string[];
items?: { id: number; title: string }[];`;

export const DEFAULT_PAYLOAD_ERROR_BODY = JSON.stringify(
  {
    success: false,
    message: 'payload is not matched, please review your payload',
    code: '0',
  },
  null,
  2
);

/**
 * Formats the error body response using the validation errors.
 */
export function renderValidationErrorBody(template: string, errors: string[]): string {
  const errorText = errors.join(', ');
  const defaultBody = DEFAULT_PAYLOAD_ERROR_BODY;

  const tpl = (template || '').trim();
  if (!tpl || tpl.includes('payloa dis wrong') || tpl.includes('Payload is wrong')) {
    if (!tpl.includes('{{error}}') && !tpl.includes('{{errors}}') && !tpl.includes('{{message}}')) {
      return defaultBody;
    }
  }

  if (tpl.includes('{{error}}') || tpl.includes('{{errors}}') || tpl.includes('{{message}}')) {
    return tpl
      .replace(/\{\{\s*error\s*\}\}/gi, errorText)
      .replace(/\{\{\s*errors\s*\}\}/gi, errorText)
      .replace(/\{\{\s*message\s*\}\}/gi, errorText);
  }

  return tpl;
}

// ---------------------------------------------------------------------------
// Schema Parser
// ---------------------------------------------------------------------------

export function parseSchema(input: string): SchemaType {
  let text = input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim();

  // 1. Check if input is standard JSON Schema or JSON object
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (parsed.type === 'object' && parsed.properties) {
          return parseJsonSchemaObject(parsed);
        }
      }
    } catch {
      // Fall through to TypeScript parsing
    }
  }

  // 2. Strip interface / type wrapper: e.g. "interface Foo { ... }" or "type Foo = { ... }"
  text = text.replace(/^(?:export\s+)?(?:interface\s+\w+\s*\{|type\s+\w+\s*=\s*\{)/i, '');

  // Strip trailing matching brace if wrapper was stripped or if full outer block
  if (text.endsWith('}') && (input.includes('interface ') || input.includes('type ') || text.startsWith('{'))) {
    const firstBrace = text.indexOf('{');
    if (firstBrace !== -1) {
      text = text.slice(firstBrace + 1, text.lastIndexOf('}')).trim();
    } else {
      text = text.slice(0, text.lastIndexOf('}')).trim();
    }
  }

  // If text starts with '{' and ends with '}', unwrap it
  if (text.startsWith('{') && text.endsWith('}')) {
    text = text.slice(1, -1).trim();
  }

  return {
    kind: 'object',
    properties: parseObjectProperties(text),
  };
}

function parseJsonSchemaObject(json: Record<string, any>): SchemaType {
  const props: Record<string, { type: SchemaType; optional: boolean }> = {};
  const required: string[] = Array.isArray(json.required) ? json.required : [];

  for (const [key, val] of Object.entries(json.properties ?? {})) {
    props[key] = {
      type: parseJsonSchemaType(val as Record<string, any>),
      optional: !required.includes(key),
    };
  }

  return {
    kind: 'object',
    properties: props,
  };
}

function parseJsonSchemaType(prop: Record<string, any>): SchemaType {
  const type = String(prop.type || '').toLowerCase();
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return { kind: 'primitive', type };
  }
  if (type === 'integer') {
    return { kind: 'primitive', type: 'number' };
  }
  if (type === 'array') {
    return {
      kind: 'array',
      elementType: prop.items ? parseJsonSchemaType(prop.items) : { kind: 'primitive', type: 'any' },
    };
  }
  if (type === 'object') {
    return parseJsonSchemaObject(prop);
  }
  return { kind: 'primitive', type: 'any' };
}

function parseObjectProperties(content: string): Record<string, { type: SchemaType; optional: boolean }> {
  const properties: Record<string, { type: SchemaType; optional: boolean }> = {};
  let i = 0;
  const len = content.length;

  while (i < len) {
    // Skip whitespace and semicolons / commas
    while (i < len && /[\s;,]/.test(content[i])) i++;
    if (i >= len) break;

    // Read field name
    let key = '';
    if (content[i] === '"' || content[i] === "'") {
      const quote = content[i++];
      while (i < len && content[i] !== quote) {
        key += content[i++];
      }
      i++; // skip quote
    } else {
      while (i < len && /[a-zA-Z0-9_$-]/.test(content[i])) {
        key += content[i++];
      }
    }

    if (!key) {
      i++;
      continue;
    }

    // Check for optional marker '?'
    while (i < len && /\s/.test(content[i])) i++;
    let optional = false;
    if (i < len && content[i] === '?') {
      optional = true;
      i++;
    }

    // Expect ':'
    while (i < len && /\s/.test(content[i])) i++;
    if (i < len && content[i] === ':') {
      i++;
    }

    // Read type expression until delimiter (; or , or \n) at depth 0
    while (i < len && /\s/.test(content[i]) && content[i] !== '\n') i++;
    let typeExpr = '';
    let braceDepth = 0;
    let parenDepth = 0;
    let angleDepth = 0;

    while (i < len) {
      const ch = content[i];
      if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
      else if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '<') angleDepth++;
      else if (ch === '>') angleDepth--;

      if (braceDepth === 0 && parenDepth === 0 && angleDepth === 0) {
        if (ch === ';' || ch === ',' || ch === '\n') {
          i++;
          break;
        }
      }
      typeExpr += ch;
      i++;
    }

    typeExpr = typeExpr.trim();
    if (typeExpr) {
      properties[key] = {
        type: parseTypeExpression(typeExpr),
        optional,
      };
    }
  }

  return properties;
}

export function parseTypeExpression(expr: string): SchemaType {
  let s = expr.trim();

  // Check union type: string | number
  if (s.includes('|')) {
    // Only split if not inside braces or angle brackets
    const parts = splitUnionParts(s);
    if (parts.length > 1) {
      return {
        kind: 'union',
        types: parts.map((p) => parseTypeExpression(p)),
      };
    }
  }

  // Array shorthand: T[]
  if (s.endsWith('[]')) {
    const inner = s.slice(0, -2).trim();
    return {
      kind: 'array',
      elementType: parseTypeExpression(inner),
    };
  }

  // Array<T>
  if (s.startsWith('Array<') && s.endsWith('>')) {
    const inner = s.slice(6, -1).trim();
    return {
      kind: 'array',
      elementType: parseTypeExpression(inner),
    };
  }

  // Nested object: { ... }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    return {
      kind: 'object',
      properties: parseObjectProperties(inner),
    };
  }

  const lower = s.toLowerCase();
  if (lower === 'string') return { kind: 'primitive', type: 'string' };
  if (lower === 'number' || lower === 'int' || lower === 'integer' || lower === 'float') {
    return { kind: 'primitive', type: 'number' };
  }
  if (lower === 'boolean' || lower === 'bool') return { kind: 'primitive', type: 'boolean' };
  if (lower === 'any') return { kind: 'primitive', type: 'any' };
  if (lower === 'object') return { kind: 'object', properties: {} };

  // Fallback to string if unknown identifier
  return { kind: 'primitive', type: 'string' };
}

function splitUnionParts(s: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  let parenDepth = 0;
  let angleDepth = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '<') angleDepth++;
    else if (ch === '>') angleDepth--;

    if (ch === '|' && braceDepth === 0 && parenDepth === 0 && angleDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ---------------------------------------------------------------------------
// Value Validator
// ---------------------------------------------------------------------------

function validateValue(
  val: unknown,
  schema: SchemaType,
  path: string,
  optional: boolean,
  errors: string[]
): void {
  const fieldName = path || 'Payload';

  if (val === undefined || val === null) {
    if (!optional) {
      errors.push(`${fieldName} is required`);
    }
    return;
  }

  switch (schema.kind) {
    case 'primitive': {
      switch (schema.type) {
        case 'string':
          if (typeof val !== 'string') {
            errors.push(`${fieldName} must be a string, received ${typeof val}`);
          }
          break;
        case 'number':
          if (typeof val !== 'number' || Number.isNaN(val)) {
            errors.push(`${fieldName} must be a number, received ${typeof val}`);
          }
          break;
        case 'boolean':
          if (typeof val !== 'boolean') {
            errors.push(`${fieldName} must be a boolean, received ${typeof val}`);
          }
          break;
        case 'any':
          break;
      }
      break;
    }

    case 'array': {
      if (!Array.isArray(val)) {
        errors.push(`${fieldName} must be an array, received ${typeof val}`);
        return;
      }
      for (let i = 0; i < val.length; i++) {
        validateValue(val[i], schema.elementType, `${path}[${i}]`, false, errors);
      }
      break;
    }

    case 'object': {
      if (typeof val !== 'object' || Array.isArray(val) || val === null) {
        errors.push(`${fieldName} must be an object, received ${Array.isArray(val) ? 'array' : typeof val}`);
        return;
      }
      const obj = val as Record<string, unknown>;

      for (const [key, prop] of Object.entries(schema.properties)) {
        const propPath = path ? `${path}.${key}` : key;
        const propVal = obj[key];
        validateValue(propVal, prop.type, propPath, prop.optional, errors);
      }
      break;
    }

    case 'union': {
      const unionErrors: string[] = [];
      let matched = false;
      for (const sub of schema.types) {
        const tempErrors: string[] = [];
        validateValue(val, sub, path, optional, tempErrors);
        if (tempErrors.length === 0) {
          matched = true;
          break;
        }
        unionErrors.push(...tempErrors);
      }
      if (!matched) {
        errors.push(`${fieldName} does not match any allowed type in union`);
      }
      break;
    }
  }
}
