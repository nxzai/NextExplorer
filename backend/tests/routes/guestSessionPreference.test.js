import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { setupTestEnv, clearModuleCache } from '../helpers/env-test-utils.js';

let envContext;

beforeAll(async () => {
  envContext = await setupTestEnv({
    tag: 'guest-session-preference-test-',
    modules: [
      'src/services/db',
      'src/services/users',
      'src/services/sharesService',
      'src/services/guestSessionService',
      'src/middleware/authMiddleware',
      'src/middleware/errorHandler',
      'src/routes/auth',
      'src/routes/shares',
      'src/routes/browse',
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
  const browseRoutes = envContext.requireFresh('src/routes/browse');
  const authMiddleware = envContext.requireFresh('src/middleware/authMiddleware');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
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
  app.use('/api', browseRoutes);
  app.use(errorHandler);

  return app;
};

describe('Guest Session Preference', () => {
  describe('Authentication Priority', () => {
    it('should prioritize authenticated user over guest session when browsing volumes', async () => {
      const app = buildApp();

      // Create a folder in the test volume.
      const projectsDir = path.join(envContext.volumeDir, 'Projects');
      await fs.mkdir(projectsDir, { recursive: true });
      await fs.writeFile(path.join(projectsDir, 'hello.txt'), 'hello');

      // Setup and login as owner.
      const ownerAgent = request.agent(app);
      const setupResponse = await ownerAgent.post('/api/auth/setup').send({
        email: 'owner@example.com',
        username: 'owner',
        password: 'secret123',
      });
      expect(setupResponse.status).toBe(201);

      // Create an anyone share so a guest session can be created.
      const createShare = await ownerAgent.post('/api/shares').send({
        sourcePath: 'Projects',
        accessMode: 'readonly',
        sharingType: 'anyone',
      });

      expect(createShare.status).toBe(201);
      const token = createShare.body?.shareToken;
      expect(token).toBeDefined();

      // Simulate a guest opening the share link to create a guest session.
      const guestAccess = await request(app).get(`/api/share/${token}/access`);

      expect(guestAccess.status).toBe(200);
      const guestSessionId = guestAccess.body?.guestSessionId;
      expect(guestSessionId).toBeDefined();

      // Now simulate the logged-in user making a request while a stale guest session is still present.
      // (Matches the real-world case where a guest session cookie/header lingers after login.)
      const browse = await ownerAgent
        .get('/api/browse/Projects')
        .set('X-Guest-Session', guestSessionId);

      expect(browse.status).toBe(200);
      const names = (browse.body.items || []).map((item) => item.name);
      expect(names).toContain('hello.txt');
    });
  });
});
