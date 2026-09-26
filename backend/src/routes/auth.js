const express = require('express');
const { auth, public: publicConfig, webauthn: webauthnConfig } = require('../config/index');
const {
  uniqueOrigins,
  sanitizeReturnTo,
  getConfiguredRequestOrigin,
  callbackUrlForOrigin,
  sanitizeOidcPrompt,
  markProviderSignIn,
} = require('../utils/oidcRedirect');
const { getOidcAvailability, oidcIsConfigured } = require('../utils/oidcAvailability');
const logger = require('../utils/logger');

const {
  countUsers,
  createLocalUser,
  attemptLocalLogin,
  changeLocalPassword,
  addLocalPassword,
  getUserAuthMethods,
  getRequestUser,
  verifyLocalPassword,
  beginTwoFactorEnrolment,
  confirmTwoFactorEnrolment,
  disableTwoFactor,
  replaceRecoveryCodes,
  twoFactorRequired,
  twoFactorStatus,
  verifySecondFactor,
} = require('../services/users');
const { incrementFailedAttempts, clearLock, isLocked } = require('../services/users/lockout');
const { issueCode, redeemCode, isValidChallenge } = require('../services/oidcMobileBridge');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const { startAuthenticatedSession } = require('../utils/authenticatedSession');
const passkeys = require('../services/users/passkeys');
const activityLog = require('../services/activityLog');
const apiTokens = require('../services/apiTokens');
const { WebAuthnError } = require('../utils/webauthn');
const {
  ValidationError,
  UnauthorizedError,
  RateLimitError,
  NotFoundError,
  ForbiddenError,
  ServiceUnavailableError,
} = require('../errors/AppError');
const { ErrorCodes } = require('../errors/errorCodes');

/**
 * The relying party: who is asking for a passkey, and where from.
 *
 * A key is bound to a domain, and the browser refuses to use it anywhere else.
 * The domain is taken from the public address when one is configured and from
 * the request otherwise, because a deployment reached by several names would
 * otherwise bind every key to whichever one was written down.
 */
const relyingParty = (req) => {
  const known = uniqueOrigins(publicConfig.origins || []);
  const origins = known.length
    ? known
    : uniqueOrigins([`${req.protocol}://${req.get('host') || ''}`]);

  let rpId = webauthnConfig.rpId;
  if (!rpId) {
    try {
      rpId = new URL(publicConfig.url || origins[0] || '').hostname;
    } catch (_) {
      rpId = null;
    }
  }
  if (!rpId) rpId = req.hostname;
  return { rpId, rpName: webauthnConfig.rpName, origins };
};

/**
 * Keep the question until the answer arrives, and spend it then.
 *
 * In the session, not in a table: it belongs to one browser and one moment.
 * Spending it means taking it away — an answer is worth one sign-in, and a
 * challenge still lying about is one somebody else can answer with a recording
 * of the first.
 */
const rememberChallenge = (req, purpose, challenge) =>
  new Promise((resolve, reject) => {
    if (!req.session) {
      reject(new Error('A passkey needs a session to ask its question in.'));
      return;
    }
    req.session.webauthn = { purpose, challenge, at: Date.now() };
    req.session.save((error) => (error ? reject(error) : resolve()));
  });

const spendChallenge = (req, purpose) => {
  const held = req.session?.webauthn;
  if (req.session) delete req.session.webauthn;
  if (!held || held.purpose !== purpose) return null;
  if (Date.now() - (Number(held.at) || 0) > passkeys.CEREMONY_TIMEOUT_MS) return null;
  return held.challenge;
};

/** Every refusal reads the same from outside, and says what happened in the log. */
const refusePasskey = (error) => {
  if (!(error instanceof WebAuthnError)) throw error;
  if (error.status === 409) throw new ValidationError(error.message);
  logger.warn({ reason: error.message }, 'A passkey was refused');
  throw new UnauthorizedError('That passkey was not accepted.', ErrorCodes.AUTH_PASSKEY_REJECTED);
};

/**
 * How long the second step stays open.
 *
 * Long enough to find a phone, pick the app and read the digits; short enough
 * that a machine walked away from is not a sign-in waiting to be finished by
 * whoever sits down next.
 */
const SECOND_STEP_MS = 5 * 60 * 1000;

/**
 * The password was right, and the account wants a code as well.
 *
 * Deliberately not a signed-in session with a flag on it: nothing but
 * `localUserId` signs anybody in, and this state does not set it. The session
 * is regenerated here for the same reason it is regenerated at the end — an id
 * somebody planted in the browser must not be the one that finishes the
 * sign-in.
 */
