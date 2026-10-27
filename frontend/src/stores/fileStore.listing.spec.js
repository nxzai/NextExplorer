import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { reactive, ref } from 'vue';

/**
 * The order the folder is shown in, and the things the listing decides.
 *
 * Sorting is the part of this store everybody sees and nobody thinks about
 * until it is wrong: folders before files whatever the column, sizes that match
 * the sizes actually printed beside them, names that sort the way a person
 * reads them rather than the way ASCII does.
 *
 * Alongside it, the smaller decisions that were never covered: moving a
 * selection somewhere chosen from a menu without emptying the clipboard
 * somebody had filled, the warning before touching a document open in
 * OnlyOffice, and the gates on fetching a thumbnail nobody asked for.
 */

const browse = vi.fn();
const fetchThumbnailApi = vi.fn();
const copyItems = vi.fn();
const moveItems = vi.fn();
const addNotification = vi.fn();
const sizeFor = vi.fn(() => null);

vi.mock('@/api', () => ({
  browse: (...args) => browse(...args),
  browseShare: vi.fn(),
  normalizePath: (path = '') => String(path).replace(/^\/+|\/+$/g, ''),
  deleteItemsStream: vi.fn(),
  copyItems: (...args) => copyItems(...args),
  moveItems: (...args) => moveItems(...args),
  createFolder: vi.fn(),
  createFile: vi.fn(),
  createOfficeDocument: vi.fn(),
  renameItem: vi.fn(),
  fetchThumbnail: (...args) => fetchThumbnailApi(...args),
  extractZip: vi.fn(),
  compressToZip: vi.fn(),
  waitForOnlyOfficeActivityVersion: vi.fn(() => new Promise(() => {})),
}));

// Reactive, because the sorted list is a computed: a plain object would hand
// back the first order it worked out, whatever the settings said afterwards.
const settings = reactive({
  sortBy: { by: 'name', order: 'asc' },
  restoreFolderPreferences: vi.fn(),
});
const appSettings = { thumbnailsEnabledForSession: true };

vi.mock('@/stores/settings', () => ({ useSettingsStore: () => settings }));
vi.mock('@/stores/appSettings', () => ({ useAppSettings: () => appSettings }));
vi.mock('@/stores/favorites', () => ({ useFavoritesStore: () => ({ loadFavorites: vi.fn() }) }));
vi.mock('@/stores/volumeUsage', () => ({
  useVolumeUsageStore: () => ({ scheduleRefresh: vi.fn() }),
}));
vi.mock('@/stores/folderSize', () => ({
  useFolderSizeStore: () => ({ scheduleRefresh: vi.fn(), sizeFor: (...args) => sizeFor(...args) }),
}));
vi.mock('@/stores/features', () => ({
  useFeaturesStore: () => ({ onlyofficeEnabled: false, ensureLoaded: vi.fn(async () => {}) }),
}));
vi.mock('@/stores/operationTasks', () => ({
  useOperationTasksStore: () => ({
    startOperation: vi.fn(() => 'op-1'),
    updateOperation: vi.fn(),
    finishOperation: vi.fn(),
  }),
}));
vi.mock('@/stores/notifications', () => ({
  useNotificationsStore: () => ({ addNotification: (...args) => addNotification(...args) }),
}));
vi.mock('@/i18n', () => ({
  default: {
    global: {
      t: (key, params, plural) =>
        params && typeof params === 'object'
          ? `${key} ${JSON.stringify(params)}${plural === undefined ? '' : ` x${plural}`}`
          : key,
    },
  },
}));
vi.mock('@vueuse/core', () => ({ useStorage: (_key, initial) => ref(initial) }));

import { useFileStore } from './fileStore';

const file = (name, extra = {}) => ({ name, path: 'Docs', kind: 'txt', ...extra });
const dir = (name, extra = {}) => file(name, { kind: 'directory', ...extra });

const storeInDocs = async (listing = []) => {
  const store = useFileStore();
  browse.mockResolvedValue({ items: listing, path: 'Docs' });
  await store.fetchPathItems('Docs');
  return store;
};

const namesInOrder = (store) => store.getCurrentPathItems.map((item) => item.name);

