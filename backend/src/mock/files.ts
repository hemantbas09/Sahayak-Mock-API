/**
 * FILE response bodies (DESIGN.md §2.4, §1 deviation 2, §4 engine purity).
 *
 * The ONLY impure module in the mock engine: it touches node:fs. Everything
 * the engine needs from it is funneled through `fileResolver`, which is
 * injected into `responder.ts` as `ResponderDeps.resolveFile` — the responder
 * itself stays pure and unit-testable with a stub.
 *
 * Path semantics (DESIGN.md §2.4 + §14 row 14):
 *  - FILE response paths are resolved relative to the server-side `dataDir`
 *    (the `DATA_DIR` env var), never the user's machine.
 *  - Absolute paths are allowed ONLY when they resolve inside `dataDir`
 *    (path-traversal guard) — anything escaping `dataDir` resolves to null.
 *  - Missing, invalid, unreadable, or non-regular files → null (the caller
 *    decides the error surface; the responder answers 500 + warning).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * MIME type by file extension for the common types. Unknown or missing
 * extensions fall back to `application/octet-stream`.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.json': 'application/json',
  '.json5': 'application/json5',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const DEFAULT_MIME = 'application/octet-stream';

/**
 * MIME type for a path, by extension. Extension lookup is case-insensitive.
 * No extension or unknown extension → `application/octet-stream`.
 */
export function mimeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? DEFAULT_MIME;
}

/**
 * Resolve + read a FILE response body.
 *
 * `filePath` is resolved relative to `dataDir` (DESIGN.md §1 deviation 2 —
 * server-side data dir, not the user's machine). Absolute paths are allowed
 * ONLY when they resolve inside `dataDir` (path-traversal guard) — anything
 * escaping `dataDir` returns null.
 *
 * Returns `{ body (utf8 string), contentType }` where contentType is the
 * extension MIME (the responder may override it with a response header), or
 * null when the file is missing, the path is invalid/escapes `dataDir`, or
 * the entry is not a readable regular file.
 */
export function readFileBody(
  dataDir: string,
  filePath: string
): { body: string; contentType: string } | null {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null;

  let resolved: string;
  try {
    resolved = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(dataDir, filePath);
  } catch {
    return null;
  }

  // Traversal guard: the resolved path must stay inside dataDir.
  // `path.relative` returns '' for the dataDir itself; anything starting
  // with '..' (or being absolute) escapes it.
  const root = path.resolve(dataDir);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return null; // missing or unreadable
  }
  if (!stat.isFile()) return null; // directories and other non-files

  let body: string;
  try {
    body = fs.readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }
  return { body, contentType: mimeForPath(resolved) };
}

/**
 * Build a `ResponderDeps.resolveFile` bound to a `dataDir`. This is the seam
 * the pipeline uses to hand fs access to the pure responder:
 *
 *   const deps: ResponderDeps = { renderTemplate, resolveFile: fileResolver(dataDir) };
 */
export function fileResolver(
  dataDir: string
): (p: string) => { body: string; contentType: string } | null {
  return (p: string) => readFileBody(dataDir, p);
}