const startSecondStep = (req, userId) =>
  new Promise((resolve, reject) => {
    if (!req.session) {
      reject(new Error('No session to hold the second step in.'));
      return;
    }
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      req.session.pendingTotpUserId = userId;
      req.session.pendingTotpSince = Date.now();
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });

/** The account halfway through signing in here, or null. */
const secondStepUserId = (req) => {
  const userId = req.session?.pendingTotpUserId;
  if (!userId) return null;
  const since = Number(req.session.pendingTotpSince) || 0;
  if (Date.now() - since > SECOND_STEP_MS) return null;
  return userId;
};

const forgetSecondStep = (req) => {
  if (!req.session) return;
  delete req.session.pendingTotpUserId;
  delete req.session.pendingTotpSince;
};

const rateLimitHandler = (req, res, next, options) => {
  const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
  const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
  const message = `Too many login attempts. Please wait ${retryAfterMinutes} minute${retryAfterMinutes > 1 ? 's' : ''} before trying again.`;
  next(new RateLimitError(message, retryAfterSeconds, ErrorCodes.RATE_LIMIT_LOGIN));
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const router = express.Router();

/**
 * Whether accounts may be created and signed in with a password here.
 *
 * `/status` already told the interface a password sign-in was not on offer when
 * AUTH_MODE is `oidc`, but the routes behind it answered anyway: on an
 * installation nobody had signed in to yet, anyone who could reach the API
 * could run the setup and become its administrator with a password.
 */
const passwordSignInEnabled = () => ['local', 'both'].includes(auth.mode || 'both');

const refuseWithoutPasswordSignIn = () => {
  if (!passwordSignInEnabled()) {
    throw new ForbiddenError('Password sign-in is not enabled on this server.');
  }
};

/**
 * Run setups one at a time. Between counting the accounts and creating the
 * first one there is a password hash, long enough for two setups sent together
 * to both find none and both make an administrator.
 */
let setupQueue = Promise.resolve();
const oneSetupAtATime = (task) => {
  const run = setupQueue.then(task, task);
  setupQueue = run.catch(() => {});
  return run;
};

const respondWithUser = async (req, res) => {
  const user = await getRequestUser(req);
  res.json({ user });
};

router.get('/status', async (req, res) => {
  const oidcEnv = (auth && auth.oidc) || {};
  // What the configuration pass concluded, so the sign-in screen can say a
  // provider is not on offer before somebody presses the button and travels
  // there to find out. The status only: the reason names settings and library
  // messages, and this answer is given to anybody who asks.
  const { status: oidcStatus } = getOidcAvailability();
  const authMode = auth.mode || 'both';
  // Skip setup requirement if AUTH_MODE is 'oidc' only
  const requiresSetup = auth.enabled && authMode !== 'oidc' ? (await countUsers()) === 0 : false;
  const isEoc = Boolean(
    req.oidc && typeof req.oidc.isAuthenticated === 'function' && req.oidc.isAuthenticated()
  );
  const hasLocal = Boolean(req.session && req.session.localUserId);
  const user = await getRequestUser(req);

  // Determine available strategies based on auth.mode
  const strategies = {
    local: authMode === 'local' || authMode === 'both',
    oidc: (authMode === 'oidc' || authMode === 'both') && Boolean(oidcEnv.enabled),
    // A passkey is a local credential, so it follows the local strategy. The
    // browser has the last word: the sign-in screen only offers it where the
    // page is secure and the browser knows what a passkey is.
    passkey: authMode === 'local' || authMode === 'both',
  };

  res.json({
    requiresSetup,
    // A reload in the middle of signing in lands back on the code, rather than
    // on a password screen that would start the whole thing again.
    totpPending: Boolean(secondStepUserId(req)),
    strategies,
    authEnabled: auth.enabled,
    authMode,
    authenticated: auth.enabled ? Boolean(isEoc || hasLocal) : true,
    user: user || null,
    oidc: {
      enabled: Boolean(oidcEnv.enabled),
      issuer: oidcEnv.issuer || null,
      scopes: oidcEnv.scopes || [],
      status: oidcStatus,
    },
  });
});

// Initial admin setup
router.post(
  '/setup',
  setupLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const { email, password, username } = req.body || {};
    const user = await oneSetupAtATime(async () => {
      if ((await countUsers()) > 0) {
        throw new ValidationError('Application already configured. Skipping setup.');
      }
      return createLocalUser({
        email,
        password,
        username: username || email?.split('@')[0],
        displayName: username || email?.split('@')[0],
        roles: ['admin'],
      });
    });
    await startAuthenticatedSession(req, user.id);

    // Clear guest session cookie when user sets up account
    // Both paths: the cookie has been set on `/api` and on `/`, and a guest
    // session left behind on the other one outlives the sign-in that should
    // have ended it.
    res.clearCookie('guestSession', { path: '/' });
    res.clearCookie('guestSession', { path: '/api' });

    res.status(201).json({ user });
  })
);

