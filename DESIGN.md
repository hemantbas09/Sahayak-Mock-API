# Sahayak — Team Mock API Platform

**One document: what the project is, what it does, and exactly how to build it — step by step.**

Stack: **Angular** (frontend, BEM + SCSS) · **Node.js + Express** (backend) · **MongoDB** (storage).

This document is the single source of truth. If a decision isn't written here, it isn't decided yet.

---

## 1. What this project is

Sahayak is a **self-hosted, team-shared mock API server**.

Think of it as a web app where:

- A team of developers keeps their API mocks (environments → routes → responses) in **one shared place** on a server, not in local files.
- Anyone with access opens the editor in a browser, edits a mock, and saves it to the server.
- Other teammates see the change **the next time they open/reload the page** (reload-to-sync; no live websockets in v1).
- Real client applications (mobile apps, frontends, scripts) call the mock endpoints over HTTP and get fast, realistic, templated responses.
- The server can **validate incoming request payloads** against a schema and report exactly what failed.

### Why it exists

Desktop mock tools (Postman mocks, Mockoon desktop, etc.) store data on one machine. A team can't share them, can't see what a teammate changed, and can't point a shared test environment at them. Sahayak moves the whole thing to a server + database so the team works from one source of truth.

### The two audiences

| Audience | What they use |
|---|---|
| **Team members** (humans) | The Angular editor UI: create/edit environments, routes, responses, rules, headers, validation; view request logs. |
| **Client apps** (code) | The mock HTTP endpoints: `GET/POST/... /mock/<environment>/<path>` return the configured response (templated, rule-matched, latency-simulated). |

Both audiences hit the **same backend**. The editor uses a small configuration API; client apps use the mock endpoints.

---

## 2. Full feature list

### 2.1 Core mocking engine (the heart of the app)

- **Environments** — a named group of routes. Each has:
  - `name`, a unique `id`, an optional `endpointPrefix` (stripped before matching), a default `port` label, a global `latency` (fallback delay in ms), and a list of default response `headers`.
- **Routes** — one HTTP method + path pattern. Supports:
  - Path parameters: `GET /users/:id`
  - Trailing wildcard (catch-all): `GET /files/*`
  - Middle wildcard (single segment): `GET /a/*/c`
  - Universal `*` matches anything.
  - Case-insensitive matching, trailing-slash tolerant.
  - Per-route `latency` (overrides the environment default).
- **Responses** — each route has one or more responses. One is the **selected (default)** response. Others are **conditional** and only served when their **rules** match.
  - Each response has: `statusCode`, a `label`, `headers` (key/value list), a `body` (string, templated), a `rules` array, a `rulesOperator` (`AND`/`OR`), and an optional **validation schema** with an on/off switch.
- **Rule matching** — a rule checks one part of the incoming request. Targets: `header`, `query`, `body`, `route_param`. ~25 operators, e.g.:
  - `equals`, `not_equals`, `contains`, `not_contains`, `regex`
  - `null`, `not_null`
  - type checks: `is_string`, `is_number`, `is_boolean`, `is_array`, `is_object` (and their `not_` forms)
  - `has_property`, `missing_property`, `body_required`, `body_empty`
  - `is_optional_string`, `is_optional_number`, `is_optional_boolean`
  - Rules combine with `AND` or `OR`. **An empty rule list never matches** (so a response with no rules is only the default when selected).
- **Template variables** — response bodies and headers support tags:
  - `{{query name "default"}}` — value from the query string
  - `{{body user.name "default"}}` — dot-path into the request body
  - `{{header x-token "default"}}` — request header (case-insensitive)
  - `{{param id "default"}}` — captured route parameter
  - `{{uuid}}` — fresh UUID v4
  - `{{randomInt 1 100}}` — random integer in range
  - `{{date iso}}` | `{{date utc}}` | `{{date time}}`
  - Unknown tags are left untouched. **No arbitrary code execution** — a fixed helper whitelist only.
- **Latency simulation** — per-environment and per-route delay before the response is sent.

### 2.2 Payload validation

