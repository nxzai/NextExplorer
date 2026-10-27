import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

/**
 * A document belongs to the tab it was opened in.
 *
 * This is the whole of what tabs change here, and the line it draws: the register
 * of plugins belongs to the window — one list, asked by everything — and what is
 * *open* belongs to a tab. Before this there was one of each, so a second tab
 * would have shown the first one's document, and looking at a folder would have
 * ended whatever was being edited.
 *
 * The rule with the most behind it is the one that refuses to open the same
 * document twice in the same tab. The page that shows a document is mounted again
 * every time its tab comes forward, and opening it again builds a second
 * ONLYOFFICE editor over a live one: a new connection to the Document Server, no
 * cursor, no undo history, and whoever was typing watches it happen.
 */

const getPreviewUrl = vi.fn((p) => `https://files.example.com/api/preview?path=${p}`);

vi.mock('@/api', () => ({
  getPreviewUrl: (...a) => getPreviewUrl(...a),
  downloadItems: vi.fn(),
  fetchFileContent: vi.fn(),
  fetchMediaTracks: vi.fn(),
  getSubtitleUrl: vi.fn(),
  normalizePath: (p = '') => String(p).replace(/^\/+|\/+$/g, ''),
}));
vi.mock('@/stores/fileStore', () => ({
  useFileStore: () => ({ getCurrentPathItems: [] }),
}));
vi.mock('@/router', () => ({ default: { push: vi.fn() } }));

import { usePreviewManager } from './manager';
import { useTabsStore } from '@/stores/tabs';
import { useTabLoadingStore } from '@/stores/tabLoading';

const REPORT = { name: 'report.docx', path: 'Docs', kind: 'docx' };
const SHEET = { name: 'budget.xlsx', path: 'Docs', kind: 'xlsx' };

let hooks;
const office = () => ({
  id: 'office',
  match: () => true,
  component: () => Promise.resolve({}),
  onOpen: hooks.onOpen,
  onBeforeClose: hooks.onBeforeClose,
  onClose: hooks.onClose,
});

/** Tabs on, a second tab opened, and both ids. */
const twoTabs = () => {
  const tabs = useTabsStore();
  tabs.setEnabled(true);
  const first = tabs.activeId;
  const second = tabs.open('/browse/Media').id;
  return { tabs, first, second };
};

beforeEach(() => {
  setActivePinia(createPinia());
  hooks = { onOpen: vi.fn(), onBeforeClose: vi.fn(), onClose: vi.fn() };
});

describe('a document belongs to its tab', () => {
  it('is not what another tab is showing', () => {
    const manager = usePreviewManager();
    manager.register(office());
    const { tabs, first, second } = twoTabs();

    manager.openIn(first, REPORT);
    manager.openIn(second, SHEET);

    tabs.activate(first);
    expect(manager.activeItem.item.name).toBe('report.docx');
    tabs.activate(second);
    expect(manager.activeItem.item.name).toBe('budget.xlsx');
  });

  it('is still there, untouched, when its tab comes back', () => {
    const manager = usePreviewManager();
    manager.register(office());
    const { tabs, first, second } = twoTabs();

    manager.openIn(first, REPORT);
    tabs.activate(first);
    const opened = manager.activeItem;

    tabs.activate(second);
    expect(manager.isOpen).toBe(false);
    tabs.activate(first);

    // The same object, which is what "not rebuilt" means: a new context would be
    // a new component, and a new component is a new editor.
    expect(manager.activeItem).toBe(opened);
    expect(hooks.onOpen).toHaveBeenCalledTimes(1);
  });

  it('is left alone when the same document is opened in it again', () => {
    const manager = usePreviewManager();
    manager.register(office());
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const only = tabs.activeId;

    expect(manager.openIn(only, REPORT)).toBe(true);
    const opened = manager.activeItem;
    expect(manager.openIn(only, REPORT)).toBe(true);

    expect(manager.activeItem).toBe(opened);
    expect(hooks.onOpen).toHaveBeenCalledTimes(1);
  });

  /**
   * The path is not enough on its own. The history panel opens an earlier
   * version of a file at the same path, and answering "already open" to that
   * would show the current document and call it the version that was asked for.
   */
  it('opens an earlier version of the same file as the other document it is', () => {
    const manager = usePreviewManager();
    manager.register(office());
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const only = tabs.activeId;

    manager.openIn(only, REPORT);
    manager.openIn(only, { ...REPORT, versionId: 7 });

    expect(hooks.onOpen).toHaveBeenCalledTimes(2);
    expect(manager.activeItem.item.versionId).toBe(7);
  });

  it('says whether a tab is already showing something', () => {
    const manager = usePreviewManager();
    manager.register(office());
    const { first, second } = twoTabs();

    manager.openIn(first, REPORT);

    expect(manager.shows(first, REPORT)).toBe(true);
    expect(manager.shows(first, SHEET)).toBe(false);
    expect(manager.shows(second, REPORT)).toBe(false);
  });
});

