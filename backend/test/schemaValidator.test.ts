import { describe, it, expect } from 'vitest';
import {
  validatePayload,
  renderValidationErrorBody,
  parseSchema,
} from '../src/mock/schemaValidator';

describe('schemaValidator', () => {
  it('validates user prompt example: id:number, name:string;, address ?: string', () => {
    const schema = `
      id:number
      name:string;
      address ?: string
    `;

    // 1. Valid without optional address
    const res1 = validatePayload({ id: 101, name: 'Hemant' }, schema);
    expect(res1.valid).toBe(true);
    expect(res1.errors).toHaveLength(0);

    // 2. Valid with optional address
    const res2 = validatePayload({ id: 101, name: 'Hemant', address: 'Kathmandu' }, schema);
    expect(res2.valid).toBe(true);
    expect(res2.errors).toHaveLength(0);

    // 3. Invalid when id is string
    const res3 = validatePayload({ id: '101', name: 'Hemant' }, schema);
    expect(res3.valid).toBe(false);
    expect(res3.errors[0]).toContain('id must be a number');

    // 4. Invalid when name is missing
    const res4 = validatePayload({ id: 101 }, schema);
    expect(res4.valid).toBe(false);
    expect(res4.errors[0]).toContain('name is required');

    // 5. Invalid when address is number
    const res5 = validatePayload({ id: 101, name: 'Hemant', address: 123 }, schema);
    expect(res5.valid).toBe(false);
    expect(res5.errors[0]).toContain('address must be a string');
  });

  it('validates array of strings (e.g. tags: string[])', () => {
    const schema = `
      id: number
      tags: string[]
    `;

    const res1 = validatePayload({ id: 1, tags: ['frontend', 'backend'] }, schema);
    expect(res1.valid).toBe(true);

    const res2 = validatePayload({ id: 1, tags: [100, 200] }, schema);
    expect(res2.valid).toBe(false);
    expect(res2.errors[0]).toContain('tags[0] must be a string');

    const res3 = validatePayload({ id: 1, tags: 'not-array' }, schema);
    expect(res3.valid).toBe(false);
    expect(res3.errors[0]).toContain('tags must be an array');
  });

  it('validates array of objects (e.g. items: { id: number; title: string }[])', () => {
    const schema = `
      orderId: string
      items: {
        id: number
        title: string
        qty?: number
      }[]
    `;

    const validPayload = {
      orderId: 'ORD-123',
      items: [
        { id: 1, title: 'Item 1', qty: 2 },
        { id: 2, title: 'Item 2' },
      ],
    };
    const res1 = validatePayload(validPayload, schema);
    expect(res1.valid).toBe(true);

    const invalidPayload = {
      orderId: 'ORD-123',
      items: [
        { id: 'wrong-type', title: 'Item 1' },
      ],
    };
    const res2 = validatePayload(invalidPayload, schema);
    expect(res2.valid).toBe(false);
    expect(res2.errors[0]).toContain('items[0].id must be a number');
  });

  it('renders custom error response body matching user prompt format', () => {
    const template = JSON.stringify({
      success: false,
      message: 'payload is not matched, please review your payload',
      code: '0',
    });

    const output = renderValidationErrorBody(template, ["Field 'id' must be a number"]);
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toBe('payload is not matched, please review your payload');
    expect(parsed.code).toBe('0');
  });

  it('interpolates {{error}} placeholder when present in error response template', () => {
    const template = JSON.stringify({
      success: false,
      message: 'Validation failed: {{error}}',
      code: '0',
    });

    const output = renderValidationErrorBody(template, ['id must be a number']);
    const parsed = JSON.parse(output);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toBe('Validation failed: id must be a number');
    expect(parsed.code).toBe('0');
  });

  it('parses TypeScript interface and unmarshals raw JSON string payload', () => {
    const schema = `
      interface CreateUserDto {
        id: number;
        name: string;
        isActive: boolean;
      }
    `;

    const rawJson = JSON.stringify({ id: 42, name: 'Alice', isActive: true });
    const res = validatePayload(rawJson, schema);
    expect(res.valid).toBe(true);
  });

  it('supports JSON Schema format seamlessly', () => {
    const jsonSchema = JSON.stringify({
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
    });

    const res1 = validatePayload({ id: 1, name: 'Test' }, jsonSchema);
    expect(res1.valid).toBe(true);

    const res2 = validatePayload({ id: 'bad' }, jsonSchema);
    expect(res2.valid).toBe(false);
  });
});
