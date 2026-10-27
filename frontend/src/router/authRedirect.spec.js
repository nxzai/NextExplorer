import { describe, it, expect } from 'vitest';

import { authRedirect } from './authRedirect';

/**
 * Who gets sent where, before a page loads.
 *
 * This lived inside the navigation guard with everything else and had no test.
 * What it decides is the difference between an application and a locked door:
 * a redirect that sends the login screen to itself is a loop, and a redirect
 * that remembers an auth screen as its destination lands a successful sign-in
 * back on the form it just filled in.
 */

const route = (overrides = {}) => ({
  name: 'FolderView',
  fullPath: '/browse/Docs',
  meta: {},
  query: {},
  params: {},
  ...overrides,
});

const NOBODY_YET = { requiresSetup: true, isAuthenticated: false };
const SIGNED_OUT = { requiresSetup: false, isAuthenticated: false };
const SIGNED_IN = { requiresSetup: false, isAuthenticated: true };

describe('before anybody has an account', () => {
  it('sends every page to the setup screen', () => {
    expect(authRedirect(route(), NOBODY_YET)).toMatchObject({ name: 'auth-setup' });
  });

  it('lets the setup screen itself through', () => {
    const setup = route({ name: 'auth-setup', meta: { authScreen: true } });

    expect(authRedirect(setup, NOBODY_YET)).toBeNull();
  });

  /**
   * The login screen is not the answer when there is nobody to log in as.
   * Letting it through because it is *an* auth screen leaves a visitor on a
   * form no password can satisfy.
   */
  it('sends even the login screen to setup', () => {
    const login = route({ name: 'auth-login', meta: { authScreen: true } });

    expect(authRedirect(login, NOBODY_YET)).toMatchObject({ name: 'auth-setup' });
  });
});

describe('signed out', () => {
  it('sends a page to the login screen, remembering where it was going', () => {
    expect(authRedirect(route({ fullPath: '/browse/Docs/2026' }), SIGNED_OUT)).toEqual({
      name: 'auth-login',
      query: { redirect: '/browse/Docs/2026' },
    });
  });

  it('lets an auth screen through rather than sending it to itself', () => {
    const login = route({ name: 'auth-login', meta: { authScreen: true } });

    expect(authRedirect(login, SIGNED_OUT)).toBeNull();
  });

  /**
   * A destination under `/auth/` is not somewhere to come back to. Remembering
   * it is how signing in successfully returns to the form.
   */
  it('never remembers an auth screen as the place to come back to', () => {
    const fromLogin = route({ fullPath: '/auth/login' });

    expect(authRedirect(fromLogin, SIGNED_OUT).query.redirect).toBe('/browse/');
  });

  it('falls back to the file browser when there is no path to remember', () => {
    expect(authRedirect(route({ fullPath: undefined }), SIGNED_OUT).query.redirect).toBe(
      '/browse/'
    );
  });
});

describe('signed in', () => {
  it('lets an ordinary page through', () => {
    expect(authRedirect(route(), SIGNED_IN)).toBeNull();
  });

  it('sends the login screen back where the visitor was going', () => {
    const login = route({
      name: 'auth-login',
      meta: { authScreen: true },
      query: { redirect: '/browse/Photos' },
    });

    expect(authRedirect(login, SIGNED_IN)).toEqual({ path: '/browse/Photos' });
  });

  it('sends the login screen to the file browser when it was asked for directly', () => {
    const login = route({ name: 'auth-login', meta: { authScreen: true } });

    expect(authRedirect(login, SIGNED_IN)).toEqual({ path: '/browse/' });
  });

  /**
   * Setup is done, so the setup screen is a page that no longer exists — for
   * whoever asks, signed in or not.
   */
  it('sends the setup screen away once setup is done', () => {
    const setup = route({ name: 'auth-setup', meta: { authScreen: true } });

    expect(authRedirect(setup, SIGNED_IN)).toEqual({ path: '/browse/' });
    expect(authRedirect(setup, SIGNED_OUT)).toMatchObject({ name: 'auth-login' });
  });
});

describe('the property that matters more than any single case', () => {
  /**
   * Whatever it answers, following that answer must not come straight back.
   * Every combination of route and state, followed one hop, has to land
   * somewhere that either stays put or goes somewhere new.
   */
  it('never sends a route to itself', () => {
    const routes = [
      route(),
      route({ name: 'auth-login', fullPath: '/auth/login', meta: { authScreen: true } }),
      route({ name: 'auth-setup', fullPath: '/auth/setup', meta: { authScreen: true } }),
      route({ name: 'HomeView', fullPath: '/browse/' }),
    ];

    for (const auth of [NOBODY_YET, SIGNED_OUT, SIGNED_IN]) {
      for (const from of routes) {
        const decision = authRedirect(from, auth);
        if (!decision) continue;

        expect(decision.name, `${from.name} under ${JSON.stringify(auth)}`).not.toBe(from.name);
        if (decision.path) expect(decision.path).not.toBe(from.fullPath);
      }
    }
  });
});