// Local login with email + password
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const { email, password, username } = req.body || {};
    // Support both email and username (backward compatibility)
    const emailOrUsername = email || username;

    let user = null;
    try {
      user = await attemptLocalLogin({ email: emailOrUsername, password });
    } catch (e) {
      if (e?.status === 423) {
        throw new RateLimitError(e.message, e.until);
      }
      throw e;
    }
    if (!user) {
      await activityLog.record({
        action: 'sign-in',
        outcome: 'refused',
        // The name that was typed, not one this server confirmed exists.
        actor: String(emailOrUsername || '').slice(0, 200) || 'unknown',
        detail: { method: 'password' },
        req,
      });
      throw new UnauthorizedError('Invalid credentials.', ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    // The password was right and the account asks for a code as well. Nothing
    // about who they are is answered here: that an account has a second factor
    // is not something to tell whoever guessed a password correctly, so the
    // answer carries the question and nothing else.
    if (await twoFactorRequired(user.id)) {
      await startSecondStep(req, user.id);
      res.json({ totpRequired: true });
      return;
    }

    await startAuthenticatedSession(req, user.id);
    await activityLog.record({ action: 'sign-in', user, detail: { method: 'password' }, req });

    // Clear guest session cookie when user logs in
    // Both paths: the cookie has been set on `/api` and on `/`, and a guest
    // session left behind on the other one outlives the sign-in that should
    // have ended it.
    res.clearCookie('guestSession', { path: '/' });
    res.clearCookie('guestSession', { path: '/api' });

    res.json({ user });
  })
);

/** The passkeys on this account, so they can be named and taken away. */
router.get(
  '/passkeys',
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');
    res.json({ passkeys: await passkeys.listPasskeys(me.id) });
  })
);

/**
 * Start making one.
 *
 * Signed in here with this account, like the second factor: a session the
 * identity provider opened is not one that adds a local way in.
 */
router.post(
  '/passkeys/register/start',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');
    if (!req.session || req.session.localUserId !== me.id) {
      throw new ForbiddenError('Sign in with your password to add a passkey.');
    }

    const { rpId, rpName, origins } = relyingParty(req);
    const options = await passkeys.beginRegistration({
      userId: me.id,
      account: me.email || me.username || me.id,
      displayName: me.displayName || me.username || me.email || me.id,
      rpId,
      rpName,
    });
    await rememberChallenge(req, 'register', options.challenge);
    res.json({ options, origins });
  })
);

/** Keep it, if it answers the question this browser was just asked. */
router.post(
  '/passkeys/register/finish',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');
    if (!req.session || req.session.localUserId !== me.id) {
      throw new ForbiddenError('Sign in with your password to add a passkey.');
    }

    const challenge = spendChallenge(req, 'register');
    if (!challenge) {
      throw new ValidationError('That passkey took too long. Start again.');
    }

    const { rpId, origins } = relyingParty(req);
    try {
      const passkey = await passkeys.finishRegistration({
        userId: me.id,
        response: req.body?.response,
        name: req.body?.name,
        expected: { challenge, origins, rpId },
      });
      await activityLog.record({
        action: 'account.passkey',
        user: me,
        target: passkey.name,
        detail: { added: true },
        req,
      });
      res.status(201).json({ passkey });
    } catch (error) {
      refusePasskey(error);
    }
  })
);

/** A new name for one, so two keys on a desk can be told apart. */
router.patch(
  '/passkeys/:id',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');

    const passkey = await passkeys.renamePasskey({
      userId: me.id,
      id: req.params.id,
      name: req.body?.name,
    });
    if (!passkey) throw new NotFoundError('There is no such passkey on this account.');
    res.json({ passkey });
  })
);

/**
 * Take one away, with the password for the same reason the second factor asks
 * for it: a browser left unlocked should not be able to change how somebody
 * signs in. An account with no password has none to give, and is refused its
 * last passkey instead — that one is the whole way in.
 */
