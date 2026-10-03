import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAddress } from '@/utils/testing/routerAddress';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, inject, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

/**
 * The right-click menu.
 *
 * 409 statements at 0.7%, and it is where a permission becomes a thing somebody
 * can click. Everything the explorer refuses is refused twice — once by the
 * guard that runs the action, once by this menu deciding whether to offer it —
 * and the second one is what people actually see. An entry that stays live on a
 * read-only share is not a cosmetic problem: it is a person told they may do
 * something, finding out afterwards that they may not.
 *
 * The menu is three different menus depending on what was clicked — the
 * background, a file, a folder — and the differences are the interesting part.
 * Paste belongs to a folder and the background but not to a file. Rename needs
 * a target. Open-in-terminal is for a file only, and only where the terminal is
 * switched on at all.
 */

let actions;
let fileStore;
let features;
let favorites;

const infoOpen = vi.fn();
const infoClose = vi.fn();
const versionsOpen = vi.fn();
const openEditorForFavorite = vi.fn();
const getDeleteImpact = vi.fn(async () => ({ shareCount: 0, shares: [] }));
const terminalOpen = vi.fn();
const routerPush = vi.fn();

vi.mock('@floating-ui/vue', () => ({
  useFloating: () => ({ x: ref(0), y: ref(0), strategy: ref('fixed'), update: vi.fn() }),
  offset: vi.fn(),
  flip: vi.fn(),
  shift: vi.fn(),
  autoUpdate: vi.fn(),
  size: vi.fn(),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, resolve: resolveAddress }),
}));
/**
 * `t` gives back the key, and the values interpolated into it when there are
 * any — so a message naming a file, or counting several, can be told apart from
 * the same message about something else.
 */
const translate = (key, params) =>
  params && typeof params === 'object' ? `${key} ${JSON.stringify(params)}` : key;
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: translate }) }));
/**
 * A stable object that always reads the current test's actions.
 *
 * `useDeleteConfirm` is a module-level singleton: it calls `useFileActions()`
 * once, on the first mount, and keeps whatever it got for the rest of the file.
 * Handing it the live object directly would freeze every later test's selection
 * to the first one's.
 */
const actionsProxy = new Proxy(
  {},
  {
    get: (_target, property) => actions[property],
    has: (_target, property) => property in actions,
    ownKeys: () => Reflect.ownKeys(actions),
    getOwnPropertyDescriptor: (_target, property) =>
      Object.getOwnPropertyDescriptor(actions, property),
  }
);
vi.mock('@/composables/fileActions', () => ({ useFileActions: () => actionsProxy }));
// Where an entry opens is the preview plugins' business; mocked here so a spec
// about the menu does not build the plugin registry, and so the one thing the menu
// decides — whether to offer the entry at all — can be moved.
const address = vi.hoisted(() => ({
  addressFor: vi.fn(() => ({ path: '/open/Docs/report.docx' })),
  enabled: true,
  // Answering with a tab is how the store says there was room for it; null is
  // how it says the row is full, and the menu has to read the difference.
  open: vi.fn(() => ({ id: 'opened' })),
  limit: 10,
}));
vi.mock('@/composables/itemAddress', () => ({
  useItemAddress: () => ({ addressFor: address.addressFor }),
}));
vi.mock('@/composables/tabNavigation', () => ({
  useTabNavigation: () => ({
    get tabs() {
      return { enabled: address.enabled, limit: address.limit };
    },
    open: address.open,
  }),
}));
vi.mock('@/stores/fileStore', () => ({ useFileStore: () => fileStore }));
vi.mock('@/stores/infoPanel', () => ({
  useInfoPanelStore: () => ({ open: infoOpen, close: infoClose }),
}));
vi.mock('@/stores/versionsPanel', () => ({
  useVersionsPanelStore: () => ({ open: versionsOpen }),
}));
vi.mock('@/stores/favorites', () => ({ useFavoritesStore: () => favorites }));
vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));
vi.mock('@/stores/terminal', () => ({ useTerminalStore: () => ({ openIn: terminalOpen }) }));
// A terminal belongs to the tab it was opened from, so the menu has to say which.
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => ({ activeId: 'tab-1' }) }));
vi.mock('@/stores/notifications', () => ({
  useNotificationsStore: () => ({ addNotification: vi.fn() }),
}));
vi.mock('@/composables/itemSelection', () => ({
  useSelection: () => ({ clearSelection: vi.fn() }),
}));
vi.mock('@/composables/useFavoriteEditor', () => ({
  useFavoriteEditor: () => ({ openEditorForFavorite: openEditorForFavorite }),
}));
vi.mock('@/api', () => ({
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
  getDeleteImpact: (...args) => getDeleteImpact(...args),
}));
// The menu pulls in the share dialog, which is a screen of its own with a date
// picker in it. Stubbed: nothing here is about creating a share.
vi.mock('@/components/ShareDialog.vue', () => ({
  default: defineComponent({ name: 'ShareDialogStub', render: () => null }),
}));

import ExplorerContextMenu from './ExplorerContextMenu.vue';
import { explorerContextMenuSymbol as realSymbol } from '@/composables/contextMenu';

const FILE = { name: 'report.docx', path: 'Docs', kind: 'docx' };
const FOLDER = { name: '2026', path: 'Docs', kind: 'directory' };

