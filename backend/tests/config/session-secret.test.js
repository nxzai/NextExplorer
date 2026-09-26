import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearApplicationModules, modulePath, setupTestEnv } from '../helpers/env-test-utils.js';

/**
 * Whether a restart signs everyone out.
 *
 * The secret sessions are signed with was drawn at random on every start when
 * SESSION_SECRET was not set. The sessions themselves survive — they are rows in
 * CACHE_DIR/sessions.db — but a cookie signed with the previous secret no longer
 * verifies, so the row was read as a stranger's and everyone was asked to sign
 * in again after every restart, every upgrade and every crash.
 *
 * So the test that matters is not "the resolver returns the same string twice";
 * it is a session set before a restart still being that session after one, which
 * is what a person notices. It is asserted through the real session middleware,
 * against a real store, because the secret is only ever used for signing.
 */

const require = createRequire(import.meta.url);
const load = (relative) => require(modulePath(relative));
const RUNS_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

let env;
const unlocked = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (unlocked.length) await fsp.chmod(unlocked.pop(), 0o755).catch(() => {});
  if (env) await env.cleanup();
  env = null;
});

/** Everything a logger spy was told, message and context both, as one string. */
const said = (spy) =>
  spy.mock.calls
    .map((call) =>
      call
        .map((part) =>
          part && typeof part === 'object'
            ? Object.entries(part)
                .map(([key, value]) => `${key}=${value?.message ?? value}`)
                .join(' ')
            : String(part)
        )
        .join(' ')
    )
    .join('\n');

/** A test environment where nobody configured a secret. */
const seed = (extra = {}) =>
  setupTestEnv({ tag: 'session-secret-', env: { SESSION_SECRET: undefined, ...extra } });

/**
 * An application that can be asked to remember a name and to say it back.
 *
 * Built from a freshly loaded session middleware every time, so building one
 * after `clearApplicationModules()` is exactly what a restart does: the same
 * CONFIG_DIR and the same store, read by new module instances.
 */
const buildApp = () => {
  const application = express();
  load('src/middleware/session').configureSession(application);
  application.post('/remember', (req, res) => {
    req.session.who = 'benjy';
    req.session.save(() => res.json({ ok: true }));
  });
  application.get('/who', (req, res) => res.json({ who: req.session.who ?? null }));
  return application;
};

describe('the secret sessions are signed with', () => {
  it('keeps a session across a restart when nobody configured one', async () => {
    env = await seed();

    const before = buildApp();
    const set = await request(before).post('/remember');
    expect(set.status).toBe(200);
    const cookie = set.headers['set-cookie'];
    expect(cookie).toBeTruthy();
    // It is that session while the server is up, which was never in question.
    expect((await request(before).get('/who').set('Cookie', cookie)).body.who).toBe('benjy');

    // The restart: every module reloaded, the same CONFIG_DIR and the same store.
    clearApplicationModules();
    const after = buildApp();

    const asked = await request(after).get('/who').set('Cookie', cookie);

    expect(asked.body.who).toBe('benjy');
  });

  it('is the one the operator set, and stores nothing then', async () => {
    env = await seed({ SESSION_SECRET: 'chosen by the operator' });

    expect(load('src/config/index').auth.sessionSecret).toBe('chosen by the operator');
    await expect(fsp.access(path.join(env.configDir, 'session-secret'))).rejects.toThrow();
  });

  it('stores its own where nobody but the server can read it', async () => {
    env = await seed();

    const secret = load('src/config/index').auth.sessionSecret;

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const stored = await fsp.stat(path.join(env.configDir, 'session-secret'));
    expect(stored.mode & 0o777).toBe(0o600);
    expect((await fsp.readFile(path.join(env.configDir, 'session-secret'), 'utf8')).trim()).toBe(
      secret
    );
  });

  it('replaces an unusable stored secret without putting it in the log', async () => {
    env = await seed();
    // What a person editing the file by hand would leave behind.
    await fsp.writeFile(path.join(env.configDir, 'session-secret'), 'hunter2\n');
    const warn = vi.spyOn(load('src/utils/logger'), 'warn');

    const secret = load('src/config/index').auth.sessionSecret;

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(warn).toHaveBeenCalled();
    // The secret on its way to being replaced is still a secret. Everything the
    // call carried, message and context flattened by hand: JSON.stringify leaves
    // an Error as {} and would have passed a secret hidden inside one.
    expect(said(warn)).not.toContain('hunter2');
  });

  it.skipIf(RUNS_AS_ROOT)('still starts when CONFIG_DIR cannot be written', async () => {
    env = await seed();
    await fsp.chmod(env.configDir, 0o555);
    unlocked.push(env.configDir);
    const warn = vi.spyOn(load('src/utils/logger'), 'warn');

    const secret = load('src/config/index').auth.sessionSecret;

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    // And says why the next restart will sign everyone out anyway.
    expect(said(warn)).toContain('signed out');
  });
});
