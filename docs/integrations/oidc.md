# OIDC Integration

nextExplorer uses Express OpenID Connect (EOC) to federate authentication with external providers. Configure these variables and your IdP once, and the app exposes `/login`, `/callback`, and `/logout` to manage the flow.

## Environment variables (see `backend/src/config/env.js`)

- `OIDC_ENABLED=true` enables the middleware.
- `OIDC_ISSUER` points to the IdP discovery URL (e.g., Keycloak realm or Authentik application base).
- `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` store client credentials.
- `OIDC_SCOPES` defaults to `openid profile email`; add `groups` if you want nextExplorer to inspect group claims.
- `OIDC_ADMIN_GROUPS` contains comma/space-separated group names that grant the admin role when present in `groups`, `roles`, or `entitlements` claims.
- `OIDC_REQUIRE_EMAIL_VERIFIED` (default `false`) — when `true`, requires the IdP to verify the user's email before allowing user creation or auto-linking. Some providers like newer versions of Authentik set `email_verified` to `false` by default; keep this setting as `false` to allow those users to log in.
- `OIDC_AUTO_CREATE_USERS` (default `true`) — when `false`, the user must already exist in the nextExplorer database (local or previously OIDC-linked), otherwise OIDC login is denied.
- Optional overrides: `OIDC_AUTHORIZATION_URL`, `OIDC_TOKEN_URL`, `OIDC_USERINFO_URL`, `OIDC_LOGOUT_URL`, and an explicit `OIDC_CALLBACK_URL` (defaults to `${PUBLIC_URL}/callback`).
  - `OIDC_LOGOUT_URL` — optional custom IdP logout URL. When set, logout requests redirect to this URL with a `post_logout_redirect_uri` parameter (OIDC standard). If not set, logout only clears the local session without redirecting to the IdP.

## Choosing authentication modes

Use `AUTH_MODE` to control which authentication methods are available:

- `AUTH_MODE=oidc` — **OIDC only**: The login page shows only the "Continue with Single Sign-On" button. Users cannot create local passwords.
- `AUTH_MODE=local` — **Local only**: The login page shows only username/password fields. OIDC is disabled even if `OIDC_ENABLED=true`.
- `AUTH_MODE=both` — **Dual authentication** (default): Users can choose between local login or SSO. The login page displays both options.
- `AUTH_MODE=disabled` — **No authentication**: Skips the login page entirely and makes all APIs public (same as `AUTH_ENABLED=false`).

## Flow overview

1. A user clicks “Continue with Single Sign-On” on the login page.
2. The app redirects to `${OIDC_AUTHORIZATION_URL}` or the issuer discovery endpoint.
3. After IdP authentication, the callback (`/callback`) is invoked, sessions are established, and the user lands back in the workspace.
4. Logout routes (`/logout`) tear down the session. If `OIDC_LOGOUT_URL` is configured, logout redirects to the IdP logout endpoint with a `post_logout_redirect_uri` parameter to complete the IdP logout flow. Otherwise, only the local session is cleared.

## Admin elevation

- nextExplorer inspects the `groups`, `roles`, and `entitlements` claims returned by the IdP.
- If any entry matches `OIDC_ADMIN_GROUPS` (case-insensitive), the user is promoted to admin.
- Without a match, the user receives the standard `user` role and only sees non-admin settings.

**This is re-evaluated at every sign-in**, so removing someone from the admin
group at the IdP takes their admin rights away here the next time they log in,
and adding them grants it. Role changes are written to the log.

Two conditions have to hold before the IdP is allowed to decide, and both exist
to stop a misconfiguration from locking everyone out:

- **`OIDC_ADMIN_GROUPS` must be configured.** Without it every login would
  derive the plain `user` role, and applying that would strip the rights of
  anyone promoted from the interface — the bootstrap account included.
- **The IdP must actually return a group claim.** A missing `groups` scope looks
  exactly like a user who belongs to no group; roles are left untouched rather
  than reset on that silence.

Where neither holds, roles stay as they are and are managed from **Settings →
Users** instead. If you do lock yourself out, setting `AUTH_ADMIN_EMAIL` to your
address and restarting restores the admin role on that account.

## Signing in from a native app

A native iOS or Android client cannot complete an OIDC sign-in the way the web
app does. On iOS, passkeys only work inside `ASWebAuthenticationSession`, and
that system web view never hands the `HttpOnly` session cookie back to the
application. The web view that _can_ read cookies does not do passkeys
reliably. So against a passkey-only provider, an app is stuck: the person signs
in successfully and the application never learns of it.

Three routes bridge that gap, and they exist only for native clients — nothing
in the web interface uses them:

1. `GET /api/auth/oidc/mobile/login` — the app opens this in the system web
   session with a PKCE `code_challenge` (S256 only) and one of the allowlisted
   redirect URIs. Standard OIDC login follows.
2. `GET /api/auth/oidc/mobile/complete` — once the provider has authenticated
   the person, the server mints a single-use code, valid for sixty seconds and
   bound to that PKCE challenge, and redirects to
   `nextexplorer://oidc-callback?code=…`.
3. `POST /api/auth/oidc/exchange` — the app sends the code and its
   `code_verifier` and receives an ordinary session cookie, the same one a
   password sign-in produces.

The code is destroyed by the first attempt to redeem it, right or wrong, so
there is no second guess against a live one. `OIDC_MOBILE_REDIRECT_URIS`
restricts where it can be delivered to custom schemes an app has registered;
`http(s)` addresses are refused, so the code cannot be redirected to a web page.

Nothing here is reachable unless OIDC is configured — the routes answer 404
otherwise — and no configuration is needed to keep it off.

## Common troubleshooting

- **Invalid redirect URI**: Ensure your IdP’s redirect URI matches `${PUBLIC_URL}/callback` or the explicitly configured `OIDC_CALLBACK_URL`.
- **Sessions drop after restart**: Keep `/config` persistent, since the session secret generated when `SESSION_SECRET` is unset is kept there, or supply a stable `SESSION_SECRET`.
- **Not an admin after login**: Verify the IdP includes the expected group claim (e.g., `groups` scope) and that `OIDC_ADMIN_GROUPS` contains the group name exactly. Both are required before the IdP may set roles at all — without them the role stored on the account is kept, whatever the claims say.
- **Cookies flagged Insecure**: Run the app over HTTPS (`PUBLIC_URL` must use `https`) and confirm your proxy forwards `X-Forwarded-Proto`/`Host` headers (see the Reverse Proxy guide).
- **The sign-in screen says single sign-on is not configured**: it means what it
  says — one of `OIDC_ENABLED`, `OIDC_ISSUER`, `OIDC_CLIENT_ID` or a public
  address (`PUBLIC_URL`, or `OIDC_CALLBACK_URL`) is missing. The start-up log
  names which.
- **The sign-in screen says single sign-on could not be started**: the settings
  are all there and the hand-off failed — the provider did not answer, discovery
  failed, or the library refused what it was given (a missing
  `OIDC_CLIENT_SECRET` is the usual one). Nothing to change in the configuration
  before reading the server log, which carries the reason; the message shown in
  the browser never does, because it would name the provider's internal host.