router.delete(
  '/passkeys/:id',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');

    if (await passkeys.hasPassword(me.id)) {
      if (!(await verifyLocalPassword({ userId: me.id, password: req.body?.password }))) {
        throw new UnauthorizedError(
          'That password is not right.',
          ErrorCodes.AUTH_PASSWORD_INCORRECT
        );
      }
    }

    const outcome = await passkeys.deletePasskey({ userId: me.id, id: req.params.id });
    if (outcome.reason === 'missing') {
      throw new NotFoundError('There is no such passkey on this account.');
    }
    if (outcome.reason === 'last-way-in') {
      throw new ValidationError(
        'This is the only way into this account. Add a password, or another passkey, before removing it.'
      );
    }
    res.status(204).end();
  })
);

/**
 * Signing in with one: the question.
 *
 * Nobody is named, and nothing is asked about who might be signing in. The
 * authenticator offers what it holds for this site, so this route answers the
 * same thing to everybody — including to somebody with no passkey at all.
 */
router.post(
  '/login/passkey/start',
  loginLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const { rpId, origins } = relyingParty(req);
    const options = passkeys.beginAuthentication({ rpId });
    await rememberChallenge(req, 'login', options.challenge);
    res.json({ options, origins });
  })
);

/**
 * Signing in with one: the answer.
 *
 * A passkey that was unlocked — a fingerprint, a face, a PIN — is already two
 * things: the device, and whoever can open it. That is why it satisfies an
 * account that asks for a second factor, and why one that was not unlocked does
 * not: that proves only that the device was there.
 */
router.post(
  '/login/passkey/finish',
  loginLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const challenge = spendChallenge(req, 'login');
    if (!challenge) {
      throw new UnauthorizedError(
        'That sign-in took too long. Try again.',
        ErrorCodes.AUTH_PASSKEY_REJECTED
      );
    }

    const { rpId, origins } = relyingParty(req);
    let outcome;
    try {
      outcome = await passkeys.finishAuthentication({
        response: req.body?.response,
        expected: { challenge, origins, rpId },
      });
    } catch (error) {
      refusePasskey(error);
    }

    if (await isLocked(outcome.userId)) {
      throw new RateLimitError(
        'Account is temporarily locked due to failed login attempts.',
        null,
        ErrorCodes.AUTH_ACCOUNT_LOCKED
      );
    }
    await clearLock(outcome.userId);

    if (!outcome.userVerified && (await twoFactorRequired(outcome.userId))) {
      await startSecondStep(req, outcome.userId);
      res.json({ totpRequired: true });
      return;
    }

    await startAuthenticatedSession(req, outcome.userId);
    // Both paths: the cookie has been set on `/api` and on `/`, and a guest
    // session left behind on the other one outlives the sign-in that should
    // have ended it.
    res.clearCookie('guestSession', { path: '/' });
    res.clearCookie('guestSession', { path: '/api' });

    logger.info(
      { userId: outcome.userId, passkeyId: outcome.passkeyId },
      'Signed in with a passkey'
    );
    const signedIn = await getRequestUser(req);
    await activityLog.record({
      action: 'sign-in',
      user: signedIn,
      detail: { method: 'passkey', passkey: outcome.name },
      req,
    });
    res.json({ user: signedIn });
  })
);

/**
 * The second step: the code from the phone, or one off the paper.
 *
 * Wrong codes count against the same lockout a wrong password does, so the
 * second factor is not a place to guess a million times at six digits while
 * the first one is bounded.
 */