const makeActions = (overrides = {}) => ({
  selectedItems: ref([FILE]),
  primaryItem: ref(FILE),
  isSingleItemSelected: ref(true),
  hasSelection: ref(true),
  canRename: ref(true),
  canCut: ref(true),
  canCopy: ref(true),
  canPaste: ref(true),
  canDelete: ref(true),
  canDownloadSeparately: ref(false),
  downloadMode: ref('zip'),
  canExtractArchive: ref(false),
  canCompressToZip: ref(true),
  canDownloadCurrentFolder: ref(false),
  isArchiveSelected: ref(false),
  isCutActive: ref(false),
  isCopyActive: ref(false),
  locationCanWrite: ref(true),
  locationCanCreateFolder: ref(true),
  locationCanCreateFile: ref(true),
  locationCanDelete: ref(true),
  locationCanUpload: ref(true),
  locationCanDownload: ref(true),
  resolveItemPath: (item) => (item?.path ? `${item.path}/${item.name}` : item?.name || ''),
  isEditableElement: () => false,
  runCut: vi.fn(),
  runCopy: vi.fn(),
  runRename: vi.fn(),
  runMoveTo: vi.fn(),
  runCopyTo: vi.fn(),
  runPasteToDestination: vi.fn(),
  runPasteIntoCurrent: vi.fn(),
  runExtractArchive: vi.fn(),
  runExtractArchiveIntoCurrentFolder: vi.fn(),
  runCompressToZip: vi.fn(),
  runDownload: vi.fn(),
  runDownloadAsZip: vi.fn(),
  runDownloadSeparately: vi.fn(),
  runDownloadCurrentFolder: vi.fn(),
  deleteNow: vi.fn(),
  ...overrides,
});

let mounted = null;

/** Mounts the menu with a child that captures the API it provides. */
const mountMenu = async () => {
  let api = null;
  const Child = defineComponent({
    setup() {
      api = inject(realSymbol);
      return () => h('div', 'child');
    },
  });
  const wrapper = mount(ExplorerContextMenu, {
    slots: { default: () => h(Child) },
    attachTo: document.body,
    // The template uses the global `$t` as well as the `t` from useI18n, and a
    // missing one throws during render rather than showing an untranslated
    // string — which looks exactly like the menu refusing to open.
    global: { mocks: { $t: translate } },
  });
  mounted = wrapper;
  await flushPromises();
  return { wrapper, api };
};

