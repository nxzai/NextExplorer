import { describe, it, expect, afterEach } from 'vitest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

const MODULES = ['src/config/env', 'src/config/index', 'src/services/db', 'src/services/users'];

let envContext;

const build = async () => {
  envContext = await setupTestEnv({ tag: 'oidc-roles-test-', modules: MODULES });
  const users = envContext.requireFresh('src/services/users');
  const dbService = envContext.requireFresh('src/services/db');
  const db = await dbService.getDb();
  return { users, db };
};

/** An account that already exists and signs in again through OIDC. */
const seedOidcUser = (db, { roles }) => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
  ).run('user-1', 'someone@example.com', 'someone', 'Someone', JSON.stringify(roles), now, now);
  db.prepare(
    `INSERT INTO auth_methods (id, user_id, method_type, provider_issuer, provider_sub, provider_name, created_at)
     VALUES ('auth-1', 'user-1', 'oidc', 'https://idp.example', 'sub-1', 'OIDC', ?)`
  ).run(now);
};

const signIn = (users, { roles, rolesAreAuthoritative }) =>
  users.getOrCreateOidcUser({
    issuer: 'https://idp.example',
    sub: 'sub-1',
    email: 'someone@example.com',
    emailVerified: true,
    username: 'someone',
    displayName: 'Someone',
    roles,
    rolesAreAuthoritative,
  });

const rolesOf = (db) =>
  JSON.parse(db.prepare('SELECT roles FROM users WHERE id = ?').get('user-1').roles);

afterEach(async () => {
  if (envContext) await envContext.cleanup();
  envContext = null;
});

describe('deciding whether the provider may set roles', () => {
  it('is authoritative when a group is configured and the claim is present', async () => {
    const { users } = await build();

    expect(users.rolesFromClaimsAreAuthoritative({ groups: ['admins'] }, ['admins'])).toBe(true);
    // An empty group list is still an answer: this user belongs to nothing.
    expect(users.rolesFromClaimsAreAuthoritative({ groups: [] }, ['admins'])).toBe(true);
  });

  // Without OIDC_ADMIN_GROUPS every login derives ['user']. Applying that would
  // demote anyone promoted through the interface, the bootstrap account
  // included, and leave nobody able to administer the instance.
  it('is not authoritative when no admin group is configured', async () => {
    const { users } = await build();

    expect(users.rolesFromClaimsAreAuthoritative({ groups: ['admins'] }, [])).toBe(false);
    expect(users.rolesFromClaimsAreAuthoritative({ groups: ['admins'] }, null)).toBe(false);
  });

  // A missing `groups` scope looks exactly like a user who belongs to nothing.
  // Its documented symptom is "not an admin after login"; acting on that
  // silence would turn a misconfiguration into a demotion.
  it('is not authoritative when the provider said nothing about groups', async () => {
    const { users } = await build();

    expect(users.rolesFromClaimsAreAuthoritative({}, ['admins'])).toBe(false);
    expect(users.rolesFromClaimsAreAuthoritative({ groups: null }, ['admins'])).toBe(false);
  });
});

describe('roles of a returning OIDC user', () => {
  it('grants admin when the provider now says so', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['user'] });

    await signIn(users, { roles: ['admin'], rolesAreAuthoritative: true });

    expect(rolesOf(db)).toEqual(['admin']);
  });

  // The point of the fix: removal at the provider has to reach us.
  it('revokes admin when the provider no longer says so', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['admin'] });

    await signIn(users, { roles: ['user'], rolesAreAuthoritative: true });

    expect(rolesOf(db)).toEqual(['user']);
  });

  it('leaves roles untouched when the provider is not authoritative', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['admin'] });

    await signIn(users, { roles: ['user'], rolesAreAuthoritative: false });

    expect(rolesOf(db)).toEqual(['admin']);
  });

  it('defaults to leaving them alone when nothing is said', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['admin'] });

    await users.getOrCreateOidcUser({
      issuer: 'https://idp.example',
      sub: 'sub-1',
      email: 'someone@example.com',
      emailVerified: true,
      username: 'someone',
      displayName: 'Someone',
      roles: ['user'],
    });

    expect(rolesOf(db)).toEqual(['admin']);
  });
});

/**
 * The regression this fix must not cause.
 *
 * On an instance with OIDC but no OIDC_ADMIN_GROUPS, every login derives the
 * plain `user` role. If that were applied, the administrator promoted from
 * Settings → Users — or created by AUTH_ADMIN_EMAIL at bootstrap — would lose
 * the role at their next sign-in, and nobody would be able to administer
 * anything. These follow the middleware's own sequence: work out whether the
 * provider is authoritative, then sign in with that answer.
 */
describe('an instance with no admin group configured', () => {
  const signInAsMiddlewareWould = async (users, claims, adminGroups, currentRoles) => {
    const authoritative = users.rolesFromClaimsAreAuthoritative(claims, adminGroups);
    const roles = users.deriveRolesFromClaims(claims, adminGroups);
    await signIn(users, { roles, rolesAreAuthoritative: authoritative });
    return currentRoles;
  };

  it('keeps an administrator promoted from the interface', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['admin'] });

    // No OIDC_ADMIN_GROUPS, and the provider reports groups the app knows
    // nothing about — the everyday case.
    await signInAsMiddlewareWould(users, { groups: ['staff', 'everyone'] }, null);

    expect(rolesOf(db)).toEqual(['admin']);
  });

  it('keeps it across repeated sign-ins', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['admin'] });

    for (let i = 0; i < 3; i += 1) {
      await signInAsMiddlewareWould(users, { groups: ['staff'] }, []);
    }

    expect(rolesOf(db)).toEqual(['admin']);
  });

  it('keeps it when the provider returns no group claim at all', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['admin'] });

    await signInAsMiddlewareWould(users, { email: 'someone@example.com' }, null);

    expect(rolesOf(db)).toEqual(['admin']);
  });

  // The same protection has to hold where a group IS configured but the
  // provider stayed silent about groups — a missing scope, not a demotion.
  it('keeps it when a group is configured but the claim is missing', async () => {
    const { users, db } = await build();
    seedOidcUser(db, { roles: ['admin'] });

    await signInAsMiddlewareWould(users, { email: 'someone@example.com' }, ['admins']);

    expect(rolesOf(db)).toEqual(['admin']);
  });
});