router.post(
  '/login/totp',
  loginLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const userId = secondStepUserId(req);
    if (!userId) {
      forgetSecondStep(req);
      throw new UnauthorizedError(
        'That sign-in is no longer waiting for a code. Sign in again.',
        ErrorCodes.AUTH_INVALID_CREDENTIALS
      );
    }

    if (await isLocked(userId)) {
      throw new RateLimitError(
        'Account is temporarily locked due to failed login attempts.',
        null,
        ErrorCodes.AUTH_ACCOUNT_LOCKED
      );
    }

    const { code } = req.body || {};
    const outcome = await verifySecondFactor({ userId, code });
    if (!outcome.ok) {
      await incrementFailedAttempts(userId);
      await activityLog.record({
        action: 'sign-in',
        outcome: 'refused',
        userId,
        detail: { method: 'code' },
        req,
      });
      throw new UnauthorizedError('That code is not right.', ErrorCodes.AUTH_INVALID_TOTP_CODE);
    }

    await clearLock(userId);
    forgetSecondStep(req);
    await startAuthenticatedSession(req, userId);
    // Both paths: the cookie has been set on `/api` and on `/`, and a guest
    // session left behind on the other one outlives the sign-in that should
    // have ended it.
    res.clearCookie('guestSession', { path: '/' });
    res.clearCookie('guestSession', { path: '/api' });

    const signedIn = await getRequestUser(req);
    await activityLog.record({
      action: 'sign-in',
      user: signedIn,
      detail: { method: outcome.usedRecoveryCode ? 'recovery code' : 'code' },
      req,
    });
    res.json({
      user: signedIn,
      usedRecoveryCode: Boolean(outcome.usedRecoveryCode),
      recoveryCodesLeft: outcome.recoveryCodesLeft ?? null,
    });
  })
);

/** Whether this account asks for a code, and how many recovery codes are left. */
router.get(
  '/totp',
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');
    res.json(await twoFactorStatus(me.id));
  })
);

/**
 * Draw a secret and show it, which turns nothing on.
 *
 * What comes back is shown once and never again: the phone keeps it, and the
 * copy here is unreadable the moment it is written.
 */
router.post(
  '/totp/start',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    refuseWithoutPasswordSignIn();
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');
    if (!req.session || req.session.localUserId !== me.id) {
      throw new ForbiddenError('Sign in with your password to set up a second factor.');
    }

    res.json(
      await beginTwoFactorEnrolment({
        userId: me.id,
        account: me.email || me.username || me.id,
      })
    );
  })
);

/** Turn it on, once a code proves the phone holds the same secret. */
router.post(
  '/totp/confirm',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');

    const confirmed = await confirmTwoFactorEnrolment({ userId: me.id, code: req.body?.code });
    if (!confirmed) {
      throw new UnauthorizedError('That code is not right.', ErrorCodes.AUTH_INVALID_TOTP_CODE);
    }
    logger.info({ userId: me.id }, 'Two-factor authentication turned on');
    await activityLog.record({ action: 'account.two-factor', user: me, detail: { on: true }, req });
    res.json(confirmed);
  })
);

/**
 * New recovery codes, and the password to prove it is still the same person.
 *
 * A browser left unlocked is the case this is about: drawing new codes throws
 * the old ones away, and somebody who sat down at a signed-in screen should not
 * be able to leave with the only working set.
 */
router.post(
  '/totp/recovery-codes',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');
    if (!(await verifyLocalPassword({ userId: me.id, password: req.body?.password }))) {
      throw new UnauthorizedError(
        'That password is not right.',
        ErrorCodes.AUTH_PASSWORD_INCORRECT
      );
    }

    res.json({ recoveryCodes: await replaceRecoveryCodes(me.id) });
  })
);

/** Off, with the password for the same reason. */
router.delete(
  '/totp',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) throw new UnauthorizedError('Authentication required.');
    if (!(await verifyLocalPassword({ userId: me.id, password: req.body?.password }))) {
      throw new UnauthorizedError(
        'That password is not right.',
        ErrorCodes.AUTH_PASSWORD_INCORRECT
      );
    }

    await disableTwoFactor(me.id);
    logger.info({ userId: me.id }, 'Two-factor authentication turned off');
    await activityLog.record({
      action: 'account.two-factor',
      user: me,
      detail: { on: false },
      req,
    });
    res.status(204).end();
  })
);

// Change password (for users with password auth)
router.post(
  '/password',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await getRequestUser(req);
    if (!me) {
      throw new UnauthorizedError('Authentication required.');
    }

    const { currentPassword, newPassword } = req.body || {};
    // Every other session of the account ends; this one stays signed in, but
    // only if it is signed in here as this account. A session the identity
    // provider opened is not one a password could have opened.
    const signedInHere = Boolean(req.session) && req.session.localUserId === me.id;
    await changeLocalPassword({
      userId: me.id,
      currentPassword,
      newPassword,
      keepSessionId: signedInHere ? req.sessionID : null,
    });
    await activityLog.record({ action: 'account.password', user: me, req });
    res.status(204).end();
  })
);

// Add password authentication to current user (for OIDC-only users)
router.post(
  '/password/add',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      throw new UnauthorizedError('Authentication required.');
    }

    const { password } = req.body || {};
    await addLocalPassword({ userId: user.id, password });

    res.json({ message: 'Password authentication added successfully.' });
  })
);

