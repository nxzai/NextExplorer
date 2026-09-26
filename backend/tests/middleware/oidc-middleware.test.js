import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import express from 'express';
import { setupTestEnv, modulePath } from '../helpers/env-test-utils.js';

const require = createRequire(import.meta.url);

/**
 * This is the path that decides who someone is, in the deployments that use
 * it, and nothing exercised any of it. A regression here would be both silent
 * and serious — the roles half of it already was: membership was read once, at
 * account creation, while the documentation said otherwise.
 */

let envContext;

const build = async (env = {}) => {
  envContext = await setupTestEnv({ tag: 'oidc-middleware-', env });
  const middleware = envContext.requireFresh('src/middleware/oidc');
  const dbService = envContext.requireFresh('src/services/db');
  const db = await dbService.getDb();
  return { middleware, db };
};

afterEach(async () => {
  if (envContext) await envContext.cleanup();
  envContext = null;
});

describe('where the provider is told to come back to', () => {
  it('takes the origin of the callback URL when there is one', async () => {
    const { middleware } = await build();

    expect(middleware.deriveBaseUrl({ callbackUrl: 'https://files.example.com/callback' })).toBe(
      'https://files.example.com'
    );
  });

  it('falls back to the public URL', async () => {
    const { middleware } = await build({ PUBLIC_URL: 'https://files.example.com' });

    expect(middleware.deriveBaseUrl({})).toBe('https://files.example.com');
  });

  it('answers nothing rather than guessing', async () => {
    const { middleware } = await build();

    expect(middleware.deriveBaseUrl({})).toBeNull();
  });

  // A malformed value is a misconfiguration, not a reason to fail at startup.
  it('survives a callback URL that is not one', async () => {
    const { middleware } = await build();

    expect(middleware.deriveBaseUrl({ callbackUrl: 'https://' })).toBeNull();
  });
});

describe('whether the session cookie is marked secure', () => {
  it('marks it on https and not on http', async () => {
    const { middleware } = await build();

    expect(middleware.shouldOidcCookieBeSecure('https://files.example.com')).toBe(true);
    // Marking it on plain http would send a cookie the browser never returns,
    // and the login would loop.
    expect(middleware.shouldOidcCookieBeSecure('http://localhost:3000')).toBe(false);
    expect(middleware.shouldOidcCookieBeSecure(null)).toBe(false);
    expect(middleware.shouldOidcCookieBeSecure('not a url')).toBe(false);
  });
});

describe('what is asked of the provider', () => {
  it('always asks for openid, once', async () => {
    const { middleware } = await build();

    expect(middleware.resolveOidcScopes({ scopes: ['openid', 'profile'] })).toBe('openid profile');
    expect(middleware.resolveOidcScopes({ scopes: ['profile', 'email'] })).toBe(
      'openid profile email'
    );
  });

  it('has a usable default', async () => {
    const { middleware } = await build();

    expect(middleware.resolveOidcScopes({})).toBe('openid profile email');
  });

  // Without the groups scope the provider returns no group claim, which looks
  // exactly like a user who belongs to nothing.
  it('asks for groups when they are configured', async () => {
    const { middleware } = await build();

    expect(middleware.resolveOidcScopes({ scopes: ['openid', 'profile', 'groups'] })).toContain(
      'groups'
    );
  });
});

