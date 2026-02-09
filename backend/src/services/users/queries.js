const { getDb } = require('../db');
const { toClientUser, normalizeEmail } = require('./utils');

const countUsers = async () => {
  const db = await getDb();
  const row = db.prepare('SELECT COUNT(*) as c FROM users').get();
  return Number(row?.c || 0);
};

// Count users that currently have the admin role
const countAdmins = async () => {
  const db = await getDb();
  const rows = db.prepare('SELECT roles FROM users').all();
  let count = 0;
  for (const r of rows) {
    try {
      const roles = JSON.parse(r.roles || '[]');
      if (Array.isArray(roles) && roles.includes('admin')) count++;
    } catch (_) {
      /* ignore */
    }
  }
  return count;
};

const getById = async (id) => {
  const db = await getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return toClientUser(row);
};

const getByEmail = async (email) => {
  const db = await getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email));
  return row || null;
};

// Get auth methods for a user
const getUserAuthMethods = async (userId) => {
  const db = await getDb();
  return db.prepare('SELECT * FROM auth_methods WHERE user_id = ? AND enabled = 1').all(userId);
};

module.exports = {
  countUsers,
  countAdmins,
  getById,
  getByEmail,
  getUserAuthMethods,
};