- Each response can carry a **request schema** describing the expected body.
- Two accepted schema shapes:
  - A **TypeScript interface** string (parsed line-by-line): `interface Pay { cardId: string; amount: string }`
  - A **JSON object** where keys are property names and values are type words (`"string"`, `"number"`, `"boolean"`), with `?`-suffixed keys for optional properties.
- The validator returns `{ valid, errors[] }` where each error names the field, the expected type, and what was received.
- `GET` requests never validate.
- When validation fails, the mock responds **400** with a structured error listing each failing field.
- (v1.5) Per-route modes: **Off / Warn / Strict** — Warn logs the failure but still returns the normal mock; Strict returns 400.

### 2.3 Request logs

- Every mock request is logged: timestamp, environment, method, URL, client IP, request headers (sensitive ones redacted), query params, body, response status, response headers, response body, which route matched, and actual latency.
- **Sensitive header redaction** — `authorization`, `cookie`, `x-api-key`, and any header matching `/token|secret|password|api[-_]?key/i` are stored as `[redacted]`.
- The editor shows a live-ish log panel (polled, not streamed, in v1).

### 2.4 Save protocol (the important part)

**Editing one response body must send only that response — not the whole file.** This is the core requirement.

- The client keeps a `saved` snapshot and a `current` snapshot in memory.
- On save, it computes a **list of minimal "ops"** (the diff) and sends only those.
- The server applies the same **pure reducer** to its in-memory snapshot, then persists **only the touched entities** to MongoDB.
- Ops are versioned. Current protocol version: `1`.

| Op type | Payload | Meaning |
|---|---|---|
| `env.upsert` | `env` | Create or update an environment |
| `env.delete` | `id` | Delete an environment (cascades to its routes/responses) |
| `env.reorder` | `order[]` | Reorder environments by id |
| `route.upsert` | `envId`, `route` | Create or update a route |
| `route.delete` | `envId`, `id` | Delete a route (cascades to responses) |
| `route.reorder` | `envId`, `order[]` | Reorder routes within an environment |
| `response.upsert` | `envId`, `routeId`, `response` | Create or update a response |
| `response.delete` | `envId`, `routeId`, `id` | Delete a response |
| `response.reorder` | `envId`, `routeId`, `order[]` | Reorder responses within a route |

**Rules the protocol must obey (invariants):**
1. Editing exactly one endpoint's body ⇒ **exactly one `response.upsert`** on the wire.
2. Reorder ops are only emitted when the *set* of ids is unchanged but the *order* changed. When ids were added/removed, upserts/deletes already cover it — no reorder op.
3. A reorder op's `order` must list **every existing id exactly once**.
4. When a child is created, its parent's upsert is in the same batch, so the server never has to invent a missing parent.
5. Deleting a parent expands into all child paths **before** applying, using the pre-update snapshot (so the backend knows what to delete).
6. `buildOps` (client diff) and `applyOps` (server reducer) live in **one shared module** so the two sides can never drift.
7. An unknown parent reference is a **hard error** (rejected), never a silent drop.

The server save is a **synchronous acknowledgement**: it applies the ops, returns `{ success, applied }` immediately. No silent background queue that pretends success.

### 2.5 Team features (v1.5, layered on the same engine)

- **Auth + roles** — email/password login; roles `admin`, `editor`, `viewer`. Permission check on every configuration endpoint.
- **Workspaces** — group environments for teams/projects.
- **Stale-edit protection** — the client sends the version it loaded; if the server version changed in the meantime, the save is **rejected** with "This was changed by someone else — reload to see the latest," including who changed it and when.
- **Version history + rollback** — a snapshot is stored on every save; admins can roll back.
- **Audit log** — who changed what, and when.
- **Mockoon JSON import/export** — convert existing Mockoon environment files in and out (the engine already understands the format).

> v1 deliberately excludes: live/websocket sync, presence indicators, concurrent-edit merging, multi-company tenancy, billing, mobile-only UI.

### 2.6 Non-functional features

