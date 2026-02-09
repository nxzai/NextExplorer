const { getDb } = require('../db');
const { toClientUser, toShareableUser, normalizeEmail, nowIso } = require('./utils');
const { countAdmins } = require('./queries');

const listUsers = async () => {
  const db = await getDb();
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();

  const authMethods = db
    .prepare('SELECT user_id, method_type, provider_name FROM auth_methods WHERE enabled = 1')
    .all();
  const authMap = {};
  for (const am of authMethods) {
    if (!authMap[am.user_id]) authMap[am.user_id] = [];
    authMap[am.user_id].push({
      method: am.method_type,
      provider: am.provider_name,
    });
  }

  return rows.map((r) => {
    const u = toClientUser(r);
    u.authMethods = authMap[r.id] || [];
    return u;
  });
};

const listShareableUsers = async ({ excludeUserId } = {}) => {
  const db = await getDb();
  const rows =
    typeof excludeUserId === 'string' && excludeUserId.trim()
      ? db
          .prepare(
            'SELECT id, email, username, display_name FROM users WHERE id != ? ORDER BY display_name ASC, email ASC'
          )
          .all(excludeUserId)
      : db
          .prepare(
            'SELECT id, email, username, display_name FROM users ORDER BY display_name ASC, email ASC'
          )
          .all();
  return rows.map(toShareableUser).filter(Boolean);
};

const updateUserProfile = async ({ userId, email, username, displayName }) => {
  const db = await getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.status = 404;
    throw err;
  }

  const updates = [];
  const values = [];

  if (typeof email === 'string') {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      const err = new Error('Email is required.');
      err.status = 400;
      throw err;
    }
    const exists = db
      .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(normalizedEmail, userId);
    if (exists) {
      const err = new Error('Email already in use.');
      err.status = 409;
      throw err;
    }
    updates.push('email = ?');
    values.push(normalizedEmail);
  }

  if (typeof username === 'string') {
    const trimmed = username.trim();
    updates.push('username = ?');
    values.push(trimmed || null);
  }

  if (typeof displayName === 'string') {
    const trimmed = displayName.trim();
    updates.push('display_name = ?');
    values.push(trimmed || null);
  }

  if (!updates.length) {
    return toClientUser(user);
  }

  updates.push('updated_at = ?');
  values.push(nowIso());
  values.push(userId);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toClientUser(updated);
};

const updateUserRoles = async ({ userId, roles }) => {
  const db = await getDb();
  const r = Array.isArray(roles)
    ? roles.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : [];
  const json = JSON.stringify(r);
  db.prepare('UPDATE users SET roles = ?, updated_at = ? WHERE id = ?').run(json, nowIso(), userId);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toClientUser(row);
};

const deleteUser = async ({ userId }) => {
  const db = await getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) {
    return false;
  }

  // Prevent removing the last admin
  try {
    const roles = JSON.parse(row.roles || '[]');
    if (Array.isArray(roles) && roles.includes('admin')) {
      const admins = await countAdmins();
      if (admins <= 1) {
        const e = new Error('Cannot remove the last admin.');
        e.status = 400;
        throw e;
      }
    }
  } catch (e) {
    if (e.status === 400) throw e;
    /* ignore parse errors */
  }

  // Delete user (cascade will delete auth_methods)
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return true;
};

module.exports = {
  listUsers,
  listShareableUsers,
  updateUserProfile,
  updateUserRoles,
  deleteUser,
};