const rightClick = () => ({
  clientX: 100,
  clientY: 100,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

/**
 * The menu is teleported to the body, so it is read from the document rather
 * than from the wrapper. `t` is mocked to return the key it was given, so each
 * entry is identified by its translation key — stable, and it does not require
 * adding attributes to the component just to be testable.
 */
const menuPanel = () =>
  [...document.body.querySelectorAll('div')].find((el) => el.className.includes('min-w-[220px]'));

const isOpen = () => Boolean(menuPanel());

const entries = () =>
  [...(menuPanel()?.querySelectorAll('button') ?? [])].map((button) => ({
    label: button.querySelector('p')?.textContent?.trim() ?? '',
    disabled: button.disabled,
  }));

const labels = () => entries().map((entry) => entry.label);

const isDisabled = (label) => entries().find((entry) => entry.label === label)?.disabled;

/**
 * Unmounted between tests, not just cleared: the menu registers keydown and
 * pointerdown listeners on `window`, and a component left mounted keeps
 * answering them. That is how an Escape test that passes alone fails in a run.
 */
afterEach(() => {
  // The delete confirmation is a singleton too, so a pending deletion outlives
  // the component that asked for it.
  mounted?.vm?.closeDeleteConfirm?.();
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

beforeEach(() => {
  document.body.innerHTML = '';
  setActivePinia(createPinia());
  [infoOpen, terminalOpen, routerPush, openEditorForFavorite].forEach((m) => m.mockReset());
  getDeleteImpact.mockReset();
  getDeleteImpact.mockResolvedValue({ shareCount: 0, shares: [] });
  actions = makeActions();
  fileStore = {
    selectedItems: [FILE],
    get selectedItemKeys() {
      return new Set(fileStore.selectedItems.map((i) => `${i.path}::${i.name}`));
    },
    getCurrentPathItems: [FILE, FOLDER],
    currentPath: 'Docs',
    getCurrentPath: 'Docs',
    currentPathData: { canWrite: true, canDelete: true },
    createFolder: vi.fn(),
    createFile: vi.fn(),
    createOfficeDocument: vi.fn(),
  };
  features = {
    terminalEnabled: true,
    terminalExtensions: ['sh', 'py'],
    archiveExtensions: ['zip'],
    onlyofficeEnabled: false,
  };
  favorites = {
    isFavorite: vi.fn(() => false),
    addFavorite: vi.fn().mockResolvedValue({ id: 'f1' }),
    removeFavorite: vi.fn().mockResolvedValue(),
  };
});

describe('opening it', () => {
  it('stays shut until something asks for it', async () => {
    await mountMenu();

    expect(isOpen()).toBe(false);
  });

  it('opens on a right-click on a file', async () => {
    const { api } = await mountMenu();

    api.openItemMenu(rightClick(), FILE);
    await flushPromises();

    expect(isOpen()).toBe(true);
  });

  it('opens on a right-click on the background', async () => {
    const { api } = await mountMenu();

    api.openBackgroundMenu(rightClick());
    await flushPromises();

    expect(isOpen()).toBe(true);
  });

  /** A right-click must not also trigger the browser's own menu. */
  it('takes the event away from the browser', async () => {
    const { api } = await mountMenu();
    const event = rightClick();

    api.openItemMenu(event, FILE);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('ignores a call with no event, and one with no item', async () => {
    const { api } = await mountMenu();

    api.openItemMenu(null, FILE);
    api.openItemMenu(rightClick(), null);
    await flushPromises();

    expect(isOpen()).toBe(false);
  });

  it('closes again', async () => {
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();

    api.closeMenu();
    await flushPromises();

    expect(isOpen()).toBe(false);
  });

  /** Escape closes it, because a menu that traps the keyboard is a bug. */
  it('closes on Escape', async () => {
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(isOpen()).toBe(false);
  });
});

describe('what a right-click selects', () => {
  /**
   * Right-clicking a row that is not in the selection selects it. Without this
   * the menu acts on whatever was selected before, which is the wrong file.
   */
  it('selects the row it was opened on', async () => {
    const { api } = await mountMenu();
    fileStore.selectedItems = [FOLDER];

    api.openItemMenu(rightClick(), FILE);

    expect(fileStore.selectedItems.map((i) => i.name)).toEqual(['report.docx']);
  });

  /** Right-clicking inside a multi-selection keeps it, so a bulk action works. */
  it('leaves a selection alone when the row is already in it', async () => {
    const { api } = await mountMenu();
    fileStore.selectedItems = [FILE, FOLDER];

    api.openItemMenu(rightClick(), FILE);

    expect(fileStore.selectedItems).toHaveLength(2);
  });
});

describe('what each of the three menus offers', () => {
  const openOn = async (kind) => {
    mounted?.unmount();
    document.body.innerHTML = '';
    const { api } = await mountMenu();
    if (kind === 'background') api.openBackgroundMenu(rightClick());
    else api.openItemMenu(rightClick(), kind === 'directory' ? FOLDER : FILE);
    await flushPromises();
  };

  it('offers creation on the background, where there is nothing selected to act on', async () => {
    await openOn('background');

    expect(labels()).toEqual(expect.arrayContaining(['actions.newFolder', 'actions.newFile']));
  });

  it('offers cut, copy and rename on a file', async () => {
    await openOn('file');

    expect(labels()).toEqual(
      expect.arrayContaining(['actions.cut', 'actions.copy', 'actions.rename'])
    );
  });

  /**
   * Paste goes into a folder, and into the folder being looked at. Pasting
   * "into" a file is not a thing, and offering it is a click that can only fail.
   */
  it('offers paste on a folder but not on a file', async () => {
    await openOn('directory');
    expect(labels()).toContain('actions.paste');

    await openOn('file');
    expect(labels()).not.toContain('actions.paste');
  });

  /**
   * A second condition beyond the kind: the terminal is offered for a file it
   * could actually run, which is what `TERMINAL_EXTENSIONS` names. A .docx has
   * no terminal entry, and that is right.
   */
  it('offers the terminal for a script', async () => {
    const script = { name: 'deploy.sh', path: 'Docs', kind: 'sh' };
    actions = makeActions({ primaryItem: ref(script), selectedItems: ref([script]) });
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), script);
    await flushPromises();

    expect(labels()).toContain('context.openWithTerminal');
  });

  it('does not offer it for a document, which the terminal could not run', async () => {
    await openOn('file');

    expect(labels()).not.toContain('context.openWithTerminal');
  });

  it('offers no terminal on a folder', async () => {
    await openOn('directory');

    expect(labels()).not.toContain('context.openWithTerminal');
  });

  it('offers no terminal at all where the deployment has it switched off', async () => {
    features.terminalEnabled = false;
    const script = { name: 'deploy.sh', path: 'Docs', kind: 'sh' };
    actions = makeActions({ primaryItem: ref(script), selectedItems: ref([script]) });

    await openOn('file');

    expect(labels()).not.toContain('context.openWithTerminal');
  });

  it('offers favourites on a folder', async () => {
    await openOn('directory');

    expect(labels()).toContain('context.addToFavorites');
  });

  it('says remove rather than add for a folder already favourited', async () => {
    favorites.isFavorite = vi.fn(() => true);

    await openOn('directory');

    expect(labels()).toContain('context.removeFromFavorites');
    expect(labels()).not.toContain('context.addToFavorites');
  });

  it('offers extraction only for an archive', async () => {
    await openOn('file');
    expect(labels()).not.toContain('actions.extractArchive');

    actions = makeActions({ canExtractArchive: ref(true), isArchiveSelected: ref(true) });
    await openOn('file');
    expect(labels()).toContain('actions.extractArchive');
  });
});

describe("a file's versions", () => {
  const openOnFile = async () => {
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();
  };

  const click = async (label) => {
    const button = [...(menuPanel()?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.querySelector('p')?.textContent?.trim() === label
    );
    button.click();
    await flushPromises();
  };

  beforeEach(() => {
    features.versionsEnabled = true;
    infoClose.mockReset();
    versionsOpen.mockReset();
  });

  it('are offered on a single file', async () => {
    await openOnFile();

    expect(labels()).toContain('versions.menu');
  });

  it('open the history of that file, in place of the details', async () => {
    await openOnFile();

    await click('versions.menu');

    expect(infoClose).toHaveBeenCalled();
    expect(versionsOpen).toHaveBeenCalledWith(FILE);
  });

  it('are not offered where versions are switched off', async () => {
    features.versionsEnabled = false;

    await openOnFile();

    expect(labels()).not.toContain('versions.menu');
  });

  it('are not offered on a folder, which has no history of its own', async () => {
    actions = makeActions({ primaryItem: ref(FOLDER), selectedItems: ref([FOLDER]) });
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FOLDER);
    await flushPromises();

    expect(labels()).not.toContain('versions.menu');
  });

  it('are not offered for several files at once', async () => {
    const other = { name: 'budget.xlsx', path: 'Docs', kind: 'xlsx' };
    actions = makeActions({ isSingleItemSelected: ref(false), selectedItems: ref([FILE, other]) });
    fileStore.selectedItems = [FILE, other];

    await openOnFile();

    // The menu did open, on the file clicked, with the rest of what it offers.
    expect(labels()).toContain('context.getInfo');
    expect(labels()).not.toContain('versions.menu');
  });

  it('are not offered through a share whose owner keeps them hidden', async () => {
    fileStore.currentPathData = { canWrite: true, canDelete: true, canSeeVersions: false };

    await openOnFile();

    expect(labels()).not.toContain('versions.menu');
  });
});

describe('what it will not offer where the location forbids it', () => {
  const openOnFile = async (overrides) => {
    actions = makeActions(overrides);
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();
  };

  const openOnBackground = async (overrides) => {
    actions = makeActions(overrides);
    const { api } = await mountMenu();
    api.openBackgroundMenu(rightClick());
    await flushPromises();
  };

  /**
   * The rename entry is built inside `if (locationCanWrite)`, so a read-only
   * location has no rename at all rather than a greyed-out one.
   */
  it('drops rename entirely on a read-only location', async () => {
    await openOnFile({ locationCanWrite: ref(false) });

    expect(labels()).not.toContain('actions.rename');
  });

  it('greys out rename where the target itself cannot be renamed', async () => {
    await openOnFile({ canRename: ref(false) });

    expect(isDisabled('actions.rename')).toBe(true);
  });

  it('greys out cut and copy when there is nothing to cut or copy', async () => {
    await openOnFile({ canCut: ref(false), canCopy: ref(false) });

    expect(isDisabled('actions.cut')).toBe(true);
    expect(isDisabled('actions.copy')).toBe(true);
  });

  it('offers no folder creation where folders may not be created', async () => {
    await openOnBackground({ locationCanCreateFolder: ref(false) });

    expect(labels()).not.toContain('actions.newFolder');
  });

  it('offers no file creation where files may not be created', async () => {
    await openOnBackground({ locationCanCreateFile: ref(false) });

    expect(labels()).not.toContain('actions.newFile');
  });

  it('greys out compressing when the selection cannot be zipped', async () => {
    await openOnFile({ canCompressToZip: ref(false) });

    expect(isDisabled('actions.compressToZip')).toBe(true);
  });
});

describe('running an entry', () => {
  const clickEntry = async (label) => {
    const button = [...menuPanel().querySelectorAll('button')].find(
      (candidate) => candidate.querySelector('p')?.textContent?.trim() === label
    );
    button.click();
    await flushPromises();
  };

  it('cuts', async () => {
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();

    await clickEntry('actions.cut');

    expect(actions.runCut).toHaveBeenCalled();
  });

  it('opens the info panel on what was clicked', async () => {
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();

    await clickEntry('context.getInfo');

    expect(infoOpen).toHaveBeenCalled();
  });

  /** A menu that stays open over the thing it just acted on is in the way. */
  it('closes itself afterwards', async () => {
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();

    await clickEntry('actions.copy');

    expect(isOpen()).toBe(false);
  });
});

/** Opens the menu on something and hands back the component instance. */
const openOn = async (item, kind = 'item') => {
  const { wrapper, api } = await mountMenu();
  if (kind === 'background') api.openBackgroundMenu(rightClick());
  else api.openItemMenu(rightClick(), item);
  await flushPromises();
  return { view: wrapper.vm, api, wrapper };
};

const clickLabel = async (label) => {
  const button = [...menuPanel().querySelectorAll('button')].find(
    (candidate) => candidate.querySelector('p')?.textContent?.trim() === label
  );
  button.click();
  await flushPromises();
};

describe('what the delete confirmation says', () => {
  it('names the one thing being deleted', async () => {
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteDialogTitle).toContain('report.docx');
    expect(view.deleteDialogMessage).toContain('report.docx');
  });

  it('counts them when there are several', async () => {
    actions.selectedItems = ref([FILE, FOLDER]);
    fileStore.selectedItems = [FILE, FOLDER];
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteDialogTitle).toContain('"count":2');
    expect(view.deleteDialogMessage).toContain('"count":2');
  });

  it('falls back to saying nothing in particular when nothing is pending', async () => {
    const { view } = await openOn(FILE);

    expect(view.deleteDialogTitle).toBe('context.deleteTitle.generic');
    expect(view.deleteDialogMessage).toBe('context.deleteMessage.generic');
  });

  /**
   * Deleting a file that a share points at breaks the share, and the person
   * deleting it is the only one who can weigh that.
   */
  it('warns that shares point at what is about to go', async () => {
    getDeleteImpact.mockResolvedValue({ shareCount: 3, shares: [] });
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteShareImpactMessage).toContain('"count":3');
  });

  /** Into the trash, a share link stops working but is kept for a restore. */
  it('says the share links can come back when it goes to the trash', async () => {
    getDeleteImpact.mockResolvedValue({
      shareCount: 2,
      shares: [],
      trash: {
        enabled: true,
        retentionDays: 30,
        items: [{ path: 'x', disposition: 'trash', reason: null, shareCount: 2 }],
      },
    });
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteShareImpactMessage).toContain('context.deleteLinkedSharesTrash');
    expect(view.deleteShareImpactMessage).toContain('"count":2');
    expect(view.deleteShareImpactMessage).not.toContain('Permanent');
  });

  it('says the share links go for good with what cannot go to the trash', async () => {
    getDeleteImpact.mockResolvedValue({
      shareCount: 1,
      shares: [],
      trash: {
        enabled: true,
        retentionDays: 30,
        items: [{ path: 'x', disposition: 'permanent', reason: null, shareCount: 1 }],
      },
    });
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteShareImpactMessage).toContain('context.deleteLinkedSharesPermanent');
    expect(view.deleteShareImpactMessage).not.toContain('LinkedSharesTrash');
  });

  it('says nothing about shares when none point at it', async () => {
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteShareImpactMessage).toBe('');
  });

  it('reports a check it could not make', async () => {
    getDeleteImpact.mockRejectedValue(new Error('Share service unreachable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteImpactError).toBe('Share service unreachable');
  });

  /** With the trash on, the dialog says the item goes there, and for how long. */
  it('says one item goes to the trash, and for how long', async () => {
    getDeleteImpact.mockResolvedValue({
      shareCount: 0,
      shares: [],
      trash: {
        enabled: true,
        retentionDays: 30,
        items: [{ path: 'Docs/report.docx', disposition: 'trash', reason: null }],
      },
    });
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteDialogMessage).toBe(
      'context.deleteMessage.trashSingle {"name":"report.docx","count":30}'
    );
    expect(view.goesToTrash).toBe(true);
    expect(view.deletePermanentNotice).toBe('');
  });

  it('says several items go to the trash', async () => {
    actions.selectedItems = ref([FILE, FOLDER]);
    fileStore.selectedItems = [FILE, FOLDER];
    getDeleteImpact.mockResolvedValue({
      shareCount: 0,
      shares: [],
      trash: {
        enabled: true,
        retentionDays: 7,
        items: [
          { path: 'Docs/report.docx', disposition: 'trash', reason: null },
          { path: 'Docs/2026', disposition: 'trash', reason: null },
        ],
      },
    });
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteDialogMessage).toBe(
      'context.deleteMessage.trashMultiple {"items":2,"count":7}'
    );
  });

  /** Never gone for good without being told: which ones, and why. */
  it('warns which items will be gone for good although the trash is on', async () => {
    actions.selectedItems = ref([FILE, FOLDER]);
    fileStore.selectedItems = [FILE, FOLDER];
    getDeleteImpact.mockResolvedValue({
      shareCount: 0,
      shares: [],
      trash: {
        enabled: true,
        retentionDays: 30,
        items: [
          { path: 'Docs/report.docx', disposition: 'trash', reason: null },
          { path: 'Docs/2026', disposition: 'permanent', reason: 'other-device' },
        ],
      },
    });
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deletePermanentNotice).toBe(
      'context.deleteSomePermanent {"count":1} context.trashReasons.otherDevice'
    );
    // Not the trash wording: something here is permanent.
    expect(view.deleteDialogMessage).toContain('context.deleteMessage.multiple');
    expect(view.goesToTrash).toBe(true);
  });

  /** Before the server answers, "irreversible" would be wrong for nearly every item. */
  it('does not call a deletion irreversible while the trash is on and the answer is pending', async () => {
    features.trashEnabled = true;
    features.trashRetentionDays = 30;
    getDeleteImpact.mockReturnValue(new Promise(() => {}));
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteDialogMessage).toBe(
      'context.deleteMessage.trashSingle {"name":"report.docx","count":30}'
    );
    expect(view.goesToTrash).toBe(true);
  });

  it('keeps the permanent wording while pending when the trash is off', async () => {
    features.trashEnabled = false;
    getDeleteImpact.mockReturnValue(new Promise(() => {}));
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteDialogMessage).toContain('context.deleteMessage.single');
    expect(view.goesToTrash).toBe(false);
  });

  it('keeps the permanent wording when the trash is off', async () => {
    getDeleteImpact.mockResolvedValue({
      shareCount: 0,
      shares: [],
      trash: {
        enabled: false,
        retentionDays: 30,
        items: [{ path: 'Docs/report.docx', disposition: 'permanent', reason: 'disabled' }],
      },
    });
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteDialogMessage).toContain('context.deleteMessage.single');
    expect(view.goesToTrash).toBe(false);
    expect(view.deletePermanentNotice).toBe('');
  });

  it('explains how much too large an item turned away by the trash was', async () => {
    const { view } = await openOn(FILE);

    expect(
      view.keptItemReason({
        reason: 'too-large',
        size: 50 * 1024 ** 2,
        budgetBytes: 20 * 1024 ** 2,
      })
    ).toBe('context.keptReasons.tooLarge {"size":"50 MB","budget":"20 MB"}');
    expect(view.keptItemReason({ reason: 'zone-root' })).toBe('context.trashReasons.zoneRoot');
  });

  /** Somebody may have unsaved work in it, open in another window right now. */
  it('warns that a document is open in the editor', async () => {
    const open = { ...FILE, onlyofficeActivity: { active: true } };
    actions.selectedItems = ref([open]);
    fileStore.selectedItems = [open];
    const { view } = await openOn(open);

    await clickLabel('common.delete');

    expect(view.deleteOnlyOfficeActivityMessage).toBe(
      'context.deleteOnlyofficeOpen {"names":"report.docx"}'
    );
  });

  it('names the first two and counts the rest', async () => {
    const open = ['a.docx', 'b.docx', 'c.docx', 'd.docx'].map((name) => ({
      name,
      path: 'Docs',
      kind: 'docx',
      onlyofficeActivity: { active: true },
    }));
    actions.selectedItems = ref(open);
    fileStore.selectedItems = open;
    const { view } = await openOn(open[0]);

    await clickLabel('common.delete');

    const message = view.deleteOnlyOfficeActivityMessage;
    expect(message.startsWith('context.deleteOnlyofficeOpen')).toBe(true);
    expect(message).toContain('a.docx, b.docx onlyoffice.andOthers');
    expect(message).toContain('\\"count\\":2');
    expect(message).not.toContain('c.docx');
  });

  it('says nothing when none of them is open', async () => {
    const { view } = await openOn(FILE);

    await clickLabel('common.delete');

    expect(view.deleteOnlyOfficeActivityMessage).toBe('');
  });
});