- **CORS done right** — `Access-Control-Allow-Credentials: true` is only sent together with a **concrete** origin (never with `*`). Preflight handled via explicit headers.
- **Method fallback** — a request with the wrong method returns **405** with `X-Mock-Method-Fallback: true` and an `X-Mock-Warning`, and includes the method-mismatch details in the body.
- **Size limits** — request bodies capped (e.g. 50mb).
- **Unknown environment** → 404. **Unknown path** → 404. **Unknown method** → 405.
- **Health endpoint** — `GET /api/status` returns ok, storage backend name, and environment count.

---

## 3. Technology decisions

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **Angular** | Team requirement; component model fits the nested environment/route/response editor. |
| Frontend styling | **SCSS + BEM** | Team requirement; BEM keeps a large component tree consistent and debuggable. |
| Language | **TypeScript** end-to-end | Shared types between client and server; the op-protocol reducer can be shared. |
| Backend | **Node.js + Express** | Same language as the frontend; mature, simple, enough for this scale. |
| Database | **MongoDB** | Team requirement; documents map naturally to environment/route/response. |
| ODM | **Mongoose** | Schemas, indexes, and connection management for MongoDB. |
| Build (frontend) | **Angular CLI** + **esbuild/vite** where useful | Standard tooling. |
| Tests | **Jest/Vitest** (unit) + **Supertest** or raw `fetch` (e2e) | Unit-test the pure engine; e2e the HTTP API. |
| Deployment | **Docker** (one image: server + built Angular static) behind **Nginx/Caddy** with HTTPS | Simple to run internally. |

---

## 4. Architecture

```
                        ┌──────────────────────────────────────────────┐
   Browser (Angular)    │              Node.js (Express)               │
  ┌──────────────────┐  │  ┌────────────────────────────────────────┐  │
  │  Editor UI        │  │  │  Configuration API  /api/*            │  │
  │  (BEM + SCSS)     │──┼──┤    environments, logs, status, auth   │  │
  └──────────────────┘  │  └───────────────┬────────────────────────┘  │
                        │                  │                            │
  Client apps ──────────┼──► Mock engine   │  Store (in-memory snapshot)│
  (mobile/web/scripts)  │  /mock/:env/*    │   applies ops, serves data │
                        │                  │                            │
                        │                  ▼                            │
                        │        Storage backend (MongoStorage)         │
                        │                  │                            │
                        └──────────────────┼────────────────────────────┘
                                           ▼
                                     ┌───────────┐
                                     │  MongoDB  │
                                     └───────────┘
```

Key properties:
- **The in-memory snapshot is the source of truth at runtime.** Mock endpoints read from memory (fast, no DB hit per request). The DB is the durable copy, written only for touched entities.
- **The mock engine is pure.** Matching, rules, templates, and validation are pure functions that take data in and return a result — trivially unit-testable, no I/O.
- **The op-protocol reducer is shared** between client (diff) and server (apply).

### 4.1 Backend module map

```
server/
  server.ts            # entry: config -> db -> store -> http (wiring only)
  app.ts               # createApp(store, logs, storageName) -> Express app (testable, no port)
  config.ts            # loadConfig() reads env; side-effect free
  state.ts             # Store: holds snapshot, applyOps(), persists touched
  logs.ts              # LogBuffer (ring buffer, redaction)
  api.ts               # /api routes + createMockHandler (the mock endpoints)
  mock/
    matcher.ts         # matchPath, findMatchingRoute, findAnyMethodRoute
    rules.ts           # getNestedValue, evaluateRules
    templates.ts       # parseTemplate
    validation.ts      # validateBody (TS interface / JSON schema)
    responder.ts       # resolveMockResponse (pure) + findEnvironment, stripPrefix, CORS
  storage/
    index.ts           # StorageBackend interface, Touched, parseTouchedPath
    mongoStorage.ts    # MongoStorage (primary)
    fileStorage.ts     # FileStorage (optional local fallback, dev convenience)
db/
  mongodb.ts           # connectMongo(uri) -> mongoose Connection, maskMongoUri
  models.ts            # Mongoose schemas + registerModels(conn)
lib/
  ops.ts               # buildOps(), applyOps(), shared types, OPS_PROTOCOL_VERSION
  types.ts             # MockEnvironment / MockRoute / RouteResponse / RequestLog / ...
```

### 4.2 Frontend module map (Angular)

