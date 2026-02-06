import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { clearModuleCache } from '../helpers/env-test-utils.js';

const buildApp = () => {
  clearModuleCache('src/routes/health');

  const healthRoutes = require('../../src/routes/health');
  const app = express();
  app.use('/', healthRoutes);
  return app;
};

describe('Health Routes', () => {
  describe('GET /healthz', () => {
    it('should return ok status', async () => {
      const app = buildApp();
      const response = await request(app).get('/healthz');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /readyz', () => {
    it('should return ready status', async () => {
      const app = buildApp();
      const response = await request(app).get('/readyz');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ready' });
    });
  });
});