beforeEach(() => {
  setActivePinia(createPinia());
  [browse, fetchThumbnailApi, copyItems, moveItems, addNotification, sizeFor].forEach((m) =>
    m.mockReset()
  );
  browse.mockResolvedValue({ items: [], path: '' });
  sizeFor.mockReturnValue(null);
  settings.sortBy = { by: 'name', order: 'asc' };
  settings.foldersFirst = true;
  appSettings.thumbnailsEnabledForSession = true;
});

/**
 * What the listing says the folder allows is copied field by field: a field the
 * server sends and this store does not copy is, for every screen, a field the
 * server never sent. That is how the Versions entry stayed on offer through a
 * share whose owner kept the history hidden.
 */
describe('what a listing says its files show', () => {
  const listed = async (access) => {
    const store = useFileStore();
    browse.mockResolvedValue({ items: [file('notes.md')], path: 'Docs', access });
    await store.fetchPathItems('Docs');
    return store.currentPathData;
  };

  it('keeps a history the server says is hidden, hidden', async () => {
    expect((await listed({ canRead: true, canSeeVersions: false })).canSeeVersions).toBe(false);
  });

  it('keeps one it says is shown', async () => {
    expect((await listed({ canRead: true, canSeeVersions: true })).canSeeVersions).toBe(true);
  });

  it('leaves the decision to the server when an older one says nothing', async () => {
    expect((await listed({ canRead: true })).canSeeVersions).toBe(true);
  });
});

