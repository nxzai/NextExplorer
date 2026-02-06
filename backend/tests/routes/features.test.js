import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { clearModuleCache, overrideEnv } from '../helpers/env-test-utils.js';

const backendPackage = require('../../package.json');

const buildApp = () => {
  clearModuleCache('src/config/env');
  clearModuleCache('src/config/index');
  clearModuleCache('src/routes/features');

  const featureRoutes = require('../../src/routes/features');
  const app = express();
  app.use('/api', featureRoutes);
  return app;
};

describe('Features Routes', () => {
  let restoreEnv;

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
      restoreEnv = null;
    }
  });

  describe('GET /api/features', () => {
    it('should expose default feature flags and version metadata', async () => {
      restoreEnv = overrideEnv({
        ONLYOFFICE_URL: undefined,
        ONLYOFFICE_FILE_EXTENSIONS: undefined,
        COLLABORA_URL: undefined,
        COLLABORA_SECRET: undefined,
        COLLABORA_FILE_EXTENSIONS: undefined,
        EDITOR_EXTENSIONS: undefined,
        SHOW_VOLUME_USAGE: undefined,
        SKIP_HOME: undefined,
        GIT_COMMIT: undefined,
        GIT_BRANCH: undefined,
        REPO_URL: undefined,
      });

      const app = buildApp();
      const response = await request(app).get('/api/features');

      expect(response.status).toBe(200);
      expect(response.body.onlyoffice.enabled).toBe(false);
      expect(response.body.onlyoffice.extensions).toEqual([]);
      expect(response.body.collabora.enabled).toBe(false);
      expect(response.body.collabora.extensions).toEqual([]);
      expect(response.body.editor.extensions).toEqual([]);
      expect(response.body.volumeUsage.enabled).toBe(false);
      expect(response.body.navigation.skipHome).toBe(false);
      expect(response.body.version.app).toBe(backendPackage.version);
      expect(response.body.version.gitCommit).toBe('');
      expect(response.body.version.gitBranch).toBe('');
      expect(response.body.version.repoUrl).toBe('');
    });

    it('should reflect enabled editors, onlyoffice, and volume usage', async () => {
      restoreEnv = overrideEnv({
        ONLYOFFICE_URL: 'https://desk.example.com',
        ONLYOFFICE_FILE_EXTENSIONS: '.docx, .XLSX',
        COLLABORA_URL: 'https://collabora.example.com',
        COLLABORA_SECRET: 'collabora-secret',
        COLLABORA_FILE_EXTENSIONS: '.odt, .ODS',
        EDITOR_EXTENSIONS: '.MD,.txt',
        SHOW_VOLUME_USAGE: 'true',
        SKIP_HOME: 'true',
        GIT_COMMIT: 'abc123',
        GIT_BRANCH: 'main',
        REPO_URL: 'https://example.com/repo',
      });

      const app = buildApp();
      const response = await request(app).get('/api/features');

      expect(response.status).toBe(200);
      expect(response.body.onlyoffice.enabled).toBe(true);
      expect(response.body.onlyoffice.extensions).toEqual(['.docx', '.xlsx']);
      expect(response.body.collabora.enabled).toBe(true);
      expect(response.body.collabora.extensions).toEqual(['.odt', '.ods']);
      expect(response.body.editor.extensions).toEqual(['.md', '.txt']);
      expect(response.body.volumeUsage.enabled).toBe(true);
      expect(response.body.navigation.skipHome).toBe(true);
      expect(response.body.version.gitCommit).toBe('abc123');
      expect(response.body.version.gitBranch).toBe('main');
      expect(response.body.version.repoUrl).toBe('https://example.com/repo');
    });
  });
});
