# Fixing CORS errors (and `PUBLIC_URL`)

If your browser shows errors like:

- “Blocked by CORS policy”
- “has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header”
- The UI shows a **Public URL mismatch** warning

…your instance is usually being accessed from a different origin than the server is configured to allow.

## The quick fix (most common)

1. Decide the *one* URL you will use to access nextExplorer (scheme + host + optional port), for example:
   - `https://files.example.com`
2. Set it on the server:
   - `PUBLIC_URL=https://files.example.com`
3. Restart the container/app.

If you access nextExplorer from multiple domains (or you have a separate frontend domain), also set `CORS_ORIGINS`.

## CORS environment variables

### `CORS_ORIGINS` / `CORS_ORIGIN` / `ALLOWED_ORIGINS`

- **What it is:** A comma-separated list of allowed *origins* (no paths).
- **Examples:**
  - `CORS_ORIGINS=https://files.example.com`
  - `CORS_ORIGINS=https://files.example.com,https://admin.example.com`
  - `CORS_ORIGINS=http://localhost:5173` (local dev frontend)

Notes:

- Origins must match exactly (scheme + host + port). `https://files.example.com` is different from `http://files.example.com` and `https://files.example.com:8443`.
- Use `CORS_ORIGINS` when the app is accessed from multiple origins (for example, multiple reverse-proxy hostnames).

## `PUBLIC_URL` (what it does, and what depends on it)

`PUBLIC_URL` is nextExplorer’s external base URL (no trailing slash). It should match the URL users type into the browser.

When set correctly, it drives several behaviors:

- **CORS defaults:** If you don’t set `CORS_ORIGINS`, nextExplorer defaults CORS to the origin of `PUBLIC_URL`.
- **UI safety checks:** The frontend compares the current browser origin to the server’s expected public origin and shows a mismatch warning when they differ.
- **Reverse proxy + cookies:** When `PUBLIC_URL` is set, nextExplorer enables a safe default `TRUST_PROXY` so Express can correctly interpret `X-Forwarded-*` headers (important for HTTPS and cookie security behind a proxy).
- **OIDC callbacks:** If you don’t set `OIDC_CALLBACK_URL`, it defaults to `${PUBLIC_URL}/callback`.
- **Sharing links:** Share URLs are built from `PUBLIC_URL` when available (otherwise they fall back to the incoming request host).
- **ONLYOFFICE / Collabora:** These integrations need a correct `PUBLIC_URL` to build absolute URLs that the document server calls back.

## Common configurations

### Single domain (recommended)

If the UI and API are served from the same origin (typical reverse proxy setup), just set:

```bash
PUBLIC_URL=https://files.example.com
```

You usually do **not** need `CORS_ORIGINS` in this case.

### Multiple domains

If users access the same instance from multiple origins, add them all:

```bash
PUBLIC_URL=https://files.example.com
CORS_ORIGINS=https://files.example.com,https://files-alt.example.com
```

### Local dev frontend

If you run the backend at `http://localhost:3000` and the frontend dev server at `http://localhost:5173`:

```bash
PUBLIC_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:5173
```

## If it still fails

- Confirm your reverse proxy forwards `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-For`.
- Make sure you’re visiting the exact `PUBLIC_URL` (including `https` vs `http` and ports).
- Double-check there’s no browser cache/service-worker holding onto an old origin.

