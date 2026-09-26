import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * A whole OpenID Connect sign-in, through the real library, against a provider
 * that runs in this process.
 *
 * `oidc-middleware.test.js` calls the after-callback handler directly, with a
 * session it builds by hand. That cannot show what the library actually hands
 * the handler, nor whether the routes this module mounts keep the addresses a
 * request supplies on this site. Here the browser starts at /login, carries
 * the library's own transaction cookie to /callback, and the provider signs a
 * real id token and answers userinfo — so what is asserted is what a person
 * signing in would get.
 *
 * Three things are pinned:
 *
 * - the addresses. The provider returns the code to the configured site whatever
 *   Host the request named, and neither a sign-in nor a sign-out ends on an
 *   address the query string supplied;
 * - the refusals. A callback this browser did not start, one whose state does
 *   not match, one carrying the provider's error and one without a code all
 *   sign nobody in and never reach the token endpoint. Those checks live in the
 *   library; the successful sign-in beside them is the control that shows the
 *   refusals come from the checks and not from a provider that never worked;
 * - who the account is. The provider's groups decide the administrator role by
 *   exact name only, and an address the provider has not verified does not
 *   attach a sign-in to an account that already has it.
 */

const CLIENT_ID = 'nextexplorer';
const PUBLIC_URL = 'http://files.example.test';

const provider = {
  origin: null,
  server: null,
  signingKey: null,
  jwk: null,
  /** code -> { nonce, claims }, registered by the test before the callback. */
  grants: new Map(),
  /** access token -> claims, for the userinfo endpoint. */
  tokens: new Map(),
  tokenRequests: 0,
};

const signIdToken = (payload) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })}.${encode(payload)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), provider.signingKey);
  return `${unsigned}.${signature.toString('base64url')}`;
};

const answer = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

const handleProviderRequest = (req, res) => {
  const { pathname } = new URL(req.url, provider.origin);
  const { origin } = provider;

  if (pathname === '/.well-known/openid-configuration') {
    answer(res, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      jwks_uri: `${origin}/jwks`,
      userinfo_endpoint: `${origin}/userinfo`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    });
  } else if (pathname === '/jwks') {
    answer(res, 200, { keys: [provider.jwk] });
  } else if (pathname === '/token') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      provider.tokenRequests += 1;
      const code = new URLSearchParams(body).get('code');
      const grant = provider.grants.get(code);
      if (!grant) {
        answer(res, 400, { error: 'invalid_grant' });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const accessToken = `access-${code}`;
      provider.tokens.set(accessToken, grant.claims);
      answer(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: signIdToken({
          iss: origin,
          aud: CLIENT_ID,
          iat: now,
          exp: now + 600,
          nonce: grant.nonce,
          ...grant.claims,
        }),
      });
    });
  } else if (pathname === '/userinfo') {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const claims = provider.tokens.get(token);
    if (provider.userinfo === 'down') answer(res, 503, { error: 'temporarily_unavailable' });
    else if (provider.userinfo === 'someone-else' && claims) {
      answer(res, 200, { sub: 'someone-else', email: 'else@example.com', email_verified: true });
    } else if (claims) answer(res, 200, claims);
    else answer(res, 401, { error: 'invalid_token' });
  } else {
    res.writeHead(404).end();
  }
};

beforeAll(async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  provider.signingKey = privateKey;
  provider.jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  provider.server = http.createServer(handleProviderRequest);
  await new Promise((resolve) => provider.server.listen(0, '127.0.0.1', resolve));
  provider.origin = `http://127.0.0.1:${provider.server.address().port}`;
});

afterAll(async () => {
  provider.server.closeAllConnections();
  await new Promise((resolve) => provider.server.close(resolve));
});

let currentEnv;

