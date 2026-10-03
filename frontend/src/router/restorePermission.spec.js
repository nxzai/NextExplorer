import { describe, expect, it } from 'vitest';

import { restorePermission } from './restorePermission';

/**
 * The rule the router applies before every navigation, asked directly.
 *
 * It had no test, and the part that had no test is the part that went wrong: the
 * permission to be put back was granted for a *folder*, and the folder's memory is
 * shared by every tab on it. One tab walking up out of a subfolder left a permission
 * that the next tab drawn on that folder took, and that reader was moved to where
 * the first one had been.
 */
describe('permission to be put back where you were', () => {
  it('permits it for a walk back up into the folder above', () => {
    expect(
      restorePermission({ destination: 'Docs', source: 'Docs/Reports', travelling: 'tab-1' })
    ).toEqual({ path: 'Docs', tabId: 'tab-1', permitted: true });
  });

  /** Opening a folder visited some time ago is an arrival, not a return. */
  it('refuses it for a folder arrived at from somewhere else', () => {
    expect(
      restorePermission({ destination: 'Docs', source: 'Media', travelling: 'tab-1' })
    ).toEqual({ path: 'Docs', tabId: 'tab-1', permitted: false });
  });

  it('refuses it for a walk down into a subfolder', () => {
    expect(
      restorePermission({ destination: 'Docs/Reports', source: 'Docs', travelling: 'tab-1' })
    ).toMatchObject({ permitted: false });
  });

  it('refuses it when there is nowhere it came from', () => {
    expect(
      restorePermission({ destination: 'Docs', source: '', travelling: 'tab-1' })
    ).toMatchObject({ permitted: false });
  });

  /**
   * And it names the tab making the journey, which is the whole point: two tabs can
   * be in one folder at once, and a permission with no name is one either of them
   * will consume.
   */
  it('names the tab that is making the journey', () => {
    expect(
      restorePermission({ destination: 'Docs', source: 'Docs/Reports', travelling: 'tab-7' }).tabId
    ).toBe('tab-7');
  });

  it('says nothing at all about a destination that is not a folder', () => {
    expect(restorePermission({ destination: '', source: 'Docs', travelling: 'tab-1' })).toBeNull();
  });
});
