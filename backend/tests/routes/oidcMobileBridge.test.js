import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import request from 'supertest';
import { setupTestEnv, clearModuleCache, modulePath } from '../helpers/env-test-utils.js';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto');

let envContext;
let bridge;
let app; // exchange app: real session, no res.oidc.login
let loginApp; // login app: stubbed res.oidc.login so /oidc/mobile/login is exercisable
let admin;

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The session id a response hands back, or null when it sets none. */
const sessionId = (response) => {
  const cookie = []
    .concat(response.headers['set-cookie'] || [])
    .find((entry) => entry.startsWith('connect.sid='));
  return cookie ? cookie.split(';')[0].slice('connect.sid='.length) : null;
};

const makePkce = () => {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

// oidcLogin: when true, stub res.oidc.login so /oidc/mobile/login is exercisable.
const buildApp = (authRoutes, errorHandlers, { oidcLogin = false } = {}) => {
  const instance = express();
  instance.use(bodyParser.json());
  instance.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    })
  );
  instance.use((req, res, next) => {
    req.oidc = { isAuthenticated: () => false };
    if (oidcLogin) {
      res.oidc = { login: async ({ returnTo }) => res.redirect(returnTo || '/') };
    }
    next();
  });
  instance.use('/api/auth', authRoutes);
  instance.use(errorHandlers.notFoundHandler);
  instance.use(errorHandlers.errorHandler);
  return instance;
};

// One shared server per file. Submodules of the users service cache the DB
// instance, so tearing down and rebuilding per test does not reset the DB
// reliably. A single long lived app (as in production) keeps the tests honest.
beforeAll(async () => {
  envContext = await setupTestEnv({
    tag: 'oidc-mobile-routes-test-',
    modules: ['src/services/db', 'src/services/users', 'src/routes/auth'],
    env: { AUTH_ENABLED: 'true' },
  });
  bridge = require(modulePath('src/services/oidcMobileBridge'));

  try {
    fs.rmSync(path.join(envContext.configDir, 'app.db'), { force: true });
  } catch (_) {
    // ignore
  }
  process.env.AUTH_ENABLED = 'true';
  clearModuleCache('src/config/env');
  clearModuleCache('src/config/index');
  clearModuleCache('src/services/db');
  clearModuleCache('src/services/users');

  const authRoutes = envContext.requireFresh('src/routes/auth');
  const errorHandlers = envContext.requireFresh('src/middleware/errorHandler');
  app = buildApp(authRoutes, errorHandlers);
  loginApp = buildApp(authRoutes, errorHandlers, { oidcLogin: true });

  const setup = await request(app).post('/api/auth/setup').send({
    email: 'admin@example.com',
    username: 'admin',
    password: 'secret123',
  });
  expect(setup.status).toBe(201);
  admin = setup.body.user;
});

afterAll(async () => {
  await envContext.cleanup();
});

beforeEach(() => bridge._reset());

