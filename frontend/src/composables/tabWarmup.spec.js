import { beforeEach, describe, expect, it, vi } from 'vitest';

import { warmInBackground, warmTab, warmTabs, WARM_TAB_LIMIT } from './tabWarmup';

/**
 * Getting a tab ready before the reader arrives at it.
 *
 * A tab opened behind is an address and nothing else, because the router draws one
 * page — so everything that tab needs happened at the moment it was brought
 * forward. For a folder that is a listing; for a document in ONLYOFFICE it is an
 * iframe, a document server to reach and an editing session to open, which is
 * seconds of blank panel after deliberately opening the tab in advance so as not
 * to wait.
 *
 * Each kind fills the place that already outlives a page — the preview manager's
 * session, the tab's own folder, the terminal's session — which is what makes any
 * of this possible without drawing a second page.
 */

const ended = [];
const tools = () => ({
  fileStore: { fetchIn: vi.fn(() => Promise.resolve()), holdsFolder: vi.fn(() => false) },
  previewManager: { openIn: vi.fn(() => true) },
  terminalStore: { openIn: vi.fn(() => ({ open: true })) },
  readFile: vi.fn(() => Promise.resolve({ content: 'a line, and another' })),
  // Says the tab is busy, and answers with the way to say it is not.
  beginLoading: vi.fn((id) => () => ended.push(id)),
  // Where a warmed file is kept, which is where the editor page reads it on the way
  // in — warming the network alone left the first arrival showing a spinner.
  keepSource: vi.fn(),
  alreadyKept: vi.fn(() => false),
});

const tab = (kind, path, id = `tab-${kind}`) => ({ id, kind, path });

let kit;

beforeEach(() => {
  ended.length = 0;
  kit = tools();
});

describe('a folder got ready', () => {
  it('has its listing read into its own tab', () => {
    expect(warmTab(tab('folder', '/browse/Docs/2026'), kit)).toBe(true);

    expect(kit.fileStore.fetchIn).toHaveBeenCalledWith('tab-folder', 'Docs/2026');
  });

  it('is the volumes when the address names no folder', () => {
    warmTab(tab('folder', '/browse/'), kit);

    expect(kit.fileStore.fetchIn).toHaveBeenCalledWith('tab-folder', '');
  });

  /** A folder that cannot be listed costs the head start, not the tab. */
  it('says nothing when the listing cannot be read', () => {
    kit.fileStore.fetchIn = vi.fn(() => Promise.reject(new Error('offline')));

    expect(() => warmTab(tab('folder', '/browse/Docs'), kit)).not.toThrow();
  });
});

describe('a document got ready', () => {
  /**
   * The session, in the manager, for that tab — which is what the host draws
   * hidden and what the page's own first question ("is this already here?")
   * answers yes to.
   */
  it('is opened in the preview manager, for its own tab', () => {
    expect(warmTab(tab('document', '/open/Docs/2026/report.docx'), kit)).toBe(true);

    expect(kit.previewManager.openIn).toHaveBeenCalledWith('tab-document', {
      name: 'report.docx',
      path: 'Docs/2026',
    });
  });

  it('is named as it is written, not as the address encodes it', () => {
    warmTab(tab('document', '/open/Docs/data%20set/a%20report.docx'), kit);

    expect(kit.previewManager.openIn).toHaveBeenCalledWith('tab-document', {
      name: 'a report.docx',
      path: 'Docs/data set',
    });
  });

  /** Nothing opens it: there was nothing to get ready. */
  it('says so when no plugin claims it', () => {
    kit.previewManager.openIn = vi.fn(() => false);

    expect(warmTab(tab('document', '/open/Docs/thing.bin'), kit)).toBe(false);
  });

  it('says so for an address with no document in it', () => {
    expect(warmTab(tab('document', '/open/'), kit)).toBe(false);
    expect(kit.previewManager.openIn).not.toHaveBeenCalled();
  });
});

describe('a terminal got ready', () => {
  it('has its session claimed, in the folder its address names', () => {
    expect(warmTab(tab('terminal', '/terminal/Docs/data%20set'), kit)).toBe(true);

    expect(kit.terminalStore.openIn).toHaveBeenCalledWith('tab-terminal', 'Docs/data set', {
      mode: 'page',
    });
  });
});

