import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  sanitizeReturnTo,
  getConfiguredRequestOrigin,
  absoluteReturnTo,
  callbackUrlForOrigin,
  oidcCookieNamesForOrigin,
  sanitizeOidcPrompt,
} = require('../../src/utils/oidcRedirect');

const configuredOrigins = ['https://files.example.test', 'http://192.168.1.250:3017'];

const makeRequest = ({ protocol = 'https', host, forwardedHost, trustedProxy = false } = {}) => ({
  protocol,
  headers: {
    ...(host ? { host } : {}),
    ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
  },
  socket: { remoteAddress: '127.0.0.1' },
  app: {
    get: (name) => (name === 'trust proxy fn' ? () => trustedProxy : undefined),
  },
  get: (name) => (name.toLowerCase() === 'host' ? host : undefined),
});

describe('OIDC origin-aware redirects', () => {
  it('keeps only same-site return paths in OIDC state', () => {
    expect(sanitizeReturnTo('/browse/Media?sort=name')).toBe('/browse/Media?sort=name');
    expect(sanitizeReturnTo('https://attacker.example')).toBe('/browse/');
    expect(sanitizeReturnTo('//attacker.example')).toBe('/browse/');
    expect(sanitizeReturnTo('/\\attacker.example')).toBe('/browse/');
  });

  it('selects the exact configured origin used by the browser', () => {
    expect(
      getConfiguredRequestOrigin(
        makeRequest({ protocol: 'https', host: 'files.example.test' }),
        configuredOrigins
      )
    ).toBe('https://files.example.test');
    expect(
      getConfiguredRequestOrigin(
        makeRequest({ protocol: 'http', host: '192.168.1.250:3017' }),
        configuredOrigins
      )
    ).toBe('http://192.168.1.250:3017');
  });

  it('uses a configured forwarded host only from a trusted proxy', () => {
    expect(
      getConfiguredRequestOrigin(
        makeRequest({
          protocol: 'https',
          host: 'next-explorer:3000',
          forwardedHost: 'files.example.test',
          trustedProxy: true,
        }),
        configuredOrigins
      )
    ).toBe('https://files.example.test');
    expect(
      getConfiguredRequestOrigin(
        makeRequest({
          protocol: 'https',
          host: 'next-explorer:3000',
          forwardedHost: 'files.example.test',
        }),
        configuredOrigins
      )
    ).toBeNull();
    expect(
      getConfiguredRequestOrigin(
        makeRequest({ protocol: 'https', host: 'attacker.example' }),
        configuredOrigins
      )
    ).toBeNull();
  });

  it('builds an absolute logout return URL from the selected origin', () => {
    expect(absoluteReturnTo('http://192.168.1.250:3017', '/auth/login?expired=1')).toBe(
      'http://192.168.1.250:3017/auth/login?expired=1'
    );
  });

  it('builds the OIDC callback URL from the selected origin', () => {
    expect(callbackUrlForOrigin('https://files.example.test')).toBe(
      'https://files.example.test/callback'
    );
    expect(callbackUrlForOrigin('http://192.168.1.250:3017')).toBe(
      'http://192.168.1.250:3017/callback'
    );
  });

  it('isolates OIDC session and transaction cookies per origin', () => {
    const publicCookies = oidcCookieNamesForOrigin('https://files.example.test');
    const internalCookies = oidcCookieNamesForOrigin('http://192.168.1.250:3017');

    expect(publicCookies).not.toEqual(internalCookies);
    expect(publicCookies.session).toMatch(/^appSession\.[a-f0-9]{16}$/);
    expect(publicCookies.transaction).toMatch(/^auth_verification\.[a-f0-9]{16}$/);
  });

  it('allows only safe OIDC prompts after logout', () => {
    expect(sanitizeOidcPrompt('login')).toBe('login');
    expect(sanitizeOidcPrompt('select_account')).toBe('select_account');
    expect(sanitizeOidcPrompt('none')).toBeNull();
  });
});
