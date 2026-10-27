import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a click, a Ctrl-click and a Shift-click select.
 *
 * Eighty-nine lines that run on every click in the explorer, at 1.8%. Selection
 * is what every destructive action reads afterwards, so an off-by-one in the
 * range is a file deleted that nobody meant to delete.
 *
 * The subtle part is the anchor. Shift-click extends from the *last* item
 * selected, not the first, and it works in both directions — so the range has
 * to be normalised before slicing or a backwards drag selects nothing.
 */

let store;
/**
 * Which pane is asking. Null is the ordinary case — one pane, which is the tab in
 * front — and the tests about a split view name a tab themselves.
 */
const paneTab = { id: null };

vi.mock('@/api', () => ({
  normalizePath: (p = '') => String(p).replace(/^\/+|\/+$/g, ''),
}));
vi.mock('@/stores/fileStore', () => ({ useFileStore: () => store }));
vi.mock('@/composables/paneTab', () => ({
  usePaneTabId: () => ({
    get value() {
      return paneTab.id || 'tab-in-front';
    },
  }),
}));

import { useSelection } from './itemSelection';

const item = (name, path = 'Docs') => ({ name, path, kind: 'txt' });
const LIST = ['a', 'b', 'c', 'd', 'e'].map((n) => item(`${n}.txt`));

/**
 * The store as it really is: one folder per tab, each with its own listing and
 * its own selection. A stand-in with a single selection on it would answer every
 * question the same whichever pane asked — which is the whole of what this is for.
 */
const folderHolding = (selected = [], items = LIST) => {
  const selectedItems = { value: selected };
  const folder = {
    items: { value: items },
    selection: {
      selectedItems,
      get selectedItemKeys() {
        return { value: new Set(selectedItems.value.map((i) => `${i.path}::${i.name}`)) };
      },
      clearSelection: () => {
        selectedItems.value = [];
      },
    },
  };
  return folder;
};

const makeStore = (selected = []) => {
  const folders = { 'tab-in-front': folderHolding(selected) };
  return {
    folders,
    // As the real one does: no tab named is the tab in front.
    folderFor: (id) => (folders[id || 'tab-in-front'] ??= folderHolding()),
    arrange: (items) => items,
    // What this spec reads, which is the folder of whichever tab was asked about
    // last — the tab in front unless a test says otherwise.
    get selectedItems() {
      return folders[paneTab.id || 'tab-in-front'].selection.selectedItems.value;
    },
  };
};

const names = () => store.selectedItems.map((i) => i.name);

beforeEach(() => {
  paneTab.id = null;
  store = makeStore();
});

describe('a plain click', () => {
  it('selects one thing and drops everything else', () => {
    store = makeStore([item('a.txt'), item('b.txt')]);

    useSelection().handleSelection(item('d.txt'), {});

    expect(names()).toEqual(['d.txt']);
  });

  it('selects with no event at all', () => {
    useSelection().handleSelection(item('c.txt'));

    expect(names()).toEqual(['c.txt']);
  });

  /**
   * The object from a row is not the object in the listing. Selecting the row's
   * copy means later comparisons against the listing miss.
   */
  it('selects the listing’s object, not the copy it was handed', () => {
    useSelection().handleSelection({ name: 'c.txt', path: 'Docs' }, {});

    expect(store.selectedItems[0]).toBe(LIST[2]);
  });

  it('keeps an item the listing does not contain rather than dropping it', () => {
    useSelection().handleSelection(item('gone.txt'), {});

    expect(names()).toEqual(['gone.txt']);
  });
});

describe('Ctrl-click, and Cmd-click', () => {
  it.each([
    ['ctrl', { ctrlKey: true }],
    ['cmd', { metaKey: true }],
  ])('%s adds to the selection', (_label, event) => {
    store = makeStore([item('a.txt')]);

    useSelection().handleSelection(item('c.txt'), event);

    expect(names()).toEqual(['a.txt', 'c.txt']);
  });

  it('removes something already selected', () => {
    store = makeStore([item('a.txt'), item('c.txt')]);

    useSelection().handleSelection(item('a.txt'), { ctrlKey: true });

    expect(names()).toEqual(['c.txt']);
  });

  it('removes the right one when several are selected', () => {
    store = makeStore([item('a.txt'), item('b.txt'), item('c.txt')]);

    useSelection().handleSelection(item('b.txt'), { ctrlKey: true });

    expect(names()).toEqual(['a.txt', 'c.txt']);
  });

  /** A new array every time, or a memoised list never notices the change. */
  it('replaces the array rather than mutating it in place', () => {
    const before = [item('a.txt')];
    store = makeStore(before);

    useSelection().handleSelection(item('c.txt'), { ctrlKey: true });

    expect(store.selectedItems).not.toBe(before);
    expect(before).toHaveLength(1);
  });
});