// Get available auth methods for current user
router.get(
  '/methods',
  asyncHandler(async (req, res) => {
    const user = await getRequestUser(req);
    if (!user) {
      throw new UnauthorizedError('Authentication required.');
    }

    const methods = await getUserAuthMethods(user.id);

    res.json({
      methods: methods.map((m) => ({
        id: m.id,
        type: m.method_type,
        provider: m.provider_name || (m.method_type === 'local_password' ? 'Password' : 'Unknown'),
        lastUsedAt: m.last_used_at,
        createdAt: m.created_at,
      })),
    });
  })
);

router.post('/logout', async (req, res) => {
  // Read who this is before the session that says so is destroyed.
  await activityLog.record({ action: 'sign-out', user: await getRequestUser(req), req });

  // Clear local app session if present (local auth)
  if (req.session) {
    try {
      req.session.destroy(() => {});
    } catch (_) {
      /* ignore */
    }
  }
  // Clear the EOC session cookie selected for this browser origin. The
  // legacy name is also cleared during the origin-scoped cookie migration.
  const cookieNames = new Set([req.nextExplorerOidcSessionCookieName, 'appSession']);
  for (const cookieName of cookieNames) {
    if (!cookieName) continue;
    try {
      if (cookieName in req) req[cookieName] = undefined;
      const cookieOptions = { path: '/', sameSite: 'Lax', httpOnly: true };
      res.clearCookie(cookieName, { ...cookieOptions, secure: true });
      res.clearCookie(cookieName, { ...cookieOptions, secure: false });
    } catch (_) {
      /* ignore */
    }
  }
  // For IdP/federated logout, the UI navigates to GET /logout separately.
  res.status(204).end();
});

router.get('/me', async (req, res) => {
  await respondWithUser(req, res);
});

/**
 * API tokens: a credential for a script, issued from the account it belongs to.
 *
 * Everything here is reached with a session and never with a token — the door
 * in middleware/apiTokenAuth.js shuts `/api/auth` to tokens, and each route
 * below says so again, because a credential that can mint credentials is one
 * revocation that revokes nothing.
 *
 * Minting asks for the account's password when the account has one. It is the
 * same reason removing a passkey asks: a browser left unlocked on somebody's
 * desk should not be enough to walk away with a credential that outlives the
 * session, works from anywhere, and does not show up as a sign-in.
 */
const refuseTokenAuthenticatedCaller = (req) => {
  if (req.apiToken) {
    throw new ForbiddenError('An API token cannot manage API tokens.');
  }
};

/** Tokens name an account, so an installation with no accounts has none. */
const refuseWithoutAccounts = () => {
  if (auth.enabled === false) {
    throw new ForbiddenError('This installation runs without accounts, so it issues no tokens.');
  }
};

const tokenHolder = async (req) => {
  refuseWithoutAccounts();
  refuseTokenAuthenticatedCaller(req);
  const me = await getRequestUser(req);
  if (!me) throw new UnauthorizedError('Authentication required.');
  return me;
};

router.get(
  '/tokens',
  asyncHandler(async (req, res) => {
    const me = await tokenHolder(req);
    res.json({ tokens: await apiTokens.listTokens(me.id) });
  })
);

/**
 * Make one.
 *
 * The only reply that carries the value. It is not stored in readable form and
 * no route answers with it again — losing it costs a new token, which is the
 * property that makes a stolen database worth nothing here.
 */
router.post(
  '/tokens',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await tokenHolder(req);

    if (await passkeys.hasPassword(me.id)) {
      if (!(await verifyLocalPassword({ userId: me.id, password: req.body?.password }))) {
        throw new UnauthorizedError(
          'That password is not right.',
          ErrorCodes.AUTH_PASSWORD_INCORRECT
        );
      }
    }

    const outcome = await apiTokens.mintToken({
      userId: me.id,
      name: req.body?.name,
      scope: req.body?.scope || apiTokens.DEFAULT_SCOPE,
      expiresInDays: req.body?.expiresInDays ?? null,
    });

    if (outcome.error === 'scope') {
      throw new ValidationError('A token reads, or it reads and writes. Nothing else.');
    }
    if (outcome.error === 'expiry') {
      throw new ValidationError(
        `A token lasts for a number of days, up to ${apiTokens.MAX_EXPIRY_DAYS}, or for ever.`
      );
    }
    if (outcome.error === 'too-many') {
      throw new ValidationError(
        `This account already holds ${apiTokens.MAX_TOKENS_PER_USER} tokens. Revoke one before issuing another.`
      );
    }

    await activityLog.record({
      action: 'account.token',
      user: me,
      target: outcome.token.name,
      detail: { issued: true, scope: outcome.token.scope, expiresAt: outcome.token.expiresAt },
      req,
    });

    res.status(201).json({ token: outcome.token, secret: outcome.secret });
  })
);