describe('the order a folder is shown in', () => {
  it('puts folders before files, whatever is being sorted on', async () => {
    const store = await storeInDocs([file('a.txt'), dir('zzz'), file('b.txt'), dir('aaa')]);

    expect(namesInOrder(store)).toEqual(['aaa', 'zzz', 'a.txt', 'b.txt']);
  });

  it('keeps them there when the order is reversed', async () => {
    settings.sortBy = { by: 'name', order: 'desc' };
    const store = await storeInDocs([file('a.txt'), dir('zzz'), file('b.txt'), dir('aaa')]);

    expect(namesInOrder(store)).toEqual(['zzz', 'aaa', 'b.txt', 'a.txt']);
  });

  /**
   * The person's own choice, not the program's: some lists read better as one
   * ordering where a folder sits wherever its key puts it (#495).
   */
  it('mixes folders and files into one list when asked to', async () => {
    settings.foldersFirst = false;
    const store = await storeInDocs([file('a.txt'), dir('zzz'), file('b.txt'), dir('aaa')]);

    expect(namesInOrder(store)).toEqual(['a.txt', 'aaa', 'b.txt', 'zzz']);
  });

  it('mixes by the chosen key, not by the kind of entry', async () => {
    settings.foldersFirst = false;
    settings.sortBy = { by: 'size', order: 'desc' };
    const store = await storeInDocs([
      file('gros.txt', { size: 9000 }),
      dir('boite', { size: 500 }),
      file('petit.txt', { size: 10 }),
    ]);

    expect(namesInOrder(store)).toEqual(['gros.txt', 'boite', 'petit.txt']);
  });

  /**
   * Nobody reads a folder as "Banane, ananas, cerise". Compared as raw
   * characters every capital sorts before every lowercase letter, which puts a
   * name in a place its reader will not look for it.
   */
  it('sorts names the way they are read, not the way they are encoded', async () => {
    const store = await storeInDocs([file('cerise.txt'), file('Banane.txt'), file('ananas.txt')]);

    expect(namesInOrder(store)).toEqual(['ananas.txt', 'Banane.txt', 'cerise.txt']);
  });

  it('sorts files by size, largest first when asked that way', async () => {
    settings.sortBy = { by: 'size', order: 'desc' };
    const store = await storeInDocs([
      file('petit.txt', { size: 10 }),
      file('gros.txt', { size: 9000 }),
      file('moyen.txt', { size: 500 }),
    ]);

    expect(namesInOrder(store)).toEqual(['gros.txt', 'moyen.txt', 'petit.txt']);
  });

  /**
   * A directory's own `size` is the few bytes of its inode. Sorting on it would
   * rank every folder as empty while the column beside them prints the real
   * recursive size, from the folder-size index.
   */
  it('sorts folders by what their size column actually says', async () => {
    settings.sortBy = { by: 'size', order: 'desc' };
    sizeFor.mockImplementation((path) =>
      path === 'Docs/Photos' ? { sizeBytes: 9_000_000 } : { sizeBytes: 1000 }
    );
    const store = await storeInDocs([
      dir('Musique', { size: 4096 }),
      dir('Photos', { size: 4096 }),
    ]);

    expect(namesInOrder(store)).toEqual(['Photos', 'Musique']);
  });

  it('falls back to the folder"s own size where the index knows nothing', async () => {
    settings.sortBy = { by: 'size', order: 'desc' };
    sizeFor.mockReturnValue(null);
    const store = await storeInDocs([dir('a', { size: 10 }), dir('b', { size: 20 })]);

    expect(namesInOrder(store)).toEqual(['b', 'a']);
  });

  /**
   * A row whose size never arrived weighs nothing. Left as it is, it compares
   * false against every number in both directions, and a comparator that says
   * "a before b" and "b before a" of the same pair sorts the rest around it
   * into whatever order the sort happens to visit them in.
   */
  it('treats a missing size as nothing rather than as an error', async () => {
    const store = await storeInDocs([
      file('moyen.txt', { size: 5 }),
      file('inconnu.txt'),
      file('gros.txt', { size: 10 }),
    ]);

    settings.sortBy = { by: 'size', order: 'desc' };
    expect(namesInOrder(store)).toEqual(['gros.txt', 'moyen.txt', 'inconnu.txt']);

    settings.sortBy = { by: 'size', order: 'asc' };
    expect(namesInOrder(store)).toEqual(['inconnu.txt', 'moyen.txt', 'gros.txt']);
  });

  it('leaves two identical entries as they were', async () => {
    const store = await storeInDocs([file('a.txt', { size: 1 }), file('b.txt', { size: 1 })]);
    settings.sortBy = { by: 'size', order: 'asc' };

    expect(namesInOrder(store)).toEqual(['a.txt', 'b.txt']);
  });

  /** Sorting must not reorder the list the rest of the store works from. */
  it('does not rearrange the listing itself', async () => {
    settings.sortBy = { by: 'name', order: 'desc' };
    const store = await storeInDocs([file('a.txt'), file('b.txt')]);

    expect(namesInOrder(store)).toEqual(['b.txt', 'a.txt']);
    expect(store.currentPathItems.map((item) => item.name)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('the item the keyboard is acting on', () => {
  it('is the row it was set to', async () => {
    const store = await storeInDocs([file('a.txt'), file('b.txt')]);

    store.setKeyboardActionItem(file('b.txt'));

    expect(store.keyboardActionItem?.name).toBe('b.txt');
  });

  it('is nothing once it is cleared', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.setKeyboardActionItem(file('a.txt'));

    store.clearKeyboardActionItem();

    expect(store.keyboardActionItem).toBeNull();
  });

  /** A row that has gone is not a row anything should act on. */
  it('is nothing when the folder no longer holds it', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.setKeyboardActionItem(file('gone.txt'));

    expect(store.keyboardActionItem).toBeNull();
  });

  it('is nothing for something with no name', async () => {
    const store = await storeInDocs([file('a.txt')]);

    store.setKeyboardActionItem({ path: 'Docs' });

    expect(store.keyboardActionItem).toBeNull();
  });
});

describe('selection mode', () => {
  it('turns on, and off again', async () => {
    const store = await storeInDocs();

    store.toggleSelectionMode();
    expect(store.selectionMode).toBe(true);

    store.toggleSelectionMode();
    expect(store.selectionMode).toBe(false);
  });

  /** Leaving it with a selection nobody can see is how a stale delete happens. */
  it('forgets the selection when it is switched off', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.setSelectionMode(true);
    store.selectedItems = [file('a.txt')];

    store.setSelectionMode(false);

    expect(store.selectedItems).toEqual([]);
  });

  it('keeps it when the caller says to', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.setSelectionMode(true);
    store.selectedItems = [file('a.txt')];

    store.setSelectionMode(false, { clearOnDisable: false });

    expect(store.selectedItems).toHaveLength(1);
  });

  it('leaves the selection alone when it is switched on', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.selectedItems = [file('a.txt')];

    store.setSelectionMode(true);

    expect(store.selectedItems).toHaveLength(1);
  });
});