describe('what happens when someone comes back from the provider', () => {
  const callbackWith = async ({ claims, adminGroups = null, env = {} }) => {
    const { middleware, db } = await build(env);
    const handler = middleware.createAfterCallbackHandler(
      { issuer: 'https://idp.example' },
      { oidc: { adminGroups } }
    );

    const req = { oidc: { user: claims } };
    const session = { id_token_claims: claims };
    const returned = await handler(req, {}, session);

    return { db, returned, session };
  };

  const rolesOf = (db, email) => {
    const row = db.prepare('SELECT roles FROM users WHERE email = ?').get(email);
    return row ? JSON.parse(row.roles) : null;
  };

  it('creates the account the claims describe', async () => {
    const { db } = await callbackWith({
      claims: {
        sub: 'sub-1',
        email: 'someone@example.com',
        email_verified: true,
        preferred_username: 'someone',
        name: 'Some One',
      },
    });

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get('someone@example.com');
    expect(row).toBeTruthy();
    expect(row.username).toBe('someone');
    expect(row.display_name).toBe('Some One');
  });

  it('hands the session back untouched', async () => {
    const { returned, session } = await callbackWith({
      claims: { sub: 'sub-1', email: 'someone@example.com', email_verified: true },
    });

    expect(returned).toBe(session);
  });

  // Claims without a subject are not an identity. The login is refused rather
  // than an account made from whatever else the provider sent — and refused as
  // an authentication failure, which the error handler turns into a trip back
  // to the login screen rather than a server fault.
  it('refuses claims with no subject, and makes no account from them', async () => {
    const { middleware, db } = await build();
    const handler = middleware.createAfterCallbackHandler(
      { issuer: 'https://idp.example' },
      { oidc: { adminGroups: null } }
    );
    const claims = { email: 'nobody@example.com', email_verified: true };

    await expect(
      handler({ oidc: { user: claims } }, {}, { id_token_claims: claims })
    ).rejects.toMatchObject({ statusCode: 401 });

    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(0);
  });

  it('grants admin when the configured group is claimed', async () => {
    const { db } = await callbackWith({
      claims: {
        sub: 'sub-1',
        email: 'boss@example.com',
        email_verified: true,
        groups: ['nx-admins'],
      },
      adminGroups: ['nx-admins'],
    });

    expect(rolesOf(db, 'boss@example.com')).toContain('admin');
  });

  // The regression this must never cause: with no group configured every login
  // derives the plain `user` role, and applying it would demote the
  // administrator promoted from Settings at their next sign-in.
  it('leaves the roles alone when no group is configured', async () => {
    const { middleware, db } = await build();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
       VALUES ('u-1', 'boss@example.com', 1, 'boss', 'Boss', '["admin"]', ?, ?)`
    ).run(now, now);
    db.prepare(
      `INSERT INTO auth_methods (id, user_id, method_type, provider_issuer, provider_sub, provider_name, created_at)
       VALUES ('a-1', 'u-1', 'oidc', 'https://idp.example', 'sub-1', 'OIDC', ?)`
    ).run(now);

    const handler = middleware.createAfterCallbackHandler(
      { issuer: 'https://idp.example' },
      { oidc: { adminGroups: null } }
    );
    const claims = {
      sub: 'sub-1',
      email: 'boss@example.com',
      email_verified: true,
      groups: ['staff'],
    };
    await handler({ oidc: { user: claims } }, {}, { id_token_claims: claims });

    expect(JSON.parse(db.prepare("SELECT roles FROM users WHERE id = 'u-1'").get().roles)).toEqual([
      'admin',
    ]);
  });
});

/**
 * Signing out, which is more than forgetting the session here.
 *
 * The identity provider holds a session of its own, so the browser has to be
 * sent there to end it — and where it comes back to afterwards travels in the
 * URL. That makes the return address the interesting part: somewhere else's
 * address in `post_logout_redirect_uri` turns signing out into a redirect
 * anybody can aim.
 *
 * Fifty lines of it, untested until now, in a route reached by everybody who
 * signs out.
 */
describe('signing out through the identity provider', () => {
  const buildHandler = async ({
    logoutURL = 'https://idp.example/logout',
    returnTo = '/browse/',
  } = {}) => {
    const { middleware } = await build();
    const handler = middleware.createLogoutHandler({
      logoutURL,
      getReturnTo: () => returnTo,
      getSessionCookieName: () => 'appSession',
    });
    return handler;
  };

  /** A request that has a session, and a response that records what it was told. */
  const exchange = ({ idToken } = {}) => {
    const res = { redirects: [], cleared: [] };
    res.redirect = (url) => res.redirects.push(url);
    res.clearCookie = (name, options) => res.cleared.push({ name, options });
    const req = {
      oidc: idToken ? { idToken } : {},
      session: { destroy: (cb) => cb(null) },
      appSession: { some: 'session' },
    };
    return { req, res };
  };

  it('sends the browser to the provider', async () => {
    const handler = await buildHandler();
    const { req, res } = exchange();

    await handler(req, res);

    expect(res.redirects[0]).toContain('https://idp.example/logout');
  });

  it('tells it where to come back to', async () => {
    const handler = await buildHandler({ returnTo: 'https://files.example.com/browse/' });
    const { req, res } = exchange();

    await handler(req, res);

    expect(res.redirects[0]).toContain(
      `post_logout_redirect_uri=${encodeURIComponent('https://files.example.com/browse/')}`
    );
  });

  /**
   * The provider will not end a session it cannot identify, so the hint is what
   * makes the sign-out actually take effect rather than only appearing to.
   */
  it('passes the identity token as a hint when it has one', async () => {
    const handler = await buildHandler();
    const { req, res } = exchange({ idToken: 'the-id-token' });

    await handler(req, res);

    expect(res.redirects[0]).toContain('id_token_hint=the-id-token');
  });

  it('leaves the hint out when there is none', async () => {
    const handler = await buildHandler();
    const { req, res } = exchange();

    await handler(req, res);

    expect(res.redirects[0]).not.toContain('id_token_hint');
  });

  it('clears the session cookie', async () => {
    const handler = await buildHandler();
    const { req, res } = exchange();

    await handler(req, res);

    expect(res.cleared.map((c) => c.name)).toContain('appSession');
  });

  /**
   * Two names, because a session begun before cookies were scoped per origin
   * carries the old one — and a cookie nobody clears keeps somebody signed in
   * after they asked not to be.
   */
  it('clears the origin-scoped cookie and the older shared one', async () => {
    const { middleware } = await build();
    const handler = middleware.createLogoutHandler({
      logoutURL: 'https://idp.example/logout',
      getReturnTo: () => '/browse/',
      getSessionCookieName: () => 'appSession.files',
    });
    const { req, res } = exchange();

    await handler(req, res);

    expect([...new Set(res.cleared.map((c) => c.name))].sort()).toEqual([
      'appSession',
      'appSession.files',
    ]);
  });

  /**
   * Each name twice, once marked secure and once not. A cookie is only cleared
   * by an attribute set that matches the one it was written with, and an
   * instance reached over both http and https has written both.
   */
  it('clears each name for a secure and an insecure connection alike', async () => {
    const handler = await buildHandler();
    const { req, res } = exchange();

    await handler(req, res);

    const forAppSession = res.cleared.filter((c) => c.name === 'appSession');
    expect(forAppSession.map((c) => c.options.secure).sort()).toEqual([false, true]);
  });

  it('drops the server-side session too', async () => {
    const handler = await buildHandler();
    const { req, res } = exchange();

    await handler(req, res);

    expect(req.appSession).toBeUndefined();
  });

  /**
   * A session that refuses to be destroyed must not leave somebody stuck on a
   * page that no longer works: the sign-out carries on and the cookies still go.
   */
  it('carries on when the session will not be destroyed', async () => {
    const handler = await buildHandler();
    const res = { redirects: [], cleared: [] };
    res.redirect = (url) => res.redirects.push(url);
    res.clearCookie = (name) => res.cleared.push({ name });
    const req = {
      oidc: {},
      session: { destroy: (cb) => cb(new Error('store is down')) },
    };

    await handler(req, res);

    expect(res.redirects).toHaveLength(1);
    expect(res.cleared.length).toBeGreaterThan(0);
  });

  /** Somewhere is better than nowhere when the provider cannot be reached. */
  it('falls back to the return address when building the provider URL fails', async () => {
    const handler = await buildHandler({ returnTo: '/browse/' });
    const res = { redirects: [], cleared: [] };
    res.redirect = (url) => res.redirects.push(url);
    res.clearCookie = () => {
      throw new Error('cannot clear');
    };
    const req = { oidc: {}, session: { destroy: (cb) => cb(null) } };

    await handler(req, res);

    expect(res.redirects).toEqual(['/browse/']);
  });

  /**
   * Configured with something that is not a URL, there is no provider to send
   * anybody to — so no handler is installed, and the ordinary sign-out stands.
   */
  it('is not installed at all when the configured URL is not one', async () => {
    const { middleware } = await build();

    expect(
      middleware.createLogoutHandler({
        logoutURL: 'not-a-url',
        getReturnTo: () => '/browse/',
        getSessionCookieName: () => 'appSession',
      })
    ).toBeNull();
  });

  it('is not installed when no URL is configured', async () => {
    const { middleware } = await build();

    expect(
      middleware.createLogoutHandler({
        logoutURL: '',
        getReturnTo: () => '/browse/',
        getSessionCookieName: () => 'appSession',
      })
    ).toBeNull();
  });
});

/**
 * What the configuration pass concluded, which is the only place it is known.
 *
 * A sign-in refused later has to say whether the settings are missing or
 * whether what was configured could not be made to work: the first is answered
 * by filling them in, the second by looking at the provider, and answering the
 * first for both is what sent administrators to change a configuration that was
 * already right. Everything that fails here used to be one warning in the log
 * and nothing else.
 */
describe('what a configuration pass records', () => {
  const configured = {
    OIDC_ENABLED: 'true',
    OIDC_ISSUER: 'https://idp.example',
    OIDC_CLIENT_ID: 'nextexplorer',
    OIDC_CLIENT_SECRET: 'shhh',
    PUBLIC_URL: 'https://files.example.com',
  };

  const runConfigure = async (env) => {
    envContext = await setupTestEnv({ tag: 'oidc-configure-', env });
    const middleware = envContext.requireFresh('src/middleware/oidc');
    await middleware.configureOidc(express());
    // Required rather than required fresh: a fresh one would be a second
    // instance, and the pass wrote to the one the middleware loaded.
    return require(modulePath('src/utils/oidcAvailability')).getOidcAvailability();
  };

  it('says nothing is configured, and which settings are missing', async () => {
    const state = await runConfigure({});

    expect(state.status).toBe('not-configured');
    expect(state.reason).toContain('OIDC_ENABLED');
    expect(state.reason).toContain('OIDC_ISSUER');
  });

  /** Enabled, named, and with nowhere for the provider to come back to. */
  it('names the address it could not derive', async () => {
    const state = await runConfigure({
      OIDC_ENABLED: 'true',
      OIDC_ISSUER: 'https://idp.example',
      OIDC_CLIENT_ID: 'nextexplorer',
    });

    expect(state.status).toBe('not-configured');
    expect(state.reason).toContain('PUBLIC_URL');
  });

  it('says it is ready when the hand-off is mounted', async () => {
    const state = await runConfigure(configured);

    expect(state.status).toBe('ready');
  });

  /**
   * The settings this server asks for are all there and the library refuses
   * what it was handed. Nothing an administrator fixes by filling in
   * OIDC_ISSUER, so it must not read as a configuration that is missing.
   */
  it.each([['an issuer that is not a URL', { OIDC_ISSUER: 'not a url' }]])(
    'says the provider is unavailable, not unconfigured, for %s',
    async (_name, broken) => {
      const state = await runConfigure({ ...configured, ...broken });

      expect(state.status).toBe('unavailable');
      expect(state.reason).toBeTruthy();
    }
  );

  /**
   * The client secret used to be the other way round, and wrongly: it was left
   * out of the enablement check, so the library was handed a configuration it
   * refuses and the instance reported a provider that could not be started.
   * An administrator was sent to look at a provider that was perfectly well,
   * while the one setting they had missed was named in the log and nowhere
   * else. The hand-off asks for the authorization code flow, which has no
   * other way to prove which application is asking, so a missing secret is a
   * configuration that is missing — like the issuer, and named like it.
   */
  it('names the client secret rather than blaming the provider', async () => {
    const state = await runConfigure({ ...configured, OIDC_CLIENT_SECRET: undefined });

    expect(state.status).toBe('not-configured');
    expect(state.reason).toContain('OIDC_CLIENT_SECRET');
  });
});
