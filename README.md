# Sahayak — Team Mock API Platform

A self-hosted mock API platform: configure mock endpoints in a team editor,
then call them from any client app. See **[DESIGN.md](./DESIGN.md)** for the
full design, data model, API, and build plan.

## Repository layout

```
├── frontend/     # Angular 22 editor UI (BEM + SCSS, design tokens)
├── backend/      # Node.js + Express + MongoDB API & mock engine
├── DESIGN.md     # The single design document (source of truth)
└── .npm-cache/   # Workspace-local npm cache (gitignored)
```

Each app is standalone with its own `package.json` — install and run them
independently.

## Development setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # adjust MONGODB_URI if you don't use 127.0.0.1:27017
npm run dev               # API + mock engine on http://localhost:4000
```

Without a reachable `MONGODB_URI`, the backend falls back to local file
storage (`backend/data/mock-config.json`) — fine for trying things out.

Useful endpoints:

- `GET /api/status` — health, storage backend, environment count
- `GET /api/environments` — full editor snapshot
- `GET /api/logs` — recent mock requests
- `ANY /mock/<environment>/<path>` — the mocked endpoints themselves

### 2. Frontend

```bash
cd frontend
npm install
npm start                 # http://localhost:4200
```

The dev server proxies `/api` and `/mock` to `http://localhost:4000`
(see `frontend/proxy.conf.json`), so the editor talks to the backend with no
CORS setup.

### Scripts

| Where    | Script           | What                                        |
| -------- | ---------------- | ------------------------------------------- |
| backend  | `npm run dev`    | tsx dev server (`:4000` + one port per env) |
| backend  | `npm run build`  | esbuild bundle → `dist/server.cjs`          |
| backend  | `npm start`      | run the built bundle                        |
| backend  | `npm test`       | vitest: engine units + HTTP/mock e2e        |
| backend  | `npm run lint`   | `tsc --noEmit`                              |
| frontend | `npm start`      | Angular dev server with proxy (`:4200`)     |
| frontend | `npm run build`  | production build → `frontend/dist/sahayak`  |
| frontend | `npm test`       | vitest unit tests                           |

## Production

Build the frontend, then point the backend at it:

```bash
cd frontend && npm run build
cd ../backend
FRONTEND_DIST=../frontend/dist/sahayak/browser npm start
```

The backend then serves the built UI from `/` alongside `/api` and `/mock`.
(DESIGN.md §10 Phase 5 specifies Docker + HTTPS for the deployed setup.)
