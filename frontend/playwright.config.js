import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The application tests run against a throwaway install: its own config, cache
// and volumes, under one directory the tests can also read to check what
// reached the disk. Playwright loads this file again in every worker, so the
// directory is made once, by the first load, and inherited through the
// environment by the rest — otherwise each worker would look in a different one.
process.env.E2E_ROOT ||= fs.mkdtempSync(path.join(os.tmpdir(), 'nextexplorer-e2e-'));
const APP_PORT = 4180;

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173/e2e/media-preview.html',
      reuseExistingServer: !process.env.CI,
    },
    {
      // The real server entry point serving the real build — see e2e/app/serve.mjs.
      // Never reused: a server left running belongs to another E2E_ROOT, and
      // the tests would check a disk it is not writing to.
      command: 'node e2e/app/serve.mjs',
      url: `http://127.0.0.1:${APP_PORT}/healthz`,
      reuseExistingServer: false,
      env: { E2E_ROOT: process.env.E2E_ROOT, E2E_PORT: String(APP_PORT) },
      // Playwright kills a web server outright unless told otherwise, which
      // skips the server's own shutdown and the cleanup in serve.mjs with it.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
  ],
  projects: [
    {
      name: 'mobile-chromium',
      // The application journey has its own project below: it wants a desktop
      // window and the server that serves the build, not the dev server.
      testIgnore: 'app/**',
      use: {
        ...devices['Pixel 7'],
        hasTouch: true,
      },
    },
    // What someone actually does with the application, end to end: set it up,
    // sign in, open a volume, upload, share. English is pinned because the
    // interface follows the browser's language and the labels are asserted.
    {
      name: 'app',
      testDir: './e2e/app',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${APP_PORT}`,
        locale: 'en-US',
      },
    },
  ],
});
