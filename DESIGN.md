# Sahayak — Self-Hosted Mockoon-Compatible Mock API Server

**One document: what the project is, what it does, and exactly how to build it — step by step.**

Stack: **Angular** (frontend, BEM + SCSS) · **Node.js + Express** (backend) · **MongoDB** (storage) · **Handlebars + Faker.js** (templating, same as Mockoon).

**Design goal: behavioral and data-model parity with Mockoon (desktop/CLI v9+).** Every Mockoon feature works the same way here — same route/rule/templating semantics, same JSON export format (a Sahayak environment exports to a file Mockoon can open, and a Mockoon file imports losslessly). The only deliberate deviations are the ones a *server-hosted, team-shared* tool must make, and each is called out explicitly in §14.

This document is the single source of truth. If a decision isn't written here, it isn't decided yet.

---

## 1. What this project is

Sahayak is a **self-hosted, team-shared mock API server with full Mockoon parity**.

Think of it as Mockoon's desktop app rebuilt as a web application:

- A team keeps its Mockoon environments (routes → responses, data buckets, proxy settings) in **one shared place** on a server, not in local JSON files.
- Anyone with access opens the editor in a browser, edits a mock, and saves it to the server. Changes are live for the mock endpoints immediately.
- Other teammates see the change the next time they open/reload the editor (reload-to-sync; no live websockets in v1).
- Real client applications call the mock endpoints over HTTP(S) and get the exact same responses Mockoon would serve: rules, response modes, Handlebars/Faker templating, CRUD routes over data buckets, proxying, latency, file serving, TLS.
- The UI, concepts, and vocabulary mirror Mockoon 1:1: environments, routes, route responses, rules, data buckets, proxy mode, response modes, templating helpers.

### Why it exists

Mockoon desktop stores each environment in a file on one machine. A team can't share it, can't see what a teammate changed, and can't point a shared test environment at it. Sahayak moves the whole thing to a server + database so the team works from one source of truth — **without giving up a single Mockoon feature**.

### The two audiences

| Audience | What they use |
| --- | --- |
| **Team members** (humans) | The Angular editor UI: create/edit environments, routes, responses, rules, data buckets, proxy settings; view request logs. |
| **Client apps** (code) | The mock HTTP(S) endpoints: one listener per environment, on the environment's configured port, exactly like Mockoon. |

### Deliberate deviations from Mockoon desktop (read first)

Mockoon desktop is a single-user local app. Hosting it for a team forces exactly four behavior changes; everything else is identical:

1. **Persistence & multi-user**: environments live in MongoDB with optimistic-concurrency version checks instead of being rewritten to a local JSON file (§4.3). Last-write-wins is *not* acceptable on a server, so saves carry a version number and stale saves are rejected with a clear conflict message. Mockoon desktop has no such concept because only one person edits a file.
2. **No desktop shell**: file responses resolve paths relative to a server-side data directory (`DATA_DIR`), not the user's machine.
3. **Logs are stored in MongoDB** (capped collection) instead of only in desktop memory, so the whole team can inspect them; sensitive headers are redacted (§2.6).
4. **The editor is a web app** served by the same server, protected by auth from day one (§2.7) — a server that anyone on the network can edit is not shippable.

Everything else — matching, rules, templating, CRUD semantics, proxy, response modes, export format — follows Mockoon exactly, section by section below.

---

## 2. Full feature list

Legend: **[M]** = Mockoon behavior copied verbatim · **[S]** = server-specific deviation.

### 2.1 Environments [M]

A named group of routes with its own HTTP listener. Fields:

- `uuid` — environment id (UUID, client-generated).
- `name`.
- `port` — **real listening port** (deviation detail in §14.1: desktop binds localhost; the server binds `0.0.0.0`).
- `endpointPrefix` — stripped before route matching (e.g. `/api/v1`).
- `latency` — legacy fallback removed; latency is per-response in Mockoon (§2.4). Field omitted.
- `headers` — default response headers (key/value list).
- `proxyMode` (bool), `proxyHost` (string), `proxyRemovePrefix` (bool) — environment-level proxy fallback (§2.8).
- `tlsOptions` — `{enabled, certPath, keyPath, passphrase?}` for HTTPS on this environment's port (§2.9).
- `routes[]` — ordered; order matters (§2.3).
- `data[]` — data buckets (§2.10).
- `version` — integer, incremented on every save; optimistic concurrency (§4.3). **[S]**

### 2.2 Route matching [M]

- **HTTP routes**: one method + path pattern. Methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- **CRUD routes**: special type, no method of its own; expands into multiple operations at runtime (§2.5).
- Path patterns:
- Parameters: `/users/:id`.
- Trailing catch-all: `/files/*`.
- Middle wildcard (one segment): `/a/*/c`.
- Case-insensitive, trailing-slash tolerant, URL-decoded params.
- **Precedence (most to least specific)**: exact path segment > `:param` > `*` wildcard. Declared order breaks ties. A regular HTTP route declared *above* a CRUD route overrides that CRUD operation. **[this paragraph answers the "who wins" question explicitly]**
- No route matches → 404 (body `{"error":"Route not matched"}`), **unless** proxy fallback is enabled → proxied instead (§2.8).

### 2.3 Responses & response modes [M]

Each route has one or more responses, in order.

- Every response has: `statusCode`, `label`, `headers[]`, `body`/`filePath`/`databucketId` (§2.4), `latency` (ms, per response — this replaces the old per-env/per-route latency), `rules[]`, `rulesOperator` (`OR`|`AND`), `defaultResponse` (bool, exactly one per route).
- **Selection algorithm** (verbatim Mockoon):

