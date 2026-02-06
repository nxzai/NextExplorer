import { describe, it, expect, beforeEach } from 'vitest';
import lockService from '../../src/services/wopiLockService.js';

describe('WOPI Lock Service', () => {
  beforeEach(() => {
    lockService.resetAllLocks();
  });

  describe('Lock/Unlock Flow', () => {
    it('should support complete lock/unlock lifecycle', () => {
      const fileId = 'file-1';
      const now = Date.now();

      // Initially no lock
      expect(lockService.getLock(fileId, now)).toBeNull();

      // Acquire lock
      expect(lockService.tryLock(fileId, 'lock-a', now)).toEqual({ ok: true });
      expect(lockService.getLock(fileId, now + 1)).toBe('lock-a');

      // Different lock ID should fail
      expect(lockService.tryLock(fileId, 'lock-b', now + 2)).toEqual({
        ok: false,
        currentLockId: 'lock-a',
      });

      // Unlock with wrong ID should fail
      expect(lockService.tryUnlock(fileId, 'lock-b', now + 3)).toEqual({
        ok: false,
        currentLockId: 'lock-a',
      });

      // Unlock with correct ID should succeed
      expect(lockService.tryUnlock(fileId, 'lock-a', now + 4)).toEqual({ ok: true });
      expect(lockService.getLock(fileId, now + 5)).toBeNull();
    });
  });
});
