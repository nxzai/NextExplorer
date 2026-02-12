# Backend Agent Guide (NextExplorer)

The backend is a Docker-first, CommonJS Express server. In production it also serves the built SPA
from `backend/src/public` (see `backend/src/utils/staticServer.js`).

## How To Run (Docker-First)

- Development (recommended, documented): `docker compose -f docker/docker-compose.development.yml up --build`
  - Frontend dev server: `http://localhost:3000`
  - Backend listens on `PORT=3001` inside the Compose network; Vite proxies `/api/*` to it.
- Production: Docker Compose using `nxzai/explorer` (see `README.md`) or build via `Dockerfile`.
  - Single container serves API + SPA on `PORT` (default `3000`).
  - Container user mapping uses `PUID`/`PGID` via `docker/entrypoint.sh` (keeps created files owned correctly on the host).

If you must run backend-only outside Docker, keep mounts/paths consistent with container defaults:
`VOLUME_ROOT=/mnt`, `CONFIG_DIR=/config`, `CACHE_DIR=/cache`.

## Environment Variables (Source Of Truth)

- Canonical list + defaults: `backend/src/config/env.js`
- Derived runtime config: `backend/src/config/index.js`
- VitePress reference: `docs/configuration/environment.md`

Important operational notes:
- `PUBLIC_URL` should match the browser URL (cookies/CORS/OIDC callback derivation).
- `/config` must be persistent (SQLite `app.db`, branding assets, extensions).
- `/cache` should be persistent for performance (thumbnails, search artifacts).

## Public Endpoints (Must Stay Non-Sensitive)

These are intentionally reachable without auth (see `backend/src/middleware/authMiddleware.js`):
- `GET /api/features` returns env-derived feature flags and build metadata: `backend/src/routes/features.js`
- `GET /api/branding` returns branding for the login page: `backend/src/routes/settings.js`
- `GET /healthz` and `GET /readyz`: `backend/src/routes/health.js`

Do not add secrets/user-specific data to these responses.

## Settings Model (System vs User)

Settings are persisted in SQLite (`/config/app.db`) with a legacy fallback/migration from
`/config/app-config.json` (`backend/src/services/db.js`).

- `GET /api/settings` returns:
  - Public: `branding`
  - Authenticated user: `branding` + `user` settings
  - Admin: `branding` + `user` + system settings (`thumbnails`, `access`)
- `PATCH /api/settings`:
  - Users may update whitelisted keys under `user.*` only.
  - Admins may update `thumbnails`, `access.rules`, and `branding`.
  - Sanitization lives in `backend/src/services/settingsService.js`.

## Access Control And Path Safety (Core Backend Contract)

Client-provided paths are logical paths, not filesystem paths. Do not `path.join()` raw inputs.

- Path parsing/spaces: `backend/src/utils/pathUtils.js` (`parsePathSpace`)
  - `volume`: `Projects/file.txt` -> `<VOLUME_ROOT>/Projects/file.txt`
  - `personal`: `personal/docs` -> `<USER_ROOT>/<userFolder>/docs`
  - `share`: `share/<token>/...` -> resolved via shares metadata
- Central enforcement:
  - Access decisions: `backend/src/services/accessManager.js` (`getAccessInfo`, `resolvePathWithAccess`)
  - Authorization helpers: `backend/src/services/authorizationService.js` (`authorizeAndResolve`, `ACTIONS`)
- Access control rules:
  - Stored in system settings as `access.rules` (`rw|ro|hidden`, first-match wins)
  - Resolved via `backend/src/services/accessControlService.js`
  - Applied to logical paths, including `personal/...` and shared content.

When `USER_VOLUMES=true`, non-admin users are restricted to volumes assigned in `user_volumes` and those rules
compose with `access.rules` (see `backend/src/services/accessManager.js`).

## Code Conventions (Match Existing Patterns)

- Backend source uses CommonJS: `require(...)` + `module.exports`.
- Routes should use `asyncHandler`: `backend/src/utils/asyncHandler.js`.
- Log via Pino (`backend/src/utils/logger.js`); avoid `console.*` in request paths.
- Throw `AppError` variants (`backend/src/errors/AppError.js`) for expected failures so the centralized
  handler (`backend/src/middleware/errorHandler.js`) formats consistently.
- Avoid adding new non-API GET routes at `/` because SPA fallback serves `index.html` for most non-`/api` paths
  (`backend/src/utils/staticServer.js`); keep backend routes under `/api`.

## High-Risk Areas (Be Careful)

- Terminal: `POST /api/terminal/session` (admin-only) + WS `/api/terminal?token=...` with short-lived,
  single-use tokens (`backend/src/routes/terminal.js`, `backend/src/services/terminalService.js`).
- Permissions endpoints (`/api/permissions/*`) execute OS-level operations and must continue to flow
  through `authorizeAndResolve` and guest restrictions: `backend/src/routes/permissions.js`.