describe('what the inline quick actions offer', () => {
  const available = async (item, ids, overrides = {}) => {
    actions = makeActions(overrides);
    const { api } = await mountMenu();
    return ids.filter((id) => api.quickActionAvailable(item, id));
  };

  const ALL = [
    'info',
    'copyName',
    'copyPath',
    'copy',
    'download',
    'cut',
    'rename',
    'share',
    'compress',
    'favorite',
    'delete',
  ];

  /** A volume is not a file: it cannot be cut, renamed, shared or deleted. */
  it('offers a volume only what makes sense on a volume', async () => {
    const offered = await available({ name: 'media', kind: 'volume' }, ALL);

    expect(offered).toEqual(['info', 'copyName']);
  });

  it('offers a folder everything but nothing extra', async () => {
    const offered = await available(FOLDER, ALL);

    expect(offered).toEqual(ALL);
  });

  it('does not offer to favourite a file', async () => {
    const offered = await available(FILE, ALL);

    expect(offered).not.toContain('favorite');
  });

  it('offers nothing at all for nothing at all', async () => {
    const offered = await available(null, ALL);

    expect(offered).toEqual([]);
  });

  it('does not invent an action nobody asked for', async () => {
    const offered = await available(FILE, ['format-drive']);

    expect(offered).toEqual([]);
  });

  it('withholds deleting where the location forbids it', async () => {
    const offered = await available(FILE, ALL, { locationCanDelete: ref(false) });

    expect(offered).not.toContain('delete');
  });

  /** Cutting is a move: it needs the right to write there and to remove from here. */
  it('withholds cutting unless both halves of a move are allowed', async () => {
    expect(await available(FILE, ['cut'], { locationCanDelete: ref(false) })).toEqual([]);
    expect(await available(FILE, ['cut'], { locationCanWrite: ref(false) })).toEqual([]);
  });

  it('withholds renaming and compressing on a read-only location', async () => {
    const offered = await available(FILE, ALL, { locationCanWrite: ref(false) });

    expect(offered).not.toContain('rename');
    expect(offered).not.toContain('compress');
  });

  it('still offers reading it, on a read-only location', async () => {
    const offered = await available(FILE, ALL, { locationCanWrite: ref(false) });

    expect(offered).toEqual(expect.arrayContaining(['info', 'copyPath', 'copy', 'download']));
  });
});

