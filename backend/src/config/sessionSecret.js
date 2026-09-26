const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * The secret sessions are signed with, when nobody configured one.
 *
 * It was drawn at random at every start. Sessions themselves outlive a restart
 * — they are kept in CACHE_DIR/sessions.db — but a cookie signed with the
 * previous secret no longer verifies, so every restart, every upgrade and every
 * crash signed everyone out. The secrets derived from it (ONLYOFFICE without
 * ONLYOFFICE_SECRET, the thumbnail links) changed with it.
 *
 * So the first start draws one and keeps it in CONFIG_DIR, and later starts read
 * it back. SESSION_SECRET, when set, always wins and nothing is written.
 *
 * Synchronous on purpose: the configuration is required before anything else
 * runs, and every value derived from the secret is computed at that moment.
 */

const SECRET_FILE_NAME = 'session-secret';
const SECRET_PATTERN = /^[0-9a-f]{64}$/i;

const draw = () => crypto.randomBytes(32).toString('hex');

/** Read the stored secret: the secret, `null` when there is none to use, or the error. */
const readStored = (file) => {
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { secret: null };
    return { error };
  }

  const value = contents.trim();
  if (SECRET_PATTERN.test(value)) return { secret: value };

  // Nothing of the file's contents is logged: a hand-written secret would
  // otherwise land in the logs on its way to being replaced.
  logger.warn(
    { file, reason: value ? 'not a 64-character hexadecimal secret' : 'empty' },
    'The stored session secret is unusable and is being replaced; sessions signed with it end ' +
      'here. To choose the secret yourself, set SESSION_SECRET instead.'
  );
  return { secret: null };
};

/**
 * Write the secret beside its final name, then rename it into place, so a start
 * interrupted half-way leaves either no file or a whole one — never a truncated
 * secret that the next start would have to throw away.
 *
 * The staging name is fixed rather than unique: a write that keeps failing (a
 * full disk) then leaves one stray file that the next attempt reuses, not a new
 * one per start. Removing it is not this module's business.
 */
const store = (configDir, file, secret) => {
  fs.mkdirSync(configDir, { recursive: true });

  const staging = path.join(configDir, `.${SECRET_FILE_NAME}.tmp`);
  const fd = fs.openSync(staging, 'w', 0o600);
  try {
    // The mode given to open only applies to a file it creates; a staging file
    // left by an older attempt keeps its own.
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, `${secret}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(staging, file);

  // The rename only survives a power cut once the directory is on disk too.
  // Not every platform lets a directory be opened for that, and the file is
  // already in place, so a refusal here costs nothing but that guarantee.
  try {
    const dirFd = fs.openSync(configDir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* best effort */
  }
};

const warnEphemeral = (configDir, error, action) => {
  logger.warn(
    { directory: configDir, code: error.code || null, err: { message: error.message } },
    `Could not ${action} the session secret in CONFIG_DIR, so a new one is used for this run ` +
      'only: everyone will be signed out at the next restart. Make CONFIG_DIR writable by the ' +
      'user the server runs as, or set SESSION_SECRET.'
  );
};

/**
 * @param {object} options
 * @param {string|null|undefined} options.configured SESSION_SECRET, as read from the environment
 * @param {string} options.configDir The resolved CONFIG_DIR
 * @returns {string}
 */
const resolveSessionSecret = ({ configured, configDir }) => {
  if (configured) return configured;

  const file = path.join(configDir, SECRET_FILE_NAME);

  const stored = readStored(file);
  if (stored.error) {
    // A file that exists and cannot be read belongs to someone else — another
    // user, a mount gone wrong. Replacing it would throw away a secret that may
    // still be good once the permissions are, so it is left alone.
    warnEphemeral(configDir, stored.error, 'read');
    return draw();
  }
  if (stored.secret) return stored.secret;

  const secret = draw();
  try {
    store(configDir, file, secret);
  } catch (error) {
    warnEphemeral(configDir, error, 'store');
    return secret;
  }

  logger.info(
    { file },
    'Generated a session secret and stored it in CONFIG_DIR; sessions now survive restarts'
  );
  return secret;
};

module.exports = { resolveSessionSecret, SECRET_FILE_NAME };
