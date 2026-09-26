import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { setupTestEnv, modulePath } from '../helpers/env-test-utils.js';

const require = createRequire(import.meta.url);

/**
 * The sign-in routes under /api/auth that hand over to the identity provider.
 *
 * Starting a sign-in puts two addresses in play: where the provider sends the
 * browser back with a code, and where the application sends it once signed
 * in. Both come from the request, so both have to be pinned to this site — a
 * Host header or a `redirect` parameter naming somewhere else would otherwise
 * deliver a code, or a signed-in visitor, to whoever wrote it.
 *
 * The mobile hand-off mints a single-use code for whoever completed the
 * provider sign-in in that browser. It must mint nothing for a sign-in that did
 * not finish, for one this browser never started, for one already spent, or
 * for an identity that has no account yet.
 *
 * The provider itself is not here: `req.oidc` and `res.oidc` are stood in for,
 * with the signed-in subject taken from a test header. What the real library
 * does with the addresses is covered in `middleware/oidc-provider-flow.test.js`.
 */

const ISSUER = 'https://idp.example';
const PUBLIC_URL = 'https://files.example.com';

let currentEnv;

afterEach(async () => {
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

/**
 * @param {object} [options]
 * @param {boolean} [options.providerReachable] whether the hand-off succeeds
 * @param {boolean} [options.providerMounted] whether there is a hand-off at
 *   all: `res.oidc` is what `configureOidc` attaches, and an installation it
 *   declined to configure — or could not — has none.
 */
const build = async ({ providerReachable = true, providerMounted = true } = {}) => {
  currentEnv = await setupTestEnv({
    tag: 'auth-oidc-routes-',
    env: {
      AUTH_ENABLED: 'true',
      OIDC_ENABLED: 'true',
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: 'nextexplorer',
      PUBLIC_URL,
    },
  });
  const authRoutes = currentEnv.requireFresh('src/routes/auth');
  const errorHandlers = currentEnv.requireFresh('src/middleware/errorHandler');
  const bridge = require(modulePath('src/services/oidcMobileBridge'));
  // The same instance the routes read: the configuration pass writes what it
  // concluded here, and there is no configuration pass in this suite.
  const availability = require(modulePath('src/utils/oidcAvailability'));
  const db = await require(modulePath('src/services/db')).getDb();

  const logins = [];
  const app = express();
  app.use(express.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use((req, res, next) => {
    const sub = req.get('x-test-oidc-sub');
    req.oidc = {
      isAuthenticated: () => Boolean(sub),
      user: sub ? { sub, email: `${sub}@example.com`, email_verified: true } : undefined,
    };
    if (providerMounted) {
      res.oidc = {
        login: async (options) => {
          logins.push(options);
          if (!providerReachable) {
            throw new Error('getaddrinfo ENOTFOUND idp.internal.example');
          }
          res.redirect(options.returnTo);
        },
      };
    }
    next();
  });
  app.use('/api/auth', authRoutes);
  app.use(errorHandlers.notFoundHandler);
  app.use(errorHandlers.errorHandler);

  return { app, bridge, db, logins, availability };
};

/** An account linked to the provider subject `sub-1`. */
const linkedAccount = (db) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES ('user-1', 'someone@example.com', 1, 'someone', 'Someone', '["user"]', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO auth_methods (id, user_id, method_type, provider_issuer, provider_sub, provider_name, created_at)
     VALUES ('auth-1', 'user-1', 'oidc', ?, 'sub-1', 'OIDC', ?)`
  ).run(ISSUER, now);
  return 'user-1';
};

const makePkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

describe('starting a sign-in at the provider', () => {
  it.each([['https://evil.example/steal'], ['//evil.example/steal'], ['/\\evil.example/steal']])(
    'keeps the return address on this site when given %s',
    async (redirect) => {
      const { app, logins } = await build();

      await request(app).get('/api/auth/oidc/login').query({ redirect });

      expect(logins).toHaveLength(1);
      expect(logins[0].returnTo).toBe('/browse/');
    }
  );

  it('keeps a return address that is on this site', async () => {
    const { app, logins } = await build();

    await request(app).get('/api/auth/oidc/login').query({ redirect: '/browse/Projects' });

    expect(logins[0].returnTo).toBe('/browse/Projects');
  });

  /** The code the provider hands back goes to this address. */
  it('tells the provider to come back to the configured address, whatever Host the request names', async () => {
    const { app, logins } = await build();

    await request(app).get('/api/auth/oidc/login').set('Host', 'evil.example');

    expect(logins[0].authorizationParams.redirect_uri).toBe(`${PUBLIC_URL}/callback`);
  });

  /**
   * An unreachable provider fails inside the library with the network's own
   * words, which name the provider's internal host.
   */
  it('answers a provider that cannot be reached with a refusal that names nothing of the network', async () => {
    const { app } = await build({ providerReachable: false });

    const response = await request(app).get('/api/auth/oidc/login');

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.location).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/ENOTFOUND|idp\.internal/);
  });
});

/**
 * Which of the two it is.
 *
 * Every refusal here used to be 404 "OIDC is not configured", including the one
 * meant for a provider that is simply down — so the administrator was sent to
 * change a configuration that was already right, and the reason the sign-in
 * failed was never written anywhere. The two answers are told apart by their
 * status and by a code, because the sign-in screen says what the code means in
 * the reader's own language and a server sentence cannot.
 */
describe('a sign-in that cannot be started', () => {
  const codeOf = (response) => response.body?.error?.code;

  it('says the configuration is missing when nothing was configured', async () => {
    const { app } = await build({ providerMounted: false });

    const response = await request(app).get('/api/auth/oidc/login');

    expect(response.status).toBe(404);
    expect(codeOf(response)).toBe('AUTH_OIDC_NOT_CONFIGURED');
  });

  /**
   * Settings that are all there and could not be made to work — a bad issuer
   * URL, discovery that did not answer at startup. Nothing to change in the
   * configuration, so nothing that should read as a missing one.
   */
  it('says the provider is unavailable when the configuration was there and failed', async () => {
    const { app, availability } = await build({ providerMounted: false });
    availability.recordOidcUnavailable('getaddrinfo ENOTFOUND idp.internal.example');

    const response = await request(app).get('/api/auth/oidc/login');

    expect(response.status).toBe(503);
    expect(codeOf(response)).toBe('AUTH_OIDC_PROVIDER_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toMatch(/ENOTFOUND|idp\.internal/);
  });

  it('says the same of a provider that was asked and did not answer', async () => {
    const { app } = await build({ providerReachable: false });

    const response = await request(app).get('/api/auth/oidc/login');

    expect(response.status).toBe(503);
    expect(codeOf(response)).toBe('AUTH_OIDC_PROVIDER_UNAVAILABLE');
  });

  /** The native app gets the same two answers, for the same reason. */
  it('tells the mobile hand-off apart as well', async () => {
    const { app } = await build({ providerMounted: false });
    const challenge = makePkce().challenge;

    const notConfigured = await request(app)
      .get('/api/auth/oidc/mobile/login')
      .query({ code_challenge: challenge });
    expect(notConfigured.status).toBe(404);
    expect(codeOf(notConfigured)).toBe('AUTH_OIDC_NOT_CONFIGURED');
  });

  /**
   * A browser is sent here, not a script: it navigates, and a JSON body becomes
   * a standalone error page it cannot read. It goes back to the sign-in screen
   * with the code, which is where the difference between the two is finally
   * shown to the person who can act on it.
   */
  it('sends a browser back to the sign-in screen, carrying which of the two it was', async () => {
    const { app } = await build({ providerReachable: false });

    const response = await request(app)
      .get('/api/auth/oidc/login')
      .set('Accept', 'text/html,application/xhtml+xml');

    expect(response.status).toBe(302);
    const landing = new URL(response.headers.location, PUBLIC_URL);
    expect(landing.pathname).toBe('/auth/login');
    expect(landing.searchParams.get('error_code')).toBe('AUTH_OIDC_PROVIDER_UNAVAILABLE');
    expect(landing.search).not.toMatch(/ENOTFOUND|idp\.internal/);
  });

  it('sends it back saying the configuration is missing when that is what it is', async () => {
    const { app } = await build({ providerMounted: false });

    const response = await request(app).get('/api/auth/oidc/login').set('Accept', 'text/html');

    expect(response.status).toBe(302);
    const landing = new URL(response.headers.location, PUBLIC_URL);
    expect(landing.searchParams.get('error_code')).toBe('AUTH_OIDC_NOT_CONFIGURED');
  });
});

describe('handing a sign-in back to the mobile app', () => {
  const start = async (agent, challenge) => {
    const response = await agent
      .get('/api/auth/oidc/mobile/login')
      .query({ code_challenge: challenge });
    expect(response.status).toBe(302);
  };

  /** Where the app is sent, as a URL, with the signed-in subject when there is one. */
  const complete = async (agent, sub) => {
    const pending = agent.get('/api/auth/oidc/mobile/complete');
    const response = sub ? await pending.set('x-test-oidc-sub', sub) : await pending;
    expect(response.status).toBe(302);
    return new URL(response.headers.location);
  };

  it('gives the app a code for the signed-in account, which its verifier redeems', async () => {
    const { app, db } = await build();
    const userId = linkedAccount(db);
    const { verifier, challenge } = makePkce();
    const browser = request.agent(app);
    await start(browser, challenge);

    const landing = await complete(browser, 'sub-1');

    expect(`${landing.protocol}//${landing.host}`).toBe('nextexplorer://oidc-callback');
    const code = landing.searchParams.get('code');
    expect(code).toBeTruthy();
    const exchange = await request(app)
      .post('/api/auth/oidc/exchange')
      .send({ code, code_verifier: verifier });
    expect(exchange.status).toBe(200);
    expect(exchange.body.user.id).toBe(userId);
  });

  it('gives no code when the provider sign-in did not finish', async () => {
    const { app, db } = await build();
    linkedAccount(db);
    const browser = request.agent(app);
    await start(browser, makePkce().challenge);

    const landing = await complete(browser, null);

    expect(landing.searchParams.get('error')).toBe('auth_failed');
    expect(landing.searchParams.get('code')).toBeNull();
  });

  it('gives no code when this browser never started a sign-in for the app', async () => {
    const { app, db } = await build();
    linkedAccount(db);

    const landing = await complete(request.agent(app), 'sub-1');

    expect(landing.searchParams.get('error')).toBe('auth_failed');
    expect(landing.searchParams.get('code')).toBeNull();
  });

  /** A second visit to the same page would otherwise mint a second code. */
  it('spends the pending sign-in, so a second visit gets no second code', async () => {
    const { app, db } = await build();
    linkedAccount(db);
    const browser = request.agent(app);
    await start(browser, makePkce().challenge);
    expect((await complete(browser, 'sub-1')).searchParams.get('code')).toBeTruthy();

    const again = await complete(browser, 'sub-1');

    expect(again.searchParams.get('error')).toBe('auth_failed');
    expect(again.searchParams.get('code')).toBeNull();
  });

  /**
   * Until the provider sign-in has created a row, the account is a stand-in
   * built from the claims, and a code bound to its made-up id would name
   * nobody the exchange can find.
   */
  it('gives no code for an identity that has no account yet', async () => {
    const { app } = await build();
    const browser = request.agent(app);
    await start(browser, makePkce().challenge);

    const landing = await complete(browser, 'sub-without-account');

    expect(landing.searchParams.get('error')).toBe('no_profile');
    expect(landing.searchParams.get('code')).toBeNull();
  });
});

