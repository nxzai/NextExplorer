const crypto = require('crypto');

const nowIso = () => new Date().toISOString();

const toClientUser = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    emailVerified: Boolean(row.email_verified),
    username: row.username,
    displayName: row.display_name || null,
    roles: (() => {
      try {
        return JSON.parse(row.roles || '[]');
      } catch {
        return [];
      }
    })(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const generateId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const toShareableUser = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name || null,
  };
};

module.exports = {
  nowIso,
  toClientUser,
  generateId,
  normalizeEmail,
  toShareableUser,
};