describe('what is selected', () => {
  it('says so, and says which rows', async () => {
    const store = await storeInDocs([file('a.txt'), file('b.txt')]);

    store.selectedItems = [file('a.txt')];

    expect(store.hasSelection).toBe(true);
    expect(store.selectedItemKeys.has('Docs::a.txt')).toBe(true);
    expect(store.selectedItemKeys.has('Docs::b.txt')).toBe(false);
  });

  it('says nothing is when nothing is', async () => {
    const store = await storeInDocs([file('a.txt')]);

    expect(store.hasSelection).toBe(false);
    expect(store.selectedItemKeys.size).toBe(0);
  });

  it('ignores a selected row with no name', async () => {
    const store = await storeInDocs([file('a.txt')]);

    store.selectedItems = [{ path: 'Docs' }];

    expect(store.selectedItemKeys.size).toBe(0);
  });

  it('knows whether anything is waiting to be pasted', async () => {
    const store = await storeInDocs([file('a.txt')]);
    expect(store.hasClipboardItems).toBe(false);

    store.selectedItems = [file('a.txt')];
    store.cut();

    expect(store.hasClipboardItems).toBe(true);
  });
});

describe('moving a selection to a folder chosen from a menu', () => {
  beforeEach(() => {
    moveItems.mockResolvedValue({});
    copyItems.mockResolvedValue({});
  });

  it('moves it there', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.selectedItems = [file('a.txt')];

    await store.transferSelectionTo('Archive');

    expect(moveItems).toHaveBeenCalled();
    expect(moveItems.mock.calls[0][1]).toBe('Archive');
  });

  it('copies it there when that is what was asked', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.selectedItems = [file('a.txt')];

    await store.transferSelectionTo('Archive', 'copy');

    expect(copyItems).toHaveBeenCalled();
    expect(moveItems).not.toHaveBeenCalled();
  });

  /**
   * The clipboard is the person's, not a mechanism to borrow. Picking a
   * destination from a menu must not quietly discard what they had cut.
   */
  it('gives back the clipboard it borrowed', async () => {
    const store = await storeInDocs([file('a.txt'), file('b.txt')]);
    store.selectedItems = [file('b.txt')];
    store.copy();
    store.selectedItems = [file('a.txt')];

    await store.transferSelectionTo('Archive');

    expect(store.copiedItems.map((item) => item.name)).toEqual(['b.txt']);
    expect(store.cutItems).toEqual([]);
  });

  it('gives it back even when the transfer failed', async () => {
    moveItems.mockRejectedValue(new Error('Destination is read-only'));
    const store = await storeInDocs([file('a.txt'), file('b.txt')]);
    store.selectedItems = [file('b.txt')];
    store.copy();
    store.selectedItems = [file('a.txt')];

    await store.transferSelectionTo('Archive').catch(() => {});

    expect(store.copiedItems.map((item) => item.name)).toEqual(['b.txt']);
  });

  it('does nothing without a selection', async () => {
    const store = await storeInDocs([file('a.txt')]);

    await store.transferSelectionTo('Archive');

    expect(moveItems).not.toHaveBeenCalled();
  });

  it('does nothing without a destination', async () => {
    const store = await storeInDocs([file('a.txt')]);
    store.selectedItems = [file('a.txt')];

    await store.transferSelectionTo('');

    expect(moveItems).not.toHaveBeenCalled();
  });
});

