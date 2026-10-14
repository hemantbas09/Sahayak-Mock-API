/**
 * Tests for files.ts — the ONLY impure engine module (fs allowed).
 *
 * Uses a real temp dir under backend/node_modules/.tmp-files-<random> so the
 * path-traversal guard is exercised against a real on-disk layout
 * (node_modules is inside the backend dir, the fixture is OUTSIDE the
 * dataDir, and Windows/CRLF line endings are irrelevant to utf8 reads).
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileResolver, mimeForPath, readFileBody } from '../src/mock/files';

// ---------------------------------------------------------------------------
// Temp-dir fixture
// ---------------------------------------------------------------------------

let dataDir: string;
let outsideFile: string;
let subdir: string;

beforeAll(() => {
  // node_modules is guaranteed to exist (vitest runs from backend/).
  // Absolute so the "absolute path inside dataDir" test is a real absolute path.
  const nodeModulesDir = path.resolve('node_modules');
  dataDir = fs.mkdtempSync(path.join(nodeModulesDir, '.tmp-files-'));
  subdir = path.join(dataDir, 'sub');
  fs.mkdirSync(subdir);

  // Files inside the dataDir
  fs.writeFileSync(path.join(dataDir, 'hello.txt'), 'hello world');
  fs.writeFileSync(path.join(dataDir, 'data.json'), '{"a":1}');
  fs.writeFileSync(path.join(dataDir, 'noext'), 'raw bytes');
  fs.writeFileSync(path.join(dataDir, 'UPPER.JSON'), '{"b":2}');
  fs.writeFileSync(path.join(subdir, 'nested.md'), '# nested');
  fs.writeFileSync(path.join(dataDir, 'dirname.txt'), 'should-not-be-read-as-dir');
  fs.mkdirSync(path.join(dataDir, 'dirname.txt.dir'));

  // A sibling OUTSIDE the dataDir (sibling of .tmp-files-<random>)
  outsideFile = path.join('node_modules', `.tmp-files-outside-${Date.now()}.txt`);
  fs.writeFileSync(outsideFile, 'outside');
});

afterAll(() => {
  // Guard against a partially-initialized fixture (beforeAll throwing early).
  const dir = dataDir as string | undefined;
  const out = outsideFile as string | undefined;
  if (typeof dir === 'string' && dir !== '' && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (typeof out === 'string' && out !== '' && fs.existsSync(out)) {
    fs.rmSync(out, { force: true });
  }
});

// ---------------------------------------------------------------------------
// mimeForPath
// ---------------------------------------------------------------------------

describe('mimeForPath', () => {
  it('maps the common extensions', () => {
    expect(mimeForPath('a.json')).toBe('application/json');
    expect(mimeForPath('a.json5')).toBe('application/json5');
    expect(mimeForPath('a.js')).toBe('text/javascript');
    expect(mimeForPath('a.ts')).toBe('text/typescript');
    expect(mimeForPath('a.html')).toBe('text/html');
    expect(mimeForPath('a.htm')).toBe('text/html');
    expect(mimeForPath('a.css')).toBe('text/css');
    expect(mimeForPath('a.xml')).toBe('application/xml');
    expect(mimeForPath('a.txt')).toBe('text/plain');
    expect(mimeForPath('a.csv')).toBe('text/csv');
    expect(mimeForPath('a.md')).toBe('text/markdown');
    expect(mimeForPath('a.yaml')).toBe('application/yaml');
    expect(mimeForPath('a.yml')).toBe('application/yaml');
    expect(mimeForPath('a.webmanifest')).toBe('application/manifest+json');
    expect(mimeForPath('a.png')).toBe('image/png');
    expect(mimeForPath('a.jpg')).toBe('image/jpeg');
    expect(mimeForPath('a.jpeg')).toBe('image/jpeg');
    expect(mimeForPath('a.gif')).toBe('image/gif');
    expect(mimeForPath('a.svg')).toBe('image/svg+xml');
    expect(mimeForPath('a.webp')).toBe('image/webp');
    expect(mimeForPath('a.ico')).toBe('image/x-icon');
    expect(mimeForPath('a.pdf')).toBe('application/pdf');
    expect(mimeForPath('a.zip')).toBe('application/zip');
    expect(mimeForPath('a.woff')).toBe('font/woff');
    expect(mimeForPath('a.woff2')).toBe('font/woff2');
    expect(mimeForPath('a.ttf')).toBe('font/ttf');
  });

  it('unknown extension → application/octet-stream', () => {
    expect(mimeForPath('a.kaboom')).toBe('application/octet-stream');
    expect(mimeForPath('a.abc123')).toBe('application/octet-stream');
  });

  it('no extension → application/octet-stream', () => {
    expect(mimeForPath('noext')).toBe('application/octet-stream');
    expect(mimeForPath('a/b/c')).toBe('application/octet-stream');
  });

  it('extension lookup is case-insensitive and works with directories in the path', () => {
    expect(mimeForPath('A.JSON')).toBe('application/json');
    expect(mimeForPath('dir/deep/File.TXT')).toBe('text/plain');
  });
});

// ---------------------------------------------------------------------------
// readFileBody
// ---------------------------------------------------------------------------

describe('readFileBody', () => {
  it('reads an existing file (utf8 content + right mime)', () => {
    const res = readFileBody(dataDir, 'hello.txt');
    expect(res).toEqual({ body: 'hello world', contentType: 'text/plain' });

    const json = readFileBody(dataDir, 'data.json');
    expect(json).toEqual({ body: '{"a":1}', contentType: 'application/json' });
  });

  it('reads files in subdirectories', () => {
    const res = readFileBody(dataDir, path.join('sub', 'nested.md'));
    expect(res).toEqual({ body: '# nested', contentType: 'text/markdown' });
  });

  it('missing file → null', () => {
    expect(readFileBody(dataDir, 'nope.txt')).toBeNull();
    expect(readFileBody(dataDir, path.join('sub', 'nope.json'))).toBeNull();
  });

  it("path traversal '../' escaping dataDir → null", () => {
    expect(readFileBody(dataDir, '..')).toBeNull();
    expect(readFileBody(dataDir, '../package.json')).toBeNull();
    expect(readFileBody(dataDir, 'sub/../../package.json')).toBeNull();
    expect(readFileBody(dataDir, path.join('..', path.basename(outsideFile)))).toBeNull();
    // absolute path of a file that sits OUTSIDE dataDir (in node_modules)
    expect(readFileBody(dataDir, outsideFile)).toBeNull();
  });

  it('absolute path INSIDE dataDir → ok', () => {
    const absInside = path.join(dataDir, 'data.json');
    expect(fs.existsSync(absInside)).toBe(true);
    const res = readFileBody(dataDir, absInside);
    expect(res).toEqual({ body: '{"a":1}', contentType: 'application/json' });
  });

  it('directory → null', () => {
    expect(readFileBody(dataDir, 'sub')).toBeNull();
    expect(readFileBody(dataDir, path.join('sub', 'nested.md', 'x'))).toBeNull();
  });

  it('empty/blank path → null', () => {
    expect(readFileBody(dataDir, '')).toBeNull();
    expect(readFileBody(dataDir, '   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fileResolver
// ---------------------------------------------------------------------------

describe('fileResolver', () => {
  it('returns a bound function (no .call/.apply binding loss, dataDir closed over)', () => {
    const resolver = fileResolver(dataDir);
    expect(typeof resolver).toBe('function');

    const viaResolve = resolver('hello.txt');
    expect(viaResolve).toEqual({ body: 'hello world', contentType: 'text/plain' });

    // Same result as calling readFileBody directly with the bound dataDir
    expect(viaResolve).toEqual(readFileBody(dataDir, 'hello.txt'));

    // The bound closure keeps working for other paths and still guards traversal
    expect(resolver('missing.bin')).toBeNull();
    expect(resolver('..')).toBeNull();
  });
});