describe('running a quick action', () => {
  const clipboard = { writeText: vi.fn(async () => {}) };

  beforeEach(() => {
    clipboard.writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  });

  /** The run functions act on the selection, so the item has to be in it first. */
  it('acts on the item it was given, not on whatever was selected', async () => {
    fileStore.selectedItems = [FOLDER];
    const { api } = await mountMenu();

    await api.runQuickAction(FILE, 'copy');

    expect(fileStore.selectedItems).toEqual([FILE]);
    expect(actions.runCopy).toHaveBeenCalled();
  });

  it('leaves a selection alone when the item is already in it', async () => {
    fileStore.selectedItems = [FILE, FOLDER];
    const { api } = await mountMenu();

    await api.runQuickAction(FILE, 'copy');

    expect(fileStore.selectedItems).toEqual([FILE, FOLDER]);
  });

  it('copies the name on its own', async () => {
    const { api } = await mountMenu();

    await api.runQuickAction(FILE, 'copyName');

    expect(clipboard.writeText).toHaveBeenCalledWith('report.docx');
  });

  it('copies the whole path', async () => {
    const { api } = await mountMenu();

    await api.runQuickAction(FILE, 'copyPath');

    expect(clipboard.writeText).toHaveBeenCalledWith('Docs/report.docx');
  });

  /** An insecure context has no clipboard; that is not a reason to throw. */
  it('says nothing when the browser will not give up its clipboard', async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
    const { api } = await mountMenu();

    await expect(api.runQuickAction(FILE, 'copyName')).resolves.toBeUndefined();
  });

  it.each([
    ['info', () => expect(infoOpen).toHaveBeenCalled()],
    ['download', () => expect(actions.runDownload).toHaveBeenCalled()],
    ['cut', () => expect(actions.runCut).toHaveBeenCalled()],
    ['rename', () => expect(actions.runRename).toHaveBeenCalled()],
    ['compress', () => expect(actions.runCompressToZip).toHaveBeenCalled()],
  ])('runs %s', async (id, assert) => {
    const { api } = await mountMenu();

    await api.runQuickAction(FILE, id);

    assert();
  });

  it('asks before deleting rather than deleting', async () => {
    const { api, wrapper } = await mountMenu();

    await api.runQuickAction(FILE, 'delete');

    expect(actions.deleteNow).not.toHaveBeenCalled();
    expect(wrapper.vm.isDeleteConfirmOpen).toBe(true);
  });

  it('does nothing for an action that does not exist', async () => {
    const { api } = await mountMenu();

    await api.runQuickAction(FILE, 'format-drive');

    expect(actions.runCopy).not.toHaveBeenCalled();
  });

  it('does nothing at all without an item', async () => {
    const { api } = await mountMenu();

    await api.runQuickAction(null, 'copy');

    expect(actions.runCopy).not.toHaveBeenCalled();
  });
});