describe('exchanging a code for a session', () => {
  it('refuses a code whose account was deleted after it was issued, and leaves nobody signed in', async () => {
    const { app, bridge, db } = await build();
    const userId = linkedAccount(db);
    const { verifier, challenge } = makePkce();
    const code = bridge.issueCode({ userId, codeChallenge: challenge });
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    const browser = request.agent(app);

    const response = await browser
      .post('/api/auth/oidc/exchange')
      .send({ code, code_verifier: verifier });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('User no longer exists.');
    expect((await browser.get('/api/auth/me')).body.user).toBeNull();
  });
});

/**
 * What the sign-in screen is told before anybody presses anything.
 *
 * A provider that cannot be reached, or settings that were never filled in,
 * used to be discovered by pressing the button: the browser travelled to the
 * provider, or to a hand-off that was not mounted, and came back here with the
 * answer. The screen asks once, at load, and says the same two things without
 * the round trip.
 *
 * The reason stays behind: it names settings and library messages, and this
 * answer is given to anybody who can reach the server.
 */
describe('what /status says about single sign-on', () => {
  it.each([
    ['ready', (availability) => availability.recordOidcReady()],
    ['not-configured', (availability) => availability.recordOidcNotConfigured('OIDC_ISSUER')],
    ['unavailable', (availability) => availability.recordOidcUnavailable('ENOTFOUND idp.example')],
  ])('reports %s', async (expected, record) => {
    const { app, availability } = await build();
    record(availability);

    const response = await request(app).get('/api/auth/status');

    expect(response.status).toBe(200);
    expect(response.body.oidc.status).toBe(expected);
  });

  it('keeps the reason to itself', async () => {
    const { app, availability } = await build();
    availability.recordOidcUnavailable('client secret is required, and the issuer is idp.internal');

    const response = await request(app).get('/api/auth/status');

    expect(JSON.stringify(response.body)).not.toContain('idp.internal');
    expect(response.body.oidc).not.toHaveProperty('reason');
  });
});
