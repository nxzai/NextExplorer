import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { setupTestEnv, clearModuleCache } from '../helpers/env-test-utils.js';

let envContext;

beforeAll(async () => {
  envContext = await setupTestEnv({
    tag: 'shares-routes-test-',
    env: {
      USER_VOLUMES: 'true',
    },
    modules: [
      'src/services/db',
      'src/services/users',
      'src/services/userVolumesService',
      'src/services/sharesService',
      'src/utils/pathUtils',
      'src/middleware/errorHandler',
      'src/routes/shares',
    ],
  });
});

afterAll(async () => {
  await envContext.cleanup();
});

const buildApp = ({ user } = {}) => {
  if (!envContext) throw new Error('Test environment not initialized');

  clearModuleCache('src/config/env');
  clearModuleCache('src/config/index');

  const sharesRoutes = envContext.requireFresh('src/routes/shares');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');

  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });

  app.use('/api/shares', sharesRoutes);
  app.use('/api/share', sharesRoutes);
  app.use(errorHandler);
  return app;
};

describe('Shares Routes', () => {
  describe('User Volumes', () => {
    it('should create and browse share from assigned volume path', async () => {
      const usersService = envContext.requireFresh('src/services/users');
      const userVolumesService = envContext.requireFresh('src/services/userVolumesService');

      const assignedRoot = path.join(envContext.tmpRoot, 'assigned-volume');
      await fs.mkdir(assignedRoot, { recursive: true });

      const sharedFolder = path.join(assignedRoot, 'myfolder');
      await fs.mkdir(sharedFolder, { recursive: true });
      await fs.writeFile(path.join(sharedFolder, 'hello.txt'), 'hello');

      const user = await usersService.createLocalUser({
        email: 'user@example.com',
        username: 'user',
        displayName: 'User',
        password: 'secret123',
        roles: ['user'],
      });

      const vol = await userVolumesService.addVolumeToUser({
        userId: user.id,
        label: 'MyVol',
        volumePath: assignedRoot,
        accessMode: 'readwrite',
      });

      const app = buildApp({ user });

      const create = await request(app)
        .post('/api/shares')
        .send({
          sourcePath: 'MyVol/myfolder',
          accessMode: 'readonly',
          sharingType: 'anyone',
        });

      expect(create.status).toBe(201);
      expect(create.body.shareToken).toBeDefined();
      expect(create.body.sourceSpace).toBe('user_volume');
      expect(create.body.sourcePath).toBe(`${vol.id}/myfolder`);

      const browse = await request(app).get(`/api/share/${create.body.shareToken}/browse/`);

      expect(browse.status).toBe(200);
      const names = (browse.body.items || []).map((item) => item.name);
      expect(names).toContain('hello.txt');
    });

    it('should not allow read-write share for readonly assigned volume', async () => {
      const usersService = envContext.requireFresh('src/services/users');
      const userVolumesService = envContext.requireFresh('src/services/userVolumesService');

      const assignedRoot = path.join(envContext.tmpRoot, 'assigned-volume-readonly');
      await fs.mkdir(assignedRoot, { recursive: true });
      await fs.mkdir(path.join(assignedRoot, 'folder'), { recursive: true });

      const user = await usersService.createLocalUser({
        email: 'user2@example.com',
        username: 'user2',
        displayName: 'User2',
        password: 'secret123',
        roles: ['user'],
      });

      await userVolumesService.addVolumeToUser({
        userId: user.id,
        label: 'ReadOnlyVol',
        volumePath: assignedRoot,
        accessMode: 'readonly',
      });

      const app = buildApp({ user });

      const response = await request(app).post('/api/shares').send({
        sourcePath: 'ReadOnlyVol/folder',
        accessMode: 'readwrite',
        sharingType: 'anyone',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Share Expiry', () => {
    it('should not allow access or browse of expired shares', async () => {
      const usersService = envContext.requireFresh('src/services/users');
      const userVolumesService = envContext.requireFresh('src/services/userVolumesService');

      const assignedRoot = path.join(envContext.tmpRoot, 'assigned-volume-expiry');
      await fs.mkdir(assignedRoot, { recursive: true });

      const sharedFolder = path.join(assignedRoot, 'myfolder');
      await fs.mkdir(sharedFolder, { recursive: true });
      await fs.writeFile(path.join(sharedFolder, 'hello.txt'), 'hello');

      const user = await usersService.createLocalUser({
        email: 'user-expiry@example.com',
        username: 'user-expiry',
        displayName: 'User Expiry',
        password: 'secret123',
        roles: ['user'],
      });

      await userVolumesService.addVolumeToUser({
        userId: user.id,
        label: 'ExpiryVol',
        volumePath: assignedRoot,
        accessMode: 'readwrite',
      });

      const app = buildApp({ user });

      const create = await request(app)
        .post('/api/shares')
        .send({
          sourcePath: 'ExpiryVol/myfolder',
          accessMode: 'readonly',
          sharingType: 'anyone',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });

      expect(create.status).toBe(201);
      const { id: shareId, shareToken } = create.body;
      expect(shareId).toBeDefined();
      expect(shareToken).toBeDefined();

      // Expire the share
      const updateResponse = await request(app)
        .put(`/api/shares/${shareId}`)
        .send({ expiresAt: '2000-01-01T00:00:00.000Z' });
      expect(updateResponse.status).toBe(200);

      // Check info shows expired
      const info = await request(app).get(`/api/share/${shareToken}/info`);
      expect(info.status).toBe(200);
      expect(info.body.isExpired).toBe(true);

      // Access should be forbidden
      const access = await request(app).get(`/api/share/${shareToken}/access`);
      expect(access.status).toBe(403);

      // Browse should be forbidden
      const browse = await request(app).get(`/api/share/${shareToken}/browse/`);
      expect(browse.status).toBe(403);
    });
  });
});