describe('marking a folder as a favourite', () => {
  it('adds it, and opens the editor so it can be named', async () => {
    favorites.addFavorite.mockResolvedValue({ id: 'f1', path: 'Docs/2026' });
    await openOn(FOLDER);

    await clickLabel('context.addToFavorites');

    expect(favorites.addFavorite).toHaveBeenCalledWith({ path: 'Docs/2026' });
    expect(openEditorForFavorite).toHaveBeenCalledWith({ id: 'f1', path: 'Docs/2026' });
  });

  it('removes one that is already there', async () => {
    favorites.isFavorite.mockReturnValue(true);
    await openOn(FOLDER);

    await clickLabel('context.removeFromFavorites');

    expect(favorites.removeFavorite).toHaveBeenCalledWith('Docs/2026');
  });

  it('opens no editor when the server did not create one', async () => {
    favorites.addFavorite.mockResolvedValue(null);
    await openOn(FOLDER);

    await clickLabel('context.addToFavorites');

    expect(openEditorForFavorite).not.toHaveBeenCalled();
  });

  it('marks the folder being looked at, from the background menu', async () => {
    await openOn(null, 'background');

    await clickLabel('context.addToFavorites');

    expect(favorites.addFavorite).toHaveBeenCalledWith({ path: 'Docs' });
  });

  /** A second click while the first is in flight would add it twice. */
  it('ignores a second click while the first is still going', async () => {
    let release;
    favorites.addFavorite.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const { view } = await openOn(FOLDER);

    const first = view.runToggleFavoriteForDirectory();
    await view.runToggleFavoriteForDirectory();
    release({ id: 'f1' });
    await first;

    expect(favorites.addFavorite).toHaveBeenCalledTimes(1);
  });

  it('marks nothing from a file', async () => {
    const { view } = await openOn(FILE);

    await view.runToggleFavoriteForDirectory();

    expect(favorites.addFavorite).not.toHaveBeenCalled();
  });
});

describe('opening a file in the terminal', () => {
  const SCRIPT = { name: 'backup.sh', path: 'Docs/bin', kind: 'sh' };

  it('opens it in the folder the file lives in', async () => {
    actions = makeActions({ primaryItem: ref(SCRIPT), selectedItems: ref([SCRIPT]) });
    await openOn(SCRIPT);

    await clickLabel('context.openWithTerminal');

    expect(terminalOpen).toHaveBeenCalledWith('tab-1', 'Docs/bin', { input: './backup.sh' });
  });

  /** A name with a space in it must not become two arguments. */
  it('quotes a name the shell would otherwise split', async () => {
    const spaced = { name: 'my backup.sh', path: 'Docs', kind: 'sh' };
    actions = makeActions({ primaryItem: ref(spaced), selectedItems: ref([spaced]) });
    await openOn(spaced);

    await clickLabel('context.openWithTerminal');

    expect(terminalOpen).toHaveBeenCalledWith('tab-1', 'Docs', { input: './my\\ backup.sh' });
  });

  it('falls back to the folder on screen for a file with no path of its own', async () => {
    const loose = { name: 'run.sh', kind: 'sh' };
    actions = makeActions({ primaryItem: ref(loose), selectedItems: ref([loose]) });
    await openOn(loose);

    await clickLabel('context.openWithTerminal');

    expect(terminalOpen).toHaveBeenCalledWith('tab-1', 'Docs', { input: './run.sh' });
  });
});

