// /api/auth.api.js

import { requestJson } from './http';

const fetchAuthStatus = () => requestJson('/api/auth/status', { method: 'GET' });

const setupAccount = ({ email, username, password }) =>
  requestJson('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ email, username, password }),
  });

const fetchCurrentUser = () => requestJson('/api/auth/me', { method: 'GET' });

/**
 * Sign in with an email address or a username.
 *
 * One box on screen, one field on the wire: the server decides which of the
 * two it was handed, because only the server can tell whether a name belongs
 * to exactly one account.
 */
const login = ({ identifier, password }) =>
  requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });

/**
 * The second step of a sign-in, when the account asks for a code.
 *
 * Which account is being signed in is the server's to know — it has been
 * holding that since the password was right — so nothing here names one.
 */
const submitTotpCode = (code) =>
  requestJson('/api/auth/login/totp', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

/** Whether this account asks for a code, and how many recovery codes are left. */
const fetchTwoFactorStatus = () => requestJson('/api/auth/totp', { method: 'GET' });

/** A secret to show once. Nothing is on until a code confirms it. */
const startTwoFactorEnrolment = () =>
  requestJson('/api/auth/totp/start', { method: 'POST', body: JSON.stringify({}) });

/** Turn it on, and receive the recovery codes — the only time they can be read. */
const confirmTwoFactorEnrolment = (code) =>
  requestJson('/api/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ code }) });

/** New recovery codes, which retire the ones before them. */
const replaceRecoveryCodes = (password) =>
  requestJson('/api/auth/totp/recovery-codes', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

const disableTwoFactor = (password) =>
  requestJson('/api/auth/totp', { method: 'DELETE', body: JSON.stringify({ password }) });

const logout = () =>
  requestJson('/api/auth/logout', {
    method: 'POST',
  });

async function changePassword({ currentPassword, newPassword }) {
  return requestJson('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export {
  fetchAuthStatus,
  setupAccount,
  fetchCurrentUser,
  login,
  submitTotpCode,
  logout,
  changePassword,
  fetchTwoFactorStatus,
  startTwoFactorEnrolment,
  confirmTwoFactorEnrolment,
  replaceRecoveryCodes,
  disableTwoFactor,
};
