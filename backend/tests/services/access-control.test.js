import { describe, it, expect } from 'vitest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

const ACCESS_MODULES = [
  'src/services/storage/jsonStorage',
  'src/services/settingsService',
  'src/services/accessControlService',
];

const createAccessContext = async () => {
  const envContext = await setupTestEnv({
    tag: 'access-control-test-',
    modules: ACCESS_MODULES,
  });
  const accessControlService = envContext.requireFresh('src/services/accessControlService');
  return { envContext, accessControlService };
};

describe('Access Control Service', () => {
  describe('Rule Management', () => {
    it('should honor rule order and recursion', async () => {
      const { envContext, accessControlService } = await createAccessContext();
      try {
        const stored = await accessControlService.setRules([
          { path: '/parent/child', permissions: 'hidden', recursive: false },
          { path: 'parent', permissions: 'ro', recursive: true },
        ]);

        expect(stored.length).toBe(2);

        const rules = await accessControlService.getRules();
        expect(rules.length).toBe(2);
        expect(rules[0].path).toBe('parent/child');

        // Exact match for non-recursive rule
        expect(await accessControlService.getPermissionForPath('parent/child')).toBe('hidden');

        // Child of non-recursive rule falls through to parent recursive rule
        expect(await accessControlService.getPermissionForPath('parent/child/file.txt')).toBe('ro');

        // Other children match the recursive parent rule
        expect(await accessControlService.getPermissionForPath('parent/other')).toBe('ro');

        // Unmatched paths get default permissions
        expect(await accessControlService.getPermissionForPath('unmatched/path')).toBe('rw');
      } finally {
        await envContext.cleanup();
      }
    });
  });
});