describe('warning about a document somebody is editing', () => {
  const open = (name) => file(name, { onlyofficeActivity: { active: true } });

  it('says which one, and what is about to happen to it', async () => {
    const store = await storeInDocs();

    const warned = store.warnAboutOnlyOfficeActivity([open('rapport.docx')], 'Delete');

    expect(warned).toBe(true);
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', body: expect.stringContaining('rapport.docx') })
    );
  });

  it('names the first two and counts the rest', async () => {
    const store = await storeInDocs();

    store.warnAboutOnlyOfficeActivity(['a.docx', 'b.docx', 'c.docx', 'd.docx'].map(open), 'Move');

    const { body } = addNotification.mock.calls[0][0];
    expect(body).toContain('a.docx, b.docx');
    expect(body).not.toContain('c.docx');
    expect(body).toMatch(/andOthers.*count.*2/);
  });

  it('says nothing about documents nobody has open', async () => {
    const store = await storeInDocs();

    const warned = store.warnAboutOnlyOfficeActivity([file('a.txt')], 'Delete');

    expect(warned).toBe(false);
    expect(addNotification).not.toHaveBeenCalled();
  });

  it('says nothing about nothing', async () => {
    const store = await storeInDocs();

    expect(store.warnAboutOnlyOfficeActivity(null, 'Delete')).toBe(false);
  });
});

describe('fetching a thumbnail nobody asked for', () => {
  it('asks for one, in the background', async () => {
    fetchThumbnailApi.mockResolvedValue({ thumbnail: 'data:image/webp;base64,AAA' });
    const store = await storeInDocs([file('photo.jpg', { supportsThumbnail: true })]);

    const accepted = await store.prefetchItemThumbnail(
      file('photo.jpg', { supportsThumbnail: true })
    );

    expect(accepted).toBe(true);
    expect(fetchThumbnailApi).toHaveBeenCalledWith(
      'Docs/photo.jpg',
      expect.objectContaining({ background: true })
    );
  });

  it('puts what came back on the row it belongs to', async () => {
    fetchThumbnailApi.mockResolvedValue({ thumbnail: 'data:image/webp;base64,AAA' });
    const store = await storeInDocs([file('photo.jpg', { supportsThumbnail: true })]);

    await store.prefetchItemThumbnail(file('photo.jpg', { supportsThumbnail: true }));

    expect(store.currentPathItems[0].thumbnail).toBe('data:image/webp;base64,AAA');
  });

  /** Queued counts: the server took the work, so the row is done being asked for. */
  it('counts a queued one as done', async () => {
    fetchThumbnailApi.mockResolvedValue({ queued: true });
    const store = await storeInDocs([file('photo.jpg', { supportsThumbnail: true })]);

    expect(await store.prefetchItemThumbnail(file('photo.jpg', { supportsThumbnail: true }))).toBe(
      true
    );
  });

  it('counts a refusal as not done, so it can be tried again', async () => {
    fetchThumbnailApi.mockResolvedValue({});
    const store = await storeInDocs([file('photo.jpg', { supportsThumbnail: true })]);

    expect(await store.prefetchItemThumbnail(file('photo.jpg', { supportsThumbnail: true }))).toBe(
      false
    );
  });

  it('says nothing when the request fails', async () => {
    fetchThumbnailApi.mockRejectedValue(new Error('offline'));
    const store = await storeInDocs([file('photo.jpg', { supportsThumbnail: true })]);

    expect(await store.prefetchItemThumbnail(file('photo.jpg', { supportsThumbnail: true }))).toBe(
      false
    );
  });

  it.each([
    ['a folder', dir('Photos', { supportsThumbnail: true })],
    ['a file that cannot have one', file('notes.txt')],
    ['nothing at all', null],
  ])('asks for nothing for %s', async (_what, item) => {
    const store = await storeInDocs([file('a.txt')]);

    expect(await store.prefetchItemThumbnail(item)).toBe(false);
    expect(fetchThumbnailApi).not.toHaveBeenCalled();
  });

  /** Somebody who switched thumbnails off did not switch off only the visible ones. */
  it('asks for nothing where thumbnails are switched off for the session', async () => {
    appSettings.thumbnailsEnabledForSession = false;
    const store = await storeInDocs([file('photo.jpg', { supportsThumbnail: true })]);

    expect(await store.prefetchItemThumbnail(file('photo.jpg', { supportsThumbnail: true }))).toBe(
      false
    );
    expect(fetchThumbnailApi).not.toHaveBeenCalled();
  });
});
