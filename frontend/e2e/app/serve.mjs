// Starts the application for the browser tests the way the image runs it: the
// real server entry point, serving the real frontend build from the directory
// the Dockerfile copies it to.
//
// That last part is the point. The unit suites build the app with
// skipStaticFiles, so the static mount and the single-page fallback are never
// registered there — which is how a route the router refused at registration
// once stopped the container starting while every test passed.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const dist = path.join(repo, 'frontend', 'dist');
const publicDir = path.join(repo, 'backend', 'src', 'public');

const root = process.env.E2E_ROOT;
if (!root) {
  console.error('E2E_ROOT is not set; start this through playwright.config.js.');
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('frontend/dist is missing: run `npm run build` before the browser tests.');
  process.exit(1);
}

// Dockerfile: COPY --from=frontend_build /app/frontend/dist/ ./src/public/
fs.rmSync(publicDir, { recursive: true, force: true });
fs.cpSync(dist, publicDir, { recursive: true });

const dirs = {
  config: path.join(root, 'config'),
  cache: path.join(root, 'cache'),
  volumes: path.join(root, 'volumes'),
};
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });

// One volume with one file in it: enough to browse into, and a known name the
// tests can share without depending on what an upload produced.
fs.mkdirSync(path.join(dirs.volumes, 'Projects'), { recursive: true });
fs.writeFileSync(path.join(dirs.volumes, 'Projects', 'notes.txt'), 'hello from the e2e volume\n');

Object.assign(process.env, {
  NODE_ENV: 'production',
  ADDRESS: '127.0.0.1',
  PORT: process.env.E2E_PORT,
  PUBLIC_URL: `http://127.0.0.1:${process.env.E2E_PORT}`,
  CONFIG_DIR: dirs.config,
  CACHE_DIR: dirs.cache,
  VOLUME_ROOT: dirs.volumes,
  SESSION_SECRET: 'e2e-session-secret-not-for-production',
});

// The server exits when Playwright stops it, which is after the last test has
// read the disk; the throwaway install goes with it.
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

createRequire(import.meta.url)(path.join(repo, 'backend', 'src', 'server.js'));