describe('opening a file in the editor', () => {
  it('goes to the editor on that file', async () => {
    await openOn(FILE);

    await clickLabel('context.openWithEditor');

    expect(routerPush).toHaveBeenCalledWith({ path: '/editor/Docs/report.docx' });
  });

  /**
   * A name is not a URL. A `#` in it would cut the path short, and a `?` would
   * turn the rest of the name into a query — the editor would open the wrong
   * file, or none.
   */
  it('encodes a name a URL would otherwise swallow', async () => {
    const awkward = { name: 'notes #1 & co?.md', path: 'Docs', kind: 'md' };
    actions = makeActions({ primaryItem: ref(awkward), selectedItems: ref([awkward]) });
    await openOn(awkward);

    await clickLabel('context.openWithEditor');

    expect(routerPush).toHaveBeenCalledWith({
      path: '/editor/Docs/notes%20%231%20%26%20co%3F.md',
    });
  });

  it('keeps the folders apart while encoding them', async () => {
    const nested = { name: 'a.md', path: 'My Docs/2026 #2', kind: 'md' };
    actions = makeActions({ primaryItem: ref(nested), selectedItems: ref([nested]) });
    await openOn(nested);

    await clickLabel('context.openWithEditor');

    expect(routerPush).toHaveBeenCalledWith({ path: '/editor/My%20Docs/2026%20%232/a.md' });
  });
});

describe('an archive that wants a password', () => {
  const ZIP = { name: 'photos.zip', path: 'Docs', kind: 'zip' };

  const openZip = async (extractResult) => {
    actions = makeActions({
      primaryItem: ref(ZIP),
      selectedItems: ref([ZIP]),
      isArchiveSelected: ref(true),
      canExtractArchive: ref(true),
      runExtractArchive: vi.fn(async () => extractResult),
    });
    fileStore.extractZipArchive = vi.fn(async () => ({}));
    return openOn(ZIP);
  };

  it('asks for one when the archive turns out to be locked', async () => {
    const { view } = await openZip({
      requiresPassword: true,
      path: 'Docs/photos.zip',
      destination: 'Docs',
    });

    await clickLabel('actions.extractArchive');

    expect(view.archivePasswordRequest).toEqual({
      path: 'Docs/photos.zip',
      destination: 'Docs',
      invalidPassword: undefined,
    });
  });

  it('asks for nothing when the archive opens on its own', async () => {
    const { view } = await openZip({ requiresPassword: false });

    await clickLabel('actions.extractArchive');

    expect(view.archivePasswordRequest).toBeNull();
  });

  it('extracts with the password it was given', async () => {
    const { view } = await openZip({
      requiresPassword: true,
      path: 'Docs/photos.zip',
      destination: 'Docs',
    });
    await clickLabel('actions.extractArchive');

    await view.submitArchivePassword('hunter2');

    expect(fileStore.extractZipArchive).toHaveBeenCalledWith('Docs/photos.zip', {
      destination: 'Docs',
      password: 'hunter2',
    });
    expect(view.archivePasswordRequest).toBeNull();
  });

  /** A wrong password is a reason to ask again, not to give up silently. */
  it('asks again, saying so, when the password was wrong', async () => {
    const { view } = await openZip({
      requiresPassword: true,
      path: 'Docs/photos.zip',
      destination: 'Docs',
    });
    await clickLabel('actions.extractArchive');
    fileStore.extractZipArchive.mockResolvedValue({
      requiresPassword: true,
      invalidPassword: true,
    });

    await view.submitArchivePassword('wrong');

    expect(view.archivePasswordRequest).toMatchObject({ invalidPassword: true });
  });

  it('cannot be dismissed while it is still trying', async () => {
    const { view } = await openZip({
      requiresPassword: true,
      path: 'Docs/photos.zip',
      destination: 'Docs',
    });
    await clickLabel('actions.extractArchive');
    let release;
    fileStore.extractZipArchive.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );

    const pending = view.submitArchivePassword('hunter2');
    view.closeArchivePasswordDialog();

    expect(view.archivePasswordRequest).not.toBeNull();
    release({});
    await pending;
  });

  it('can be dismissed once it is not', async () => {
    const { view } = await openZip({
      requiresPassword: true,
      path: 'Docs/photos.zip',
      destination: 'Docs',
    });
    await clickLabel('actions.extractArchive');

    view.closeArchivePasswordDialog();

    expect(view.archivePasswordRequest).toBeNull();
  });

  it('does nothing when asked for a password it never wanted', async () => {
    const { view } = await openZip({ requiresPassword: false });

    await view.submitArchivePassword('hunter2');

    expect(fileStore.extractZipArchive).not.toHaveBeenCalled();
  });
});

/**
 * Opening an entry in a tab of this application.
 *
 * Offered where a browser offers it and for the same reason: it is about *this*
 * entry, and it is the first thing somebody with tabs open reaches for. Not
 * offered where it would do nothing — tabs off, or an entry with no address of its
 * own, which is a download rather than a place.
 */
/**
 * Two or three files, compared side by side.
 *
 * Offered where it would do something — a selection of two or three files this
 * application reads as text — and refused everywhere else, because comparing two
 * photographs line by line is an offer that was never worth making.
 */
