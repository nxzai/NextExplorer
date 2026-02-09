// Main entry point for users service
// Re-exports all functions from individual modules

const queries = require('./queries');
const localAuth = require('./localAuth');
const oidcAuth = require('./oidcAuth');
const requestUser = require('./requestUser');
const management = require('./management');

module.exports = {
  // User queries
  countUsers: queries.countUsers,
  countAdmins: queries.countAdmins,
  getById: queries.getById,
  getByEmail: queries.getByEmail,
  getUserAuthMethods: queries.getUserAuthMethods,

  // Local authentication
  createLocalUser: localAuth.createLocalUser,
  attemptLocalLogin: localAuth.attemptLocalLogin,
  changeLocalPassword: localAuth.changeLocalPassword,
  setLocalPasswordAdmin: localAuth.setLocalPasswordAdmin,
  addLocalPassword: localAuth.addLocalPassword,

  // OIDC authentication
  getOrCreateOidcUser: oidcAuth.getOrCreateOidcUser,
  deriveRolesFromClaims: oidcAuth.deriveRolesFromClaims,

  // Request user handling
  getRequestUser: requestUser.getRequestUser,

  // User management
  listUsers: management.listUsers,
  listShareableUsers: management.listShareableUsers,
  updateUserRoles: management.updateUserRoles,
  updateUserProfile: management.updateUserProfile,
  deleteUser: management.deleteUser,

  // Backward compatibility (deprecated)
  countLocalUsers: queries.countUsers,
  getByUsername: queries.getByEmail,
};