describe('a tab that goes', () => {
  it('ends the document it was holding, wherever it was', async () => {
    const manager = usePreviewManager();
    manager.register(office());
    const { tabs, first, second } = twoTabs();

    manager.openIn(second, SHEET);
    tabs.activate(first);
    tabs.close(second);
    await nextTick();
    await Promise.resolve();

    // Not merely forgotten: an ONLYOFFICE document has a session on the server,
    // and closing the tab is the last chance anybody has to end it.
    expect(hooks.onBeforeClose).toHaveBeenCalledTimes(1);
    expect(hooks.onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the other tabs alone', async () => {
    const manager = usePreviewManager();
    manager.register(office());
    const { tabs, first, second } = twoTabs();

    manager.openIn(first, REPORT);
    manager.openIn(second, SHEET);
    tabs.close(second);
    await nextTick();
    await Promise.resolve();

    tabs.activate(first);
    expect(manager.isOpen).toBe(true);
    expect(manager.activeItem.item.name).toBe('report.docx');
  });
});

describe('the window going away', () => {
  /**
   * A document being edited in a background tab is being edited. Told only about
   * the one in front, the server would go on reporting the others as open and the
   * lock somebody else sees would never clear.
   */
  it('speaks for every open document, not only the one in front', () => {
    const manager = usePreviewManager();
    manager.register(office());
    const { first, second } = twoTabs();

    manager.openIn(first, REPORT);
    manager.openIn(second, SHEET);

    expect(manager.endForUnload()).toBe(true);
    expect(hooks.onBeforeClose).toHaveBeenCalledTimes(2);
    expect(hooks.onBeforeClose.mock.calls.every(([, how]) => how.unloading === true)).toBe(true);
  });
});

describe('a document closing itself', () => {
  /**
   * The editor's own close button goes through the api it was handed, which
   * closes *its* session. Sent to whatever is in front instead, an editor left
   * open in a background tab could close the document somebody else was reading.
   */
  it('closes its own, not whichever tab is in front', async () => {
    const manager = usePreviewManager();
    manager.register(office());
    const { tabs, first, second } = twoTabs();

    manager.openIn(first, REPORT);
    manager.openIn(second, SHEET);
    tabs.activate(second);

    const inTheBackground = manager.surfaces.find((surface) => surface.key === first);
    await inTheBackground.session.item.value.api.close();

    expect(manager.isOpen).toBe(true);
    expect(manager.activeItem.item.name).toBe('budget.xlsx');
    expect(manager.shows(first, REPORT)).toBe(false);
  });
});

describe('what the host is given to draw', () => {
  it('one surface per tab, in the order of the tabs', () => {
    const manager = usePreviewManager();
    const { tabs, first, second } = twoTabs();

    expect(manager.surfaces.map((surface) => surface.key)).toEqual([first, second]);

    tabs.close(second);
    expect(manager.surfaces.map((surface) => surface.key)).toEqual([first]);
  });
});

/**
 * A tab says it is working while its viewer is being built.
 *
 * What a browser does, and it matters more here: a document opened in a tab
 * behind is built while the reader is looking at something else, so without a
 * word from it there is nothing to tell "not there yet" from "there, and empty".
 *
 * The moment worth reporting is not the component loading — that is instant — but
 * what comes after it for a viewer that has a real wait: a document server to
 * reach, a session to be given, a file to load into an iframe. Only the viewer
 * knows when that is over, so one that has such a wait says so, and the rest are
 * done as soon as they are shown.
 */
describe('a tab whose viewer is still being built', () => {
  const reporting = () => ({ ...office(), reportsReady: true });

  it('says it is working, and stops when the viewer says it is there', async () => {
    const { first } = twoTabs();
    const manager = usePreviewManager();
    const busy = useTabLoadingStore();
    manager.register(reporting());

    manager.openIn(first, REPORT);
    await nextTick();
    expect(busy.isLoading(first)).toBe(true);

    // What the viewer sets once a document server has answered and the file is in.
    manager.itemIn(first).previewState.isReady = true;
    await nextTick();

    expect(busy.isLoading(first)).toBe(false);
  });

  /** An image is on screen the moment its component is: nothing to wait for. */
  it('says nothing for a viewer with no wait of its own', async () => {
    const { first } = twoTabs();
    const manager = usePreviewManager();
    const busy = useTabLoadingStore();
    manager.register(office());

    manager.openIn(first, REPORT);
    await nextTick();

    expect(busy.isLoading(first)).toBe(false);
  });

  it('says it of the tab it was opened in, and of no other', async () => {
    const { first, second } = twoTabs();
    const manager = usePreviewManager();
    const busy = useTabLoadingStore();
    manager.register(reporting());

    manager.openIn(second, REPORT);
    await nextTick();

    expect(busy.isLoading(second)).toBe(true);
    expect(busy.isLoading(first)).toBe(false);
  });

  /**
   * A tab that says it is working for ever is worse than one that never said it:
   * the reader is told to wait for something that is not coming.
   */
  it('stops saying it after waiting long enough', async () => {
    vi.useFakeTimers();
    try {
      const { first } = twoTabs();
      const manager = usePreviewManager();
      const busy = useTabLoadingStore();
      manager.register(reporting());

      manager.openIn(first, REPORT);
      await nextTick();
      expect(busy.isLoading(first)).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(busy.isLoading(first)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The wait is for *this* document, in this tab — and it is over when the tab
   * stops showing it, whether or not a viewer ever arrived.
   *
   * A document closed before its editor had answered left the wait standing: the
   * viewer that was going to report itself ready had been taken off the screen, so
   * the only thing left to end the wait was the patience running out. Three
   * quarters of a minute of a tab saying it is working over a tab holding nothing
   * — and every crossing that closed and re-opened a document added another one.
   */
  it('stops saying it when the document it was waiting for is closed', async () => {
    const { first } = twoTabs();
    const manager = usePreviewManager();
    const busy = useTabLoadingStore();
    manager.register(reporting());

    manager.openIn(first, REPORT);
    await nextTick();
    expect(busy.isLoading(first)).toBe(true);

    await manager.closeIn(first);
    await nextTick();

    expect(busy.isLoading(first)).toBe(false);
  });

  /**
   * And when another document takes its place, what is still being waited for is
   * the new one. Both waits standing at once, only one of them ever answered, is
   * the same spinner by another road.
   */
  it('waits for the document that took its place, and not for both', async () => {
    const { first } = twoTabs();
    const manager = usePreviewManager();
    const busy = useTabLoadingStore();
    manager.register(reporting());

    manager.openIn(first, REPORT);
    await nextTick();
    manager.openIn(first, SHEET);
    await nextTick();
    expect(busy.isLoading(first)).toBe(true);

    // The one that is actually on screen says it is there.
    manager.itemIn(first).previewState.isReady = true;
    await nextTick();

    expect(busy.isLoading(first)).toBe(false);
  });

  /** Asked for what is already there: nothing was built, so nothing is waited for. */
  it('says nothing again for a document that tab already shows', async () => {
    const { first } = twoTabs();
    const manager = usePreviewManager();
    const busy = useTabLoadingStore();
    manager.register(reporting());

    manager.openIn(first, REPORT);
    await nextTick();
    manager.itemIn(first).previewState.isReady = true;
    await nextTick();

    manager.openIn(first, REPORT);
    await nextTick();

    expect(busy.isLoading(first)).toBe(false);
  });
});