describe('comparing what was chosen', () => {
  // Text, because that is what a comparison reads: `report.docx` beside it is a
  // document this application opens in an editor, not lines it can align.
  const first = { name: 'notes.txt', path: 'Docs', kind: 'txt' };
  const second = { name: 'plan.md', path: 'Docs', kind: 'md' };
  const image = { name: 'holiday.png', path: 'Docs', kind: 'png' };

  const openOn = async (chosen) => {
    fileStore.selectedItems = chosen;
    actions = makeActions({ primaryItem: ref(chosen[0]), selectedItems: ref(chosen) });
    document.body.innerHTML = '';
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), chosen[0]);
    await flushPromises();
  };

  it('is offered for two files that can be read as text', async () => {
    await openOn([first, second]);

    expect(labels()).toContain('compare.compareCount {"count":2}');
  });

  it('is offered for three of them', async () => {
    await openOn([first, second, { name: 'more.txt', path: 'Docs', kind: 'txt' }]);

    expect(labels()).toContain('compare.compareCount {"count":3}');
  });

  it('is not offered for one file, which has nothing to be compared with', async () => {
    await openOn([first]);

    expect(labels().some((label) => label.startsWith('compare.compareCount'))).toBe(false);
  });

  it('is not offered when anything chosen cannot be read as text', async () => {
    await openOn([first, image]);

    expect(labels().some((label) => label.startsWith('compare.compareCount'))).toBe(false);
  });

  /**
   * Spelled the way the router spells it, which is the way the screen is handed it back.
   *
   * `URLSearchParams` writes a slash in a query value as `%2F`, so a tab was opened
   * under one spelling of the address and landed under another. Everything downstream
   * that matches an address by name then missed it.
   */
  it('opens the comparison in a tab of its own, carrying both paths', async () => {
    await openOn([first, second]);

    await clickLabel('compare.compareCount {"count":2}');

    expect(address.open).toHaveBeenCalledWith('/compare?paths=Docs/notes.txt&paths=Docs/plan.md', {
      own: true,
    });
  });

  /** Without tabs there is nowhere else to put it, so the window goes there. */
  it('goes there itself when there are no tabs', async () => {
    address.enabled = false;
    await openOn([first, second]);

    await clickLabel('compare.compareCount {"count":2}');

    expect(routerPush).toHaveBeenCalledWith({
      path: '/compare',
      query: { paths: ['Docs/notes.txt', 'Docs/plan.md'] },
    });
  });
});

describe('open in a new tab', () => {
  beforeEach(() => {
    address.enabled = true;
    address.open.mockReset();
    address.open.mockReturnValue({ id: 'opened' });
    address.limit = 10;
    address.addressFor.mockReset();
    address.addressFor.mockReturnValue({ path: '/open/Docs/report.docx' });
    fileStore.selectedItems = [FILE];
  });

  const openOnFileEntry = async () => {
    document.body.innerHTML = '';
    const { api } = await mountMenu();
    api.openItemMenu(rightClick(), FILE);
    await flushPromises();
  };

  it('is offered, and opens the address the entry has', async () => {
    await openOnFileEntry();
    expect(labels()).toContain('tabs.openInNewTab');

    await clickLabel('tabs.openInNewTab');

    expect(address.addressFor).toHaveBeenCalledWith(FILE, { currentPath: 'Docs' });
    expect(address.open).toHaveBeenCalledWith('/open/Docs/report.docx', {
      behind: false,
      own: true,
    });
  });

  it('is not offered while tabs are off', async () => {
    address.enabled = false;

    await openOnFileEntry();

    expect(labels()).not.toContain('tabs.openInNewTab');
  });

  it('is not offered for an entry with nowhere of its own', async () => {
    address.addressFor.mockReturnValue(null);

    await openOnFileEntry();

    expect(labels()).not.toContain('tabs.openInNewTab');
  });

  /**
   * Four chosen entries are four tabs.
   *
   * Opening the first and dropping the other three is the kind of answer that
   * makes somebody stop using the menu — they said what they wanted, four times
   * over. The first comes forward, as one entry always has; the rest line up
   * behind it, which is the order they will be read in.
   */
  it('opens every entry that was chosen, the first in front and the rest behind', async () => {
    const second = { name: 'notes.md', path: 'Docs', kind: 'md' };
    fileStore.selectedItems = [FILE, second];
    actions = makeActions({
      primaryItem: ref(FILE),
      selectedItems: ref([FILE, second]),
    });
    address.addressFor
      .mockReturnValueOnce({ path: '/open/Docs/report.docx' })
      .mockReturnValueOnce({ path: '/editor/Docs/notes.md' });

    await openOnFileEntry();
    // The label says how many, which is what makes it the right label.
    expect(labels()).toContain('tabs.openInNewTabs {"count":2}');

    await clickLabel('tabs.openInNewTabs {"count":2}');

    expect(address.open).toHaveBeenNthCalledWith(1, '/open/Docs/report.docx', {
      behind: false,
      own: true,
    });
    expect(address.open).toHaveBeenNthCalledWith(2, '/editor/Docs/notes.md', {
      behind: true,
      own: true,
    });
  });

  /** The row has a limit, and it is an administrator's: it stops there. */
  it('stops when the row is full rather than asking for tabs there is no room for', async () => {
    const second = { name: 'notes.md', path: 'Docs', kind: 'md' };
    const third = { name: 'plan.md', path: 'Docs', kind: 'md' };
    fileStore.selectedItems = [FILE, second, third];
    actions = makeActions({
      primaryItem: ref(FILE),
      selectedItems: ref([FILE, second, third]),
    });
    address.addressFor.mockReturnValue({ path: '/open/Docs/report.docx' });
    address.open.mockReturnValueOnce({ id: 'a' }).mockReturnValue(null);

    await openOnFileEntry();
    await clickLabel('tabs.openInNewTabs {"count":3}');

    expect(address.open).toHaveBeenCalledTimes(2);
  });

  /** An entry with nowhere of its own is a download: it is not one of the four. */
  it('counts only the entries that have somewhere to go', async () => {
    const nowhere = { name: 'archive.zip', path: 'Docs', kind: 'zip' };
    fileStore.selectedItems = [FILE, nowhere];
    actions = makeActions({
      primaryItem: ref(FILE),
      selectedItems: ref([FILE, nowhere]),
    });
    address.addressFor
      .mockReturnValueOnce({ path: '/open/Docs/report.docx' })
      .mockReturnValueOnce(null);

    await openOnFileEntry();

    expect(labels()).toContain('tabs.openInNewTab');
    expect(labels().some((label) => label.startsWith('tabs.openInNewTabs'))).toBe(false);
  });
});