afterEach(async () => {
  provider.grants.clear();
  provider.tokens.clear();
  provider.tokenRequests = 0;
  provider.userinfo = 'answers';
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

const build = async (env = {}) => {
  currentEnv = await setupTestEnv({
    tag: 'oidc-provider-flow-',
    env: {
      AUTH_ENABLED: 'true',
      OIDC_ENABLED: 'true',
      OIDC_ISSUER: provider.origin,
      OIDC_CLIENT_ID: CLIENT_ID,
      OIDC_CLIENT_SECRET: 'client-secret',
      OIDC_ADMIN_GROUPS: 'nx-admins',
      PUBLIC_URL,
      ...env,
    },
  });
  const { configureOidc } = currentEnv.requireFresh('src/middleware/oidc');
  const { errorHandler } = currentEnv.requireFresh('src/middleware/errorHandler');
  const db = await currentEnv.requireFresh('src/services/db').getDb();

  const app = express();
  await configureOidc(app);
  app.get('/whoami', (req, res) => {
    res.json({ signedIn: req.oidc.isAuthenticated(), sub: req.oidc.user?.sub || null });
  });
  app.use(errorHandler);
  return { app, db };
};

let codeCounter = 0;

/**
 * Start a sign-in, and register what the provider will say about whoever
 * completes it. Returns the authorization request's parameters.
 */
const startSignIn = async (browser, { claims, returnTo, host } = {}) => {
  const pending = browser.get('/login').query(returnTo ? { returnTo } : {});
  const response = host ? await pending.set('Host', host) : await pending;
  expect(response.status).toBe(302);
  const authorization = new URL(response.headers.location);
  codeCounter += 1;
  const code = `code-${codeCounter}`;
  if (claims) {
    provider.grants.set(code, { nonce: authorization.searchParams.get('nonce'), claims });
  }
  return { authorization, code, state: authorization.searchParams.get('state') };
};

/** The browser coming back from the provider, as a navigation. */
const callback = (browser, query) =>
  browser.get('/callback').query(query).set('Accept', 'text/html');

const signIn = async (browser, claims, options = {}) => {
  const { code, state } = await startSignIn(browser, { claims, ...options });
  return callback(browser, { code, state });
};

const errorShownAtLogin = (response) => {
  expect(response.status).toBe(302);
  const landing = new URL(response.headers.location, PUBLIC_URL);
  expect(landing.pathname).toBe('/auth/login');
  return landing.searchParams.get('error');
};

const rolesOf = (db, email) => {
  const row = db.prepare('SELECT roles FROM users WHERE email = ?').get(email);
  return row ? JSON.parse(row.roles) : null;
};

describe('where a sign-in is sent, and where it ends', () => {
  /** The authorization code is delivered to this address. */
  it('asks the provider to return to the configured address, whatever Host the request names', async () => {
    const { app } = await build();

    const { authorization } = await startSignIn(request.agent(app), { host: 'evil.example' });

    expect(`${authorization.origin}${authorization.pathname}`).toBe(`${provider.origin}/authorize`);
    expect(authorization.searchParams.get('redirect_uri')).toBe(`${PUBLIC_URL}/callback`);
  });

  it.each([['https://evil.example/'], ['//evil.example/']])(
    'ends a completed sign-in on this site when the return address given is %s',
    async (returnTo) => {
      const { app } = await build();
      const browser = request.agent(app);

      const response = await signIn(
        browser,
        { sub: 'sub-1', email: 'someone@example.com', email_verified: true },
        { returnTo }
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/browse/');
      expect((await browser.get('/whoami')).body.signedIn).toBe(true);
    }
  );

  it.each([
    ['through the library', {}],
    ['through the provider logout URL', { logout: true }],
  ])(
    'sends someone who signs out %s back to this site, not to the address given',
    async (_label, { logout }) => {
      const { app } = await build(logout ? { OIDC_LOGOUT_URL: `${provider.origin}/logout` } : {});

      const response = await request(app)
        .get('/logout')
        .query({ returnTo: 'https://evil.example/' });

      expect(response.status).toBe(302);
      const landing = new URL(response.headers.location);
      const comesBackTo = logout
        ? landing.searchParams.get('post_logout_redirect_uri')
        : landing.toString();
      expect(comesBackTo).toBe(`${PUBLIC_URL}/auth/login`);
    }
  );
});

describe('a callback that does not belong to a sign-in this browser started', () => {
  it('signs nobody in when the browser has no sign-in in progress', async () => {
    const { app } = await build();
    const browser = request.agent(app);

    const response = await callback(browser, { code: 'code-x', state: 'forged' });

    // The wording is the library's, and it has changed between versions of
    // express-openid-connect — "cookie not found" in one, "checks.state argument is
    // missing" in another. What the test is about is that the callback is refused,
    // so it asserts that something was refused and leaves the sentence to the library.
    expect(errorShownAtLogin(response)).toMatch(/cookie not found|state argument is missing/);
    expect(provider.tokenRequests).toBe(0);
    expect((await browser.get('/whoami')).body.signedIn).toBe(false);
  });

  it('signs nobody in when the state is not the one it sent', async () => {
    const { app } = await build();
    const browser = request.agent(app);
    const { code } = await startSignIn(browser, {
      claims: { sub: 'sub-1', email: 'someone@example.com', email_verified: true },
    });

    const response = await callback(browser, { code, state: 'forged' });

    expect(errorShownAtLogin(response)).toMatch(/state mismatch/);
    expect(provider.tokenRequests).toBe(0);
    expect((await browser.get('/whoami')).body.signedIn).toBe(false);
  });

  it('signs nobody in when the provider reports an error instead of a code', async () => {
    const { app } = await build();
    const browser = request.agent(app);
    const { state } = await startSignIn(browser);

    const response = await callback(browser, {
      state,
      error: 'access_denied',
      error_description: 'The person declined',
    });

    expect(errorShownAtLogin(response)).toMatch(/access_denied/);
    expect(provider.tokenRequests).toBe(0);
    expect((await browser.get('/whoami')).body.signedIn).toBe(false);
  });

  it('signs nobody in when the provider sends no code', async () => {
    const { app } = await build();
    const browser = request.agent(app);
    const { state } = await startSignIn(browser);

    const response = await callback(browser, { state });

    // Without a code the library reads the response as one that should have
    // carried the id token itself, and refuses it for lacking one.
    expect(errorShownAtLogin(response)).toMatch(/id_token not present|code/);
    expect(provider.tokenRequests).toBe(0);
    expect((await browser.get('/whoami')).body.signedIn).toBe(false);
  });
});

/**
 * What the handler after the callback bases the account on, in the real flow.
 *
 * It used to read the signed-in person from `req.oidc.user`, which during the
 * callback is still the user of the session the browser arrived with — or
 * nobody. So a fresh sign-in had no id token claims to fall back on when
 * userinfo failed, compared userinfo's subject with nothing, and a second
 * person in a browser that already held a session was refused as a mismatch.
 */
describe('the identity a sign-in is based on', () => {
  it('comes from the id token when userinfo is unavailable', async () => {
    const { app, db } = await build();
    provider.userinfo = 'down';
    const browser = request.agent(app);

    const response = await signIn(browser, {
      sub: 'sub-1',
      email: 'someone@example.com',
      email_verified: true,
    });

    expect(response.headers.location).toBe('/browse/');
    expect((await browser.get('/whoami')).body).toEqual({ signedIn: true, sub: 'sub-1' });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('someone@example.com').n
    ).toBe(1);
  });

  it('is refused when userinfo describes somebody else than the id token', async () => {
    const { app, db } = await build();
    provider.userinfo = 'someone-else';
    const browser = request.agent(app);

    const response = await signIn(browser, {
      sub: 'sub-1',
      email: 'someone@example.com',
      email_verified: true,
    });

    expect(errorShownAtLogin(response)).toMatch(/does not match/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0);
    expect((await browser.get('/whoami')).body.signedIn).toBe(false);
  });

  it('is the person signing in now, in a browser that held somebody else', async () => {
    const { app, db } = await build();
    const browser = request.agent(app);
    await signIn(browser, { sub: 'sub-1', email: 'first@example.com', email_verified: true });
    expect((await browser.get('/whoami')).body.sub).toBe('sub-1');

    const response = await signIn(browser, {
      sub: 'sub-2',
      email: 'second@example.com',
      email_verified: true,
    });

    expect(response.headers.location).toBe('/browse/');
    expect((await browser.get('/whoami')).body).toEqual({ signedIn: true, sub: 'sub-2' });
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('second@example.com').n
    ).toBe(1);
  });
});

describe('who a completed sign-in makes someone', () => {
  it('creates the account the provider describes, an administrator when it is in the admin group', async () => {
    const { app, db } = await build();
    const browser = request.agent(app);

    const response = await signIn(browser, {
      sub: 'sub-1',
      email: 'boss@example.com',
      email_verified: true,
      preferred_username: 'boss',
      name: 'The Boss',
      groups: ['nx-admins'],
    });

    expect(response.headers.location).toBe('/browse/');
    expect(provider.tokenRequests).toBe(1);
    expect((await browser.get('/whoami')).body).toEqual({ signedIn: true, sub: 'sub-1' });
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get('boss@example.com');
    expect(row).toMatchObject({ username: 'boss', display_name: 'The Boss' });
    expect(JSON.parse(row.roles)).toEqual(['admin']);
  });

  it.each([[['nx-admins-readonly']], [['not-nx-admins']], [['nx']]])(
    'does not make an administrator of a group that only resembles the admin group: %j',
    async (groups) => {
      const { app, db } = await build();

      await signIn(request.agent(app), {
        sub: 'sub-1',
        email: 'someone@example.com',
        email_verified: true,
        groups,
      });

      expect(rolesOf(db, 'someone@example.com')).toEqual(['user']);
    }
  );

  it.each([
    ['a single group written in capitals', { groups: 'NX-Admins' }],
    ['the roles claim', { roles: ['nx-admins'] }],
    ['the entitlements claim, with spaces', { entitlements: [' nx-admins '] }],
  ])('recognises the admin group in %s', async (_label, groupClaim) => {
    const { app, db } = await build();

    await signIn(request.agent(app), {
      sub: 'sub-1',
      email: 'someone@example.com',
      email_verified: true,
      ...groupClaim,
    });

    expect(rolesOf(db, 'someone@example.com')).toEqual(['admin']);
  });

  /**
   * Linking on an address the provider has not vouched for would let anybody
   * who can register that address at the provider sign in as the account that
   * owns it here. Only a literal `true` is a verification: a provider sending
   * the string "false" has said no.
   */
  it.each([[false], ['false'], [undefined]])(
    'does not attach a sign-in to an existing account when email_verified is %j',
    async (emailVerified) => {
      const { app, db } = await build();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
         VALUES ('local-1', 'owner@example.com', 1, 'owner', 'Owner', '["admin"]', ?, ?)`
      ).run(now, now);
      const browser = request.agent(app);

      const response = await signIn(browser, {
        sub: 'somebody-at-the-provider',
        email: 'owner@example.com',
        email_verified: emailVerified,
      });

      expect(errorShownAtLogin(response)).toBe(
        'Email must be verified before linking an existing account.'
      );
      expect(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM auth_methods WHERE user_id = 'local-1' AND method_type = 'oidc'"
          )
          .get().n
      ).toBe(0);
      expect((await browser.get('/whoami')).body.signedIn).toBe(false);
    }
  );
});