/** A new name for one, so two tokens on a server can be told apart. */
router.patch(
  '/tokens/:id',
  passwordLimiter,
  asyncHandler(async (req, res) => {
    const me = await tokenHolder(req);
    const token = await apiTokens.renameToken({
      userId: me.id,
      id: req.params.id,
      name: req.body?.name,
    });
    if (!token) throw new NotFoundError('There is no such token on this account.');
    res.json({ token });
  })
);

/**
 * Take one away.
 *
 * No password: revoking is the safe direction. Asking for one would mean that
 * somebody who has just realised a token leaked has to find their password
 * before they can stop it, and a credential nobody can revoke in a hurry is
 * most of the way to a credential that cannot be revoked.
 */
router.delete(
  '/tokens/:id',
  asyncHandler(async (req, res) => {
    const me = await tokenHolder(req);
    const outcome = await apiTokens.revokeToken({ userId: me.id, id: req.params.id });
    if (!outcome.revoked) throw new NotFoundError('There is no such token on this account.');

    await activityLog.record({
      action: 'account.token',
      user: me,
      target: outcome.token.name,
      detail: { issued: false },
      req,
    });
    res.status(204).end();
  })
);

/**
 * The provider was asked to take the sign-in, and did not.
 *
 * The real reason goes to the log and never into the response: it is the
 * network's own words, and they name the provider's internal host.
 */
const providerDidNotAnswer = (reason) => {
  logger.error(
    { issuer: auth?.oidc?.issuer, reason },
    'Could not start a sign-in at the identity provider'
  );
  return new ServiceUnavailableError(
    'The identity provider could not be reached.',
    ErrorCodes.AUTH_OIDC_PROVIDER_UNAVAILABLE
  );
};

/**
 * Nothing here can hand a sign-in over. Which of the two it is decides what an
 * administrator should go and do.
 *
 * Answering 404 "OIDC is not configured" for both is the defect: it sends
 * somebody whose provider is simply down to change a configuration that is
 * already right. The configuration pass records which it was.
 */
const noProviderSignInAvailable = () => {
  const { reason } = getOidcAvailability();

  // Configured, and it could not be mounted: a bad issuer URL, a client secret
  // the library insists on, a provider that did not answer discovery. Which of
  // those it was is in the log; what matters here is that it is not the
  // settings an administrator would be sent to fill in.
  if (oidcIsConfigured()) {
    logger.error(
      { issuer: auth?.oidc?.issuer, reason },
      'Single sign-on is configured and could not be started'
    );
    return new ServiceUnavailableError(
      'Single sign-on could not be started.',
      ErrorCodes.AUTH_OIDC_PROVIDER_UNAVAILABLE
    );
  }

  logger.warn(
    { missing: reason },
    'A sign-in at the identity provider was asked for, and none is configured'
  );
  return new NotFoundError('OIDC is not configured.', ErrorCodes.AUTH_OIDC_NOT_CONFIGURED);
};

router.get(
  '/oidc/login',
  asyncHandler(async (req, res) => {
    if (!(res.oidc && typeof res.oidc.login === 'function')) {
      throw noProviderSignInAvailable();
    }

    const redirect = sanitizeReturnTo(req.query?.redirect, '/browse/');
    const origins = uniqueOrigins([auth?.oidc?.callbackUrl, ...(publicConfig?.origins || [])]);
    const origin = getConfiguredRequestOrigin(req, origins) || origins[0];
    const prompt = sanitizeOidcPrompt(req.query?.prompt);
    const authorizationParams = {
      ...(origin ? { redirect_uri: callbackUrlForOrigin(origin) } : {}),
      ...(prompt ? { prompt } : {}),
    };

    try {
      // Marked for the OIDC error middleware: the library usually reports a
      // failure to a `next` of its own rather than throwing here.
      markProviderSignIn(req);
      await res.oidc.login({ returnTo: redirect, authorizationParams });
    } catch (e) {
      // It was asked and it failed, so this is never the configuration.
      throw providerDidNotAnswer(e?.message || null);
    }
  })
);

