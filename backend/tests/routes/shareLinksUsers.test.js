import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { setupTestEnv, clearModuleCache } from '../helpers/env-test-utils.js';

let envContext;

beforeAll(async () => {
  envContext = await setupTestEnv({
    tag: 'share-links-users-test-',
    modules: [
      'src/services/db',
      'src/services/users',
      'src/middleware/authMiddleware',
      'src/middleware/errorHandler',
      'src/routes/auth',
      'src/routes/shares',
    ],
  });
});

afterAll(async () => {
  await envContext.cleanup();
});

const buildApp = () => {
  if (!envContext) throw new Error('Test environment not initialized');

  process.env.AUTH_ENABLED = 'true';
  clearModuleCache('src/config/env');
  clearModuleCache('src/config/index');

  const authRoutes = envContext.requireFresh('src/routes/auth');
  const sharesRoutes = envContext.requireFresh('src/routes/shares');
  const authMiddleware = envContext.requireFresh('src/middleware/authMiddleware');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
    })
  );

  // Minimal stub for req.oidc so auth middleware doesn't treat requests as EOC-authenticated.
  app.use((req, _res, next) => {
    req.oidc = { isAuthenticated: () => false };
    next();
  });

  app.use(authMiddleware);

  app.use('/api/auth', authRoutes);
  app.use('/api/shares', sharesRoutes);
  app.use('/api/share', sharesRoutes);
  app.use(errorHandler);

  return app;
};

describe('Share Links for Specific Users', () => {
  describe('User-Specific Share Access', () => {
    it('should allow /api/share/:token/access when logged in as recipient', async () => {
      const usersService = envContext.requireFresh('src/services/users');
      const app = buildApp();

      // Setup the first account (admin/owner).
      const setupResponse = await request(app).post('/api/auth/setup').send({
        email: 'owner@example.com',
        username: 'owner',
        password: 'secret123',
      });
      expect(setupResponse.status).toBe(201);

      // Create a recipient user directly in DB.
      const recipient = await usersService.createLocalUser({
        email: 'recipient@example.com',
        username: 'recipient',
        displayName: 'Recipient',
        password: 'secret123',
        roles: ['user'],
      });

      // Create a folder to share under the volume root.
      const sharedFolder = path.join(envContext.volumeDir, 'docs');
      await fs.mkdir(sharedFolder, { recursive: true });
      await fs.writeFile(path.join(sharedFolder, 'hello.txt'), 'hello');

      // Owner logs in and creates a user-specific share to the recipient.
      const ownerAgent = request.agent(app);
      const loginResponse = await ownerAgent
        .post('/api/auth/login')
        .send({ email: 'owner@example.com', password: 'secret123' });
      expect(loginResponse.status).toBe(200);

      const shareCreate = await ownerAgent.post('/api/shares').send({
        sourcePath: 'docs',
        accessMode: 'readonly',
        sharingType: 'users',
        userIds: [recipient.id],
      });

      expect(shareCreate.status).toBe(201);
      const token = shareCreate.body?.shareToken;
      expect(token).toBeDefined();

      // Recipient logs in and can access via the share access endpoint.
      const recipientAgent = request.agent(app);
      const recipientLogin = await recipientAgent
        .post('/api/auth/login')
        .send({ email: 'recipient@example.com', password: 'secret123' });
      expect(recipientLogin.status).toBe(200);

      const access = await recipientAgent.get(`/api/share/${token}/access`);

      expect(access.status).toBe(200);
      expect(access.body?.share?.shareToken).toBe(token);
      expect(access.body?.share?.sourcePath).toBe(`share/${token}`);
    });
  });
});
