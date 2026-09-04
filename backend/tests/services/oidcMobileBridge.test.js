import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const crypto = require('node:crypto');
const bridge = require('../../src/services/oidcMobileBridge');

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const makePkce = () => {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

describe('oidcMobileBridge', () => {
  beforeEach(() => bridge._reset());

  describe('isValidChallenge', () => {
    it('accepts a well formed S256 challenge', () => {
      const { challenge } = makePkce();
      expect(bridge.isValidChallenge(challenge)).toBe(true);
    });

    it('rejects non-strings, empties, and out of range lengths', () => {
      expect(bridge.isValidChallenge(undefined)).toBe(false);
      expect(bridge.isValidChallenge('')).toBe(false);
      expect(bridge.isValidChallenge('a'.repeat(42))).toBe(false);
      expect(bridge.isValidChallenge('a'.repeat(129))).toBe(false);
      expect(bridge.isValidChallenge(`bad chars ${'a'.repeat(40)}`)).toBe(false);
    });
  });

  describe('issueCode', () => {
    it('mints a code for a valid user and challenge', () => {
      const { challenge } = makePkce();
      const code = bridge.issueCode({ userId: 'u1', codeChallenge: challenge });
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(20);
    });

    it('rejects a missing user id', () => {
      const { challenge } = makePkce();
      expect(() => bridge.issueCode({ userId: '', codeChallenge: challenge })).toThrow();
    });

    it('rejects an invalid challenge', () => {
      expect(() => bridge.issueCode({ userId: 'u1', codeChallenge: 'short' })).toThrow();
    });

    it('rejects an unsupported method', () => {
      const { challenge } = makePkce();
      expect(() =>
        bridge.issueCode({ userId: 'u1', codeChallenge: challenge, method: 'plain' })
      ).toThrow();
    });
  });

  describe('redeemCode', () => {
    it('redeems a valid code once and returns the bound user', () => {
      const { verifier, challenge } = makePkce();
      const code = bridge.issueCode({ userId: 'user-42', codeChallenge: challenge });
      expect(bridge.redeemCode({ code, codeVerifier: verifier })).toEqual({ userId: 'user-42' });
    });

    it('is single use: a second redemption fails', () => {
      const { verifier, challenge } = makePkce();
      const code = bridge.issueCode({ userId: 'u1', codeChallenge: challenge });
      expect(bridge.redeemCode({ code, codeVerifier: verifier })).not.toBeNull();
      expect(bridge.redeemCode({ code, codeVerifier: verifier })).toBeNull();
    });

    it('rejects a wrong verifier and burns the code', () => {
      const { challenge } = makePkce();
      const wrong = makePkce().verifier;
      const code = bridge.issueCode({ userId: 'u1', codeChallenge: challenge });
      expect(bridge.redeemCode({ code, codeVerifier: wrong })).toBeNull();
      // even the correct verifier now fails, the code is gone
      expect(bridge.redeemCode({ code, codeVerifier: challenge })).toBeNull();
    });

    it('rejects an unknown code', () => {
      const { verifier } = makePkce();
      expect(bridge.redeemCode({ code: 'nope', codeVerifier: verifier })).toBeNull();
      expect(bridge.redeemCode({ code: '', codeVerifier: verifier })).toBeNull();
    });

    it('rejects an expired code', () => {
      const { verifier, challenge } = makePkce();
      const code = bridge.issueCode({ userId: 'u1', codeChallenge: challenge });
      const now = Date.now() + bridge.CODE_TTL_MS + 1000;
      const original = Date.now;
      Date.now = () => now;
      try {
        expect(bridge.redeemCode({ code, codeVerifier: verifier })).toBeNull();
      } finally {
        Date.now = original;
      }
    });
  });

  describe('verifyChallenge', () => {
    it('matches a verifier to its S256 challenge', () => {
      const { verifier, challenge } = makePkce();
      expect(bridge.verifyChallenge(verifier, challenge)).toBe(true);
    });

    it('rejects a mismatched or malformed verifier', () => {
      const { challenge } = makePkce();
      expect(bridge.verifyChallenge(makePkce().verifier, challenge)).toBe(false);
      expect(bridge.verifyChallenge('short', challenge)).toBe(false);
      expect(bridge.verifyChallenge(undefined, challenge)).toBe(false);
    });
  });
});
