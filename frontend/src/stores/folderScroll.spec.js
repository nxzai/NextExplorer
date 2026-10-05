import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { FOLDER_SCROLL_POSITION_LIMIT, useFolderScrollStore } from './folderScroll';

describe('folder scroll positions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('remembers a non-negative position per folder', () => {
    const store = useFolderScrollStore();

    store.remember('volume/parent', 734.8);
    store.remember('volume/child', -50);

    expect(store.get('volume/parent')).toBe(735);
    expect(store.get('volume/child')).toBe(0);
    expect(store.get('volume/missing')).toBe(0);
  });

  it('keeps the most recently used positions within the session limit', () => {
    const store = useFolderScrollStore();

    for (let index = 0; index <= FOLDER_SCROLL_POSITION_LIMIT; index += 1) {
      store.remember(`volume/folder-${index}`, index);
    }

    expect(store.has('volume/folder-0')).toBe(false);
    expect(store.get(`volume/folder-${FOLDER_SCROLL_POSITION_LIMIT}`)).toBe(
      FOLDER_SCROLL_POSITION_LIMIT
    );
  });

  it('restores a remembered position only after an explicit navigation permit', () => {
    const store = useFolderScrollStore();

    store.remember('volume/parent::list', 420);

    expect(store.consumeRestore('volume/parent::list')).toBe(0);

    store.permitRestore('volume/parent');
    expect(store.consumeRestore('volume/parent::list')).toBe(420);
    expect(store.consumeRestore('volume/parent::list')).toBe(0);
  });

  it('restores the active item only with the permitted folder return', () => {
    const store = useFolderScrollStore();

    store.remember('volume/parent::list', 0);
    store.rememberActiveItem('volume/parent::list', 'volume/parent::example.txt');

    expect(store.consumeRestoreState('volume/parent::list')).toEqual({
      permitted: false,
      scrollTop: 0,
      activeItemKey: '',
    });

    store.permitRestore('volume/parent');
    expect(store.consumeRestoreState('volume/parent::list')).toEqual({
      permitted: true,
      scrollTop: 0,
      activeItemKey: 'volume/parent::example.txt',
    });
  });

  it('preserves an editor return through the generic navigation guard', () => {
    const store = useFolderScrollStore();

    store.remember('volume/parent::list', 420);
    store.permitExplicitRestore('volume/parent', 'tab-1');
    store.preventRestore('volume/parent', 'tab-1');

    expect(store.consumeRestore('volume/parent::list', 'tab-1')).toBe(420);
  });

  /**
   * A promised return belongs to the tab it was promised to.
   *
   * The folder's memory is shared by every tab on it, and so was the permission to
   * read it. One tab walking up into a folder, or coming back out of a file in it,
   * left a permission that the *next* tab drawn on that folder consumed — and that
   * tab was then put where the first one had been.
   */
  it('gives a promised return to the tab it was promised to', () => {
    const store = useFolderScrollStore();

    store.remember('volume/parent::list', 900);
    store.permitRestore('volume/parent', 'tab-1');

    expect(store.consumeRestore('volume/parent::list', 'tab-2')).toBe(0);
    expect(store.consumeRestore('volume/parent::list', 'tab-1')).toBe(900);
  });

  it('keeps one tab’s explicit return out of another’s way', () => {
    const store = useFolderScrollStore();

    store.remember('volume/parent::list', 640);
    store.permitExplicitRestore('volume/parent', 'tab-1');

    expect(store.consumeRestore('volume/parent::list', 'tab-2')).toBe(0);
    expect(store.consumeRestore('volume/parent::list', 'tab-1')).toBe(640);
  });

  /**
   * The top is a place, and a tab that is there has an answer.
   *
   * Asked as a number it answers zero, which a caller reads as "no answer" and
   * falls through to the folder's own memory — the one every tab on that folder
   * shares. Two tabs on one folder, the first scrolled to the bottom and left
   * there, the second never moved: the second came back beside the first.
   */
  it('says a tab left at the top has a place, rather than no place', () => {
    const store = useFolderScrollStore();

    store.rememberTabPlace('tab-2::volume/parent::list', 0);

    expect(store.hasTabPlace('tab-2::volume/parent::list')).toBe(true);
    expect(store.tabPlace('tab-2::volume/parent::list')).toBe(0);
  });

  it('says a tab that has never been drawn in a folder has no place in it', () => {
    const store = useFolderScrollStore();

    expect(store.hasTabPlace('tab-3::volume/parent::list')).toBe(false);
  });
});
