import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

const browse = vi.fn();
const browseShare = vi.fn();
const waitForOnlyOfficeActivityVersion = vi.fn(() => new Promise(() => {}));
let onlyofficeEnabled = false;

vi.mock('@/api', () => ({
  browse: (...args) => browse(...args),
  browseShare: (...args) => browseShare(...args),
  normalizePath: (path = '') => String(path).replace(/^\/+|\/+$/g, ''),
  copyItems: vi.fn(),
  moveItems: vi.fn(),
  deleteItems: vi.fn(),
  createFolder: vi.fn(),
  renameItem: vi.fn(),
  saveFileContent: vi.fn(),
  fetchThumbnail: vi.fn(),
  extractZip: vi.fn(),
  compressToZip: vi.fn(),
  waitForOnlyOfficeActivityVersion: (...args) => waitForOnlyOfficeActivityVersion(...args),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    sortBy: { by: 'name', order: 'asc' },
    restoreFolderPreferences: vi.fn(),
  }),
}));

vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({ thumbnailsEnabledForSession: false }),
}));

vi.mock('@/stores/favorites', () => ({
  useFavoritesStore: () => ({ loadFavorites: vi.fn() }),
}));

// Read through a getter: the store is created inside each test, after this
// factory has run.
vi.mock('@/stores/features', () => ({
  useFeaturesStore: () => ({
    get onlyofficeEnabled() {
      return onlyofficeEnabled;
    },
    ensureLoaded: async () => {},
  }),
}));

vi.mock('@vueuse/core', () => ({
  useStorage: (_key, initialValue) => ref(initialValue),
}));

