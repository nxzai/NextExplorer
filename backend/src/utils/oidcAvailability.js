/**
 * What the OIDC configuration pass concluded, and why.
 *
 * A request that cannot start a sign-in has to say which of two things
 * happened: nothing was configured, or what was configured could not be made
 * to work. The first is answered by filling in OIDC_ISSUER and the rest; the
 * second is answered by looking at the provider, and telling an administrator
 * to go and change a configuration that is already right is the whole of the
 * defect this records.
 *
 * Recorded here rather than worked out again at request time: only
 * `configureOidc` knows what it decided and what it caught, and a second copy
 * of the enablement check in the routes would drift from it.
 *
 * Lives in its own module because the routes read it and loading the OIDC
 * middleware opens sessions.db, which nothing answering a question about the
 * configuration should do.
 */

/** Nothing usable was configured; the settings are what to look at. */
const NOT_CONFIGURED = 'not-configured';
/** The settings were there, and the provider hand-off is mounted. */
const READY = 'ready';
/** The settings were there and could not be made to work; see `reason`. */
const UNAVAILABLE = 'unavailable';

// An instance that never calls `configureOidc` — AUTH_MODE=local, or a test
// that skips it — has nothing configured, which is what this says.
let state = { status: NOT_CONFIGURED, reason: null };

const recordOidcNotConfigured = (reason = null) => {
  state = { status: NOT_CONFIGURED, reason };
};

const recordOidcReady = () => {
  state = { status: READY, reason: null };
};

const recordOidcUnavailable = (reason = null) => {
  state = { status: UNAVAILABLE, reason };
};

/** @returns {{status: string, reason: string|null}} */
const getOidcAvailability = () => ({ ...state });

/** Whether the settings for a sign-in at a provider are there at all. */
const oidcIsConfigured = () => state.status !== NOT_CONFIGURED;

module.exports = {
  NOT_CONFIGURED,
  READY,
  UNAVAILABLE,
  recordOidcNotConfigured,
  recordOidcReady,
  recordOidcUnavailable,
  getOidcAvailability,
  oidcIsConfigured,
};
