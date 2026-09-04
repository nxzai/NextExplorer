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
