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

## Provider Examples

### Keycloak
1.  **Create a new client:**
    *   In your Keycloak realm, navigate to **Clients** and click **Create**.
    *   Set **Client ID** to `nextexplorer` (or your preferred name).
    *   Set **Client Protocol** to `openid-connect`.
    *   Click **Save**.
2.  **Configure the client:**
    *   Set **Access Type** to `confidential`.
    *   In **Valid Redirect URIs**, add the callback URL for your nextExplorer instance. This is typically your `PUBLIC_URL` plus `/api/auth/oidc/callback`. For example: `https://files.example.com/api/auth/oidc/callback`.
    *   Click **Save**.
3.  **Get credentials:**
    *   Navigate to the **Credentials** tab for your client.
    *   You will find the **Client Secret** here. Use this value for the `OIDC_CLIENT_SECRET` environment variable. The `OIDC_CLIENT_ID` is the **Client ID** you set in step 1.
4.  **Configure group claims:**
    *   To expose user groups in the token, navigate to **Client Scopes** > **-dedicated** scopes for your client.
    *   Click on **add mapper** and choose **By Configuration**.
    *   Now choose **Group Membership** mapper.
    *   Give it a name, and set the **Token Claim Name** to `groups`.
    *   Ensure **Full group path** is **OFF**.
    *   Click **Save**.

### Authelia
1.  **Enable the OIDC provider in `authelia/configuration.yml`:**
    ```yaml
    identity_providers:
      oidc:
        ## Enable the OIDC provider
        enable: true
        ## The issuer URL
        issuer_private_key: |
          -----BEGIN RSA PRIVATE KEY-----
          ...
          -----END RSA PRIVATE KEY-----
        clients:
          - client_id: 'nextexplorer'
            client_name: 'nextExplorer'
            client_secret: 'your-client-secret'
            public: false
            authorization_policy: 'one_factor'
            redirect_uris:
              - 'https://files.example.com/api/auth/oidc/callback'
            scopes:
              - 'openid'
              - 'profile'
              - 'email'
              - 'groups'
            grant_types:
              - 'authorization_code'
            response_types:
              - 'code'
    ```
2.  **Configure nextExplorer:**
    *   Set `OIDC_ISSUER` to your Authelia URL (e.g., `https://auth.example.com`).
    *   Set `OIDC_CLIENT_ID` to `nextexplorer`.
    *   Set `OIDC_CLIENT_SECRET` to the `client_secret` you defined in your Authelia configuration.
    *   Ensure `OIDC_SCOPES` includes `openid profile email groups`.

### Example Docker Compose Snippet
```yaml
services:
  nextexplorer:
    image: nxzai/explorer:latest
    environment:
      - PUBLIC_URL=https://files.example.com
      - OIDC_ENABLED=true
      - OIDC_ISSUER=https://auth.example.com/application/o/next/ # e.g., your Keycloak or Authelia issuer URL
      - OIDC_CLIENT_ID=nextexplorer
      - OIDC_CLIENT_SECRET=your-client-secret
      - OIDC_SCOPES=openid profile email groups
      - OIDC_ADMIN_GROUPS=next-admin admins
```
