import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

describe('Users Service', () => {
  let envContext;
  let users;

  beforeAll(async () => {
    envContext = await setupTestEnv({
      tag: 'users-test-',
      modules: ['src/services/users', 'src/services/db'],
      env: { OIDC_AUTO_CREATE_USERS: 'false' },
    });
    users = envContext.requireFresh('src/services/users');
  });

  afterAll(async () => {
    await envContext.cleanup();
  });

  describe('Local Authentication', () => {
    it('should create local user, login, change password, and enforce lockout', async () => {
      // Initially no users
      expect(await users.countUsers()).toBe(0);

      // Create admin user with local password auth
      const admin = await users.createLocalUser({
        email: 'admin@example.com',
        password: 'secret123',
        username: 'admin',
        displayName: 'Admin',
        roles: ['admin'],
      });
      expect(admin.username).toBe('admin');
      expect(await users.countUsers()).toBe(1);

      // Successful login with email + password
      const loggedIn = await users.attemptLocalLogin({
        email: 'admin@example.com',
        password: 'secret123',
      });
      expect(loggedIn).toBeDefined();
      expect(loggedIn.id).toBe(admin.id);

      // Change password and verify login with the new password
      await users.changeLocalPassword({
        userId: admin.id,
        currentPassword: 'secret123',
        newPassword: 'newpass456',
      });
      const afterChange = await users.attemptLocalLogin({
        email: 'admin@example.com',
        password: 'newpass456',
      });
      expect(afterChange).toBeDefined();
      expect(afterChange.id).toBe(admin.id);

      // Wrong password attempts trigger lockout based on email
      for (let i = 0; i < 5; i++) {
        const bad = await users.attemptLocalLogin({
          email: 'admin@example.com',
          password: 'nope',
        });
        expect(bad).toBeNull();
      }

      // Next attempt should throw 423 lockout
      await expect(
        users.attemptLocalLogin({
          email: 'admin@example.com',
          password: 'nope',
        })
      ).rejects.toMatchObject({ status: 423 });
    });
  });

  describe('OIDC Authentication', () => {
    it('should deny login when auto-create disabled and user missing', async () => {
      await expect(
        users.getOrCreateOidcUser({
          issuer: 'https://issuer.example.com',
          sub: 'sub-1',
          email: 'missing@example.com',
          emailVerified: true,
          username: 'missing',
          displayName: 'Missing',
          roles: ['user'],
          autoCreateUsers: false,
        })
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('should auto-link to existing local user even when auto-create disabled', async () => {
      const existing = await users.createLocalUser({
        email: 'existing@example.com',
        password: 'secret123',
        username: 'existing',
        displayName: 'Existing',
        roles: ['user'],
      });

      const linked = await users.getOrCreateOidcUser({
        issuer: 'https://issuer.example.com',
        sub: 'sub-2',
        email: 'existing@example.com',
        emailVerified: true,
        username: 'existing-oidc',
        displayName: 'Existing OIDC',
        roles: ['user'],
        autoCreateUsers: false,
      });
      expect(linked.id).toBe(existing.id);

      const methods = await users.getUserAuthMethods(existing.id);
      const hasOidc = methods.some((m) => m.method_type === 'oidc' && m.provider_sub === 'sub-2');
      expect(hasOidc).toBe(true);
    });
  });
});
