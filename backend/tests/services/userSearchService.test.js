import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

describe('User Search Service', () => {
  let envContext;
  let searchUsersForMentions;
  let searchLocalUsers;
  let users;
  let getDb;

  beforeAll(async () => {
    envContext = await setupTestEnv({
      tag: 'userSearch-',
      modules: ['src/services/userSearchService', 'src/services/users', 'src/services/db'],
    });
    const searchService = envContext.requireFresh('src/services/userSearchService');
    searchUsersForMentions = searchService.searchUsersForMentions;
    searchLocalUsers = searchService.searchLocalUsers;
    users = envContext.requireFresh('src/services/users');
    const db = envContext.requireFresh('src/services/db');
    getDb = db.getDb;
  });

  afterAll(async () => {
    await envContext.cleanup();
  });

  describe('searchUsersForMentions', () => {
    it('should return empty for empty query', async () => {
      const result = await searchUsersForMentions('');
      expect(result).toEqual({ Users: [] });

      const resultNull = await searchUsersForMentions(null);
      expect(resultNull).toEqual({ Users: [] });

      const resultWhitespace = await searchUsersForMentions('   ');
      expect(resultWhitespace).toEqual({ Users: [] });
    });

    it('should find users by display name, email, and username', async () => {
      // Create test users
      await users.createLocalUser({
        email: 'john.doe@example.com',
        password: 'password123',
        username: 'johnd',
        displayName: 'John Doe',
        roles: ['user'],
      });

      await users.createLocalUser({
        email: 'jane.smith@example.com',
        password: 'password123',
        username: 'janes',
        displayName: 'Jane Smith',
        roles: ['user'],
      });

      // Search by display name
      const byName = await searchUsersForMentions('John', 10);
      expect(byName.Users.length).toBe(1);
      expect(byName.Users[0].UserFriendlyName).toBe('John Doe');
      expect(byName.Users[0].UserEmail).toBe('john.doe@example.com');

      // Search by email
      const byEmail = await searchUsersForMentions('jane.smith@', 10);
      expect(byEmail.Users.length).toBe(1);
      expect(byEmail.Users[0].UserEmail).toBe('jane.smith@example.com');

      // Search by username
      const byUsername = await searchUsersForMentions('johnd', 10);
      expect(byUsername.Users.length).toBe(1);
      expect(byUsername.Users[0].UserFriendlyName).toBe('John Doe');
    });

    it('should be case insensitive', async () => {
      await users.createLocalUser({
        email: 'alice@example.com',
        password: 'password123',
        username: 'alice',
        displayName: 'Alice Anderson',
        roles: ['user'],
      });

      // Search with different cases
      const upper = await searchUsersForMentions('ALICE', 10);
      expect(upper.Users.length).toBe(1);

      const lower = await searchUsersForMentions('alice', 10);
      expect(lower.Users.length).toBe(1);

      const mixed = await searchUsersForMentions('AlIcE', 10);
      expect(mixed.Users.length).toBe(1);
    });

    it('should respect limit parameter', async () => {
      // Create multiple users with similar names
      for (let i = 1; i <= 10; i++) {
        await users.createLocalUser({
          email: `testuser${i}@example.com`,
          password: 'password123',
          username: `testuser${i}`,
          displayName: `Test User ${i}`,
          roles: ['user'],
        });
      }

      // Search with limit
      const limited = await searchUsersForMentions('Test User', 3);
      expect(limited.Users.length).toBe(3);

      const unlimited = await searchUsersForMentions('Test User', 20);
      expect(unlimited.Users.length).toBe(10);
    });

    it('should fall back to username when display_name is missing', async () => {
      // Insert user directly without display_name
      const db = await getDb();
      const now = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO users (id, email, username, display_name, roles, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      ).run('user-no-display', 'nodisplay@example.com', 'nodisplayuser', null, '["user"]', now, now);

      const result = await searchUsersForMentions('nodisplay', 10);
      expect(result.Users.length).toBe(1);
      expect(result.Users[0].UserFriendlyName).toBe('nodisplayuser');
    });

    it('should return results in Collabora format', async () => {
      const created = await users.createLocalUser({
        email: 'format@example.com',
        password: 'password123',
        username: 'formatuser',
        displayName: 'Format Test User',
        roles: ['user'],
      });

      const result = await searchUsersForMentions('format', 10);

      expect(result.Users.length).toBe(1);
      expect(result.Users[0].UserId).toBeDefined();
      expect(result.Users[0].UserFriendlyName).toBeDefined();
      expect(result.Users[0].UserEmail).toBeDefined();

      // Verify exact format expected by Collabora
      expect(result.Users[0].UserId).toBe(created.id);
      expect(result.Users[0].UserFriendlyName).toBe('Format Test User');
      expect(result.Users[0].UserEmail).toBe('format@example.com');
    });
  });

  describe('searchLocalUsers', () => {
    it('should return empty array for invalid input', async () => {
      expect(await searchLocalUsers('')).toEqual([]);
      expect(await searchLocalUsers(null)).toEqual([]);
      expect(await searchLocalUsers(undefined)).toEqual([]);
      expect(await searchLocalUsers('   ')).toEqual([]);
    });
  });
});