describe('Shift-click', () => {
  it('extends from the last selected item, downwards', () => {
    store = makeStore([item('b.txt')]);

    useSelection().handleSelection(item('d.txt'), { shiftKey: true });

    expect(names()).toEqual(['b.txt', 'c.txt', 'd.txt']);
  });

  /** Backwards is the same range. Slicing without normalising selects nothing. */
  it('extends upwards just as well', () => {
    store = makeStore([item('d.txt')]);

    useSelection().handleSelection(item('b.txt'), { shiftKey: true });

    expect(names()).toEqual(['b.txt', 'c.txt', 'd.txt']);
  });

  it('anchors on the last item selected, not the first', () => {
    store = makeStore([item('a.txt'), item('c.txt')]);

    useSelection().handleSelection(item('e.txt'), { shiftKey: true });

    expect(names()).toEqual(['c.txt', 'd.txt', 'e.txt']);
  });

  it('selects just the one when shift-clicking where you already are', () => {
    store = makeStore([item('c.txt')]);

    useSelection().handleSelection(item('c.txt'), { shiftKey: true });

    expect(names()).toEqual(['c.txt']);
  });

  it('falls back to a plain click when nothing is selected yet', () => {
    useSelection().handleSelection(item('c.txt'), { shiftKey: true });

    expect(names()).toEqual(['c.txt']);
  });

  /**
   * The anchor can be stale — selected, then the folder re-listed without it.
   * Selecting the range to a vanished anchor would select an arbitrary span.
   */
  it('selects only the target when the anchor is no longer in the listing', () => {
    store = makeStore([item('vanished.txt')]);

    useSelection().handleSelection(item('d.txt'), { shiftKey: true });

    expect(names()).toEqual(['d.txt']);
  });

  it('does nothing when the target itself is not in the listing', () => {
    store = makeStore([item('b.txt')]);

    useSelection().handleSelection(item('ghost.txt'), { shiftKey: true });

    expect(names()).toEqual(['b.txt']);
  });

  it('selects the whole listing from end to end', () => {
    store = makeStore([item('a.txt')]);

    useSelection().handleSelection(item('e.txt'), { shiftKey: true });

    expect(names()).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt']);
  });
});

describe('Ctrl beats Shift when both are held', () => {
  it('toggles rather than extending', () => {
    store = makeStore([item('a.txt')]);

    useSelection().handleSelection(item('d.txt'), { ctrlKey: true, shiftKey: true });

    expect(names()).toEqual(['a.txt', 'd.txt']);
  });
});

describe('clearing', () => {
  it('asks the folder to let go of what it was holding', () => {
    store = makeStore([item('a.txt')]);

    useSelection().clearSelection();

    expect(names()).toEqual([]);
  });

  it('clears its own pane and leaves the other alone', () => {
    store = makeStore([item('a.txt')]);
    store.folders['tab-beside'] = folderHolding([item('d.txt')]);
    paneTab.id = 'tab-beside';

    useSelection().clearSelection();

    expect(names()).toEqual([]);
    expect(store.folders['tab-in-front'].selection.selectedItems.value.map((i) => i.name)).toEqual([
      'a.txt',
    ]);
  });
});

/**
 * Two panes are two places, and what is selected belongs to a place.
 *
 * Asked of the window, one selection served both halves: choosing a file in one
 * half moved the highlight in the other — and in the half the reader was not in it
 * jumped to wherever the other had just been pressed, which is somewhere else
 * entirely in the list.
 */
describe('a row drawn in a pane', () => {
  it('selects into its own tab, not the one in front', () => {
    store = makeStore([item('a.txt')]);
    store.folders['tab-beside'] = folderHolding([]);
    paneTab.id = 'tab-beside';

    useSelection().handleSelection(item('d.txt'), {});

    expect(names()).toEqual(['d.txt']);
    // And the tab in front is still holding what it was.
    expect(store.folders['tab-in-front'].selection.selectedItems.value.map((i) => i.name)).toEqual([
      'a.txt',
    ]);
  });

  it('says what its own tab holds, not what the one in front does', () => {
    store = makeStore([item('a.txt')]);
    store.folders['tab-beside'] = folderHolding([item('e.txt')]);
    paneTab.id = 'tab-beside';
    const selection = useSelection();

    expect(selection.isSelected(item('e.txt'))).toBe(true);
    expect(selection.isSelected(item('a.txt'))).toBe(false);
  });

  /** And a range runs through its own pane's listing, which may not be the same one. */
  it('extends a range through its own listing', () => {
    store = makeStore([]);
    store.folders['tab-beside'] = folderHolding(
      [item('x.txt', 'Media')],
      ['x', 'y', 'z'].map((n) => item(`${n}.txt`, 'Media'))
    );
    paneTab.id = 'tab-beside';

    useSelection().handleSelection(item('z.txt', 'Media'), { shiftKey: true });

    expect(names()).toEqual(['x.txt', 'y.txt', 'z.txt']);
  });
});

describe('asking whether something is selected', () => {
  it('matches on the parent as well as the name', () => {
    store = makeStore([item('a.txt', 'Docs')]);
    const selection = useSelection();

    expect(selection.isSelected(item('a.txt', 'Docs'))).toBe(true);
    expect(selection.isSelected(item('a.txt', 'Other'))).toBe(false);
  });

  it('is false for something with no name', () => {
    store = makeStore([item('a.txt')]);

    expect(useSelection().isSelected({ path: 'Docs' })).toBe(false);
  });
});