describe('OIDC mobile bridge routes', () => {
  describe('POST /api/auth/oidc/exchange', () => {
    it('exchanges a valid code + verifier for a working local session', async () => {
      const { verifier, challenge } = makePkce();
      const code = bridge.issueCode({ userId: admin.id, codeChallenge: challenge });

      const agent = request.agent(app);
      const exchange = await agent
        .post('/api/auth/oidc/exchange')
        .send({ code, code_verifier: verifier });
      expect(exchange.status).toBe(200);
      expect(exchange.body.user.username).toBe('admin');

      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.username).toBe('admin');
    });

    it('rejects a wrong verifier with 401', async () => {
      const { challenge } = makePkce();
      const code = bridge.issueCode({ userId: admin.id, codeChallenge: challenge });

      const res = await request(app)
        .post('/api/auth/oidc/exchange')
        .send({ code, code_verifier: makePkce().verifier });
      expect(res.status).toBe(401);
    });

    it('rejects a reused code with 401', async () => {
      const { verifier, challenge } = makePkce();
      const code = bridge.issueCode({ userId: admin.id, codeChallenge: challenge });

      const first = await request(app)
        .post('/api/auth/oidc/exchange')
        .send({ code, code_verifier: verifier });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/auth/oidc/exchange')
        .send({ code, code_verifier: verifier });
      expect(second.status).toBe(401);
    });

    /**
     * The session id has to change when the session becomes signed in.
     *
     * Otherwise anyone who knew the id beforehand — planted it, read it from a
     * log, watched it go by — knows a signed-in one afterwards. Every other way
     * into this application goes through `startAuthenticatedSession` for this
     * reason; the exchange assigned the user onto the session in hand instead.
     */
    it('gives the caller a different session than the one it arrived with', async () => {
      const { verifier, challenge } = makePkce();
      const agent = request.agent(loginApp);

      // Step one writes the PKCE challenge to the session, which is what makes
      // express-session issue a cookie at all — so the caller reaches the
      // exchange already holding a session id, exactly as the app does.
      const started = await agent.get(
        `/api/auth/oidc/mobile/login?code_challenge=${challenge}&code_challenge_method=S256`
      );
      expect(started.status).toBe(302);
      const before = sessionId(started);
      expect(before).toBeTruthy();

      const code = bridge.issueCode({ userId: admin.id, codeChallenge: challenge });
      const after = await agent
        .post('/api/auth/oidc/exchange')
        .send({ code, code_verifier: verifier });

      expect(after.status).toBe(200);
      expect(sessionId(after)).toBeTruthy();
      expect(sessionId(after)).not.toBe(before);
    });

    /**
     * Signing in ends any guest session the same browser was carrying. The
     * cookie was once set on /api and is now set on /, and a browser holding
     * the older one keeps it unless both are cleared.
     */
    it('clears a guest session on both the paths it may have been set on', async () => {
      const { verifier, challenge } = makePkce();
      const code = bridge.issueCode({ userId: admin.id, codeChallenge: challenge });

      const response = await request(app)
        .post('/api/auth/oidc/exchange')
        .send({ code, code_verifier: verifier });

      const cleared = []
        .concat(response.headers['set-cookie'] || [])
        .filter((c) => c.startsWith('guestSession='));
      expect(cleared.some((c) => /Path=\/(;|$)/.test(c))).toBe(true);
      expect(cleared.some((c) => /Path=\/api/.test(c))).toBe(true);
    });

    it('rejects an unknown code with 401', async () => {
      const res = await request(app)
        .post('/api/auth/oidc/exchange')
        .send({ code: 'does-not-exist', code_verifier: makePkce().verifier });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/oidc/mobile/login', () => {
    it('returns 400 for a missing or invalid PKCE challenge', async () => {
      const res = await request(loginApp).get('/api/auth/oidc/mobile/login');
      expect(res.status).toBe(400);
    });

    /**
     * `plain` means the challenge is the verifier, sent in the clear — the mode
     * PKCE exists to replace. Refused where it is asked for rather than three
     * requests later, where the app has already sent the user to the provider.
     */
    it('returns 400 for a challenge method other than S256', async () => {
      const { challenge } = makePkce();

      const response = await request(loginApp).get(
        `/api/auth/oidc/mobile/login?code_challenge=${challenge}&code_challenge_method=plain`
      );

      expect(response.status).toBe(400);
    });

    it('returns 400 for an unrecognized redirect_uri', async () => {
      const { challenge } = makePkce();
      const res = await request(loginApp)
        .get('/api/auth/oidc/mobile/login')
        .query({ code_challenge: challenge, redirect_uri: 'evil://steal' });
      expect(res.status).toBe(400);
    });

    it('kicks off OIDC login with a valid challenge', async () => {
      const { challenge } = makePkce();
      const res = await request(loginApp)
        .get('/api/auth/oidc/mobile/login')
        .query({ code_challenge: challenge });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/api/auth/oidc/mobile/complete');
    });

    it('returns 404 when OIDC is not configured', async () => {
      const { challenge } = makePkce();
      const res = await request(app) // app has no res.oidc.login
        .get('/api/auth/oidc/mobile/login')
        .query({ code_challenge: challenge });
      expect(res.status).toBe(404);
    });
  });
});
