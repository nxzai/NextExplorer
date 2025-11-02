const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { auth: eocAuth } = require('express-openid-connect');

const { port, directories, corsOptions, public: publicConfig, auth: envAuthConfig } = require('./config/index');
const { ensureDir } = require('./utils/fsUtils');
const registerRoutes = require('./routes');
const authRoutes = require('./routes/auth');
const authMiddleware = require('./middleware/authMiddleware');

const app = express();
let server = null;

// Trust reverse proxy when a PUBLIC_URL is provided or TRUST_PROXY is explicitly set
function normalizeEnvVar(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

try {
  const trustProxyEnv = normalizeEnvVar(process.env.TRUST_PROXY);
  if (trustProxyEnv) {
    // Map common values to proper trust proxy settings
    const normalized = trustProxyEnv.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      app.set('trust proxy', true);
    } else if (['0', 'false', 'no', 'off'].includes(normalized)) {
      app.set('trust proxy', false);
    } else if (!Number.isNaN(Number(trustProxyEnv))) {
      app.set('trust proxy', Number(trustProxyEnv));
    } else {
      // Accept Express trust proxy presets or CIDR/source strings
      app.set('trust proxy', trustProxyEnv);
    }
  } else if (publicConfig && publicConfig.url) {
    // If PUBLIC_URL is set, assume we are behind a proxy
    app.set('trust proxy', true);
  }
} catch (e) {
  console.warn('Failed to configure trust proxy:', e?.message || e);
}

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

const bootstrap = async () => {
  try {
    await ensureDir(directories.cache);
  } catch (error) {
    console.warn(`Unable to prepare cache directory at ${directories.cache}:`, error.message);
  }

  try {
    await ensureDir(directories.thumbnails);
  } catch (error) {
    console.warn(`Unable to prepare thumbnail directory at ${directories.thumbnails}:`, error.message);
  }

  // Express OpenID Connect (provider-agnostic: Keycloak, Authentik, Authelia)
  try {
    const oidc = (envAuthConfig && envAuthConfig.oidc) || {};
    const scopes = Array.isArray(oidc.scopes) && oidc.scopes.length ? oidc.scopes : ['openid', 'profile', 'email'];
    const scopeParam = Array.from(new Set(['openid', ...scopes])).join(' ');

    // Determine baseURL from callbackUrl or PUBLIC_URL
    let baseURL = null;
    try {
      if (oidc.callbackUrl && /^https?:\/\//i.test(oidc.callbackUrl)) {
        const u = new URL(oidc.callbackUrl);
        baseURL = u.origin;
      } else if (publicConfig?.url) {
        const u = new URL(publicConfig.url);
        baseURL = u.origin;
      }
    } catch (_) {
      baseURL = null;
    }

    const sessionSecret = (envAuthConfig && envAuthConfig.sessionSecret)
      || process.env.SESSION_SECRET
      || null;

    const eocEnabled = Boolean(oidc.enabled && oidc.issuer && oidc.clientId && sessionSecret && baseURL);

    if (eocEnabled) {
      app.use(eocAuth({
        authRequired: false,
        auth0Logout: false,
        idpLogout: true,
        issuerBaseURL: oidc.issuer,
        baseURL,
        clientID: oidc.clientId,
        clientSecret: oidc.clientSecret || undefined,
        secret: sessionSecret,
        authorizationParams: {
          response_type: 'code',
          scope: scopeParam,
        },
        // Use defaults for routes; no afterCallback needed for minimal setup
      }));

      console.log('Express OpenID Connect is configured.');
    } else {
      console.log('Express OpenID Connect not configured (missing issuer/client/baseURL/secret or disabled).');
    }
  } catch (e) {
    console.warn('Failed to configure Express OpenID Connect:', e?.message || e);
  }

  app.use('/api/auth', authRoutes);
  app.use(authMiddleware);

  app.use('/static/thumbnails', express.static(directories.thumbnails));
  registerRoutes(app);

  const frontendDir = path.resolve(__dirname, 'public');
  const indexFile = path.join(frontendDir, 'index.html');

  if (fs.existsSync(frontendDir) && fs.existsSync(indexFile)) {
    app.use(express.static(frontendDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/static/thumbnails')) {
        return next();
      }

      if (!['GET', 'HEAD'].includes(req.method)) {
        return next();
      }

      res.sendFile(indexFile);
    });
  }

  server = app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
  });
};

bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error);
});

module.exports = {
  app,
  get server() {
    return server;
  },
};
