const crypto = require('crypto');

// Short lived, single use authorization codes that bridge a completed OIDC
// browser login (inside ASWebAuthenticationSession) to a native app session.
// The code is handed to the app via a custom scheme redirect and exchanged,
// with PKCE, for a normal local session cookie. Kept in memory: codes live for
// seconds and never need to survive a restart.
const CODE_TTL_MS = 60 * 1000;
const codes = new Map();

// PKCE verifier/challenge per RFC 7636: unreserved chars, 43..128 length.
const PKCE_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

const base64url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const sweep = (now = Date.now()) => {
  for (const [code, entry] of codes) {
    if (entry.expiresAt <= now) codes.delete(code);
  }
};

const isValidChallenge = (challenge) =>
  typeof challenge === 'string' && PKCE_PATTERN.test(challenge);

const issueCode = ({ userId, codeChallenge, method = 'S256' }) => {
  if (userId === undefined || userId === null || userId === '') {
    throw new Error('userId is required');
  }
  if (!isValidChallenge(codeChallenge)) {
    throw new Error('A valid PKCE code_challenge is required');
  }
  if (method !== 'S256') {
    throw new Error('Only the S256 code_challenge_method is supported');
  }
  sweep();
  const code = base64url(crypto.randomBytes(32));
  codes.set(code, {
    userId,
    codeChallenge,
    method,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
};

const verifyChallenge = (codeVerifier, codeChallenge) => {
  if (typeof codeVerifier !== 'string' || !PKCE_PATTERN.test(codeVerifier)) return false;
  const computed = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(String(codeChallenge));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Consumes the code before checking the verifier, so a wrong guess burns it and
// there is no online brute force against a live code.
const redeemCode = ({ code, codeVerifier }) => {
  sweep();
  if (typeof code !== 'string' || !code) return null;
  const entry = codes.get(code);
  if (!entry) return null;
  codes.delete(code);
  if (entry.expiresAt <= Date.now()) return null;
  if (!verifyChallenge(codeVerifier, entry.codeChallenge)) return null;
  return { userId: entry.userId };
};

const _reset = () => codes.clear();

module.exports = {
  CODE_TTL_MS,
  isValidChallenge,
  issueCode,
  verifyChallenge,
  redeemCode,
  _reset,
};
