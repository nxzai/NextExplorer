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

  /**
   * A tab's own place, and the difference between "at the top" and "nowhere".
   *
   * The folder's memory is shared by every tab on it and is only the fallback. A
   * tab whose place was the top answered zero, which reads as no answer at all —
   * so it fell through to the folder's and came back wherever another tab had last
   * been left. Three tabs on one folder, one of them scrolled to the bottom to open
   * a document, and the other two landed down there beside it.
   */
  it('tells a place at the top from no place at all', () => {
    const store = useFolderScrollStore();

    expect(store.hasTabPlace('tab-1::volume/parent::list')).toBe(false);

    store.rememberTabPlace('tab-1::volume/parent::list', 0);

    expect(store.hasTabPlace('tab-1::volume/parent::list')).toBe(true);
    expect(store.tabPlace('tab-1::volume/parent::list')).toBe(0);
  });

  /**
   * And the row it was on, which answers the same question better.
   *
   * A pane that changes width re-flows its listing — one of a pair, or a pair
   * becoming one — and the same number of pixels is then a different place in the
   * folder: a reader put back by the number alone came back a hundred files away.
   */
  it('keeps the row the reader was on beside the number', () => {
    const store = useFolderScrollStore();

    store.rememberTabPlace('tab-1::volume/parent::list', 1200, 'volume/parent::file-082.txt');

    expect(store.tabPlace('tab-1::volume/parent::list')).toBe(1200);
    expect(store.tabAnchor('tab-1::volume/parent::list')).toBe('volume/parent::file-082.txt');
  });

  it('says there is no row when none was given', () => {
    const store = useFolderScrollStore();
    store.rememberTabPlace('tab-1::volume/parent::list', 1200);

    expect(store.tabAnchor('tab-1::volume/parent::list')).toBe('');
    expect(store.tabAnchor('tab-9::volume/parent::list')).toBe('');
  });

  it('forgets a tab place when it is told to', () => {
    const store = useFolderScrollStore();
    store.rememberTabPlace('tab-1::volume/parent::list', 900);

    store.forgetTabPlace('tab-1::volume/parent::list');

    expect(store.hasTabPlace('tab-1::volume/parent::list')).toBe(false);
  });

  /**
   * A permission to be put back belongs to the tab that was promised it.
   *
   * The folder's own memory is shared by every tab on that folder, and so was the
   * permission to use it: a tab that walked up into a folder, or came back out of a
   * file in it, left one lying about — and the next tab on that same folder
   * consumed it and jumped to where the first one had been. Three tabs on one
   * folder and one of them opening a document was enough to move the other two.
   */
  it('gives a return to the tab that was promised it, and to no other', () => {
    const store = useFolderScrollStore();
    store.remember('volume/parent::list', 420);
    store.permitExplicitRestore('volume/parent', 'tab-1');

    expect(store.consumeRestoreState('volume/parent::list', 'tab-9').permitted).toBe(false);
    expect(store.consumeRestoreState('volume/parent::list', 'tab-1')).toMatchObject({
      permitted: true,
      scrollTop: 420,
    });
  });

  it('keeps a walk back up to the tab that walked', () => {
    const store = useFolderScrollStore();
    store.remember('volume/parent::list', 900);
    store.permitRestore('volume/parent', 'tab-1');

    expect(store.consumeRestoreState('volume/parent::list', 'tab-9').permitted).toBe(false);
    expect(store.consumeRestoreState('volume/parent::list', 'tab-1').permitted).toBe(true);
  });

  it('preserves an editor return through the generic navigation guard', () => {
    const store = useFolderScrollStore();

    store.remember('volume/parent::list', 420);
    store.permitExplicitRestore('volume/parent', 'tab-1');
    store.preventRestore('volume/parent', 'tab-1');

    expect(store.consumeRestore('volume/parent::list', 'tab-1')).toBe(420);
  });
});