See **Section 7** for the component-by-component breakdown.

---

## 5. Data model (MongoDB)

Three flat collections. Documents are written with `replaceOne({ upsert: true })` against unique keys, so a save touches **exactly** the entities that changed.

### `environments`
| Field | Type | Notes |
|---|---|---|
| `envId` | string | **unique** — the app-generated environment id |
| `name` | string | |
| `endpointPrefix` | string | |
| `port` | number | label only |
| `latency` | number | default delay ms |
| `headers` | `{id,key,value}[]` | default response headers |
| `position` | number | order among environments |
| `routeCount` | number | denormalized counter |
| `schemaVersion` | number | current 1 |
| `updatedAt` | string (ISO) | |

Index: `{ envId: 1 }` unique.

### `routes`
| Field | Type | Notes |
|---|---|---|
| `envId` | string | |
| `routeId` | string | |
| `method` | string | |
| `endpoint` | string | path pattern |
| `description` | string | |
| `latency` | number | |
| `selectedResponseId` | string | |
| `responseCount` | number | denormalized |
| `position` | number | order within env |
| `schemaVersion` | number | |
| `updatedAt` | string | |

Index: `{ envId: 1, routeId: 1 }` unique.

### `responses`
| Field | Type | Notes |
|---|---|---|
| `envId` | string | |
| `routeId` | string | |
| `responseId` | string | |
| `statusCode` | number | |
| `label` | string | |
| `headers` | `{id,key,value}[]` | |
| `body` | string | templated |
| `rules` | `{id,target,property,operator,value}[]` | |
| `rulesOperator` | `AND`/`OR` | |
| `validationInterface` | string? | |
| `validationEnabled` | boolean? | |
| `position` | number | order within route |
| `schemaVersion` | number | |
| `updatedAt` | string | |

Index: `{ envId: 1, routeId: 1, responseId: 1 }` unique.

### Why flat, not nested?

A nested single-document-per-environment model is easier to read but breaks the core requirement: editing one response would rewrite the whole environment document (and contend with concurrent edits). Three flat collections let a `response.upsert` write **one small document**. `loadAll()` re-nests them by querying in `position` order.

### IDs

