# Development Guide

This document covers local development, testing, and release workflows for nextExplorer. For user-facing deployment instructions, see `README.md`.

## Project Layout

- `frontend/` – Vue 3 + Vite SPA (Pinia, TailwindCSS).
- `backend/` – Express server exposing the file-system API, thumbnail generation, uploads, and terminal bridge.
- `docs/` – VitePress documentation site.
- `Dockerfile` – Multi-stage build that bakes the frontend into the backend image.
- `docker/` – Docker Compose templates (development + deployment variants).

## Prerequisites

- Node.js 18 or later and npm 9 or later.
- FFmpeg installed locally (the Docker image installs it automatically).
- Docker Desktop / Docker Engine + Compose v2 if you plan to build or run containers.
- macOS/Linux with file-system permissions to mount your working directories under `/mnt`, persistent config under `/config`, and caches under `/cache`.

## Local Setup

### Install dependencies (monorepo)

This repo is an npm workspaces monorepo. Install once at the repo root:

```bash
npm install
```

Tip: use `npm ci` for a clean install in CI or when debugging dependency issues.

### Backend API

```bash
npm run dev:backend
```

- `npm run dev:backend` runs `node --watch backend/src/server.js` to reload automatically on backend changes.
- Common environment variables (see `backend/src/config/env.js` for the full, canonical list and defaults):
  - `PORT` (default `3000`)
  - `VOLUME_ROOT` (default `/mnt`)
  - `CONFIG_DIR` (default `/config`)
  - `CACHE_DIR` (default `/cache`)
  - `PUBLIC_URL` – recommended when running behind a reverse proxy and required for correct OIDC/cookie behavior
  - `CORS_ORIGINS` – comma-separated origins (defaults to `PUBLIC_URL` origin when set)
  - `LOG_LEVEL`, `DEBUG`, `ENABLE_HTTP_LOGGING`
  - Auth:
    - `AUTH_MODE` – `local`, `oidc`, `both`, or `disabled`
    - `SESSION_SECRET` – optional; if omitted the backend generates a strong secret at startup
  - OIDC (Express OpenID Connect):
    - `OIDC_ENABLED`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
    - `OIDC_SCOPES`, `OIDC_ADMIN_GROUPS`, `OIDC_LOGOUT_URL`
    - Optional overrides: `OIDC_AUTHORIZATION_URL`, `OIDC_TOKEN_URL`, `OIDC_USERINFO_URL`, `OIDC_CALLBACK_URL`
  - Features:
    - `USER_DIR_ENABLED`, `USER_ROOT`, `USER_VOLUMES`, `SKIP_HOME`
    - `SHOW_VOLUME_USAGE`, `EDITOR_EXTENSIONS`

When EOC is enabled, the backend exposes default OIDC routes:

- `GET /login` – start login
- `GET /callback` – OIDC callback (configure this in your provider)
- `GET /logout` – logout (IdP logout enabled)

For backward compatibility with the UI, the wrapper route `GET /api/auth/oidc/login` also triggers EOC login when available.

- Ensure the process user can read/write the directories pointed to by `VOLUME_ROOT`, `CONFIG_DIR`, and `CACHE_DIR`.

### Frontend SPA

```bash
cp frontend/.env.example frontend/.env  # when using the proxy flow, leave VITE_API_URL unset
npm run dev:frontend
```

- Dev server runs on `http://localhost:3000` with hot-module replacement.
- Backend proxy target is controlled by `VITE_BACKEND_ORIGIN` (defaults to `http://localhost:3001`).
- Build metadata for About page (optional): set these before `npm run build` (or in `.env`) to show git info:
  - `VITE_GIT_COMMIT` – full SHA (e.g. `$(git rev-parse HEAD)`)
  - `VITE_GIT_BRANCH` – branch name
  - `VITE_REPO_URL` – repository URL (e.g. `https://github.com/owner/repo`)
- Helpful scripts:
  - `npm run build` – production bundle (root script builds `frontend`).
  - `npm run preview -w frontend` – serve the built assets locally.
  - `npm run test:unit -w frontend` – Vitest unit suite.
  - `npm run storybook -w frontend` – component explorer on `http://localhost:6006`.
  - `npm run build-storybook -w frontend` – static Storybook build (`frontend/storybook-static/`).