describe('an editor got ready', () => {
  /**
   * The file read once, so the page's own read is a revalidation of something the
   * browser already holds rather than a transfer.
   */
  it('has its file read', () => {
    expect(warmTab(tab('editor', '/editor/Docs/notes%20de%20suivi.md'), kit)).toBe(true);

    expect(kit.readFile).toHaveBeenCalledWith('Docs/notes de suivi.md');
  });

  it('says nothing when the file cannot be read', () => {
    kit.readFile = vi.fn(() => Promise.reject(new Error('gone')));

    expect(() => warmTab(tab('editor', '/editor/Docs/notes.md'), kit)).not.toThrow();
  });

  /**
   * And the file is kept for the tab, which is what makes it *ready* rather than
   * merely quicker. Warming the browser's cache left the page still having to mount
   * and ask, so the first arrival showed a spinner and then the text — which is not
   * what a document in ONLYOFFICE does, and was the difference that was reported.
   */
  it('keeps the file for the tab, where the page reads it on the way in', async () => {
    warmTab(tab('editor', '/editor/Docs/notes%20de%20suivi.md'), kit);
    await Promise.resolve();
    await Promise.resolve();

    expect(kit.keepSource).toHaveBeenCalledWith(
      'tab-editor',
      '/editor/Docs/notes%20de%20suivi.md',
      'a line, and another'
    );
  });

  it('keeps nothing when the file cannot be read', async () => {
    kit.readFile = vi.fn(() => Promise.reject(new Error('gone')));

    warmTab(tab('editor', '/editor/Docs/notes.md'), kit);
    await Promise.resolve();
    await Promise.resolve();

    expect(kit.keepSource).not.toHaveBeenCalled();
  });

  /** Unsaved work outranks a head start: a tab already holding something is left. */
  it('reads nothing over a tab that is already holding something', () => {
    kit.alreadyKept = vi.fn(() => true);

    expect(warmTab(tab('editor', '/editor/Docs/notes.md'), kit)).toBe(false);
    expect(kit.readFile).not.toHaveBeenCalled();
    expect(ended).toEqual(['tab-editor']);
  });
});

describe('what is left alone', () => {
  /** Cheap screens, and there is only ever one of each: nothing to prepare. */
  it.each(['trash', 'settings', 'search', 'shares', 'versions'])('is the %s', (kind) => {
    expect(warmTab(tab(kind, `/${kind}`), kit)).toBe(false);
    expect(kit.fileStore.fetchIn).not.toHaveBeenCalled();
    expect(kit.previewManager.openIn).not.toHaveBeenCalled();
  });

  it('is a tab of a kind that no longer exists', () => {
    expect(warmTab({ id: 'tab-1', kind: 'something-else', path: '/x' }, kit)).toBe(false);
  });

  it('is a tab with no id, which nothing could be kept for', () => {
    expect(warmTab({ id: '', kind: 'folder', path: '/browse/Docs' }, kit)).toBe(false);
  });
});

describe('several at once', () => {
  /**
   * Newest first, because the tab somebody has just opened is the one they are
   * about to look at.
   */
  it('takes the newest first', () => {
    const list = [tab('folder', '/browse/A', 'a'), tab('folder', '/browse/B', 'b')];

    expect(warmTabs(list, kit)).toEqual(['b', 'a']);
  });

  /**
   * What a warm document tab holds is not a cache: it is an iframe, a connection
   * to the document server and an editing session on it. Ten of those opened by
   * one gesture would be ten editors nobody asked to open.
   */
  it('stops at the limit for the ones that hold a session on a server', () => {
    const many = Array.from({ length: WARM_TAB_LIMIT + 3 }, (_, index) =>
      tab('document', `/open/Docs/file-${index}.docx`, `doc-${index}`)
    );

    expect(warmTabs(many, kit)).toHaveLength(WARM_TAB_LIMIT);
    expect(kit.previewManager.openIn).toHaveBeenCalledTimes(WARM_TAB_LIMIT);
  });

  /** A listing is a listing: it costs a request and holds nothing open. */
  it('does not count folders against that limit', () => {
    const many = Array.from({ length: WARM_TAB_LIMIT + 4 }, (_, index) =>
      tab('folder', `/browse/F${index}`, `f-${index}`)
    );

    expect(warmTabs(many, kit)).toHaveLength(WARM_TAB_LIMIT + 4);
  });

  it('warms the documents it has room for and the folders beside them', () => {
    const list = [
      tab('folder', '/browse/A', 'a'),
      ...Array.from({ length: WARM_TAB_LIMIT + 1 }, (_, index) =>
        tab('document', `/open/D${index}.docx`, `d-${index}`)
      ),
    ];

    const warmed = warmTabs(list, kit);

    expect(warmed).toContain('a');
    expect(kit.previewManager.openIn).toHaveBeenCalledTimes(WARM_TAB_LIMIT);
  });
});

/**
 * The one door every gesture goes through.
 *
 * Three of them open a tab behind — the middle button on a row, the modifier on a
 * favourite, the entry in the menu — and they do not share a road: two go straight
 * to the tabs store. The first version of the warming was wired into the one that
 * happened to pass through `tabNavigation`, so nothing was ever prepared for the
 * two people actually use. The account's answer lives here for the same reason:
 * one answer, asked once, wherever the gesture came from.
 */