import { useFileStore } from './fileStore';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('fileStore folder navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    browse.mockReset();
    browseShare.mockReset();
    waitForOnlyOfficeActivityVersion.mockClear();
    onlyofficeEnabled = false;
  });

  it('keeps the newest listing when a previous folder response arrives late', async () => {
    const first = deferred();
    browse
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({
        path: 'Volume/Child',
        items: [{ name: 'inside.txt', path: 'Volume/Child', kind: 'file' }],
      });

    const store = useFileStore();
    const rootRequest = store.fetchPathItems('Volume');
    const childRequest = store.fetchPathItems('Volume/Child');

    await childRequest;
    first.resolve({
      path: 'Volume',
      items: [{ name: 'Child', path: 'Volume', kind: 'directory' }],
    });
    await rootRequest;

    expect(browse.mock.calls[0][1].signal.aborted).toBe(true);
    expect(store.currentPath).toBe('Volume/Child');
    expect(store.currentPathItems).toEqual([
      { name: 'inside.txt', path: 'Volume/Child', kind: 'file' },
    ]);
  });

  /**
   * Going somewhere and being somewhere while it changes are two different
   * things, and the store has a word for each.
   *
   * Every caller that got this wrong got it wrong the same way — by reaching for
   * the one function there was — and what it cost was the reader's selection: an
   * upload landing a second after they chose a file took the choice away with it,
   * and the share button went grey under their hand.
   */
  it('reads the same folder again without taking away what is selected', async () => {
    browse.mockResolvedValue({
      path: 'Volume',
      items: [{ name: 'notes.txt', path: 'Volume', kind: 'txt' }],
    });

    const store = useFileStore();
    await store.fetchPathItems('Volume');
    store.selectedItems = [store.currentPathItems[0]];

    await store.refresh();

    expect(store.getCurrentPath).toBe('Volume');
    expect(store.selectedItems).toHaveLength(1);
  });

  it('clears it when the reader goes somewhere, which is the other word', async () => {
    browse.mockResolvedValue({
      path: 'Volume',
      items: [{ name: 'notes.txt', path: 'Volume', kind: 'txt' }],
    });

    const store = useFileStore();
    await store.fetchPathItems('Volume');
    store.selectedItems = [store.currentPathItems[0]];

    await store.fetchPathItems('Volume');

    expect(store.selectedItems).toHaveLength(0);
  });

  /**
   * A listing read into a tab the reader is not looking at.
   *
   * Every folder already has its own listing and its own selection — that is what
   * makes a tab keep what it was holding. What was missing was a way to fill one
   * in advance, which is what preparing a tab opened in the background means: by
   * the time the reader arrives, the folder is there instead of a spinner.
   */
  it('reads a folder into a named tab without moving the one in front', async () => {
    browse
      .mockResolvedValueOnce({ path: 'Volume', items: [{ name: 'a.txt', path: 'Volume' }] })
      .mockResolvedValueOnce({
        path: 'Other',
        items: [
          { name: 'b.txt', path: 'Other' },
          { name: 'c.txt', path: 'Other' },
        ],
      });

    const store = useFileStore();
    await store.fetchPathItems('Volume');

    await store.fetchIn('tab-behind', 'Other');

    // The tab in front is where it was, holding what it held.
    expect(store.getCurrentPath).toBe('Volume');
    expect(store.currentPathItems.map((item) => item.name)).toEqual(['a.txt']);
    // And the folder was really read: the second call went to the server.
    expect(browse).toHaveBeenCalledWith('Other', expect.anything());
  });

  it('clears an OnlyOffice activity badge when a refresh reports the document closed', async () => {
    browse
      .mockResolvedValueOnce({
        path: 'Volume',
        items: [
          {
            name: 'report.docx',
            path: 'Volume',
            kind: 'docx',
            onlyofficeActivity: { active: true, users: ['Admin'], count: 1 },
          },
        ],
      })
      .mockResolvedValueOnce({
        path: 'Volume',
        items: [{ name: 'report.docx', path: 'Volume', kind: 'docx' }],
      });

    const store = useFileStore();
    await store.fetchPathItems('Volume');
    expect(store.currentPathItems[0].onlyofficeActivity?.active).toBe(true);

    await store.fetchPathItems('Volume', { preserveInteraction: true });
    expect(store.currentPathItems[0].onlyofficeActivity).toBeUndefined();
  });

  it('clears the versions mark when a refresh reports the last version deleted', async () => {
    // The same shape of bug as the badge above: rows keep their identity
    // across a refresh, so a key the server stops sending has to be taken off
    // rather than left at its old value. Here that value is a count, and a
    // stale one is a mark pointing at a history that no longer exists.
    browse
      .mockResolvedValueOnce({
        path: 'Volume',
        items: [{ name: 'report.docx', path: 'Volume', kind: 'docx', versions: { count: 2 } }],
      })
      .mockResolvedValueOnce({
        path: 'Volume',
        items: [{ name: 'report.docx', path: 'Volume', kind: 'docx' }],
      });

    const store = useFileStore();
    await store.fetchPathItems('Volume');
    expect(store.currentPathItems[0].versions).toEqual({ count: 2 });

    await store.fetchPathItems('Volume', { preserveInteraction: true });
    expect(store.currentPathItems[0].versions).toBeUndefined();
  });

  // The endpoint is not mounted unless a document server is configured, so a
  // poll on an instance without one is a 404 answered straight away and retried
  // a second later, for as long as the tab is open.
  it('does not poll for editing activity when ONLYOFFICE is not configured', async () => {
    onlyofficeEnabled = false;
    browse.mockResolvedValue({ path: 'Volume', items: [] });

    const store = useFileStore();
    await store.fetchPathItems('Volume');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(waitForOnlyOfficeActivityVersion).not.toHaveBeenCalled();
  });

  it('polls for editing activity when ONLYOFFICE is configured', async () => {
    onlyofficeEnabled = true;
    browse.mockResolvedValue({ path: 'Volume', items: [] });

    const store = useFileStore();
    await store.fetchPathItems('Volume');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(waitForOnlyOfficeActivityVersion).toHaveBeenCalled();
  });
});
