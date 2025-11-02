const express = require('express');
const { auth: envAuthConfig } = require('../config/index');

const router = express.Router();

const respondWithUser = async (req, res) => {
  const user = (req.oidc && req.oidc.user) || null;
  res.json({ user });
};

router.get('/status', async (req, res) => {
  const oidcEnv = (envAuthConfig && envAuthConfig.oidc) || {};
  const eocAuthenticated = Boolean(req.oidc && typeof req.oidc.isAuthenticated === 'function' && req.oidc.isAuthenticated());
  res.json({
    requiresSetup: false,
    strategies: { local: false, oidc: Boolean(oidcEnv.enabled) },
    authEnabled: true,
    authMode: 'oidc',
    authenticated: eocAuthenticated,
    user: eocAuthenticated ? (req.oidc.user || null) : null,
    oidc: {
      enabled: Boolean(oidcEnv.enabled),
      issuer: oidcEnv.issuer || null,
      scopes: oidcEnv.scopes || [],
    },
  });
});

// Local setup/login/token are disabled in minimal OIDC mode
router.post('/setup', (req, res) => res.status(400).json({ error: 'Local authentication is disabled.' }));

router.post('/login', (req, res) => res.status(400).json({ error: 'Local authentication is disabled.' }));

router.post('/logout', (req, res) => {
  // Redirect through EOC logout to clear IdP session
  if (req.oidc && typeof req.oidc.logout === 'function') {
    // Use 204 for API clients; UI can hit GET /logout directly if needed
    try { req.oidc.logout(); } catch (_) { /* ignore */ }
    res.status(204).end();
    return;
  }
  res.status(204).end();
});

router.get('/me', async (req, res) => {
  await respondWithUser(req, res);
});

router.post('/token', (req, res) => res.status(400).json({ error: 'Token minting is disabled in OIDC mode.' }));

router.get('/oidc/login', async (req, res, next) => {
  try {
    if (req.oidc && typeof req.oidc.login === 'function') {
      const redirect = typeof req.query?.redirect === 'string' ? req.query.redirect : '/';
      await req.oidc.login({ returnTo: redirect });
      return;
    }
  } catch (e) {
    // ignore
  }
  res.status(404).json({ error: 'OIDC is not configured.' });
});


module.exports = router;
