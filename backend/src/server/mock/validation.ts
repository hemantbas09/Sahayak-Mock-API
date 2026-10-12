/**
 * Request body validation against a pasted TypeScript interface, type alias,
 * or JSON-schema-like object. Ported from the legacy monolithic server.
 *
 *   validateBody({ name: 'x', age: 30 }, 'interface U { name: string; age: number }')
 *     -> { valid: true, errors: [] }
 */

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

function getActualType(val: unknown): string {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

function validateAgainstJsonObject(body: Record<string, unknown>, parsedObj: Record<string, unknown>): string[] {
  const errors: string[] = [];

  for (const rawKey of Object.keys(parsedObj)) {
    const isOptional = rawKey.endsWith('?');
    const cleanKey = isOptional ? rawKey.slice(0, -1) : rawKey;
    const expectedVal = parsedObj[rawKey];
    const actualVal = body[cleanKey];

    if (actualVal === undefined || actualVal === null) {
      if (!isOptional) {
        errors.push(`Property "${cleanKey}" is required but is missing or null.`);
      }
      continue;
    }

    if (typeof expectedVal === 'string') {
      const expType = expectedVal.toLowerCase().trim();
      if (expType === 'string') {
        if (typeof actualVal !== 'string') {
          errors.push(`Property "${cleanKey}" must be a string, but received ${getActualType(actualVal)}.`);
        } else if (!isOptional && actualVal.trim() === '') {
          errors.push(`Property "${cleanKey}" is required and cannot be an empty string.`);
        }
      } else if (expType === 'number' && typeof actualVal !== 'number' && isNaN(Number(actualVal as string))) {
        errors.push(`Property "${cleanKey}" must be a number, but received ${getActualType(actualVal)}.`);
      } else if (expType === 'boolean' && typeof actualVal !== 'boolean' && actualVal !== 'true' && actualVal !== 'false') {
        errors.push(`Property "${cleanKey}" must be a boolean, but received ${getActualType(actualVal)}.`);
      } else if (expType.includes('[]') || expType === 'array') {
        validateArrayProperty(cleanKey, actualVal, isOptional, errors);
      } else if (expType === 'object' && (typeof actualVal !== 'object' || Array.isArray(actualVal) || actualVal === null)) {
        errors.push(`Property "${cleanKey}" must be an object, but received ${getActualType(actualVal)}.`);
      }
    } else if (Array.isArray(expectedVal)) {
      if (!Array.isArray(actualVal)) {
        errors.push(`Property "${cleanKey}" must be an array, but received ${getActualType(actualVal)}.`);
      }
    } else if (typeof expectedVal === 'object' && expectedVal !== null) {
      if (typeof actualVal !== 'object' || Array.isArray(actualVal) || actualVal === null) {
        errors.push(`Property "${cleanKey}" must be an object, but received ${getActualType(actualVal)}.`);
      }
    }
  }

  return errors;
}

function validateArrayProperty(key: string, actualVal: unknown, isOptional: boolean, errors: string[]): void {
  if (!Array.isArray(actualVal)) {
    errors.push(`Property "${key}" must be an array, but received ${getActualType(actualVal)}.`);
    return;
  }

  if (actualVal.some((item) => item === null || item === undefined)) {
    errors.push(`Property "${key}" array cannot contain null or undefined items.`);
  }
  if (actualVal.some((item) => typeof item === 'string' && item.trim() === '')) {
    errors.push(`Property "${key}" array cannot contain empty string items.`);
  }

  const validItems = actualVal.filter(
    (item) => item !== null && item !== undefined && (typeof item !== 'string' || item.trim() !== '')
  );
  if (!isOptional && validItems.length === 0) {
    errors.push(`Property "${key}" is required and must contain at least one valid non-empty item.`);
  }
}

function validateAgainstTypeScript(body: Record<string, unknown>, interfaceStr: string): string[] {
  const errors: string[] = [];
  const lines = interfaceStr.split(/\r?\n/);

  for (let rawLine of lines) {
    // Strip comments.
    let line = rawLine.split('//')[0].split('/*')[0].trim();
    if (!line) continue;

    // Ignore header/footer declarations like "export interface Payload {", "type Payload = {", "}", "{"
    if (line.match(/^(export\s+)?(interface|type)\s+[a-zA-Z0-9_$-]+/i) || line === '{' || line === '}') {
      continue;
    }

    // Clean trailing semicolons, commas, or closing braces.
    line = line.replace(/[;,{}]+$/g, '').trim();

    // Match property definition e.g. "cardId: string", "deviceDetail?: string", "codeDeliveryMode: string[]"
    const match = line.match(/^"?([a-zA-Z0-9_$-]+)"?(\??)\s*:\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const isOptional = match[2] === '?';
    let typeDef = match[3].trim().replace(/[;,{}]+$/g, '').trim();

    const value = body[key];

    if (value === undefined || value === null) {
      if (!isOptional) {
        errors.push(`Property "${key}" is required but is missing or null.`);
      }
      continue;
    }

    const lowerTypeDef = typeDef.toLowerCase();

    // 1. ARRAY CHECK (must run before primitive startsWith checks like 'string')
    if (
      typeDef.includes('[]') ||
      lowerTypeDef.startsWith('array') ||
      lowerTypeDef.startsWith('readonly ') ||
      typeDef.startsWith('[')
    ) {
      if (!Array.isArray(value)) {
        errors.push(`Property "${key}" must be an array (${typeDef}), but received ${getActualType(value)}.`);
      } else {
        if (value.some((item) => item === null || item === undefined)) {
          errors.push(`Property "${key}" array cannot contain null or undefined items.`);
        }
        if (value.some((item) => typeof item === 'string' && item.trim() === '')) {
          errors.push(`Property "${key}" array cannot contain empty string items.`);
        }

        const validItems = value.filter(
          (item) => item !== null && item !== undefined && (typeof item !== 'string' || item.trim() !== '')
        );
        if (!isOptional && validItems.length === 0) {
          errors.push(`Property "${key}" is required and must contain at least one valid non-empty item in the array.`);
        }

        // Element type checks, e.g. string[] / number[]
        if (lowerTypeDef.startsWith('string[]') || lowerTypeDef.startsWith('array<string>')) {
          if (value.some((item) => item !== null && item !== undefined && typeof item !== 'string')) {
            errors.push(`Property "${key}" array items must all be strings.`);
          }
        } else if (lowerTypeDef.startsWith('number[]') || lowerTypeDef.startsWith('array<number>')) {
          if (value.some((item) => item !== null && item !== undefined && typeof item !== 'number' && isNaN(Number(item)))) {
            errors.push(`Property "${key}" array items must all be numbers.`);
          }
        }
      }
    }
    // 2. STRING CHECK
    else if (lowerTypeDef === 'string' || lowerTypeDef.startsWith('string') || typeDef === '"string"') {
      if (typeof value !== 'string') {
        errors.push(`Property "${key}" must be a string, but received ${getActualType(value)}.`);
      } else if (!isOptional && value.trim() === '') {
        errors.push(`Property "${key}" is required and cannot be an empty string.`);
      }
    }
    // 3. NUMBER CHECK
    else if (lowerTypeDef === 'number' || lowerTypeDef.startsWith('number') || typeDef === '"number"') {
      const isNum = typeof value === 'number' && !isNaN(value);
      const isNumStr = typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value));
      if (!isNum && !isNumStr) {
        errors.push(`Property "${key}" must be a number, but received ${getActualType(value)}.`);
      }
    }
    // 4. BOOLEAN CHECK
    else if (lowerTypeDef === 'boolean' || lowerTypeDef.startsWith('boolean') || typeDef === '"boolean"') {
      const isBool = typeof value === 'boolean' || value === 'true' || value === 'false';
      if (!isBool) {
        errors.push(`Property "${key}" must be a boolean, but received ${getActualType(value)}.`);
      }
    }
    // 5. OBJECT CHECK
    else if (lowerTypeDef === 'object' || lowerTypeDef.startsWith('record<') || typeDef.startsWith('{')) {
      if (typeof value !== 'object' || Array.isArray(value) || value === null) {
        errors.push(`Property "${key}" must be an object, but received ${getActualType(value)}.`);
      }
    }
    // 6. UNION / LITERAL CHECK e.g. 'SMS' | 'EMAIL' or string | number
    else if (typeDef.includes('|')) {
      const unionParts = typeDef.split('|').map((p) => p.trim().replace(/^['"]|['"]$/g, ''));
      const matchesLiteral = unionParts.includes(String(value));
      const matchesType = unionParts.some((part) => {
        const pLower = part.toLowerCase();
        if (pLower === 'string') return typeof value === 'string';
        if (pLower === 'number') return typeof value === 'number' || !isNaN(Number(value));
        if (pLower === 'boolean') return typeof value === 'boolean' || value === 'true' || value === 'false';
        return false;
      });
      if (!matchesLiteral && !matchesType) {
        errors.push(`Property "${key}" must match union type (${typeDef}), but received ${JSON.stringify(value)}.`);
      }
    }
    // 7. ANY / UNKNOWN -> always valid
  }

  return errors;
}

/**
 * Validate a request body against a pasted TypeScript interface or
 * JSON-schema-like definition. Empty definitions pass everything through.
 */
export function validateBody(rawBody: unknown, definition: string): ValidationOutcome {
  const trimmed = (definition || '').trim();
  if (!trimmed) return { valid: true, errors: [] };

  let body = rawBody;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { valid: false, errors: ['Request body is not valid JSON'] };
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a valid JSON object'] };
  }

  const bodyObj = body as Record<string, unknown>;

  // JSON definition (starts with { or [)?
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsedObj = JSON.parse(trimmed);
      if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
        const jsonErrors = validateAgainstJsonObject(bodyObj, parsedObj as Record<string, unknown>);
        return { valid: jsonErrors.length === 0, errors: jsonErrors };
      }
    } catch {
      // Not valid JSON - fall through to the TypeScript parser.
    }
  }

  const errors = validateAgainstTypeScript(bodyObj, trimmed);
  return { valid: errors.length === 0, errors };
}