1. If route `responseMode` is `SEQUENTIAL`: serve responses in rotation, one per request, ignoring rules.
2. If route `responseMode` is `RANDOM`: serve a random response, ignoring rules.
3. Otherwise (rules mode): walk responses **in declaration order**; the **first** response whose rules all match is served. Responses with **zero rules are skipped** (a rule-less response is reachable only as the default).
4. If no ruled response matched, the response flagged `defaultResponse` is served.
5. Rules-disabled toggle on a route (Mockoon's "rules off" switch): always serve the default response.

- **Tiebreak**: first matching response in declaration order — never undefined, never random.

### 2.4 Response body types [M]

Each response has a `bodyType`:

| bodyType | Behavior |
| --- | --- |
| `INLINE` | `body` string, templated (§2.11) before sending. Default `Content-Type: application/json`; otherwise taken from response headers. |
| `FILE` | `filePath` (templating allowed in the path) resolved relative to `DATA_DIR`; streamed with `Content-Type` from the file extension unless overridden by headers. |
| `DATABUCKET` | Serves the linked bucket's generated content as-is (§2.10). |
| `NONE` | Empty body. |

### 2.5 CRUD routes [M]

A CRUD route (`type: 'crud'`) is linked to one data bucket (`responses[0].databucketId`) and auto-generates REST endpoints. Semantics copied from Mockoon:

| Operation | Array of objects | Array of primitives (`:id` = index) | Object / primitive / non-JSON |
| --- | --- | --- | --- |
| `GET /{path}` | whole array (supports filter/sort/pagination) | whole array | content |
| `GET /{path}/:id` | item by `id` property | item by index | content |
| `POST /{path}` | insert object (autogenerated `id` if absent) | insert item | overwrite content |
| `PUT /{path}` | replace whole bucket | replace whole bucket | overwrite content |
| `PUT /{path}/:id` | full replace by `id` | replace by index | overwrite content |
| `PATCH /{path}` | concatenate arrays | concatenate | merge if objects |
| `PATCH /{path}/:id` | partial merge by `id` | replace by index | merge if objects |
| `DELETE /{path}` | clear bucket | clear bucket | delete content |
| `DELETE /{path}/:id` | delete by `id` | delete by index | delete content |

- **IDs**: if existing objects have numeric `id`s, new items auto-increment; otherwise UUID v4. If the bucket template generated ids via a helper (e.g. `{{faker 'database.mongodbObjectId'}}`), subsequent inserts reuse that id format.
- `GET /{path}` query operators: `_page`/`_limit` (pagination), `_sort`/`_order` (sorting), `_eq`/`_ne`/`_gt`/`_gte`/`_lt`/`_lte`/`_like`/`_in`/`_contains`/`_startswith`/`_endswith` on fields (array fields auto-checked for a match on any element).
- CRUD routes may still have multiple responses and rules; response 1 is fixed (the bucket link), cannot be deleted or reordered, and is the CRUD handler. Extra ruled responses override the default CRUD behavior.
- **Bucket runtime state lives in memory, survives between requests, and resets to its templated initial content on server restart** — identical to Mockoon. **[S detail: with multiple server replicas, bucket state would need shared storage; v1 is single-replica, see §11]**

### 2.6 Request logs [M+S]

- Every mock request is logged: timestamp, environment, method, URL, client IP, request headers (sensitive redacted), query params, parsed body, response status, response headers, response body, matched route, actual latency.
- **Redaction** **[S]**: `authorization`, `cookie`, `x-api-key`, and any header matching `/token|secret|password|api[-_]?key/i` stored as `[redacted]`. Response/request **bodies** may also contain secrets — the UI shows bodies but this is documented as an accepted risk; a per-env "disable body logging" toggle is provided.
- Stored in a **MongoDB capped collection** (e.g. 512 MB) **[S]** — desktop keeps logs in memory only; a shared server must not lose them on restart.
- Bodies stored in logs are truncated (request 64 KB, response 256 KB). **[S hardening]**
- Editor log viewer: polled every 5 s (v1), expandable rows, clear button, per-env filter.

### 2.7 Auth & roles [S]

Not a Mockoon desktop feature, but mandatory for a shared server (§1, deviation 4):

- Email/password login; roles `admin`, `editor`, `viewer`.
- Every `/api/*` (configuration) endpoint checks the role. Mock listeners are public (same as Mockoon's local server).
- `viewer`: read-only (environments, logs). `editor`: edit environments. `admin`: plus delete environments, manage users, clear logs.

### 2.8 Proxy mode [M]

- **Environment proxy**: `proxyMode: true` + `proxyHost`. When no route matches a request, the server forwards it to `proxyHost` (preserving method, headers, body) and relays the response. `proxyRemovePrefix` strips `endpointPrefix` before forwarding. Response marked with `X-Mockoon-Proxy: true`-style header (use `X-Sahayak-Proxy: true`).
- **Route-level proxy**: a route can be a pure proxy endpoint (proxying to `proxyHost` or its own host), allowing partial mocking ("proxy everything except these routes").
- Timeouts (default 10 s) and error mapping (proxy unreachable → 500 with clear body).

### 2.9 HTTPS / TLS [M]

Per environment: `tlsOptions {enabled, certPath, keyPath, passphrase?}`. When enabled, that environment's listener serves HTTPS. Cert paths resolve relative to `DATA_DIR`.

### 2.10 Data buckets & global variables [M]

- **Data buckets**: env-level list `{uuid, name, content}`. `content` is templated **once at generation time** (server start or first reference), parsed as JSON when valid, and held in memory. Referenced by:
- CRUD routes (linked bucket, mutated by CRUD operations),
- responses (`bodyType: DATABUCKET`),
- templating helpers `{{data 'path' 'bucketUuid-or-name'}}` / `{{dataRaw ...}}` (read), `{{setData ...}}` (mutate: set/push/increment/decrement/invert),
- buckets can reference each other via `dataRaw`.
- A bucket may hold a **JSON Schema** used together with response rules (the schema-aware rule target).
- **Global variables**: `{{setVar 'name' value}}` in any templated surface, read via `{{globalVar 'name'}}`, usable in rules (target `global_var`). In-memory, per environment, reset on restart. `{{setVar}}` returns empty string.
- The editor has a "Data" tab (buckets) and a "Global variables" viewer with manual reset.

### 2.11 Templating (Handlebars + Faker.js, verbatim Mockoon) [M]

Mockoon implements **Handlebars**, **Faker.js**, and custom helpers. We implement the same set. No custom tag parser of our own.

- Syntax: `{{helper 'arg1' arg2}}`, block helpers `{{#helper}}...{{/helper}}`, triple-stash `{{{...}}}` to skip HTML escaping, subexpressions `(helper ...)` for arguments.
- **Request helpers**: `body 'path.to.prop' 'default'`, `bodyRaw 'path'`, `queryParam 'name' 'default'`, `urlParam 'id'`, `header 'x-token' 'default'`, `cookie 'name'`, `ip`, `method`, `hostname`, `globalVar 'name'`, `data 'path' 'bucket'`, `dataRaw`, `setData`, `requestNumber`.
- **Data helpers**: `repeat` (block), `oneOf`, `someOf`, `array`, `object`, `filter`, `sortBy`, `reverse`, `stringify`, `parseInt`, `concat`, `split`, `indexOf`, `base64` (inline & block), `newline`, `substr`, `replace`, `replaceAll`, `lowercase`, `uppercase`, `padStart`, `padEnd`, `toFixed`, `round`, `eq`, `gt`, `gte`, `lt`, `lte`, `switch/case/default` (block), `setVar`.
- **Faker.js helpers**: full `{{faker 'namespace.method' ...options}}` passthrough (pinned Faker version, seed + locale configurable per environment), plus convenience aliases: `uuid`/`guid`, `int`, `float`, `boolean`, `date`, `time`, `dateFormat`, `firstName`, `lastName`, `company`, `email`, `street`, `city`, `country`, `countryCode`, `zipcode`, `lat`, `long`, `phone`, `color`, `hexColor`, `ipv4`, `ipv6`, `lorem`, `title`, `domain`, `tld`, `postcode`.
- **Handlebars built-ins**: `if`, `unless`, `each`, `with`, `lookup`, `@index`, etc.
- Templating runs on: response body (INLINE), response header values, FILE paths, data bucket content at generation time, and **rule values**.
- **Rendering rules (error policy)**: a helper that throws (bad faker path, missing required arg) renders as an empty string and logs a templating warning entry; the response is still served. A body that fails to *parse* as its declared JSON content-type is served anyway (Mockoon behavior — invalid JSON is the user's signal, not ours).

**Template security [S hardening]** — Handlebars is **not a sandbox**. Mitigations, all enforced in `templating.ts`:

1. No custom JS helpers, no `eval`/`Function`, no `registerHelper` at runtime.
2. The Faker surface is a pinned version; `faker.helpers.fromCharacters` etc. remain pure data generators.
3. Render with a **fresh Handlebars instance per request** (no shared partial-cache pollution) and strict prototype-pollution guards on `data`/`body` lookups (reject `__proto__`, `constructor`, `prototype` path segments).
4. Rendering is CPU-bounded: 5 s per render → 500 with a clear error. Never `vm`, never user-registered partials.
5. Known residual risk is documented in §11 and the dependency is pinned + tracked.

### 2.12 Payload validation → REMOVED

The old spec's "validate body → 400 with field errors" is **not a Mockoon feature** and is removed for parity. Schema-based checking is still available the Mockoon way: put a JSON Schema in a data bucket and use the schema rule target to select responses. (If field-level 400 validation is ever needed, it re-enters as a ruled response returning a 400 INLINE body.)

### 2.13 Import / export [M]

- **Mockoon JSON**: import and export the environment document **byte-for-byte in Mockoon's format** — Sahayak's storage model *is* Mockoon's schema, so this is a pass-through, not a conversion. A file exported from Sahayak opens in Mockoon desktop/CLI and vice versa. On import: ids are kept, `version` starts at 1.
- **OpenAPI v3 / Swagger**: import (paths → routes, schemas → examples) and export, same fidelity level as Mockoon.
- Postman collection import: nice-to-have, Phase 2 (Mockoon doesn't do it; it's our addition).

### 2.14 Method fallback → REMOVED

The old spec's 405 + `X-Mock-Method-Fallback` is **not Mockoon behavior**. Mockoon returns 404 when nothing matches (path *or* method), optionally proxying if proxy mode is on. Adopted.

### 2.15 Non-functional [M+S]

- **CORS on mock listeners** [M]: permissive — preflight answered 204 with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: *`, `Access-Control-Allow-Headers: *`. (This is what makes browser client apps work against Mockoon.)
- **CORS on `/api/*`** [S]: strict — `Access-Control-Allow-Credentials: true` only with a concrete origin from `APP_URLS` allowlist; never `*`.
- **Body limits**: 50 MB `json`/`urlencoded`; `multipart` parsed with limits.
- **Body formats** [M]: JSON, `x-www-form-urlencoded`, `multipart/form-data`, XML (parsed to JSON for `body`/rules when possible); invalid bodies treated as raw strings.
- **Health**: `GET /api/status` → `{ok, storage, environments, listeners}`.
- **Latency caps**: per-response latency clamped to [0, 60 000] ms.

---

## 3. Technology decisions

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend framework | **Angular** | Team requirement; component model fits the nested editor. |
| Frontend styling | **SCSS + BEM** | Team requirement. |
| Language | **TypeScript** end-to-end | Shared types; server and client agree on the Mockoon schema types. |
| Backend | **Node.js + Express** | Same language as frontend; serves dynamic per-env listeners easily. |
| Templating | **Handlebars + Faker.js** (pinned) | Mockoon parity — this is the single biggest "same as Mockoon" dependency. |
| Database | **MongoDB** | One document per environment maps 1:1 to Mockoon's file format. |
| ODM | **Mongoose** | Schemas, indexes, connection management. |
| Build (frontend) | **Angular CLI** | Standard tooling. |
| Tests | **Vitest/Jest** (unit) + **Supertest** (e2e) | Engine must be pure and exhaustively tested. |
| Deployment | **Docker** (one image: server + built Angular static), HTTPS via Nginx/Caddy for the editor | Simple internal hosting. Mock ports are exposed separately (§14.1). |

---

## 4. Architecture

```javascript
                        ┌────────────────────────────────────────────────────┐
   Browser (Angular)    │                 Node.js (Express)                  │
  ┌──────────────────┐  │  ┌──────────────────────────────────────────────┐  │
  │  Editor UI        │  │  │  Configuration API  /api/*  (auth, roles)   │  │
  │  (BEM + SCSS)     │──┼──┤    environments CRUD, logs, import/export,  │  │
  └──────────────────┘  │  │    status                                    │  │
                        │  └───────────────┬──────────────────────────────┘  │
                        │                  │                                 │
  Client apps ──────────┼──► Mock engine    │  Store (in-memory snapshot of   │
  (mobile/web/scripts)  │  one listener     │   every env: routes, buckets'   │
                        │  per env + port   │   runtime state, global vars)   │
                        │                  │                                 │
                        │                  ▼                                 │
                        │        Storage: MongoStorage (environments,        │
                        │        users, capped logs collection)              │
                        └──────────────────┼─────────────────────────────────┘
                                           ▼
                                     ┌───────────┐
                                     │  MongoDB  │
                                     └───────────┘
```

Key properties:

- **The in-memory snapshot is the source of truth at runtime.** Mock listeners read from memory; MongoDB is the durable copy, written on save.
- **The mock engine is pure**: matching, rules, CRUD operations, templating helpers, proxy decision — pure functions over (request, env-slice, runtime-state) → result. Unit-testable without HTTP.
- **One document per environment** in MongoDB, schema-identical to Mockoon's export format.

### 4.1 Backend module map

The repository is a two-folder monorepo: **`frontend/`** (the Angular app) and
**`backend/`** (the Node.js + Express + MongoDB app). Each has its own
`package.json`, `node_modules`, and build tooling, so they install and run
independently.

```javascript
backend/
  src/
    server.ts          # entry: config -> db -> store -> listeners -> http (wiring only)
  app.ts               # createApp(store, logs, storageName) -> Express app (no port binding)
  config.ts            # loadConfig(): PORT, MONGODB_URI, DATA_DIR, APP_URLS, JWT_SECRET, PORT_RANGE
  state.ts             # Store: env snapshots + bucket/global-var runtime state, version checks
  logs.ts              # log writer (redaction), LogBuffer cache over capped collection
  api.ts               # /api routes (auth, environments, logs, status, import/export)
  listeners.ts         # per-environment HTTP/HTTPS listener lifecycle (open/close/reload on save)
  mock/
    matcher.ts         # matchPath (precedence), findRoute, stripPrefix
    rules.ts           # evaluateRules: all Mockoon targets & operators, AND/OR, first-match walk
    templating.ts      # Handlebars engine: request/data/faker helpers, security guards, timeouts
    crud.ts            # CRUD route operations matrix, id autogen/increment, query operators
    buckets.ts         # bucket generation (templated), runtime state, setData/setVar mutations
    proxy.ts           # env & route proxy forwarding
    responder.ts       # resolveMockResponse (pure): bodyType dispatch, latency, CORS, logs hook
    files.ts           # FILE body resolution relative to DATA_DIR, streaming, mime
  storage/
    index.ts           # StorageBackend interface
    mongoStorage.ts    # environments (replaceOne by uuid), users, capped logs
    fileStorage.ts     # optional dev fallback (JSON file per env)
db/
  mongodb.ts           # connectMongo(uri), maskMongoUri
  models.ts            # Environment (Mockoon schema + version), User, LogEntry
lib/
  types.ts             # Mockoon-compatible domain types (Environment, Route, RouteResponse, ...)
  mockoon-schema.ts    # zod schemas for import validation (Mockoon file format)
```

> Note on current layout: `backend/src/` is flattened — `server.ts` (entry),
> `config.ts`, `state.ts` (Store), `logs.ts`, `api.ts` (config + auth routers),
> `auth.ts`, `listeners.ts`, `pipeline.ts` (shared request pipeline), `mock/`
> (pure engine: matcher, rules, templating, crud, buckets, responder, files,
> proxy, context), `storage/` (contract + Mongo + file), `db/` (connection +
> models), `lib/` (Mockoon types). The module map above is the target
> organization; behavior matches it.

### 4.2 Frontend module map (Angular)

See **Section 7**.

### 4.3 Save & concurrency model **[S — replaces the old op protocol]**

> ⚠️ **This is the one place we intentionally do *not* copy Mockoon's internals.** Mockoon desktop rewrites the whole environment file on every change because one user owns the file. On a shared server that model loses edits, so:

- The client keeps `saved` and `current` copies; saving sends `PUT /api/environments/:uuid` with `{version, environment}` — the **whole environment document** (typically tens of KB; acceptable for team-scale mocks).
- Server checks `version` against its snapshot. Mismatch → **409** with `{message: "This environment was changed by <user> at <time>. Reload to see the latest."}`. Match → apply to in-memory snapshot, `version += 1`, persist `replaceOne`, restart/reload that env's listener if `port`/`tlsOptions`/`endpointPrefix` changed, return `{success, version}`.
- **Synchronous acknowledgement after in-memory apply; persistence completes before the response is sent** (no fire-and-forget). If Mongo write fails → 500, in-memory change is rolled back.
- The old minimal-op-diff protocol is dropped in v1. It can be reintroduced later as a wire optimization *behind the same API* if whole-document saves ever become a measurable cost. The invariants it enforced (minimal writes, no clobbering) are already guaranteed here by document granularity + version locking.
- Route/bucket creation, deletion, duplication, and **reordering are all just array mutations inside the environment document** — no separate reorder ops needed.

---

## 5. Data model (MongoDB)

### `environments` — one document per environment, Mockoon-shaped

```javascript
{
  uuid: string,            // unique index
  name: string,
  port: number,
  endpointPrefix: string,
  headers: [{key, value}],
  proxyMode: boolean,
  proxyHost: string,
  proxyRemovePrefix: boolean,
  tlsOptions: {enabled, certPath, keyPath, passphrase},
  routes: [Route],         // order = declaration order
  data: [DataBucket],
  version: number,         // optimistic concurrency (Sahayak-only field, stripped on export)
  createdAt, updatedAt: ISO strings
}
```

`Route`:

```javascript
{
  uuid, type: 'http'|'crud', method: 'get'|'post'|...,   // ignored for crud
  endpoint: string, documentation: string,
  responseMode: null|'RANDOM'|'SEQUENTIAL',
  responses: [RouteResponse]
}
```

`RouteResponse`:

```javascript
{
  uuid, label, statusCode: number,
  headers: [{key, value}],        // values templated
  latency: number,                // ms, per response (Mockoon)
  bodyType: 'INLINE'|'FILE'|'DATABUCKET'|'NONE',
  body: string, filePath: string, databucketId: string,
  rules: [RouteRule], rulesOperator: 'OR'|'AND',
  defaultResponse: boolean
}
```

`RouteRule`:

```javascript
{
  target: 'body'|'query'|'params'|'headers'|'cookie'|'global_var'|'request_number'|'data_bucket',
  property: string,        // name/path; for data_bucket: bucket uuid
  modifier: string,        // secondary path for data_bucket rules
  operator: string,        // see §2.11 ops list; combined with `invert`
  invert: boolean,         // Mockoon's "invert" toggle (replaces not_* operators)
  value: string            // templating allowed
}
```

`DataBucket`: `{uuid, name, content}` (templated at generation; runtime copy lives in the Store, not the DB).

### `users`

`{email (unique), passwordHash, role: 'admin'|'editor'|'viewer', createdAt}`.

### `logs` — **capped collection** (e.g. 512 MB, max ~200k docs)

`{ts, envUuid, method, url, ip, reqHeaders (redacted), query, reqBody (trunc 64KB), resStatus, resHeaders, resBody (trunc 256KB), routeUuid, latencyMs}`.

**Why one document per environment (not the old flat 3-collection model)?** Because the storage shape must be Mockoon's file format for lossless import/export, and because whole-document saves + version locking make concurrent-edit safety trivial to reason about. Flat collections were a good answer to the old op-protocol question; both are retired together.

**IDs**: plain UUIDs (Mockoon convention), client-generated.

---

## 6. API design (REST)

### Configuration API (editor; all require auth, role-checked)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | `{email, password}` | `{token, user}` |
| `GET` | `/api/auth/me` | — | user |
| `GET` | `/api/users` / `POST` / `DELETE` | — | admin-only user management |
| `GET` | `/api/environments` | — | env summaries (uuid, name, port, endpointPrefix, routeCount, version) |
| `GET` | `/api/environments/:uuid` | — | full environment document |
| `POST` | `/api/environments` | env (uuid optional) | created env `{success, uuid, version}` |
| `PUT` | `/api/environments/:uuid` | `{version, environment}` | `{success, version}` or **409 conflict** |
| `DELETE` | `/api/environments/:uuid` | — | `{success}` (admin) |
| `POST` | `/api/environments/:uuid/duplicate` | — | new env |
| `POST` | `/api/import` | Mockoon/OpenAPI file | imported env(s) |
| `GET` | `/api/environments/:uuid/export` | — | Mockoon JSON download |
| `GET` | `/api/logs?env=&limit=` | — | recent logs |
| `DELETE` | `/api/logs` | — | clear (admin/editor) |
| `GET` | `/api/status` | — | `{ok, storage, environments, listeners}` |

### Mock API (client apps) [M]

- **One listener per environment**, on `env.port`, HTTPS if `tlsOptions.enabled`. Path = `endpointPrefix` + route pattern. This is exactly how Mockoon desktop/CLI behaves — a client app points at `http://server:3001/...`.
- Unknown path → **404** (or proxy if enabled). Unknown method → **404** (§2.14). Every call logged (§2.6).
- Convenience path routing (optional, `PATH_ROUTING=true`): also serve `ANY /mock/:uuid/*` on the main port for setups where opening many ports is impractical. Mockoon-parity serving remains the default.

---

## 7. Frontend build plan — Angular, component by component (BEM + SCSS)

### 7.1 Conventions

**BEM.** Block = component name; `.mock-app`, `.env-sidebar`, `.route-editor`; elements `__`, modifiers `--`. One component = one block; co-located SCSS with nesting; no cross-block styling; snapshot/lint check on class prefixes.

**Design tokens** (global SCSS, imported once):

```scss
$color-bg: #0f172a; $color-surface: #1e293b; $color-text: #e2e8f0;
$color-primary: #38bdf8; $color-danger: #f87171; $color-success: #34d399;
$radius-sm: 4px; $radius-md: 8px;
$space-1: 4px; $space-2: 8px; $space-3: 12px; $space-4: 16px; $space-6: 24px;
$font-mono: 'JetBrains Mono', monospace;
```

Components reference tokens only — no raw hex in component files. (Theme matches Mockoon's dark UI for familiarity.)

**State.** `EnvironmentsStore` (signals): `list`, `current: Environment | null`, `savedVersion`, `dirty`, `saving`, `saveError`, `conflictInfo`. Mutations mutate `current`; save = `PUT {version, environment}`; 409 → surface the conflict message with who/when; success → update `savedVersion`.

**HTTP.** `MockApiClient` wraps `HttpClient` with the JWT interceptor.

### 7.2 App shell

```javascript
app/
  app.component.*                 # .mock-app — shell: header (env switcher) + tabs + save bar
  app.routes.ts / app.config.ts
  core/
    environments.store.ts
    mock-api.client.ts
    auth.store.ts                 # token, user, role guards
  shared/
    components/ kv-list, rule-editor, modal, toast, empty-state, spinner, tag-input,
                  faker-helper-picker, template-hint
    pipes/ elapsed-time.pipe
    utils/ uuid.ts, download.ts
```

### 7.3 Component-by-component build order (bottom-up)

**F1 — Project + design system.** `ng new sahayak --style=scss --routing`; tokens + base; `spinner`, `empty-state`. *Done:* styled shell on `ng serve`.

**F2 — Auth screens.** `login`, route guards by role, JWT interceptor, 401 → login redirect. *Done:* unauthenticated users can't reach `/api/*`.

**F3 — `kv-list`** (headers editor). Two-way `itemsChange`. *Done:* add/edit/remove header rows.

**F4 — `rule-editor`.** Row: target select (body/query/params/headers/cookie/global_var/request_number/data_bucket), property (+ modifier for data_bucket), **invert toggle**, operator select (full Mockoon operator list), value input (with templating allowed + helper picker button). Logic AND/OR per response. *Done:* round-trips `RouteRule[]`.

**F5 — `faker-helper-picker` + `template-hint`.** A searchable cheat-sheet panel (grouped: request, data, faker aliases) that inserts helpers at the cursor in any textarea. *Done:* users never need to memorize helper names.

**F6 — Store + API client.** Load env list, load env, save with version, conflict handling, duplicate, delete. *Done:* `dirty` tracking + 409 surfacing works.

**F7 — `env-sidebar`.** Env list (name, port, lock state), select/create/duplicate/delete, import/export buttons. *Done:* drives everything else.

**F8 — `route-list`.** Routes in declaration order: method badge / `CRUD` badge, endpoint, default-response status, drag-to-reorder, add HTTP route, add CRUD route, duplicate, delete, "rules disabled" toggle, response-mode select (rules/random/sequential). *Done:* order mutations mark dirty.

**F9 — `route-editor`.** Endpoint path, method, documentation; CRUD routes show the linked-bucket selector instead. *Done:* metadata edits mark dirty.

**F10 — `response-list` + `response-editor`.**

- `response-list`: responses in order; default flag radio (exactly one); add/duplicate/delete/reorder.
- `response-editor`: label, status code, latency (ms), headers (`kv-list`), body-type selector (`INLINE` | `FILE` | `DATA` | `NONE`) switching the editor: INLINE → monospace textarea with template hint + helper picker + "preview render" button (calls a `POST /api/preview-template` endpoint); FILE → path input (templated); DATA → bucket select; rules tab (`rule-editor`). *Done:* full Mockoon response editing parity.
- **Preview endpoint** `[S helper]**: `POST /api/environments/:uuid/preview-template` renders a template against a sample request → catches helper typos without hitting the mock.

**F11 — Data & globals screens.** `data-bucket-list` + `data-bucket-editor` (name, content textarea with helper picker, JSON parse indicator, "reset runtime state" button); `global-vars-panel` (list current vars, reset). *Done:* buckets usable by CRUD routes and `{{data}}`.

**F12 — `env-settings` modal.** name, port, endpointPrefix, default headers (`kv-list`), proxy (mode/host/removePrefix), TLS (enabled, cert/key paths), danger zone. Listener restart feedback when port/TLS changes. *Done:* settings apply on save.

**F13 — `log-viewer`.** Polled (5 s), per-env filter, method/path/status/latency table, expandable detail (headers redacted view, bodies truncated note), clear button, pause/resume. *Done:* live requests appear.

**F14 — Save bar + shell wiring.** "Unsaved changes" pill, Save (PUT), Discard (reload env), conflict banner (who/when + "reload latest" / "discard mine"). *Done:* the full loop: load → edit → save → hit the mock → see logs.

**F15 — Import/export screens.** Import dialog (Mockoon JSON / OpenAPI file → preview → import); export button (download). *Done:* round-trip with Mockoon desktop verified.

### 7.4 Frontend testing

- Unit: components render + events; store actions incl. 409 flow.
- e2e (Playwright): login → create env → add route → edit body with `{{faker}}` → save → `curl` the mock port → verify templated body → see it in logs → export → open in Mockoon desktop (manual check, scripted where possible).

---

## 8. Backend build plan — Node.js + MongoDB, step by step

**B1 — Scaffold.** TS strict, ESLint/Prettier; deps `express mongoose handlebars @faker-js/faker dotenv jsonwebtoken bcryptjs`; dev `tsx vitest supertest @types/*`. `config.ts` pure env loading; `server.ts` wiring. *Done:* `npm run dev` connects Mongo, hello route.

**B2 — DB layer.** `connectMongo`, `registerModels`: Environment (+ unique uuid, `version`), User, capped logs. *Done:* round-trip a doc in a throwaway DB.

**B3 — Pure mock engine (no I/O, fully unit-tested before wiring).**

- `matcher.ts` — segments, precedence (exact > `:param` > `*`), declared-order tiebreak, prefix stripping, decoding.
- `rules.ts` — all targets (body/query/params/headers/cookie/global_var/request_number/data_bucket), full operator set with `invert`, AND/OR, empty-rules-never-match, first-match walk, templated rule values.
- `templating.ts` — Handlebars instance factory, all request/data/faker helpers + aliases, `repeat`/`switch` block helpers, escaping rules, prototype-pollution guards, 5 s render budget, error → empty-string policy. **This is the largest engine module; port Mockoon's helper semantics from its docs/tests, don't improvise.**
- `crud.ts` — the §2.5 operation matrix over bucket runtime state, id autogen (uuid vs auto-increment vs template-detected), filter/sort/pagination operators.
- `buckets.ts` — generation (template → parse → cache), `setData` mutations, global vars (`setVar`/`globalVar`), reset.
- `responder.ts` — response selection algorithm (§2.3), bodyType dispatch, latency, CORS headers.
- `proxy.ts` — env/route forwarding with prefix handling, timeout, error mapping.
- *Done:* **every engine function green in unit tests** — matcher, rules, templating, CRUD matrix, buckets, responder. Highest-value test surface in the project.

**B4 — Storage.** `StorageBackend` interface; `MongoStorage` (loadAll, get, save with version check + `replaceOne`, delete, duplicate, capped-log writer/reader/clear); `FileStorage` dev fallback (one JSON file per env in `DATA_DIR`, still Mockoon format). *Done:* round-trip + version-conflict tests pass.

**B5 — Store.** In-memory snapshot: envs, per-env bucket runtime state, global vars, per-env listener configs. `saveEnvironment(uuid, version, doc)` → check version → apply → persist (awaited) → bump version → notify listeners. Rollback on persist failure. *Done:* concurrent-save test: two writers, second gets 409, state intact.

**B6 — Listeners.** `listeners.ts`: open/close/reload an HTTP(S) server per env on port/TLS/endpointPrefix changes; shared request pipeline (parse body by content-type → match → rules → CRUD/proxy/response → templating → latency → send → log). Port-conflict handling (409-style error surfaced in UI on save). *Done:* two envs on two ports serve independently.

**B7 — HTTP config API + auth.** `/api/auth/*`, `/api/environments*` (§6), `/api/logs`, `/api/status`, `/api/import`, `/api/export`, `/api/preview-template`. Role middleware. Body limits, strict CORS for `/api`. *Done:* supertest e2e of every endpoint incl. roles and 409s.

**B8 — e2e mock tests.** create env via API → hit its port: templated INLINE body, FILE response, DATABUCKET response, ruled response selection (order + AND/OR + invert), random/sequential modes, CRUD full matrix, proxy fallback, 404s, CORS preflight, latency, log redaction, restart persistence (envs persist, bucket state resets — Mockoon behavior). *Done:* green suite.

**B9 — Production build.** `ng build` → static dir served by Express; backend bundled with esbuild (`--packages=external`); one Dockerfile; `.dockerignore`; Nginx/Caddy in front for the editor HTTPS; mock ports published separately (§14.1); compose file. *Done:* `docker compose up` → editor + mocks.

---

## 9. Test strategy

| Layer | Tool | What |
| --- | --- | --- |
| Engine | unit | matcher precedence & ties; every rule operator × invert × target; templating helpers (escaping, defaults, subexpressions, repeat/switch); CRUD matrix incl. id strategies & query operators; response-mode algorithm; bucket mutation helpers. |
| Storage | integration | round-trip; version conflicts; capped logs. |
| HTTP API | e2e | auth/roles, env CRUD, 409 flow, import/export. |
| Mock serving | e2e (real ports) | §8 B8 checklist. |
| Parity | golden files | canned Mockoon export files import → serve → byte-compare responses against Mockoon CLI outputs for the same requests. |
| Frontend | unit + Playwright | §7.4. |

**Rule:** engine and templating are fully unit-tested *before* HTTP wiring.

---

## 10. Phased delivery

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| **0. Foundation** | Scaffold, DB, pure engine (matcher, rules, templating, CRUD, buckets), auth. | Engine + templating green in CI. |
| **1. Core loop** | Storage, Store, listeners, HTTP APIs, editor F1–F14. | Build a mock in the UI, save, `curl` it, see rules/templating/latency work, view logs. |
| **2. Parity completeness** | CRUD UI, data buckets UI, global vars, proxy mode, file responses, TLS, response modes, import/export (Mockoon + OpenAPI), preview-template. | A real Mockoon environment file imports and behaves identically; export reopens in Mockoon desktop. |
| **3. Harden** | Rate limiting on `/api`, body/log caps, template security audit, listener timeout soak, docs. | Broken env/port conflict can't take down others. |
| **4. Deploy** | Docker, HTTPS, CI/CD, admin/user docs. | `docker compose up`; teammate imports mocks and uses them. |

**Explicitly out of scope (v1+):** live collaborative editing/presence, WebSocket mocking (Mockoon v9 feature), callbacks/webhooks (Mockoon Enterprise feature), Mockoon Cloud-style quotas, multi-replica bucket state sharing, OpenAPI *export* fidelity beyond Mockoon's own level.

---

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Handlebars is not a sandbox (biggest new attack surface vs. old spec) | §2.11 guards: no runtime helpers/eval, fresh instance per render, prototype-pollution path filtering, render timeout, pinned deps, security-audit step in Phase 3. |
| Concurrent editors clobber each other | Whole-doc saves + version locking + 409 conflict UX (§4.3). |
| Per-env port model vs. corporate firewalls | `PATH_ROUTING=true` fallback (§6); document both. |
| Bucket/global-var state is in-memory → lost on restart / single replica | Accepted Mockoon behavior (state resets on restart); documented. Multi-replica would need Redis — out of scope. |
| Port conflicts between envs or with host services | Save-time validation + listener error surfaced in UI; suggest port in create flow. |
| Whole-env save payload grows | Tens of KB typical; reintroduce op-diffing later behind same API if ever needed. |
| Log bodies contain secrets | Header redaction always; body logging toggle per env; truncation caps. |
| Mockoon schema evolves | `mockoon-schema.ts` versioned; parity tests pin behaviors, not bytes. |

---

## 12. Open decisions (answer before Phase 1)

1. **Hosting topology** — single VM + Docker? Kubernetes? (Decides whether per-env ports are practical or `PATH_ROUTING` becomes primary.)
2. **Port strategy** — real per-env ports (Mockoon-exact) vs. path routing (`/mock/:uuid/*`) as the primary client-facing mode? (§14.1 discusses the trade-off; default: real ports.)
3. **TLS strategy** — per-env certs (Mockoon-style, cert files in `DATA_DIR`) vs. one wildcard cert at the reverse proxy for path routing?
4. **Auth** — email/password (spec'd) vs. company SSO/OIDC from day one? If OIDC is required, Phase 0 must know.
5. **Existing mocks** — do we have Mockoon files to import on day one? (Validates the parity claim immediately.)

---

## 13. Definition of done

- [ ] A teammate opens the editor in a browser, logs in, and creates an environment → route → response.
- [ ] A client app calling the env's port gets a templated (`{{faker}}`, `{{queryParam}}`, …), rule-matched, latency-simulated response — indistinguishable from Mockoon.
- [ ] CRUD route over a data bucket: full create/read/update/delete/filter/pagination cycle works.
- [ ] Proxy mode forwards unmatched routes to a real API.
- [ ] Random and sequential response modes behave per Mockoon.
- [ ] Mockoon JSON export from Sahayak opens unchanged in Mockoon desktop, and vice versa (verified manually + golden-file tests).
- [ ] Two editors: second save gets a clear 409 "changed by X at Y — reload" message.
- [ ] Request logs appear (sensitive headers redacted), survive restart, and can be cleared/filtered.
- [ ] Restarting the server reloads all environments from MongoDB; bucket state resets (Mockoon semantics).
- [ ] Engine + templating unit tests green; HTTP + mock e2e green.
- [ ] `docker compose up` behind HTTPS serves editor + mock endpoints.

---

## 14. Mockoon parity reference & deviation log

| # | Topic | Mockoon behavior | Sahayak decision |
| --- | --- | --- | --- |
| 1 | Serving | One server per env on `env.port` | **Same** — listeners per env; path routing available as opt-in fallback for restricted networks. |
| 2 | Templating | Handlebars + Faker.js + custom helpers | **Same** (§2.11), plus render hardening. |
| 3 | Rules | Targets incl. cookie/global var/data bucket/request number; invert toggle; AND/OR per response; first match in order | **Same** (§2.3). |
| 4 | CRUD routes | Operation matrix, id strategies, query operators | **Same** (§2.5). |
| 5 | Data buckets / global vars | Templated at generation; in-memory runtime state; reset on restart | **Same** (§2.10). |
| 6 | Proxy | Env proxy fallback + route-level proxy | **Same** (§2.8). |
| 7 | Response modes | Rules (default) / RANDOM / SEQUENTIAL, per route | **Same** (§2.3). |
| 8 | Response body | INLINE / FILE / DATABUCKET / NONE; latency per response | **Same** (§2.4). |
| 9 | No-match behavior | 404 (+ proxy if enabled) | **Same**; old spec's 405 method-fallback **removed** (§2.14). |
| 10 | Request validation → 400 | Does not exist | **Removed** (§2.12); schema-in-bucket + rules is the Mockoon way. |
| 11 | Persistence | Whole environment JSON file, last-write-wins | **Whole environment document + version lock + 409** (§4.3). |
| 12 | Logs | In-memory desktop logs | **MongoDB capped collection**, redaction, truncation (§2.6). |
| 13 | Multi-user / auth | None (desktop) / Cloud accounts | **Email/password + roles from v1** (§2.7). |
| 14 | FILE responses | Path on user's machine | **Relative to server `DATA_DIR`** (§1, deviation 2). |
| 15 | Import/export | Mockoon JSON, OpenAPI/Swagger | **Same formats**, byte-compatible (§2.13). |
| 16 | WebSocket mocking (v9) | Supported | **Out of scope.** |
| 17 | Callbacks | Enterprise feature | **Out of scope.** |