describe('asking for a tab to be got ready', () => {
  const stores = {
    appSettings: { loaded: true, userSettings: {} },
    fileStore: { fetchIn: vi.fn(), holdsFolder: vi.fn(() => false) },
    previewManager: { openIn: vi.fn(() => true) },
    terminalStore: { openIn: vi.fn(() => ({})) },
  };

  beforeEach(() => {
    stores.appSettings.loaded = true;
    stores.appSettings.userSettings = {};
    stores.fileStore.fetchIn = vi.fn();
    stores.fileStore.holdsFolder = vi.fn(() => false);
    stores.previewManager.openIn = vi.fn(() => true);
    vi.doMock('@/stores/appSettings', () => ({ useAppSettings: () => stores.appSettings }));
    vi.doMock('@/stores/fileStore', () => ({ useFileStore: () => stores.fileStore }));
    vi.doMock('@/plugins/preview/manager', () => ({
      usePreviewManager: () => stores.previewManager,
    }));
    vi.doMock('@/stores/terminal', () => ({ useTerminalStore: () => stores.terminalStore }));
    vi.doMock('@/api', () => ({ fetchFileContent: vi.fn(() => Promise.resolve({})) }));
    vi.doMock('@/stores/tabLoading', () => ({
      useTabLoadingStore: () => ({ begin: () => () => {} }),
    }));
    // Where a warmed file is kept, which is where the editor page reads it on the
    // way in: warming the network alone left the first arrival showing a spinner.
    vi.doMock('@/stores/editorDrafts', () => ({
      useEditorDraftsStore: () => ({ keep: vi.fn(), placeFor: () => null }),
    }));
  });

  it('gets it ready', async () => {
    expect(await warmInBackground([tab('document', '/open/Docs/report.docx')])).toEqual([
      'tab-document',
    ]);
    expect(stores.previewManager.openIn).toHaveBeenCalled();
  });

  it('takes one on its own, not only a list', async () => {
    expect(await warmInBackground(tab('document', '/open/Docs/report.docx'))).toEqual([
      'tab-document',
    ]);
  });

  it('does nothing when this account has said not to', async () => {
    stores.appSettings.userSettings = { preloadBackgroundTabs: false };

    expect(await warmInBackground([tab('document', '/open/Docs/report.docx')])).toEqual([]);
    expect(stores.previewManager.openIn).not.toHaveBeenCalled();
  });

  /**
   * Before the settings arrive the answer is not "no", it is *unknown* — and acting
   * on the wrong one would open editing sessions nobody asked for.
   */
  it('does nothing before the account has answered', async () => {
    stores.appSettings.loaded = false;

    expect(await warmInBackground([tab('document', '/open/Docs/report.docx')])).toEqual([]);
    expect(stores.previewManager.openIn).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing to get ready', async () => {
    expect(await warmInBackground([])).toEqual([]);
    expect(await warmInBackground(null)).toEqual([]);
  });
});

/**
 * A tab prepared in the background says it is working.
 *
 * Without a word from it there is nothing to tell "not there yet" from "there, and
 * empty" — which is the whole point of the spinner the strip draws in place of the
 * icon. Who ends it is the question worth holding: whoever finishes the work, and
 * for a document that is the viewer, once it has really loaded.
 */
describe('saying that a tab is working', () => {
  it('is said for a folder, and unsaid once the listing is in', async () => {
    warmTab(tab('folder', '/browse/Docs'), kit);

    expect(kit.beginLoading).toHaveBeenCalledWith('tab-folder');
    expect(ended).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(ended).toEqual(['tab-folder']);
  });

  it('is unsaid when the listing cannot be read', async () => {
    kit.fileStore.fetchIn = vi.fn(() => Promise.reject(new Error('offline')));

    warmTab(tab('folder', '/browse/Docs'), kit);
    await Promise.resolve();
    await Promise.resolve();

    expect(ended).toEqual(['tab-folder']);
  });

  it('is said for an editor, and unsaid once the file is read', async () => {
    warmTab(tab('editor', '/editor/Docs/notes.md'), kit);

    expect(ended).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(ended).toEqual(['tab-editor']);
  });

  /**
   * Said by the manager rather than here, and unsaid by it when the viewer is
   * really there: building the viewer — reaching a document server, loading a
   * document into it — is the part worth waiting for, and only the viewer knows
   * when it is over. Opening a document normally goes the same way, so the tab
   * says the same thing either way; see `plugins/preview/manager.js`.
   */
  it('is left to the manager for a document', () => {
    warmTab(tab('document', '/open/Docs/report.docx'), kit);

    expect(kit.previewManager.openIn).toHaveBeenCalled();
    expect(ended).toEqual(['tab-document']);
  });

  /** Nothing to wait for: the shell starts as soon as its session exists. */
  it('is unsaid at once for a terminal', () => {
    warmTab(tab('terminal', '/terminal/Docs'), kit);

    expect(ended).toEqual(['tab-terminal']);
  });

  it('is unsaid for a tab there was nothing to do for', () => {
    warmTab(tab('trash', '/trash'), kit);

    expect(ended).toEqual(['tab-trash']);
  });

  /** A tab that already holds its folder was never made to wait for anything. */
  it('is unsaid for a folder the tab already holds', () => {
    kit.fileStore.holdsFolder = vi.fn(() => true);

    warmTab(tab('folder', '/browse/Docs'), kit);

    expect(ended).toEqual(['tab-folder']);
  });
});
