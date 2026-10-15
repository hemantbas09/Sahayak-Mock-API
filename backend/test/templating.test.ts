import { describe, expect, it } from 'vitest';
import { createRenderContext, render } from '../src/mock/templating';
import { Environment } from '../src/lib/types';
import { createEnvRuntime } from '../src/mock/context';

function testEnv(): Environment {
  return {
    uuid: 'env-1',
    name: 'Test Env',
    port: 3000,
    endpointPrefix: '/api',
    headers: [],
    proxyMode: false,
    proxyHost: '',
    proxyRemovePrefix: false,
    tlsOptions: { enabled: false, certPath: '', keyPath: '', passphrase: '' },
    routes: [],
    data: [
      {
        uuid: 'bucket-users',
        name: 'users',
        content: JSON.stringify([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]),
      },
      {
        uuid: 'bucket-raw',
        name: 'rawText',
        content: 'plain string content',
      },
    ],
    version: 1,
  };
}

describe('templating engine (Handlebars + Faker + Mockoon helpers)', () => {
  it('returns empty output for empty template', () => {
    const env = testEnv();
    const ctx = createRenderContext({ env, runtime: createEnvRuntime(env) });
    expect(render('', ctx).output).toBe('');
  });

  it('renders request helpers (queryParam, urlParam, header, cookie, body, method, url)', () => {
    const env = testEnv();
    const runtime = createEnvRuntime(env);
    const ctx = createRenderContext({
      env,
      runtime,
      cookies: { session: 'sess123' },
      params: { id: '42' },
      sample: {
        query: { search: 'books', page: '2' },
        headers: { 'x-api-key': 'secret-key' },
        body: { user: { name: 'John Doe', age: 30 } },
        method: 'POST',
        url: '/api/users?search=books',
      },
    });

    const template = '{{method}} {{url}} query:{{queryParam "search"}} page:{{queryParam "page"}} param:{{urlParam "id"}} header:{{header "x-api-key"}} cookie:{{cookie "session"}} user:{{body "user.name"}}';
    const result = render(template, ctx);
    expect(result.output).toBe(
      'POST /api/users?search=books query:books page:2 param:42 header:secret-key cookie:sess123 user:John Doe'
    );
  });

  it('renders request helpers with default values when missing', () => {
    const env = testEnv();
    const ctx = createRenderContext({ env, runtime: createEnvRuntime(env) });
    const template = '{{queryParam "missing" "defaultQ"}} {{header "x-none" "defaultH"}} {{body "a.b" "defaultB"}}';
    const result = render(template, ctx);
    expect(result.output).toBe('defaultQ defaultH defaultB');
  });

  it('renders Faker aliases (uuid, int, boolean, email)', () => {
    const env = testEnv();
    const ctx = createRenderContext({ env, runtime: createEnvRuntime(env) });
    const template = '{{uuid}} {{boolean}} {{email}} {{int 10 20}}';
    const result = render(template, ctx);
    const parts = result.output.split(' ');
    expect(parts[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(['true', 'false']).toContain(parts[1]);
    expect(parts[2]).toContain('@');
    const n = Number(parts[3]);
    expect(n).toBeGreaterThanOrEqual(10);
    expect(n).toBeLessThanOrEqual(20);
  });

  it('renders full faker passthrough {{faker "location.city"}}', () => {
    const env = testEnv();
    const ctx = createRenderContext({ env, runtime: createEnvRuntime(env) });
    const result = render('{{faker "location.city"}}', ctx);
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('reads data bucket via {{data "users" "0.name"}} and mutates via {{setData}}', () => {
    const env = testEnv();
    const runtime = createEnvRuntime(env);
    const ctx = createRenderContext({ env, runtime });

    const read = render('{{data "users" "0.name"}}', ctx);
    expect(read.output).toBe('Alice');

    // Mutate via setData
    render('{{setData "users" "0.name" "set" "Alicia"}}', ctx);
    const after = render('{{data "users" "0.name"}}', ctx);
    expect(after.output).toBe('Alicia');
  });

  it('handles global variables with {{setVar}} and {{globalVar}}', () => {
    const env = testEnv();
    const runtime = createEnvRuntime(env);
    const ctx = createRenderContext({ env, runtime });

    render('{{setVar "counter" 42}}', ctx);
    const res = render('counter is {{globalVar "counter"}}', ctx);
    expect(res.output).toBe('counter is 42');
  });

  it('supports string, math, and array helpers', () => {
    const env = testEnv();
    const ctx = createRenderContext({ env, runtime: createEnvRuntime(env) });

    const t1 = '{{uppercase "hello"}} {{lowercase "WORLD"}} {{concat "a" "b" "c"}} {{add 5 3}} {{multiply 4 2}}';
    expect(render(t1, ctx).output).toBe('HELLO world abc 8 8');

    const t2 = '{{base64 "secret"}}';
    const enc = render(t2, ctx).output;
    expect(render(`{{base64Decode "${enc}"}}`, ctx).output).toBe('secret');
  });

  it('supports block helpers: repeat and switch/case/default', () => {
    const env = testEnv();
    const ctx = createRenderContext({ env, runtime: createEnvRuntime(env) });

    const repeatTemplate = '{{#repeat 3}}item-{{@index}} {{/repeat}}';
    expect(render(repeatTemplate, ctx).output.trim()).toBe('item-0 item-1 item-2');

    const switchTemplate = '{{#switch "B"}}{{#case "A"}}one{{/case}}{{#case "B"}}two{{/case}}{{#default}}other{{/default}}{{/switch}}';
    expect(render(switchTemplate, ctx).output).toBe('two');

    const defaultTemplate = '{{#switch "Z"}}{{#case "A"}}one{{/case}}{{#default}}fallback{{/default}}{{/switch}}';
    expect(render(defaultTemplate, ctx).output).toBe('fallback');
  });

  it('handles template errors gracefully without throwing', () => {
    const env = testEnv();
    const ctx = createRenderContext({ env, runtime: createEnvRuntime(env) });

    const badSyntax = '{{#unclosedTag}}foo';
    const result = render(badSyntax, ctx);
    expect(result.output).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
