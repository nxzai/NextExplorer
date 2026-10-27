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
        HIDDEN_FILE_PATTERNS: undefined,
        TERMINAL_FILE_EXTENSIONS: undefined,
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
      // How many tabs a row may hold, which the strip needs before it draws one:
      // it never scrolls, so this is what keeps a tab wide enough to read.
      expect(response.body.tabs.maxOpen).toBe(10);
      expect(response.body.hiddenFiles.patterns).toEqual([
        '.',
        'regex:\\.download$',
        'regex:\\.uploading$',
      ]);
      expect(response.body.terminal.extensions).toEqual(['sh']);
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
        HIDDEN_FILE_PATTERNS: '.,@',
        TERMINAL_FILE_EXTENSIONS: '.SH,.bash',
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
      expect(response.body.editor.extensions).toEqual(['md', 'txt']);
      expect(response.body.hiddenFiles.patterns).toEqual(['.', '@']);
      expect(response.body.terminal.extensions).toEqual(['sh', 'bash']);
      expect(response.body.volumeUsage.enabled).toBe(true);
      expect(response.body.navigation.skipHome).toBe(true);
      expect(response.body.version.gitCommit).toBe('abc123');
      expect(response.body.version.gitBranch).toBe('main');
      expect(response.body.version.repoUrl).toBe('https://example.com/repo');
    });
  });

  // A password served to whoever loads the sign-in page: right for a public
  // demo, wrong everywhere else. It takes demo mode AND both halves of a
  // credential named for the purpose, so nothing set for another reason can
  // ever publish one.
  describe('demo sign-in credentials', () => {
    const demoEnv = {
      DEMO_MODE: 'true',
      DEMO_LOGIN_EMAIL: 'demo@example.com',
      DEMO_LOGIN_PASSWORD: 'demo1234',
    };

    it('publishes them when demo mode and both credentials are set', async () => {
      restoreEnv = overrideEnv(demoEnv);

      const response = await request(buildApp()).get('/api/features').expect(200);

      expect(response.body.demoLogin).toEqual({
        email: 'demo@example.com',
        password: 'demo1234',
      });
    });

    it('publishes nothing without demo mode', async () => {
      restoreEnv = overrideEnv({ ...demoEnv, DEMO_MODE: undefined });

      const response = await request(buildApp()).get('/api/features').expect(200);

      expect(response.body.demoLogin).toBeNull();
    });

    it('publishes nothing when demo mode is off', async () => {
      restoreEnv = overrideEnv({ ...demoEnv, DEMO_MODE: 'false' });

      const response = await request(buildApp()).get('/api/features').expect(200);

      expect(response.body.demoLogin).toBeNull();
    });

    // Anything normalizeBoolean does not recognise is not true, so a typo
    // leaves the credentials unpublished rather than publishing them.
    it('publishes nothing when demo mode is not a value it recognises', async () => {
      restoreEnv = overrideEnv({ ...demoEnv, DEMO_MODE: 'oui' });

      const response = await request(buildApp()).get('/api/features').expect(200);

      expect(response.body.demoLogin).toBeNull();
    });

    it('publishes nothing when only one half is set', async () => {
      restoreEnv = overrideEnv({ ...demoEnv, DEMO_LOGIN_PASSWORD: undefined });

      const response = await request(buildApp()).get('/api/features').expect(200);

      expect(response.body.demoLogin).toBeNull();
    });

    // Demo mode alone seeds sample files; it must never reach for credentials
    // that were set for something else.
    it('never falls back to the admin bootstrap credentials', async () => {
      restoreEnv = overrideEnv({
        DEMO_MODE: 'true',
        DEMO_LOGIN_EMAIL: undefined,
        DEMO_LOGIN_PASSWORD: undefined,
        AUTH_ADMIN_EMAIL: 'admin@example.com',
        AUTH_ADMIN_PASSWORD: 'a-real-password',
      });

      const response = await request(buildApp()).get('/api/features').expect(200);

      expect(response.body.demoLogin).toBeNull();
      expect(JSON.stringify(response.body)).not.toContain('a-real-password');
    });
  });
});