// Allowlisted custom scheme URIs the native apps (iOS/Android) register. The code
// is only ever delivered to one of these, never an arbitrary or http(s) URL.
const mobileRedirectUris = (auth && auth.oidc && auth.oidc.mobileRedirectUris) || [
  'nextexplorer://oidc-callback',
];

const resolveMobileRedirect = (requested) => {
  if (requested === undefined) return mobileRedirectUris[0];
  return mobileRedirectUris.includes(requested) ? requested : null;
};

const buildMobileRedirect = (redirectUri, params) => {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

// Step 1 of native OIDC: the app opens this in ASWebAuthenticationSession (iOS) or
// Custom Tabs (Android) with a PKCE code_challenge. It stashes the challenge and the
// chosen redirect in the (throwaway) browser session and kicks off standard OIDC login.
router.get(
  '/oidc/mobile/login',
  asyncHandler(async (req, res) => {
    if (!(res.oidc && typeof res.oidc.login === 'function')) {
      throw noProviderSignInAvailable();
    }
    const codeChallenge = req.query?.code_challenge;
    const method = req.query?.code_challenge_method || 'S256';
    if (!isValidChallenge(codeChallenge) || method !== 'S256') {
      throw new ValidationError('A valid PKCE code_challenge (S256) is required.');
    }
    const redirectUri = resolveMobileRedirect(req.query?.redirect_uri);
    if (!redirectUri) {
      throw new ValidationError('Unrecognized redirect_uri.');
    }
    if (req.session) {
      req.session.oidcMobile = { codeChallenge, method, redirectUri };
    }
    try {
      markProviderSignIn(req);
      await res.oidc.login({ returnTo: '/api/auth/oidc/mobile/complete' });
    } catch (e) {
      throw providerDidNotAnswer(e?.message || null);
    }
  })
);

// Step 2: OIDC login has completed inside the web session. Mint a single use code
// bound to the authenticated user and the PKCE challenge, then hand it back to the
// app via the custom scheme. Errors are reported the same way so the app can react.
router.get(
  '/oidc/mobile/complete',
  asyncHandler(async (req, res) => {
    const pending = req.session?.oidcMobile;
    if (req.session) delete req.session.oidcMobile;

    const redirectUri = resolveMobileRedirect(pending?.redirectUri);
    if (!redirectUri) {
      throw new ValidationError('Unrecognized redirect_uri.');
    }

    const isAuthed = Boolean(
      req.oidc && typeof req.oidc.isAuthenticated === 'function' && req.oidc.isAuthenticated()
    );
    if (!isAuthed || !pending || !isValidChallenge(pending.codeChallenge)) {
      return res.redirect(buildMobileRedirect(redirectUri, { error: 'auth_failed' }));
    }

    const user = await getRequestUser(req);
    if (!user || !user.id || String(user.id).startsWith('oidc:')) {
      return res.redirect(buildMobileRedirect(redirectUri, { error: 'no_profile' }));
    }

    const code = issueCode({
      userId: user.id,
      codeChallenge: pending.codeChallenge,
      method: pending.method,
    });
    return res.redirect(buildMobileRedirect(redirectUri, { code }));
  })
);

// Step 3: the app exchanges the one time code plus its PKCE verifier for a normal
// local session cookie, reusing the same session plumbing as password login.
router.post(
  '/oidc/exchange',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { code, code_verifier: codeVerifier } = req.body || {};
    const result = redeemCode({ code, codeVerifier });
    if (!result) {
      throw new UnauthorizedError(
        'Invalid or expired authorization code.',
        ErrorCodes.AUTH_INVALID_CREDENTIALS
      );
    }

    // The same call every other way in makes a session with, and for the same
    // reason: it rotates the session id. Assigning the user onto the session
    // already in hand leaves whoever knew that id before signing in knowing a
    // signed-in one.
    await startAuthenticatedSession(req, result.userId);

    const user = await getRequestUser(req);
    if (!user) {
      if (req.session) delete req.session.localUserId;
      throw new UnauthorizedError('User no longer exists.', ErrorCodes.AUTH_INVALID_CREDENTIALS);
    }

    // Both paths: the cookie has been set on `/api` and on `/`, and a guest
    // session left behind on the other one outlives the sign-in that should
    // have ended it.
    res.clearCookie('guestSession', { path: '/' });
    res.clearCookie('guestSession', { path: '/api' });
    res.json({ user });
  })
);

module.exports = router;
