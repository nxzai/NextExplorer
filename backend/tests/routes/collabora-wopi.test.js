import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestEnv } from '../helpers/env-test-utils.js';

const buildApp = (routes, { notFoundHandler, errorHandler }) => {
  const app = express();
  app.use('/api', routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

describe('Collabora WOPI Routes', () => {
  describe('Authentication', () => {
    it('should reject requests with missing token', async () => {
      const env = await setupTestEnv({
        tag: 'collabora-wopi-',
        modules: [
          'src/routes/collabora',
          'src/services/wopiLockService',
          'src/middleware/errorHandler',
        ],
        env: {
          COLLABORA_URL: 'https://collabora.example.com',
          COLLABORA_SECRET: 'test-collabora-secret',
        },
      });

      try {
        const collaboraRoutes = env.requireFresh('src/routes/collabora');
        const errorMiddleware = env.requireFresh('src/middleware/errorHandler');
        const app = buildApp(collaboraRoutes, errorMiddleware);

        const response = await request(app).get('/api/collabora/wopi/files/file-1');

        expect(response.status).toBe(401);
        // The error response format may vary, just verify 401 status was returned
      } finally {
        await env.cleanup();
      }
    });
  });

  describe('File Operations', () => {
    it('should handle GetFile and PutFile with valid token', async () => {
      const env = await setupTestEnv({
        tag: 'collabora-wopi-',
        modules: ['src/routes/collabora', 'src/config/index', 'src/middleware/errorHandler'],
        env: {
          COLLABORA_URL: 'https://collabora.example.com',
          COLLABORA_SECRET: 'test-collabora-secret',
        },
      });

      try {
        const { collabora } = env.requireFresh('src/config/index');
        const collaboraRoutes = env.requireFresh('src/routes/collabora');
        const errorMiddleware = env.requireFresh('src/middleware/errorHandler');
        const app = buildApp(collaboraRoutes, errorMiddleware);

        const abs = path.join(env.tmpRoot, 'sample.docx');
        await fs.writeFile(abs, Buffer.from('original'));

        const fileId = 'file-1';
        const accessToken = jwt.sign(
          {
            fileId,
            absolutePath: abs,
            canWrite: true,
            userId: 'user-1',
            userName: 'Test User',
          },
          collabora.secret,
          { algorithm: 'HS256', expiresIn: 60 }
        );

        // GetFile
        const getResponse = await request(app)
          .get(`/api/collabora/wopi/files/${fileId}/contents`)
          .query({ access_token: accessToken });

        expect(getResponse.status).toBe(200);
        const bodyText = Buffer.isBuffer(getResponse.body)
          ? getResponse.body.toString('utf8')
          : String(getResponse.text || '');
        expect(bodyText).toBe('original');

        // PutFile
        const putResponse = await request(app)
          .post(`/api/collabora/wopi/files/${fileId}/contents`)
          .query({ access_token: accessToken })
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from('updated'));

        expect(putResponse.status).toBe(200);

        const updated = await fs.readFile(abs, 'utf8');
        expect(updated).toBe('updated');
      } finally {
        await env.cleanup();
      }
    });
  });
});
