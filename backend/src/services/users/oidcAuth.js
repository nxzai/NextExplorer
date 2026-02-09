const { getDb } = require('../db');
const { ForbiddenError } = require('../../errors/AppError');
const { nowIso, toClientUser, generateId, normalizeEmail } = require('./utils');

// Map provider claims/groups to an app roles array
const deriveRolesFromClaims = (claims = {}, adminGroups = []) => {
  try {
    const groups = []
      .concat(Array.isArray(claims.groups) ? claims.groups : [])
      .concat(Array.isArray(claims.roles) ? claims.roles : [])
      .concat(Array.isArray(claims.entitlements) ? claims.entitlements : [])
      .filter((g) => typeof g === 'string' && g.trim())
      .map((g) => g.trim().toLowerCase());

    const cfgAdmin = Array.isArray(adminGroups)
      ? adminGroups
          .map((g) => (typeof g === 'string' ? g.trim().toLowerCase() : ''))
          .filter(Boolean)
      : [];
    const isAdmin = cfgAdmin.some((g) => groups.includes(g));
    return isAdmin ? ['admin'] : ['user'];
  } catch (_) {
    return ['user'];
  }
};

// Get or create user from OIDC claims (with auto-linking via email)
const getOrCreateOidcUser = async ({
  issuer,
  sub,
  email,
  emailVerified,
  username,
  displayName,
  roles,
  requireEmailVerified = false,
  autoCreateUsers = true,
}) => {
  const db = await getDb();
  const normEmail = normalizeEmail(email);

  if (!normEmail) {
    throw new Error('Email is required from OIDC provider');
  }

  // For security, only auto-link if email is verified (when required)
  if (requireEmailVerified && !emailVerified) {
    throw new Error('Email must be verified by identity provider');
  }

  // Check if this OIDC identity already exists
  let authMethod = db
    .prepare(
      `
    SELECT * FROM auth_methods
    WHERE provider_issuer = ? AND provider_sub = ? AND method_type = 'oidc'
  `
    )
    .get(issuer, sub);

  if (authMethod) {
    // Existing OIDC auth - update last used
    db.prepare('UPDATE auth_methods SET last_used_at = ? WHERE id = ?').run(
      nowIso(),
      authMethod.id
    );

    // Update user profile from latest claims
    db.prepare(
      `
      UPDATE users
      SET display_name = COALESCE(?, display_name),
          username = COALESCE(?, username),
          email_verified = 1,
          updated_at = ?
      WHERE id = ?
    `
    ).run(displayName, username, nowIso(), authMethod.user_id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(authMethod.user_id);
    return toClientUser(user);
  }

  // New OIDC identity - check if user with this email exists
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail);

  if (user) {
    // Auto-link: User exists, add OIDC as new auth method
    console.log(`[Auth] Auto-linking OIDC to existing user: ${user.email}`);

    const authId = generateId();
    db.prepare(
      `
      INSERT INTO auth_methods (id, user_id, method_type, provider_issuer, provider_sub, provider_name, created_at)
      VALUES (?, ?, 'oidc', ?, ?, ?, ?)
    `
    ).run(authId, user.id, issuer, sub, 'OIDC', nowIso());

    // Update user info from OIDC claims
    db.prepare(
      `
      UPDATE users
      SET display_name = COALESCE(?, display_name),
          username = COALESCE(?, username),
          email_verified = 1,
          updated_at = ?
      WHERE id = ?
    `
    ).run(displayName, username, nowIso(), user.id);

    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    return toClientUser(user);
  }

  // New user: Create user and OIDC auth method
  if (!autoCreateUsers) {
    throw new ForbiddenError('Profile does not exist.');
  }

  console.log(`[Auth] Creating new user from OIDC: ${normEmail}`);

  const userId = generateId();
  const now = nowIso();
  const rolesJson = JSON.stringify(Array.isArray(roles) ? roles : ['user']);

  // Create user
  db.prepare(
    `
    INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)
  `
  ).run(userId, normEmail, username, displayName, rolesJson, now, now);

  // Create OIDC auth method
  const authId = generateId();
  db.prepare(
    `
    INSERT INTO auth_methods (id, user_id, method_type, provider_issuer, provider_sub, provider_name, created_at)
    VALUES (?, ?, 'oidc', ?, ?, ?, ?)
  `
  ).run(authId, userId, issuer, sub, 'OIDC', now);

  user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return toClientUser(user);
};

module.exports = {
  deriveRolesFromClaims,
  getOrCreateOidcUser,
};
