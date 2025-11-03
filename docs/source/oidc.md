# OIDC (OpenID Connect) Authentication

nextExplorer supports OIDC providers such as Authentik, Keycloak, Google, and others via a generic, provider‑agnostic setup.

### Environment variables
- `OIDC_ENABLED`: `true|false` to enable OIDC.
- `OIDC_ISSUER`: Provider issuer URL (used for discovery). Example: `https://id.example.com/application/o/your-app/`.
- `OIDC_AUTHORIZATION_URL`, `OIDC_TOKEN_URL`, `OIDC_USERINFO_URL` (optional): Manually override endpoints. If omitted, discovery is used from `OIDC_ISSUER`.
- `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`: Credentials for your app.
- `OIDC_CALLBACK_URL` (optional): Callback URL. If not set, derived from `PUBLIC_URL` as `${PUBLIC_URL}/api/auth/oidc/callback`.
- `OIDC_SCOPES` (optional): Space/comma separated scopes. Default: `openid profile email`. Add `groups` if your provider exposes it.
- `OIDC_ADMIN_GROUPS` (recommended): Space/comma separated group names that should map to the app’s `admin` role, e.g. `next-admin admins`.

Notes:
- Discovery: If `OIDC_AUTHORIZATION_URL`/`OIDC_TOKEN_URL`/`OIDC_USERINFO_URL` are not supplied, the app fetches them from `OIDC_ISSUER/.well-known/openid-configuration`.
- Callback: If you run behind a reverse proxy, set `PUBLIC_URL` so the default callback is correct.

### Admin role mapping
- Provider‑agnostic: The app only looks at standard OIDC claims for group‑like values: `groups`, `roles`, `entitlements` (arrays or space/comma strings).
- Config‑driven: A user becomes `admin` only if they belong to any group listed in `OIDC_ADMIN_GROUPS` (case‑insensitive). Otherwise the user gets role `user`.
- No implicit defaults: There are no built‑in admin group names. If `OIDC_ADMIN_GROUPS` is empty/unset, no OIDC user is auto‑elevated.
- Safety: If an existing user already has the `admin` role, the app preserves it on subsequent logins to avoid accidental demotion.

Example compose snippet:

```yaml
services:
  nextexplorer:
    image: nxzai/explorer:latest
    environment:
      - PUBLIC_URL=https://files.example.com
      - OIDC_ENABLED=true
      - OIDC_ISSUER=https://auth.example.com/application/o/next/
      # Optional manual overrides (otherwise discovery is used)
      # - OIDC_AUTHORIZATION_URL=...
      # - OIDC_TOKEN_URL=...
      # - OIDC_USERINFO_URL=...
      - OIDC_CLIENT_ID=your-client-id
      - OIDC_CLIENT_SECRET=your-client-secret
      - OIDC_SCOPES=openid profile email groups
      - OIDC_ADMIN_GROUPS=next-admin admins
```

Provider tips:
- Authentik/Keycloak: Usually expose `groups`; include `groups` in scopes.
- Google: Group claims typically require additional configuration (Cloud Identity / Admin SDK). Without groups, users will be `user` role by default.
