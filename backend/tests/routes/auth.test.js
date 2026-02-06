import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import session from 'express-session';
import bodyParser from 'body-parser';
import request from 'supertest';
import { setupTestEnv, clearModuleCache } from '../helpers/env-test-utils.js';

let envContext;

beforeAll(async () => {
  envContext = await setupTestEnv({
    tag: 'auth-routes-test-',
    modules: ['src/services/db', 'src/services/users', 'src/routes/auth'],
  });
});

afterAll(async () => {
  await envContext.cleanup();
});

const buildApp = ({ authEnabled } = {}) => {
  if (!envContext) {
    throw new Error('Test environment not initialized');
  }

  if (authEnabled === true) {
    process.env.AUTH_ENABLED = 'true';
  } else if (authEnabled === false) {
    process.env.AUTH_ENABLED = 'false';
  } else {
    delete process.env.AUTH_ENABLED;
  }

  clearModuleCache('src/config/env');
  clearModuleCache('src/config/index');
  clearModuleCache('src/services/db');
  clearModuleCache('src/services/users');

  const authRoutes = envContext.requireFresh('src/routes/auth');
  const app = express();
  app.use(bodyParser.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    })
  );

  // Minimal stub for req.oidc so /status works without EOC
  app.use((req, _res, next) => {
    req.oidc = { isAuthenticated: () => false };
    next();
  });

  app.use('/api/auth', authRoutes);
  return app;
};

describe('Auth Routes', () => {
  describe('Authentication Flow', () => {
    it('should complete setup -> login -> me -> password -> logout flow', async () => {
      const app = buildApp({ authEnabled: true });

      // status before setup
      const s1 = await request(app).get('/api/auth/status');
      expect(s1.status).toBe(200);
      expect(s1.body.requiresSetup).toBe(true);
      expect(s1.body.authEnabled).toBe(true);

      // setup admin
      const setup = await request(app)
        .post('/api/auth/setup')
        .send({
          email: 'admin@example.com',
          username: 'admin',
          password: 'secret123',
        });
      expect(setup.status).toBe(201);
      expect(setup.body.user).toBeDefined();
      expect(setup.body.user.roles).toContain('admin');

      // login
      const agent = request.agent(app);
      const loginResponse = await agent
        .post('/api/auth/login')
        .send({ email: 'admin@example.com', password: 'secret123' });
      expect(loginResponse.status).toBe(200);

      // me
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.username).toBe('admin');

      // change password
      const passwordChange = await agent
        .post('/api/auth/password')
        .send({ currentPassword: 'secret123', newPassword: 'newpass456' });
      expect(passwordChange.status).toBe(204);

      // logout
      const logout = await agent.post('/api/auth/logout');
      expect(logout.status).toBe(204);
    });
  });

  describe('Auth Status', () => {
    it('should reflect disabled auth via AUTH_ENABLED', async () => {
      const app = buildApp({ authEnabled: false });

      const status = await request(app).get('/api/auth/status');
      expect(status.status).toBe(200);
      expect(status.body.authEnabled).toBe(false);
      expect(status.body.authMode).toBe('both');
    });
  });
});
