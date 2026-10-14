/**
 * Frontend SchemaValidator utility for payload validation & live testing.
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

export function inferTypeScriptSchema(value: unknown, interfaceName = 'RequestPayload'): string {
  function typeOfValue(val: unknown, indent = '  '): string {
    if (val === null || val === undefined) return 'any';
    if (typeof val === 'string') return 'string';
    if (typeof val === 'number') return 'number';
    if (typeof val === 'boolean') return 'boolean';
    if (Array.isArray(val)) {
      if (val.length === 0) return 'any[]';
      const elemType = typeOfValue(val[0], indent);
      return elemType.includes('\n') ? `(${elemType})[]` : `${elemType}[]`;
    }
    if (typeof val === 'object') {
      const entries = Object.entries(val as Record<string, unknown>);
      if (entries.length === 0) return 'Record<string, any>';
      const lines = entries.map(([k, v]) => `${indent}  ${k}: ${typeOfValue(v, indent + '  ')};`);
      return `{\n${lines.join('\n')}\n${indent}}`;
    }
    return 'any';
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    const lines = entries.map(([k, v]) => `  ${k}: ${typeOfValue(v, '  ')};`);
    return `interface ${interfaceName} {\n${lines.join('\n')}\n}`;
  }
  return `type ${interfaceName} = ${typeOfValue(value)};`;
}

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

export function parseSchema(input: string): SchemaType {
  let text = input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim();

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

  text = text.replace(/^(?:export\s+)?(?:interface\s+\w+\s*\{|type\s+\w+\s*=\s*\{)/i, '');

  if (text.endsWith('}') && (input.includes('interface ') || input.includes('type ') || text.startsWith('{'))) {
    const firstBrace = text.indexOf('{');
    if (firstBrace !== -1) {
      text = text.slice(firstBrace + 1, text.lastIndexOf('}')).trim();
    } else {
      text = text.slice(0, text.lastIndexOf('}')).trim();
    }
  }

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
  const required: string[] = Array.isArray(json['required']) ? json['required'] : [];
  const propertiesObj = (json['properties'] as Record<string, any>) ?? {};

  for (const [key, val] of Object.entries(propertiesObj)) {
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
  const type = String(prop['type'] || '').toLowerCase();
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return { kind: 'primitive', type };
  }
  if (type === 'integer') {
    return { kind: 'primitive', type: 'number' };
  }
  if (type === 'array') {
    const items = prop['items'];
    return {
      kind: 'array',
      elementType: items ? parseJsonSchemaType(items) : { kind: 'primitive', type: 'any' },
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
    while (i < len && /[\s;,]/.test(content[i])) i++;
    if (i >= len) break;

    let key = '';
    if (content[i] === '"' || content[i] === "'") {
      const quote = content[i++];
      while (i < len && content[i] !== quote) {
        key += content[i++];
      }
      i++;
    } else {
      while (i < len && /[a-zA-Z0-9_$-]/.test(content[i])) {
        key += content[i++];
      }
    }

    if (!key) {
      i++;
      continue;
    }

    while (i < len && /\s/.test(content[i])) i++;
    let optional = false;
    if (i < len && content[i] === '?') {
      optional = true;
      i++;
    }

    while (i < len && /\s/.test(content[i])) i++;
    if (i < len && content[i] === ':') {
      i++;
    }

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

  if (s.includes('|')) {
    const parts = splitUnionParts(s);
    if (parts.length > 1) {
      return {
        kind: 'union',
        types: parts.map((p) => parseTypeExpression(p)),
      };
    }
  }

  if (s.endsWith('[]')) {
    const inner = s.slice(0, -2).trim();
    return {
      kind: 'array',
      elementType: parseTypeExpression(inner),
    };
  }

  if (s.startsWith('Array<') && s.endsWith('>')) {
    const inner = s.slice(6, -1).trim();
    return {
      kind: 'array',
      elementType: parseTypeExpression(inner),
    };
  }

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
      let matched = false;
      for (const sub of schema.types) {
        const tempErrors: string[] = [];
        validateValue(val, sub, path, optional, tempErrors);
        if (tempErrors.length === 0) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        errors.push(`${fieldName} does not match any allowed type in union`);
      }
      break;
    }
  }
}
