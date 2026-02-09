const { getDb } = require('../db');
const { auth: envAuthConfig } = require('../../config/index');
const { toClientUser, normalizeEmail } = require('./utils');
const { deriveRolesFromClaims } = require('./oidcAuth');

const getRequestUser = async (req) => {
  // Synthetic or pre-populated user (e.g., AUTH_ENABLED=false)
  if (req?.user && typeof req.user === 'object' && req.user.id) {
    return req.user;
  }

  // Local session
  if (req?.session?.localUserId) {
    const db = await getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.localUserId);
    const user = toClientUser(row);
    if (user) {
      user.provider = 'local';
    }
    return user;
  }

  // OIDC mapped user
  if (
    req?.oidc &&
    typeof req.oidc.isAuthenticated === 'function' &&
    req.oidc.isAuthenticated() &&
    req.oidc.user?.sub
  ) {
    const issuer = (envAuthConfig && envAuthConfig.oidc && envAuthConfig.oidc.issuer) || null;
    if (!issuer) return null;
    const autoCreateUsers =
      (envAuthConfig && envAuthConfig.oidc && envAuthConfig.oidc.autoCreateUsers) ?? true;

    const db = await getDb();
    const authMethod = db
      .prepare(
        `
      SELECT user_id FROM auth_methods
      WHERE provider_issuer = ? AND provider_sub = ? AND method_type = 'oidc'
    `
      )
      .get(issuer, req.oidc.user.sub);

    if (authMethod) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(authMethod.user_id);
      const user = toClientUser(row);
      if (user) {
        user.provider = 'oidc';
        user.oidcIssuer = issuer;
        if (!user.avatarUrl && typeof req.oidc.user.picture === 'string') {
          const trimmed = req.oidc.user.picture.trim();
          if (trimmed) {
            user.avatarUrl = trimmed;
          }
        }
      }
      return user;
    }

    // When auto-create is disabled, do not allow a synthetic user fallback.
    if (!autoCreateUsers) return null;

    // Fallback: derive a minimal user object from OIDC claims when DB sync hasn't happened yet
    try {
      const claims = req.oidc.user || {};
      const email = normalizeEmail(claims.email || '');
      const preferredUsername = claims.preferred_username || claims.username || email || claims.sub;
      const displayName = claims.name || preferredUsername || null;
      const roles = deriveRolesFromClaims(claims, envAuthConfig?.oidc?.adminGroups);
      const avatarUrl =
        typeof claims.picture === 'string' && claims.picture.trim() ? claims.picture.trim() : null;

      return {
        id: `oidc:${claims.sub}`,
        email,
        emailVerified: claims.email_verified || false,
        username: preferredUsername,
        displayName,
        avatarUrl,
        provider: 'oidc',
        roles,
        createdAt: null,
        updatedAt: null,
      };
    } catch (_) {
      return null;
    }
  }

  return null;
};

module.exports = {
  getRequestUser,
};