All ids are **app-generated prefixed strings** (`env-…`, `route-…`, `resp-…`, `h-…`, `rule-…`), created on the client. They are safe to use as the unique keys (they're never ObjectId-shaped).

---

## 6. API design (REST)

### Configuration API (used by the editor)

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/environments` | — | `MockEnvironment[]` (the full nested snapshot) |
| `POST` | `/api/environments` | `{ version, ops[] }` | `{ success: true, applied: n }` (synchronous) or `400` on malformed ops |
| `GET` | `/api/logs` | — | `RequestLog[]` (most recent first, capped) |
| `DELETE` | `/api/logs` | — | `{ success: true }` |
| `GET` | `/api/status` | — | `{ ok, storage, environments }` |

(v1.5) Add `/api/auth/*` (login, me), `/api/workspaces`, and version/rollback endpoints. Every config endpoint checks the caller's role.

### Mock API (used by client apps)

| Method | Path | Behavior |
|---|---|---|
| `ANY` | `/mock/:envId/*` | Match the environment (by id or slug), strip `endpointPrefix`, find a route + response, run rules/validation/templates/latency, return the mocked response. Logs every call. |
| `ANY` | `/mock/:envId` | Same, with an empty path segment. |

Mock response semantics:
- Unknown environment → **404**.
- No matching path → **404**.
- Path matches but method differs → **405** + `X-Mock-Method-Fallback: true` + `X-Mock-Warning`, body includes the method-mismatch info.
- A response with matching rules wins over the selected default.
- Validation failure (when enabled) → **400** with the structured error list.
- Requested `Content-Type` honored from the response headers (default JSON).

---

## 7. Frontend build plan — Angular, component by component (BEM + SCSS)

### 7.1 Conventions (agree on these before writing a single component)

**BEM.** Every component's styles use Block__Element--Modifier.
- Block = the component name, kebab-case: `.mock-app`, `.env-sidebar`, `.route-editor`.
- Element = `__`: `.route-editor__header`, `.route-editor__endpoint`.
- Modifier = `--`: `.route-editor__endpoint--invalid`, `.btn--primary`, `.log-row--error`.
- One component = one block. Elements/modifiers only live inside that block's file. No styling across blocks.

**SCSS structure per component** (co-located, partials):
```
src/app/features/environments/
  route-editor/
    route-editor.component.ts
    route-editor.component.html
    route-editor.component.scss   # .route-editor { ... }
    route-editor.component.spec.ts
```
In the SCSS, use nesting to express BEM:
```scss
.route-editor {
  &__header { ... }
  &__endpoint {
    &--invalid { ... }
  }
  &__actions { ... }
}
```

**Design tokens** (global SCSS, imported once in `styles.scss`):
```scss
// styles/_tokens.scss
$color-bg: #0f172a;
$color-surface: #1e293b;
$color-text: #e2e8f0;
$color-primary: #38bdf8;
$color-danger: #f87171;
$color-success: #34d399;
$radius-sm: 4px;
$radius-md: 8px;
$space-1: 4px; $space-2: 8px; $space-3: 12px; $space-4: 16px; $space-6: 24px;
$font-mono: 'JetBrains Mono', monospace;
```
Components reference tokens only — never raw hex in a component file.

**State.** One `EnvironmentsStore` (Angular `signal`-based or a lightweight `BehaviorSubject`) holds:
- `saved: MockEnvironment[]` (last known-good from the server)
- `current: MockEnvironment[]` (what the UI is editing)
- `dirty` (derived: `current !== saved`)
- `saving`, `saveError`

All mutations go through the store's action methods, which mutate `current`. Saving is: `buildOps(saved, current)` → `POST /api/environments` → on success set `saved = current`.

**HTTP.** A thin `MockApiClient` service wraps `HttpClient`: `fetchEnvironments`, `saveOps`, `fetchLogs`, `clearLogs`, `status`.

### 7.2 App shell (top-level layout)

```
app/
  app.component.ts/html/scss          # .mock-app  — three-column shell
  app.routes.ts                       # lazy routes
  app.config.ts                       # provideRouter, provideHttpClient
  core/
    environments.store.ts             # the single source of truth
    mock-api.client.ts                # HttpClient wrapper
    op-protocol/                      # shared lib/ops ported to Angular (or an npm-internal package)
      ops.ts
  shared/                             # dumb, reusable, no business logic
    components/
      kv-list/                        # .kv-list — add/remove/edit key-value rows
      rule-editor/                    # .rule-editor — build a RouteRule row
      tag-input/                      # .tag-input
      modal/                          # .modal — confirm + alert dialogs
      toast/                          # .toast
      empty-state/                    # .empty-state
      spinner/                        # .spinner
    pipes/
      elapsed-time.pipe.ts
    utils/
      id.ts                           # prefixed id generator
      slugify.ts
```

### 7.3 Component-by-component build order

Build **bottom-up**: shared leaf components first, then feature panels, then the shell. Each step has a concrete "done" check.

**Step F1 — Project + design system**
- `ng new sahayak --style=scss --routing`, add `@angular/*` dev deps.
- Create `styles/_tokens.scss`, `styles/_base.scss`, import in `styles.scss`.
- Build `spinner` and `empty-state` (no logic — pure presentation).
- *Done:* `ng serve` shows the base page styled with tokens.

**Step F2 — `kv-list` component**
- Inputs: `items: KeyValue[]`, `placeholder`; outputs: `itemsChange` (two-way via `@Input` + `@Output`, or `ControlledComponent`).
- BEM: `.kv-list__row`, `.kv-list__key`, `.kv-list__value`, `.kv-list__remove`.
- *Done:* can add, edit, remove header rows; used in a scratch component.

**Step F3 — `rule-editor` component**
- Inputs: `rules: RouteRule[]`, `operator: AND|OR`; outputs on change.
- Row: target select (header/query/body/route_param), property input, operator select (all 25), value input.
- BEM: `.rule-editor__row`, `.rule-editor__target`, `.rule-editor__operator`, `.rule-editor__value`, `.rule-editor__logic`.
- *Done:* build AND/OR rules visually; round-trips to a `RouteRule[]`.

**Step F4 — `modal` + `toast`**
- `modal`: `open`, `title`, `message`, `confirmLabel`, `cancelLabel`; `confirmed`/`cancelled` outputs. BEM `.modal`, `.modal__overlay`, `.modal__dialog`, `.modal__actions`.
- `toast`: transient success/error, auto-dismiss. BEM `.toast`, `.toast--error`.
- *Done:* confirm-delete flow works end to end.

**Step F5 — The store + API client + op protocol**
- Port the shared `ops.ts` (buildOps/applyOps) and `types.ts` into `app/core`.
- Implement `EnvironmentsStore` (signals) and `MockApiClient`.
- *Done:* store can load environments from a running backend and report `dirty`.

**Step F6 — `env-sidebar` (left column)**
- Lists environments; select one; create/duplicate/delete/reorder (up/down).
- BEM: `.env-sidebar`, `.env-sidebar__item`, `.env-sidebar__item--active`, `.env-sidebar__actions`.
- *Done:* selecting an env drives the middle column; create/delete update the store.

**Step F7 — `route-list` (middle column)**
- Lists the selected env's routes: method badge, endpoint, selected-response status, latency.
- Add/duplicate/delete/reorder routes.
- BEM: `.route-list`, `.route-list__item`, `.route-list__method--get`, `.route-list__endpoint`.
- *Done:* manage routes visually.

**Step F8 — `route-editor` (right column, top)**
- Edits the selected route: method, endpoint, description, latency, selected response id.
- Embeds `kv-list` for env default headers (in env settings, not here).
- BEM: `.route-editor`, `.route-editor__field`, `.route-editor__field--invalid`.
- *Done:* edit route metadata; `dirty` reflects.

**Step F9 — `response-list` + `response-editor` (right column, bottom)**
- `response-list`: select among a route's responses, mark selected, add/delete.
- `response-editor`: status code, label, headers (`kv-list`), **body** (monospace textarea with template hint), rules (`rule-editor` + logic select), validation schema textarea + enable switch.
- BEM: `.response-editor`, `.response-editor__body`, `.response-editor__validation`, `.response-editor__validation--off`.
- *Done:* edit one response body → store dirty → save sends **exactly one** `response.upsert` (verify in devtools network).

**Step F10 — `log-viewer` (bottom panel or tab)**
- Polls `/api/logs` every 5s; table of requests with method, path, status, latency; row expands to full headers/body; invalid requests highlighted; "Clear" button.
- BEM: `.log-viewer`, `.log-viewer__row`, `.log-viewer__row--error`, `.log-viewer__detail`.
- *Done:* see live mock requests appear; clear works.

**Step F11 — `env-settings` modal + `import-export`**
- `env-settings`: rename env, endpoint prefix, global latency, default headers.
- `import-export`: Mockoon/Postman/OpenAPI import (parse → build envs → add via ops), JSON export (download snapshot).
- BEM: `.env-settings`, `.import-export`, `.import-export__dropzone`.
- *Done:* import a Mockoon file and see it as a new environment.

**Step F12 — Save bar + shell wiring**
- `save-bar`: "Unsaved changes" state, Save (POST ops), Discard (revert to `saved`), status (stale-edit error in v1.5).
- Wire `app.component` three columns: `env-sidebar` | (`route-list` over `route-editor`+`response-editor`) | `log-viewer`.
- *Done:* the full editor loop works against a real backend: load → edit → save → reload.

**Step F13 — v1.5 team screens**
- `login`, `workspace-list`, `workspace-members`, `version-history` (rollback), `audit-log`.
- Reuse `modal`, `toast`, `kv-list` where sensible.

### 7.4 Frontend testing

- Unit (Jest/Karma or Vitest+Jest-style): each component's render + events; store actions; op protocol (round-trips, single-upsert invariant).
- Component BEM sanity: a lint rule / snapshot test asserting no element outside the component's block prefix.
- e2e (Playwright): log in → create env → add route → edit body → save → reload → still there.

---

## 8. Backend build plan — Node.js + MongoDB, step by step

**Step B1 — Scaffold**
- `npm init -y`, TypeScript config (`strict`), `tsconfig.json`, ESLint + Prettier.
- Deps: `express`, `mongoose`, `dotenv`. Dev: `typescript`, `tsx`, `@types/*`, `jest`/`vitest`, `supertest`.
- `server/server.ts` reads config, connects Mongo, builds store + app, listens.
- `server/config.ts` — pure `loadConfig()` from env: `PORT`, `HOST`, `MONGODB_URI`, `DATA_FILE` (optional file fallback), `APP_URL`.
- `.env.example` committed; `.env` gitignored.
- *Done:* `npm run dev` starts, logs the Mongo connection, serves a hello route.

**Step B2 — DB layer**
- `db/mongodb.ts`: `connectMongo(uri)` returns a standalone `mongoose.Connection`; `maskMongoUri` for logs.
- `db/models.ts`: the three schemas (Section 5) + `registerModels(conn)` (safe to call twice).
- *Done:* scripts can create/read a test doc in a throwaway DB.

**Step B3 — The pure mock engine** (no I/O, fully unit-tested before wiring)
- `mock/matcher.ts` — `matchPath`, `findMatchingRoute`, `findAnyMethodRoute`.
- `mock/rules.ts` — `getNestedValue`, `evaluateRules` (all operators, AND/OR, empty-never-matches).
- `mock/templates.ts` — `parseTemplate` (all tags, unknown untouched).
- `mock/validation.ts` — `validateBody` (TS interface + JSON shapes, `?` optional).
- `mock/responder.ts` — `resolveMockResponse` (pure; returns `response | not_found | method_mismatch | validation_failed`), plus `findEnvironment`, `stripPrefix`, CORS/preflight helpers.
- *Done:* **every engine function has passing unit tests** (matcher, rules, validation, templates, responder). This is the highest-value test surface.

**Step B4 — Storage backends**
- `storage/index.ts`: `StorageBackend` interface, `Touched`, `parseTouchedPath`.
- `storage/mongoStorage.ts`: `loadAll()` (query all three collections in `position` order, re-nest), `save(snapshot, touched)` (delete touched paths, `replaceOne upsert` touched writes).
- `storage/fileStorage.ts`: local JSON fallback (dev convenience / no-Mongo mode).
- *Done:* `MongoStorage` round-trips a snapshot; a save touches only the listed entities (assert doc count changes).

**Step B5 — Shared op protocol**
- `lib/ops.ts`: `buildOps(saved, current)`, `applyOps(state, ops)`, `OPS_PROTOCOL_VERSION`, `stableStringify`, meta helpers.
- `lib/types.ts`: all domain types.
- *Done:* op unit tests — single-body-edit ⇒ exactly one `response.upsert`; round-trips; deletes cascade; reorder invariants; unknown-parent throws.

**Step B6 — `Store` + `logs`**
- `state.ts`: `Store.applyOps` — expand deletes on pre-snapshot → `applyOps` in memory → extract touched → **queued** persist (fire-and-forget, logged on error).
- `logs.ts`: `LogBuffer` (capped ring, ~200), `buildEntry`, redaction list + regex.
- *Done:* applying a batch updates the snapshot and the DB; logs accumulate and redact.

**Step B7 — HTTP layer**
- `api.ts`: `createApiRouter(store, logs)` (GET/POST `/api/environments`, GET/DELETE `/api/logs`) + `createMockHandler(store, logs)` (404/204/405 semantics, logs every request).
- `app.ts`: `createApp(store, logs, storageName)` → Express app with JSON body limits, `/api`, `/api/status`, `/mock/:envId/*`. **No port binding here** so it's testable.
- *Done:* `supertest`/`fetch` e2e — create env via ops, hit mock endpoint, verify templated body, 404/405/validation paths, log redaction, restart persistence.

**Step B8 — Production build**
- Frontend: `ng build` → copy to a static dir.
- Backend: bundle `server.ts` (esbuild, `--packages=external`, CJS) or `tsc`.
- One Dockerfile: Node base → install → build frontend + backend → `CMD node dist/server.cjs`. `.dockerignore`.
- Nginx/Caddy reverse proxy with HTTPS.
- *Done:* `docker compose up` serves the editor + mock endpoints over HTTPS.

---

## 9. Test strategy (whole project)

| Layer | Tool | What |
|---|---|---|
| Pure engine | unit | matcher, rules, validation, templates, responder — **the core**. Exhaustive on edge cases (wildcards, decoded params, empty rules, unions, optional keys, unknown tags). |
| Op protocol | unit | build/apply round-trips, single-upsert invariant, cascade deletes, reorder invariants, unknown-parent error. |
| Storage | integration | Mongo round-trip; "save touches only listed entities"; file fallback parity. |
| HTTP API | e2e (supertest/fetch) | full save flow over real HTTP, mock serving, 404/405/validation, log redaction, restart persistence, status endpoint. |
| Frontend components | unit + snapshot | rendering, events, BEM class discipline. |
| Full app | e2e (Playwright) | login → build a mock → save → reload → verify. |

**Rule:** the engine and op protocol are tested *before* they're wired into HTTP. If a test fails, it fails in isolation, where the fix is obvious.

---

## 10. Phased delivery (what to build, in order)

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundation** | Backend scaffold + DB + pure engine + op protocol, all unit-tested. Frontend scaffold + design tokens + shared leaf components. | Engine + ops green in CI. `ng serve` shows styled shell. |
| **1. Core loop** | Mongo storage, Store, HTTP API, full Angular editor (F6–F12). | Create a mock in the UI, save (single op for a body edit), call it from Postman, see it in logs. |
| **2. Polish** | Import/export (Mockoon/Postman/OpenAPI), env settings, log detail, discard/confirm flows. | Import an existing Mockoon file and serve it. |
| **3. Harden** | Input validation, rate limiting, safe templates (whitelist already), timeouts/size limits, health checks, app logs. | Soak: one broken env can't take down others. |
| **4. Team (v1.5)** | Auth + roles, workspaces, stale-edit protection, version history + rollback, audit log. | Two users editing → second save rejected with a clear "reload" message; rollback restores. |
| **5. Deploy** | Docker + HTTPS + CI/CD + docs (setup/admin/user). | Deployed internally; a teammate imports mocks and uses it on a real project. |

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Concurrent edits clobber each other | Stale-edit protection (version check on save) + version history/rollback. In-memory snapshot keeps runtime consistent. |
| Templates become an execution hole | Fixed helper whitelist, no `eval`, parse errors leave the tag untouched. |
| One bad env slows the server | Per-request timeouts, body size limits, latency caps; engine is pure and fast. |
| MongoDB writes interleave | Serialize persistence in `Store` (queue); unique indexes make upserts idempotent. |
| Scope creep toward "live sync" | Explicitly out of scope for v1 (Section 2.5). Reload-to-sync is the contract. |
| BEM discipline decays as components grow | Snapshot/lint checks on class prefixes; co-located SCSS per block. |
| Solo maintainer bus-factor | This document + tests + clear module boundaries; onboard a second dev in Phase 0. |

---

## 12. Open decisions (answer before Phase 1)

1. **Hosting** — where does this run? (company server / cloud / Docker on a VM)
2. **Team size** — how many concurrent editors? (drives whether we need the v1.5 team features early)
3. **Auth** — is email/password enough for v1, or must SSO be there from day one?
4. **Save model** — apply on every save (v1 default) vs. a later Publish button (drafts)?
5. **Existing mocks** — do we have Mockoon files to import first (validates the import path early)?

---

## 13. Definition of done (v1)

- [ ] A teammate opens the editor in a browser, logs in, and creates an environment → route → response.
- [ ] Saving edits to **one response body sends exactly one `response.upsert`** (verified in the network tab).
- [ ] A client app calls the mock endpoint and gets the templated, rule-matched, latency-simulated response.
- [ ] Invalid payload returns 400 with a per-field error list.
- [ ] Request logs appear (sensitive headers redacted) and can be cleared.
- [ ] Restarting the server reloads all configuration from MongoDB.
- [ ] The engine and op protocol have passing unit tests; the HTTP API has passing e2e tests.
- [ ] Deploys with `docker compose up` behind HTTPS.