#### Features Store Architecture

The frontend uses a centralized Pinia store (`frontend/src/stores/features.js`) to manage all runtime configuration from Docker environment variables. This provides optimal performance and consistency.

**Key Characteristics**:

- **Eager initialization**: Features load immediately at app startup (`main.js`) in parallel with other initialization
- **Single source of truth**: All components access features through the store, ensuring consistency
- **Performance optimized**: Only one HTTP request to `/api/features` per app load
- **Reactive state**: Components automatically update when features load

**Usage in Components**:

```javascript
// Async components (wait for features to load)
import { useFeaturesStore } from '@/stores/features';

const featuresStore = useFeaturesStore();
await featuresStore.ensureLoaded();

// Now access features
if (featuresStore.volumeUsageEnabled) {
  // Load volume usage data
}
```

```javascript
// Reactive computed (automatically updates when features load)
import { useFeaturesStore } from '@/stores/features';

const featuresStore = useFeaturesStore();
const extensions = computed(() => featuresStore.editorExtensions);
```

**Available Features**:

- `editorExtensions` – array of custom file extensions from `EDITOR_EXTENSIONS`
- `onlyofficeEnabled` – boolean from `ONLYOFFICE_URL`
- `onlyofficeExtensions` – array from `ONLYOFFICE_FILE_EXTENSIONS`
- `volumeUsageEnabled` – boolean from `SHOW_VOLUME_USAGE`
- `personalEnabled` – boolean from `USER_DIR_ENABLED`
- `skipHome` – boolean from `SKIP_HOME`

**Backend API**: Features are served by `GET /api/features` which consolidates all runtime configuration from environment variables.

### Docs (VitePress)

```bash
npm run docs
```

### Single-port Dev via Vite proxy (recommended)

Serve the SPA on port 3000 and proxy API calls to the backend on an internal port 3001.

Local (no Docker):

```bash
# Install once (monorepo)
npm install

# Backend on 3001
PORT=3001 VOLUME_ROOT=$PWD/../example-express-openid CONFIG_DIR=$PWD/.config CACHE_DIR=$PWD/.cache npm run dev -w backend

# Frontend on 3000 (proxies /api and /static/thumbnails to 3001)
PORT=3000 VITE_BACKEND_ORIGIN=http://localhost:3001 npm run dev -w frontend
# Open http://localhost:3000
```

Docker (two services, one exposed port):

```bash
docker compose -f docker/docker-compose.development.yml up --build
```

- Only `http://localhost:3000` is exposed; backend listens on 3001 internally.
- Update the host volume paths under the `backend` service to match directories you want to expose.

If you run the dev stack behind a local reverse proxy, set `PUBLIC_URL` for the backend to the URL you access in the browser (for example `http://localhost:3000`). This centralizes:

- CORS origin (derived from the origin of `PUBLIC_URL` unless `CORS_ORIGINS` is set)
- OIDC callback URL (defaults to `PUBLIC_URL + /callback` unless `OIDC_CALLBACK_URL` is set)

Note: When using EOC, set your provider redirect URI to `${PUBLIC_URL}/callback` (the EOC default), unless you explicitly override it via `OIDC_CALLBACK_URL`.

## Testing & Quality

- Run backend tests: `npm run test`
- Run frontend unit tests: `npm run test:unit -w frontend`
- Lint the monorepo: `npm run lint` (auto-fix: `npm run lint:fix`)
- Format the monorepo: `npm run format` (check: `npm run format:check`)

## Building Production Images

The multi-stage `Dockerfile` builds the Vue app and packages it with the Node backend.

### Local build

```bash
docker build -t nextexplorer:dev .
```

### Multi-architecture build & push

```bash
docker buildx create --use --name multi || docker buildx use multi
# Install QEMU binfmt for cross-compilation (one-time per host)
docker run --privileged --rm tonistiigi/binfmt --install all

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t nxzai/explorer:latest \
  --push .
```

## Release Checklist

- Update `README.md` screenshots or feature descriptions if UX changes.
- Regenerate the frontend production build (`npm run build`) and smoke-test locally.
- Run through critical file operations (upload/move/delete) on a staging instance.
- Bump Docker tags or package versions as needed and publish release notes.
