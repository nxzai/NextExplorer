import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { createI18n } from 'vue-i18n';

/**
 * The folder, and everything it decides.
 *
 * 1200 lines wired to seven stores, eight composables and the scroll position
 * of a window that does not exist in a test runner — which is why it sat at two
 * per cent while everything around it was covered. Most of it is not layout
 * though: it is which item the arrow keys land on, whether a folder somebody
 * came back to opens where they left it, and whether the tab quietly re-reads
 * the listing behind their back.
 *
 * The stores are replaced by plain reactive objects so a test can state the
 * situation instead of assembling it, and the composables that reach further
 * (navigation, actions, drag and drop) are replaced by spies. What is exercised
 * is this file.
 */

/**
 * Reactive stand-ins for the stores and the route.
 *
 * Built inside the mock factories rather than beside them: a `vi.hoisted` block
 * runs before any import, so `reactive` does not exist yet there.
 */
const shared = vi.hoisted(() => {
  const objects = {};
  const make = async (name, initial = {}) => {
    const { reactive } = await import('vue');
    objects[name] ||= reactive(initial);
    return objects[name];
  };
  return { objects, make, routeLeaveGuards: [] };
});

const routeState = () => shared.objects.route;
const routeLeaveGuards = shared.routeLeaveGuards;
const stores = shared.objects;

vi.mock('vue-router', async () => {
  const route = await shared.make('route', { params: { path: 'Docs' }, query: {} });
  return {
    useRoute: () => route,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    onBeforeRouteLeave: (guard) => shared.routeLeaveGuards.push(guard),
    RouterLink: { template: '<a><slot /></a>' },
    // A row asks where an entry opens, which asks the preview plugins, and the
    // plugin manager imports the application's own router — so loading this view
    // now loads the module that builds it. Mocking a router means mocking that too.
    createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), resolve: vi.fn() }),
    createWebHistory: () => ({}),
  };
});

vi.mock('@/api', () => ({
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
}));

// Which tabs are still working, so the strip can say so. A stand-in: whether the
// work is a listing or a file is this screen's business, drawing it is the strip's.
vi.mock('@/stores/tabLoading', () => ({
  useTabLoadingStore: () => ({ begin: () => () => {}, isLoading: () => false }),
}));
vi.mock('@/stores/settings', async () => {
  const store = await shared.make('settings');
  return { useSettingsStore: () => store };
});
vi.mock('@/stores/fileStore', async () => {
  const store = await shared.make('file');
  return { useFileStore: () => store };
});
vi.mock('@/stores/folderSize', async () => {
  const store = await shared.make('folderSize');
  return { useFolderSizeStore: () => store };
});
vi.mock('@/stores/volumeUsage', async () => {
  const store = await shared.make('volumeUsage');
  return { useVolumeUsageStore: () => store };
});
vi.mock('@/stores/features', async () => {
  const store = await shared.make('features');
  return { useFeaturesStore: () => store };
});
vi.mock('@/stores/folderScroll', async () => {
  const store = await shared.make('folderScroll');
  return { useFolderScrollStore: () => store };
});
vi.mock('@/stores/operationTasks', async () => {
  const store = await shared.make('operationTasks');
  return { useOperationTasksStore: () => store };
});
// The tab this listing is in, which is half the key its place is remembered
// under: two tabs can be on one folder and be in different places in it.
/** What kind of place the pane's address names — a folder, unless a test says so. */
const addressKind = vi.hoisted(() => ({ value: 'folder' }));
vi.mock('@/config/tabKinds', async (importOriginal) => ({
  ...(await importOriginal()),
  tabKindForPath: () => ({ id: addressKind.value }),
}));

const appTabs = vi.hoisted(() => ({
  activeId: 'tab-1',
  // Which tab the pane draws, when that is not the one in front.
  paneId: '',
  // The tabs drawn right now: one of them, or the two halves of a pair. What says
  // whether this listing is on screen at all, which is not the same question as
  // whether the reader is in it.
  panes: ['tab-1'],
  takeBroughtForward: vi.fn(() => false),
}));
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => appTabs }));

/**
 * The pane this view is drawing, which is where it now reads its place from.
 *
 * Composed from the same stand-ins the tests already drive: the folder on screen
 * is `stores.file`, and where the pane is comes from the route — so every
 * assertion below still states its situation the way it did, and still asserts
 * the same thing. What the pane itself decides is held in
 * `composables/paneTab.spec.js`; what is exercised here is this view.
 */
vi.mock('@/composables/paneTab', async () => {
  const { computed } = await import('vue');
  const file = await shared.make('file');
  const route = await shared.make('route', { params: { path: 'Docs' }, query: {} });
  const folderPath = computed(() => String(route.params?.path || ''));
  const address = computed(() => {
    const select = route.query?.select;
    const query = typeof select === 'string' ? `?select=${encodeURIComponent(select)}` : '';
    return `/browse/${folderPath.value}${query}`;
  });
  return {
    usePaneFolder: () => ({
      tabId: computed(() => appTabs.paneId || appTabs.activeId),
      folder: computed(() => file),
      address,
      folderPath,
      view: file,
      items: computed(() => file.getCurrentPathItems),
      // Whether the reader is in this pane, which is what makes it act: with one
      // pane that is always true, and in a pair it is true of one of the two.
      focused: computed(() => (appTabs.paneId || appTabs.activeId) === appTabs.activeId),
    }),
    usePaneTabId: () => computed(() => appTabs.paneId || appTabs.activeId),
    providePaneTab: () => {},
  };
});

const composables = vi.hoisted(() => ({
  clearSelection: vi.fn(),
  toggleSelection: vi.fn(),
  openBackgroundMenu: vi.fn(),
  openItem: vi.fn(),
  openItemInTab: vi.fn(() => true),
  goNext: vi.fn(),
  goPrev: vi.fn(),
  goUp: vi.fn(),
  isEditableElement: vi.fn(() => false),
  handleDragOver: vi.fn(),
  handleDragLeave: vi.fn(),
  handleDrop: vi.fn(),
  isDeleteConfirmOpen: null,
}));

vi.mock('@/composables/itemSelection', () => ({
  useSelection: () => ({
    clearSelection: composables.clearSelection,
    toggleSelection: composables.toggleSelection,
  }),
}));
vi.mock('@/composables/contextMenu', () => ({
  useExplorerContextMenu: () => ({ openBackgroundMenu: composables.openBackgroundMenu }),
}));
// What a tab behind means is the rule's own, held in
// `composables/itemAddress.openInTab.spec.js`. What is asked here is that the key
// that opens things asks it when the modifier is held.
vi.mock('@/composables/itemAddress', () => ({
  useOpenItemInTab: () => ({ openItemInTab: composables.openItemInTab }),
}));
vi.mock('@/composables/navigation', () => ({
  useNavigation: () => ({
    openItem: composables.openItem,
    goNext: composables.goNext,
    goPrev: composables.goPrev,
    goUp: composables.goUp,
  }),
}));
vi.mock('@/composables/fileActions', () => ({
  useFileActions: () => ({ isEditableElement: composables.isEditableElement }),
}));
vi.mock('@/composables/useDeleteConfirm', () => ({
  useDeleteConfirm: () => ({ isDeleteConfirmOpen: composables.isDeleteConfirmOpen }),
}));
vi.mock('@/composables/useFileDragDrop', () => ({
  useFileDragDrop: () => ({
    handleDragOver: composables.handleDragOver,
    handleDragLeave: composables.handleDragLeave,
    handleDrop: composables.handleDrop,
    isDragTarget: () => false,
    isCopyDragTarget: () => false,
  }),
}));
vi.mock('@/composables/fileUploader', () => ({ useUppyDropTarget: () => {} }));
vi.mock('@/composables/useInputMode', () => ({ useInputMode: () => ({ isTouchDevice: false }) }));
vi.mock('@/composables/useViewConfig', async () => {
  const { computed } = await import('vue');
  return {
    useViewConfig: () => ({ gridClasses: computed(() => ''), gridStyle: computed(() => ({})) }),
  };
});
vi.mock('@coleqiu/vue-drag-select', () => ({
  DragSelect: { name: 'DragSelect', template: '<div><slot /></div>' },
}));

const FolderView = (await import('./FolderView.vue')).default;

const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false });

const file = (name, extra = {}) => ({ name, path: 'Docs', kind: 'file', ...extra });
const folder = (name, extra = {}) => file(name, { kind: 'directory', ...extra });

let wrapper = null;

const mountFolder = async () => {
  wrapper = mount(FolderView, {
    global: {
      plugins: [i18n],
      stubs: {
        FileObject: { template: '<div />' },
        LoadingIcon: true,
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper.vm;
};

/** What the keyboard sees, without a real window to scroll. */
const press = async (key, modifiers = {}) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  await flushPromises();
};

const selectedNames = () => stores.file.selectedItems.map((item) => item.name);

/**
 * jsdom has no `scrollIntoView`, and the view reads its presence as "this row
 * can be brought into sight". Without it the reveal path reports failure and
 * the remembered position quietly takes over — the opposite of what a browser
 * does. Local to this file: a no-op stub is not something every other spec
 * should silently inherit.
 */
let scrollIntoView = null;

beforeEach(() => {
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  routeLeaveGuards.length = 0;
  Object.assign(routeState(), { params: { path: 'Docs' }, query: {} });

  Object.assign(composables, {
    isDeleteConfirmOpen: ref(false),
  });
  composables.clearSelection.mockClear();
  composables.toggleSelection.mockClear();
  composables.openItem.mockClear();
  composables.openItemInTab.mockClear();
  composables.openItemInTab.mockReturnValue(true);
  composables.goNext.mockClear();
  composables.goPrev.mockClear();
  composables.goUp.mockClear();
  composables.openBackgroundMenu.mockClear();
  composables.isEditableElement.mockReturnValue(false);

  Object.assign(stores.settings, {
    view: 'list',
    sortBy: { by: 'name', order: 'asc' },
    setSort: vi.fn((by, order) => {
      stores.settings.sortBy = { by, order };
    }),
    listViewColumnWidths: [0, 200, 100, 100, 160],
    setListViewColumnWidth: vi.fn(),
    // How a folder is shown is its own preference. Walking into another folder
    // applies that folder's to the window, so a tab coming back has to ask for its
    // own again — otherwise it comes back looking like somewhere else, and the
    // position it looks up belongs to a view nobody is in.
    restoreFolderPreferences: vi.fn(),
  });

  Object.assign(stores.file, {
    currentPath: 'Docs',
    currentPathData: null,
    renameState: null,
    items: [],
    selectedItems: [],
    fetchPathItems: vi.fn(async () => {}),
    prefetchItemThumbnail: vi.fn(async () => true),
    setKeyboardActionItem: vi.fn(),
    clearKeyboardActionItem: vi.fn(),
  });

  // Real getters, so the view sees the listing change the way the store makes
  // it change. Object.assign would have copied one evaluation and frozen it.
  Object.defineProperty(stores.file, 'getCurrentPathItems', {
    configurable: true,
    get: () => stores.file.items,
  });
  Object.defineProperty(stores.file, 'selectedItemKeys', {
    configurable: true,
    get: () => new Set(stores.file.selectedItems.map((item) => `${item.path || ''}::${item.name}`)),
  });

  Object.assign(stores.folderSize, {
    ensureSizes: vi.fn(async () => {}),
    scheduleRefresh: vi.fn(),
  });
  Object.assign(stores.volumeUsage, { scheduleRefresh: vi.fn() });
  Object.assign(stores.features, { folderSizeEnabled: true, volumeUsageEnabled: true });
  Object.assign(stores.folderScroll, {
    remember: vi.fn(),
    rememberActiveItem: vi.fn(),
    consumeRestoreState: vi.fn(() => ({ permitted: false, scrollTop: 0, activeItemKey: '' })),
    rememberTabPlace: vi.fn(),
    tabPlace: vi.fn(() => 0),
    // Whether this tab has a place in this folder at all, which is a different
    // question from where it is: the top is an answer, and as a number it is zero.
    hasTabPlace: vi.fn(() => false),
    // The row the reader was on, which is what a place in a folder really is: a
    // pane that comes back a different width has re-flowed under the same pixels.
    tabAnchor: vi.fn(() => ''),
    // The folder's own memory, which a tab coming back falls back to: it is what
    // a walk back up the path reads, and it has been putting readers back where
    // they were since long before tabs existed.
    get: vi.fn(() => 0),
  });
  appTabs.activeId = 'tab-1';
  appTabs.paneId = '';
  appTabs.panes = ['tab-1'];
  addressKind.value = 'folder';
  appTabs.takeBroughtForward.mockClear();
  appTabs.takeBroughtForward.mockReturnValue(false);
  Object.assign(stores.operationTasks, { operationCount: 0 });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  delete Element.prototype.scrollIntoView;
});

describe('opening a folder', () => {
  it('reads the folder the route names', async () => {
    await mountFolder();

    expect(stores.file.fetchPathItems).toHaveBeenCalledWith('Docs');
  });

  it('stops showing itself as loading once the listing is in', async () => {
    const view = await mountFolder();

    expect(view.loading).toBe(false);
  });

  /** A folder that will not load is still a folder somebody is looking at. */
  it('stops loading even when the listing never arrives', async () => {
    stores.file.fetchPathItems.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const view = await mountFolder();

    expect(view.loading).toBe(false);
  });
});

describe('the item a search result asked us to land on', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt'), file('report.pdf'), file('z.txt')];
  });

  it('is selected on arrival', async () => {
    routeState().query = { select: 'report.pdf' };

    await mountFolder();

    expect(selectedNames()).toEqual(['report.pdf']);
  });

  /** So the arrow keys carry on from there rather than from the top. */
  it('becomes where the keyboard is', async () => {
    routeState().query = { select: 'report.pdf' };

    const view = await mountFolder();

    expect(view.keyboardActiveItemKey).toBe('Docs::report.pdf');
    expect(stores.file.setKeyboardActionItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'report.pdf' })
    );
  });

  it('is ignored when the folder does not hold it', async () => {
    routeState().query = { select: 'gone.txt' };

    await mountFolder();

    expect(selectedNames()).toEqual([]);
  });

  /**
   * Landing on a named item is what the reader just asked for; the remembered
   * position is where they happened to be some time ago.
   */
  it('wins over the position this folder was left at', async () => {
    routeState().query = { select: 'report.pdf' };
    stores.folderScroll.consumeRestoreState.mockReturnValue({
      permitted: true,
      scrollTop: 900,
      activeItemKey: 'Docs::z.txt',
    });

    const view = await mountFolder();

    expect(view.keyboardActiveItemKey).toBe('Docs::report.pdf');
  });
});

describe('coming back to a folder', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt'), file('b.txt'), file('c.txt')];
  });

  it('puts the keyboard back on the item it was left on', async () => {
    stores.folderScroll.consumeRestoreState.mockReturnValue({
      permitted: true,
      scrollTop: 0,
      activeItemKey: 'Docs::b.txt',
    });

    const view = await mountFolder();

    expect(view.keyboardActiveItemKey).toBe('Docs::b.txt');
    expect(selectedNames()).toEqual(['b.txt']);
  });

  it('ignores a remembered item the folder no longer holds', async () => {
    stores.folderScroll.consumeRestoreState.mockReturnValue({
      permitted: true,
      scrollTop: 0,
      activeItemKey: 'Docs::deleted.txt',
    });

    const view = await mountFolder();

    expect(view.keyboardActiveItemKey).toBe('');
  });

  it('restores nothing when the store says this arrival is not a return', async () => {
    stores.folderScroll.consumeRestoreState.mockReturnValue({
      permitted: false,
      scrollTop: 400,
      activeItemKey: 'Docs::b.txt',
    });

    const view = await mountFolder();

    expect(view.keyboardActiveItemKey).toBe('');
  });

  /**
   * A listing that can scroll, which jsdom will not give anybody for free.
   *
   * Everything about remembering a place turns on whether there is a place to
   * remember, and the component decides that by asking the container whether it
   * scrolls. Under jsdom nothing has a size, so the answer is always no — which
   * is a real case, and the one that caused the defect, but it makes the other
   * case untestable unless the sizes are put there by hand.
   */
  const listingThatScrolls = (scrollTop) => {
    const listing = wrapper.find('.upload-drop-target').element;
    Object.defineProperty(listing, 'scrollHeight', { value: 4000, configurable: true });
    Object.defineProperty(listing, 'clientHeight', { value: 800, configurable: true });
    listing.scrollTop = scrollTop;
    return listing;
  };

  /**
   * The keyed router view unmounts this component on a folder change, but the
   * guard runs first — before a view transition can reset the scroll container.
   */
  it('writes down where it was before the route moves on', async () => {
    await mountFolder();
    listingThatScrolls(1355);
    stores.folderScroll.remember.mockClear();

    routeLeaveGuards.forEach((guard) => guard());

    expect(stores.folderScroll.remember).toHaveBeenCalledWith('Docs::list', 1355);
  });

  it('writes it down on the way out too', async () => {
    await mountFolder();
    listingThatScrolls(1355);
    stores.folderScroll.remember.mockClear();

    wrapper.unmount();
    wrapper = null;

    expect(stores.folderScroll.remember).toHaveBeenCalledWith('Docs::list', 1355);
  });

  /**
   * And writes nothing at all once there is nothing that scrolls.
   *
   * This is the defect, and its symptom was the odd one: the listing is taken off
   * screen before the last scroll events stop arriving, the fallback behind it is
   * the page, and the page never scrolls — so zero was written over a position
   * hundreds of pixels down. Coming back, the file the reader had chosen was
   * still chosen, because that is remembered separately, while the folder sat at
   * the top under it.
   */
  it('writes nothing over it once the listing has gone', async () => {
    await mountFolder();
    listingThatScrolls(1355);
    routeLeaveGuards.forEach((guard) => guard());
    stores.folderScroll.remember.mockClear();

    // Nothing that scrolls any more: the listing is on its way off the screen.
    wrapper.unmount();
    wrapper = null;

    expect(stores.folderScroll.remember).not.toHaveBeenCalled();
  });
});

/**
 * The keyboard belongs to the pane the reader is in.
 *
 * Every listing listens to the *window* for its keys, because a folder has no
 * focus of its own to hang them on. With two panes that is two listeners, and both
 * of them acted: pressing Enter in the half the reader was in opened the file
 * chosen in the half they were not — measured in a browser, the reader's own half
 * became an editor on the neighbour's file.
 */
/**
 * A listing drawn for an address that is not a folder's.
 *
 * A pane can be handed another tab, and that tab may hold a file: for the tick
 * before that tab's own screen replaces this one, this listing's address is the
 * file's. Reading it asks the server to list a file as a folder — `ENOTDIR: not a
 * directory`, a 500, and nothing on screen to explain it.
 */
describe('an address that is not a folder', () => {
  it('reads nothing at all', async () => {
    const route = await shared.make('route');
    route.params.path = 'Docs/notes.ps1';
    addressKind.value = 'editor';

    await mountFolder();

    expect(stores.file.fetchPathItems).not.toHaveBeenCalled();
  });
});

describe('a pane the reader is not in', () => {
  const pressIn = async (key) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await flushPromises();
  };

  beforeEach(() => {
    stores.file.items = [file('a.txt'), file('b.txt'), file('c.txt')];
  });

  it('does nothing when a key is pressed', async () => {
    appTabs.activeId = 'tab-1';
    appTabs.paneId = 'tab-9';
    const view = await mountFolder();
    stores.file.selectedItems = [file('b.txt')];

    await pressIn('Enter');
    await pressIn('ArrowDown');

    expect(composables.openItem).not.toHaveBeenCalled();
    expect(view.keyboardActiveItemKey).toBe('');
  });

  it('acts when the reader is in it', async () => {
    appTabs.activeId = 'tab-9';
    appTabs.paneId = 'tab-9';
    const view = await mountFolder();
    stores.file.selectedItems = [file('b.txt')];

    await pressIn('Enter');

    expect(composables.openItem).toHaveBeenCalled();
    expect(view).toBeTruthy();
  });
});

describe('what an empty folder says', () => {
  it('says it is empty once it is known to be', async () => {
    const view = await mountFolder();

    expect(view.showEmptyFolderMessage).toBe(true);
  });

  /** Before the listing arrives, empty is not yet an answer. */
  it('says nothing while it is still loading', async () => {
    stores.file.fetchPathItems.mockImplementationOnce(() => new Promise(() => {}));
    wrapper = mount(FolderView, {
      global: {
        plugins: [i18n],
        stubs: { FileObject: { template: '<div />' }, LoadingIcon: true },
      },
    });

    expect(wrapper.vm.showEmptyFolderMessage).toBe(false);
  });

  it('says a folder of documents holds no photos, in the photo view', async () => {
    stores.settings.view = 'photos';
    stores.file.items = [file('notes.txt'), file('sheet.csv')];

    const view = await mountFolder();

    expect(view.showNoPhotosMessage).toBe(true);
  });

  it('says nothing of the sort when one of them is an image', async () => {
    stores.settings.view = 'photos';
    stores.file.items = [file('notes.txt'), file('holiday.jpg', { kind: 'jpg' })];

    const view = await mountFolder();

    expect(view.showNoPhotosMessage).toBe(false);
  });

  /** Before the listing arrives, "no photos here" is a guess, not an answer. */
  it('says nothing about photos while it is still loading', async () => {
    stores.settings.view = 'photos';
    stores.file.items = [file('notes.txt')];
    stores.file.fetchPathItems.mockImplementationOnce(() => new Promise(() => {}));
    wrapper = mount(FolderView, {
      global: {
        plugins: [i18n],
        stubs: { FileObject: { template: '<div />' }, LoadingIcon: true },
      },
    });

    expect(wrapper.vm.showNoPhotosMessage).toBe(false);
  });

  it('says nothing of the sort in any other view', async () => {
    stores.settings.view = 'list';
    stores.file.items = [file('notes.txt')];

    const view = await mountFolder();

    expect(view.showNoPhotosMessage).toBe(false);
  });
});

describe('sorting the list', () => {
  it('turns the order around when the same column is asked for again', async () => {
    stores.settings.sortBy = { by: 'name', order: 'asc' };
    const view = await mountFolder();

    view.toggleSort('name');

    expect(stores.settings.setSort).toHaveBeenCalledWith('name', 'desc');
  });

  /** Newest first, biggest first: the useful end of a date or a size. */
  it('starts a new column at the end that column is usually read from', async () => {
    stores.settings.sortBy = { by: 'name', order: 'asc' };
    const view = await mountFolder();

    view.toggleSort('size', 'desc');

    expect(stores.settings.setSort).toHaveBeenCalledWith('size', 'desc');
  });

  it('marks only the column actually sorted on', async () => {
    stores.settings.sortBy = { by: 'size', order: 'desc' };
    const view = await mountFolder();

    expect(view.sortIndicator('size')).toBe('desc');
    expect(view.sortIndicator('name')).toBeNull();
  });
});

describe('selecting everything', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt'), file('b.txt')];
  });

  it('selects every item when none of them were', async () => {
    const view = await mountFolder();

    view.toggleSelectAll();

    expect(selectedNames()).toEqual(['a.txt', 'b.txt']);
  });

  it('clears the selection when they all were', async () => {
    stores.file.selectedItems = [...stores.file.items];
    const view = await mountFolder();

    view.toggleSelectAll();

    expect(composables.clearSelection).toHaveBeenCalled();
  });

  it('knows when only some of them are', async () => {
    stores.file.selectedItems = [stores.file.items[0]];
    const view = await mountFolder();

    expect(view.someItemsSelected).toBe(true);
    expect(view.allItemsSelected).toBe(false);
  });

  it('calls an empty folder neither all nor partly selected', async () => {
    stores.file.items = [];
    const view = await mountFolder();

    expect(view.someItemsSelected).toBe(false);
    expect(view.allItemsSelected).toBe(false);
  });
});

describe('walking the folder with the arrow keys', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt'), file('b.txt'), folder('sub')];
  });

  it('starts at the first item', async () => {
    const view = await mountFolder();

    await press('ArrowDown');

    expect(view.keyboardActiveItemKey).toBe('Docs::a.txt');
  });

  it('carries on from where it is', async () => {
    const view = await mountFolder();

    await press('ArrowDown');
    await press('ArrowDown');

    expect(view.keyboardActiveItemKey).toBe('Docs::b.txt');
  });

  it('goes back up again', async () => {
    const view = await mountFolder();
    await press('ArrowDown');
    await press('ArrowDown');

    await press('ArrowUp');

    expect(view.keyboardActiveItemKey).toBe('Docs::a.txt');
  });

  /**
   * Moving the ring is not selecting: somebody arrowing through a folder to
   * find something has not asked to act on everything they passed.
   */
  it('moves the ring without selecting anything', async () => {
    await mountFolder();

    await press('ArrowDown');

    expect(selectedNames()).toEqual([]);
    expect(stores.file.setKeyboardActionItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a.txt' })
    );
  });

  it('selects a run of items when the shift key is held', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press('ArrowDown', { shiftKey: true });

    expect(selectedNames()).toEqual(['a.txt', 'b.txt']);
  });

  it('grows that run rather than starting a new one', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press('ArrowDown', { shiftKey: true });
    await press('ArrowDown', { shiftKey: true });

    expect(selectedNames()).toEqual(['a.txt', 'b.txt', 'sub']);
  });

  it('shrinks it again on the way back', async () => {
    await mountFolder();
    await press('ArrowDown');
    await press('ArrowDown', { shiftKey: true });
    await press('ArrowDown', { shiftKey: true });

    await press('ArrowUp', { shiftKey: true });

    expect(selectedNames()).toEqual(['a.txt', 'b.txt']);
  });

  it('adds the item under the ring to the selection on the space bar', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press(' ');

    expect(composables.toggleSelection).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a.txt' })
    );
  });

  it('does nothing in an empty folder', async () => {
    stores.file.items = [];
    const view = await mountFolder();

    await press('ArrowDown');
    await press(' ');

    expect(view.keyboardActiveItemKey).toBe('');
  });
});

describe('opening and leaving with the keyboard', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt'), folder('sub')];
  });

  /**
   * One rule everywhere: command, or control, turns *opening* into opening in a
   * tab behind. Here it rides the key that opens, because on a row the same
   * modifier with a click already means "and this one too".
   */
  it('opens in a tab behind when command is held', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press('Enter', { metaKey: true });

    expect(composables.openItemInTab).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a.txt' }),
      'Docs'
    );
    expect(composables.openItem).not.toHaveBeenCalled();
  });

  it('does the same on control, for everyone else', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press('Enter', { ctrlKey: true });

    expect(composables.openItemInTab).toHaveBeenCalled();
    expect(composables.openItem).not.toHaveBeenCalled();
  });

  /** Nowhere of its own, or tabs off: the modifier changes nothing. */
  it('opens the ordinary way when there is no tab to open it in', async () => {
    composables.openItemInTab.mockReturnValue(false);
    await mountFolder();
    await press('ArrowDown');

    await press('Enter', { metaKey: true });

    expect(composables.openItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt' }));
  });

  it('opens what the ring is on', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press('Enter');

    expect(composables.openItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.txt' }));
  });

  it('opens the one thing that is selected when the ring is nowhere', async () => {
    stores.file.selectedItems = [stores.file.items[1]];
    await mountFolder();

    await press('Enter');

    expect(composables.openItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'sub' }));
  });

  /** With several selected, the last one touched is the one Enter means. */
  it('opens the last of several selected things', async () => {
    stores.file.selectedItems = [...stores.file.items];
    await mountFolder();

    await press('Enter');

    expect(composables.openItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'sub' }));
  });

  it('opens nothing at all when nothing is selected and the ring is nowhere', async () => {
    await mountFolder();

    await press('Enter');

    expect(composables.openItem).not.toHaveBeenCalled();
  });

  /** Right enters a folder, the way a tree does; on a file it means nothing. */
  it('enters a folder on the right arrow', async () => {
    await mountFolder();
    await press('ArrowDown');
    await press('ArrowDown');

    await press('ArrowRight');

    expect(composables.openItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'sub' }));
  });

  /** Right on a file has nothing to enter, so it does nothing. */
  it('does not open a file on the right arrow', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press('ArrowRight');

    expect(composables.openItem).not.toHaveBeenCalled();
  });

  it('leaves the folder on the left arrow', async () => {
    await mountFolder();
    await press('ArrowDown');

    await press('ArrowLeft');

    expect(composables.goUp).toHaveBeenCalled();
  });

  it('goes up on backspace', async () => {
    await mountFolder();

    await press('Backspace');

    expect(composables.goUp).toHaveBeenCalled();
  });

  it('walks the history with the alt key', async () => {
    await mountFolder();

    await press('ArrowLeft', { altKey: true });
    await press('ArrowRight', { altKey: true });
    await press('ArrowUp', { altKey: true });

    expect(composables.goPrev).toHaveBeenCalled();
    expect(composables.goNext).toHaveBeenCalled();
    expect(composables.goUp).toHaveBeenCalled();
  });
});

describe('typing a name to jump to it', () => {
  beforeEach(() => {
    stores.file.items = [file('apple.txt'), file('banana.txt'), file('blueberry.txt')];
  });

  it('lands on the first item that starts with what was typed', async () => {
    await mountFolder();

    await press('b');

    expect(selectedNames()).toEqual(['banana.txt']);
  });

  it('narrows as more letters arrive', async () => {
    await mountFolder();

    await press('b');
    await press('l');

    expect(selectedNames()).toEqual(['blueberry.txt']);
  });

  it('ignores a letter typed with a modifier, which is a shortcut', async () => {
    await mountFolder();

    await press('b', { ctrlKey: true });

    expect(selectedNames()).toEqual([]);
  });

  it('says nothing about a folder holding no such name', async () => {
    await mountFolder();

    await press('z');

    expect(selectedNames()).toEqual([]);
  });
});

describe('when the keyboard belongs to something else', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt'), file('b.txt')];
  });

  it('leaves the folder alone while a name is being edited', async () => {
    const view = await mountFolder();
    stores.file.renameState = { name: 'a.txt' };

    await press('ArrowDown');

    expect(view.keyboardActiveItemKey).toBe('');
  });

  it('leaves it alone while a deletion is being confirmed', async () => {
    const view = await mountFolder();
    composables.isDeleteConfirmOpen.value = true;

    await press('ArrowDown');

    expect(view.keyboardActiveItemKey).toBe('');
  });

  it('leaves it alone while somebody is typing in a field', async () => {
    const view = await mountFolder();
    composables.isEditableElement.mockReturnValue(true);

    await press('ArrowDown');

    expect(view.keyboardActiveItemKey).toBe('');
  });

  it('leaves it alone when something else already answered the key', async () => {
    const view = await mountFolder();

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    await flushPromises();

    expect(view.keyboardActiveItemKey).toBe('');
  });
});

describe('fetching thumbnails while nothing else is happening', () => {
  const thumbnailable = (name) => file(name, { supportsThumbnail: true });

  /** Mounted, then the clock taken over, so only what a test asks for fires. */
  const withFakeClock = async (items) => {
    stores.file.items = items;
    const view = await mountFolder();
    vi.useFakeTimers();
    return view;
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for one that could have a thumbnail and has none yet', async () => {
    const view = await withFakeClock([thumbnailable('photo.jpg')]);

    view.scheduleIdleThumbnailPrefetch(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(stores.file.prefetchItemThumbnail).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'photo.jpg' })
    );
  });

  it('passes over folders, and files that cannot have one', async () => {
    const view = await withFakeClock([folder('sub'), file('notes.txt')]);

    view.scheduleIdleThumbnailPrefetch(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(stores.file.prefetchItemThumbnail).not.toHaveBeenCalled();
  });

  it('passes over one the server already said it has no thumbnail for', async () => {
    const view = await withFakeClock([
      file('broken.jpg', { supportsThumbnail: true, thumbnailUnavailable: true }),
    ]);

    view.scheduleIdleThumbnailPrefetch(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(stores.file.prefetchItemThumbnail).not.toHaveBeenCalled();
  });

  it('works down the list rather than asking for the same one again', async () => {
    const view = await withFakeClock([thumbnailable('one.jpg'), thumbnailable('two.jpg')]);

    view.scheduleIdleThumbnailPrefetch(0);
    await vi.advanceTimersByTimeAsync(3000);

    expect(stores.file.prefetchItemThumbnail.mock.calls.map(([item]) => item.name)).toEqual([
      'one.jpg',
      'two.jpg',
    ]);
  });

  /** Idle work waits: a copy or a move is what the person is actually waiting on. */
  it('holds off while a file operation is running', async () => {
    const view = await withFakeClock([thumbnailable('photo.jpg')]);
    stores.operationTasks.operationCount = 1;

    view.scheduleIdleThumbnailPrefetch(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(stores.file.prefetchItemThumbnail).not.toHaveBeenCalled();
  });

  it('stops the moment one starts', async () => {
    const view = await withFakeClock([thumbnailable('photo.jpg')]);
    view.scheduleIdleThumbnailPrefetch(50);

    stores.operationTasks.operationCount = 1;
    await vi.advanceTimersByTimeAsync(100);

    expect(stores.file.prefetchItemThumbnail).not.toHaveBeenCalled();
  });

  /**
   * Idle work has an end: past a couple of dozen the reader has moved on, and
   * a thousand-file folder would otherwise fetch all night.
   */
  it('stops after a couple of dozen', async () => {
    const view = await withFakeClock(
      Array.from({ length: 40 }, (_, index) => thumbnailable(`photo${index}.jpg`))
    );

    view.scheduleIdleThumbnailPrefetch(0);
    await vi.advanceTimersByTimeAsync(200000);

    expect(stores.file.prefetchItemThumbnail).toHaveBeenCalledTimes(24);
  });

  it('holds off while the tab is out of sight', async () => {
    const view = await withFakeClock([thumbnailable('photo.jpg')]);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });

    view.scheduleIdleThumbnailPrefetch(0);
    await vi.advanceTimersByTimeAsync(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });

    expect(stores.file.prefetchItemThumbnail).not.toHaveBeenCalled();
  });

  /** Even one already waiting: the tab can go away between the two moments. */
  it('drops the one it had queued when the tab goes away first', async () => {
    const view = await withFakeClock([thumbnailable('photo.jpg')]);
    view.scheduleIdleThumbnailPrefetch(50);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await vi.advanceTimersByTimeAsync(100);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });

    expect(stores.file.prefetchItemThumbnail).not.toHaveBeenCalled();
  });
});

describe('the size of the folders on screen', () => {
  beforeEach(() => {
    stores.file.items = [folder('Photos'), file('notes.txt'), folder('Music')];
  });

  it('is asked for in one request, for the folders only', async () => {
    await mountFolder();

    expect(stores.folderSize.ensureSizes).toHaveBeenCalledWith(['Docs/Photos', 'Docs/Music']);
  });

  it('is not asked for at all when the feature is off', async () => {
    stores.features.folderSizeEnabled = false;

    await mountFolder();

    expect(stores.folderSize.ensureSizes).not.toHaveBeenCalled();
  });

  it('is not asked for in a folder holding no folders', async () => {
    stores.file.items = [file('notes.txt')];

    await mountFolder();

    expect(stores.folderSize.ensureSizes).not.toHaveBeenCalled();
  });

  /**
   * Serving the listing also asks the server to re-check these folders in the
   * background, so one follow-up surfaces what that found.
   */
  it('is asked for again shortly after, once the server has caught up', async () => {
    await mountFolder();
    vi.useFakeTimers();
    // The clock is taken over first, then the listing changes, so the
    // follow-up this schedules is one the test can advance to.
    stores.file.items = [folder('Photos')];
    await vi.advanceTimersByTimeAsync(0);
    stores.folderSize.scheduleRefresh.mockClear();

    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();

    expect(stores.folderSize.scheduleRefresh).toHaveBeenCalled();
  });
});

describe('coming back to the tab', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt')];
  });

  const returnToTab = async () => {
    window.dispatchEvent(new Event('focus'));
    await flushPromises();
  };

  it('re-reads the listing, in case somebody else changed it', async () => {
    await mountFolder();
    stores.file.fetchPathItems.mockClear();

    await returnToTab();

    expect(stores.file.fetchPathItems).toHaveBeenCalledWith('Docs');
  });

  it('re-reads what the volume and the folders now weigh', async () => {
    await mountFolder();
    stores.folderSize.scheduleRefresh.mockClear();
    stores.volumeUsage.scheduleRefresh.mockClear();

    await returnToTab();

    expect(stores.folderSize.scheduleRefresh).toHaveBeenCalled();
    expect(stores.volumeUsage.scheduleRefresh).toHaveBeenCalled();
  });

  it('leaves each of those to the feature that owns it', async () => {
    stores.features.folderSizeEnabled = false;
    stores.features.volumeUsageEnabled = false;
    await mountFolder();
    stores.folderSize.scheduleRefresh.mockClear();
    stores.volumeUsage.scheduleRefresh.mockClear();

    await returnToTab();

    expect(stores.folderSize.scheduleRefresh).not.toHaveBeenCalled();
    expect(stores.volumeUsage.scheduleRefresh).not.toHaveBeenCalled();
  });

  /** Two windows regaining focus in the same second are one return. */
  it('does not re-read the listing twice in a moment', async () => {
    await mountFolder();
    stores.file.fetchPathItems.mockClear();

    await returnToTab();
    await returnToTab();

    expect(stores.file.fetchPathItems).toHaveBeenCalledTimes(1);
  });

  it('does not re-read it while the tab is still out of sight', async () => {
    await mountFolder();
    stores.file.fetchPathItems.mockClear();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });

    await returnToTab();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });

    expect(stores.file.fetchPathItems).not.toHaveBeenCalled();
  });
});

describe('dragging the column edges in the detail view', () => {
  const drag = async (view, columnIndex, from, to) => {
    view.startResize(columnIndex, { button: 0, clientX: from });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: to }));
    await flushPromises();
  };

  it('widens the column by however far the pointer went', async () => {
    const view = await mountFolder();

    await drag(view, 1, 100, 160);

    expect(stores.settings.setListViewColumnWidth).toHaveBeenCalledWith(1, 260);
  });

  it('narrows it going the other way', async () => {
    const view = await mountFolder();

    await drag(view, 1, 100, 60);

    expect(stores.settings.setListViewColumnWidth).toHaveBeenCalledWith(1, 160);
  });

  it('stops when the pointer is let go', async () => {
    const view = await mountFolder();
    await drag(view, 1, 100, 160);
    stores.settings.setListViewColumnWidth.mockClear();

    window.dispatchEvent(new MouseEvent('pointerup'));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
    await flushPromises();

    expect(stores.settings.setListViewColumnWidth).not.toHaveBeenCalled();
  });

  it('ignores anything but the left button', async () => {
    const view = await mountFolder();

    view.startResize(1, { button: 2, clientX: 100 });
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
    await flushPromises();

    expect(stores.settings.setListViewColumnWidth).not.toHaveBeenCalled();
  });

  it('ignores a column with no width to start from', async () => {
    stores.settings.listViewColumnWidths = [];
    const view = await mountFolder();

    await drag(view, 1, 100, 160);

    expect(stores.settings.setListViewColumnWidth).not.toHaveBeenCalled();
  });

  /** A drag left hanging would keep the whole page unselectable. */
  it('gives the page back its cursor and its text selection', async () => {
    const view = await mountFolder();
    await drag(view, 1, 100, 160);
    expect(document.body.style.cursor).toBe('col-resize');

    window.dispatchEvent(new MouseEvent('pointerup'));
    await flushPromises();

    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});

describe('the folder itself as a drop target', () => {
  it('offers the current folder as the destination', async () => {
    const view = await mountFolder();
    const event = new Event('dragover');

    view.handleCurrentFolderDragOver(event);

    expect(composables.handleDragOver).toHaveBeenCalledWith(event, {
      destinationPath: 'Docs',
      kind: 'directory',
    });
  });

  it('drops onto it', async () => {
    const view = await mountFolder();
    const event = new Event('drop');

    view.handleCurrentFolderDrop(event);

    expect(composables.handleDrop).toHaveBeenCalledWith(event, {
      destinationPath: 'Docs',
      kind: 'directory',
    });
  });

  it('stops offering it when the pointer leaves', async () => {
    const view = await mountFolder();
    const event = new Event('dragleave');

    view.handleCurrentFolderDragLeave(event);

    expect(composables.handleDragLeave).toHaveBeenCalledWith(event, {
      destinationPath: 'Docs',
      kind: 'directory',
    });
  });

  it('opens the folder"s own menu on a right click on the background', async () => {
    const view = await mountFolder();
    const event = new Event('contextmenu');

    view.handleBackgroundContextMenu(event);

    expect(composables.openBackgroundMenu).toHaveBeenCalledWith(event);
  });
});

describe('a folder too big to draw at once', () => {
  const many = (count) => Array.from({ length: count }, (_, index) => file(`f${index}.txt`));

  it('draws the first five hundred and says there are more', async () => {
    stores.file.items = many(1200);
    stores.settings.view = 'photos';

    const view = await mountFolder();

    expect(view.hasMoreItems).toBe(true);
    expect(view.visibleItems).toHaveLength(500);
  });

  it('draws five hundred more when asked', async () => {
    stores.file.items = many(1200);
    stores.settings.view = 'photos';
    const view = await mountFolder();

    view.revealMoreItems();
    await flushPromises();

    expect(view.visibleItems).toHaveLength(1000);
  });

  it('stops at the end rather than past it', async () => {
    stores.file.items = many(600);
    stores.settings.view = 'photos';
    const view = await mountFolder();

    view.revealMoreItems();
    await flushPromises();

    expect(view.visibleItems).toHaveLength(600);
    expect(view.hasMoreItems).toBe(false);
  });

  it('starts over at five hundred when the folder changes', async () => {
    stores.file.items = many(1200);
    stores.settings.view = 'photos';
    const view = await mountFolder();
    view.revealMoreItems();
    await flushPromises();

    routeState().params = { path: 'Other' };
    await flushPromises();

    expect(view.visibleItems).toHaveLength(500);
  });
});

/**
 * Coming back to a folder tab that another one was in front of.
 *
 * The tab already holds its listing, its selection and the rename it was in the
 * middle of — that is what `stores/files/folderTab.js` is for — so reading the
 * folder again from the server throws all of it away and lands the reader at the
 * top of something they had scrolled. Which is what it did.
 */
describe('a folder tab coming back', () => {
  beforeEach(() => {
    stores.file.items = [file('a.txt'), file('b.txt')];
    stores.file.currentPath = 'Docs';
    appTabs.takeBroughtForward.mockReturnValue(true);
  });

  it('shows what the tab was holding without reading the folder again', async () => {
    await mountFolder();

    expect(stores.file.fetchPathItems).not.toHaveBeenCalledWith('Docs');
  });

  /**
   * And it asks about its *own* tab.
   *
   * A pane beside the reader draws a tab that does not have focus, so a view
   * that asked "was the tab in front just brought forward" asked about somebody
   * else's tab — and would have thrown away the listing of a pane nobody had
   * touched, or kept a stale one for the pane they had.
   */
  it('asks about its own pane tab, not the one in front', async () => {
    appTabs.paneId = 'tab-beside';

    await mountFolder();

    expect(appTabs.takeBroughtForward).toHaveBeenCalledWith('tab-beside');
    expect(appTabs.takeBroughtForward).not.toHaveBeenCalledWith('tab-1');
  });

  it('asks for it again quietly, under whatever was on screen', async () => {
    await mountFolder();

    // Quietly: the listing is replaced under the selection rather than clearing
    // it, and nothing about it moves the reader.
    expect(stores.file.fetchPathItems).toHaveBeenCalledWith('Docs', { preserveInteraction: true });
  });

  /**
   * The folder's own memory answers when the tab's does not.
   *
   * Two memories, one question. The tab's is the precise one — two tabs on one
   * folder can be in different places in it — but the folder's is the one that has
   * been putting readers back where they were since long before tabs existed, and
   * it is what a walk back up the path reads. A tab that never left the folder has
   * the same answer under both, so asking the second costs nothing; and when the
   * first is missing, the reader lands where they were instead of at the top,
   * which is what they were told would happen.
   */
  it('falls back to where the folder was when the tab has no place of its own', async () => {
    stores.folderScroll.tabPlace.mockReturnValue(0);
    stores.folderScroll.get = vi.fn(() => 540);

    await mountFolder();

    expect(stores.folderScroll.get).toHaveBeenCalledWith('Docs::list');
  });

  it('prefers the tab’s own place when there is one', async () => {
    stores.folderScroll.hasTabPlace.mockReturnValue(true);
    stores.folderScroll.tabPlace.mockReturnValue(120);
    stores.folderScroll.get = vi.fn(() => 540);

    await mountFolder();

    expect(stores.folderScroll.tabPlace).toHaveBeenCalledWith('tab-1::Docs::list');
    expect(stores.folderScroll.get).not.toHaveBeenCalledWith('Docs::list');
  });

  /**
   * And the top is one of those places.
   *
   * Asked as a number, a tab sitting at the top answers zero — which reads as no
   * answer, and the folder's own memory was taken instead. That memory is shared by
   * every tab on the folder: three tabs on one, one of them scrolled to the bottom
   * to open a document there, and the other two came back down beside it, hundreds
   * of pixels from where their own readers had left them.
   */
  it('comes back to the top when that is where the tab was', async () => {
    stores.folderScroll.hasTabPlace.mockReturnValue(true);
    stores.folderScroll.tabPlace.mockReturnValue(0);
    stores.folderScroll.get = vi.fn(() => 540);

    await mountFolder();

    expect(stores.folderScroll.get).not.toHaveBeenCalledWith('Docs::list');
  });

  /**
   * As it was left, which includes how it was shown.
   *
   * How a folder is shown is its own preference, and walking into another folder
   * applies that folder's to the whole window. A tab left in the list view and
   * come back to while the window is in the grid came back in the grid — and asked
   * the wrong question about where the reader was, because the position is
   * remembered per view: the same folder is a different height in each. It found an
   * older position under the other view's key and put the reader two hundred pixels
   * down a folder they had left four thousand pixels down, with the selection still
   * there, which is exactly how it was reported.
   */
  it('comes back shown the way this folder is shown', async () => {
    await mountFolder();

    expect(stores.settings.restoreFolderPreferences).toHaveBeenCalledWith('Docs');
  });

  it('asks where the reader was under the view it is now in', async () => {
    stores.settings.restoreFolderPreferences = vi.fn(() => {
      // As the real one does when this folder's own preference is the grid.
      stores.settings.view = 'grid';
    });
    stores.folderScroll.hasTabPlace.mockReturnValue(true);
    stores.folderScroll.tabPlace.mockReturnValue(540);

    await mountFolder();

    expect(stores.folderScroll.tabPlace).toHaveBeenCalledWith('tab-1::Docs::grid');
  });

  it('puts the tab back where it was in the folder', async () => {
    stores.folderScroll.hasTabPlace.mockReturnValue(true);
    stores.folderScroll.tabPlace.mockReturnValue(540);

    await mountFolder();

    expect(stores.folderScroll.tabPlace).toHaveBeenCalledWith('tab-1::Docs::list');
  });

  /**
   * Never from the page behind the listing.
   *
   * On the way out the listing can already be gone, and the page behind it is
   * always at the top — so where this tab was, hundreds of pixels down, was
   * overwritten with zero a moment before anybody could come back to it. Here
   * there is no layout at all, so the listing is never the thing that scrolls,
   * which is exactly the case being asked about; that it *is* remembered, and put
   * back, is asked in a browser, where scrolling exists.
   */
  it('remembers nothing for the tab from the page behind the listing', async () => {
    await mountFolder();

    expect(stores.folderScroll.rememberTabPlace).not.toHaveBeenCalled();
  });

  /**
   * Nothing at all once another tab is in front.
   *
   * This is the one that was reported, and it is a measurement of somebody else's
   * folder. The listing draws the folder of whichever tab is in front, so the
   * instant that is another tab it is drawing a handful of rows where there were
   * twelve hundred — the container becomes shorter than the position it was
   * holding, the browser clamps the position, and the clamp arrives as an ordinary
   * scroll event. Two hundred pixels was written over four thousand, a moment
   * before anybody could come back to it. Only long folders lost anything, because
   * a short one has no position to lose; the selection survived, because a
   * selection is not a measurement of a container that had just been emptied.
   */
  it('writes nothing once another tab is the one in front', async () => {
    await mountFolder();
    const listing = wrapper.find('.upload-drop-target').element;
    Object.defineProperty(listing, 'scrollHeight', { value: 4000, configurable: true });
    Object.defineProperty(listing, 'clientHeight', { value: 800, configurable: true });
    listing.scrollTop = 4000;
    stores.folderScroll.remember.mockClear();
    stores.folderScroll.rememberTabPlace.mockClear();

    // Another tab comes forward, and the listing is clamped to what is left.
    appTabs.activeId = 'tab-9';
    appTabs.panes = ['tab-9'];
    listing.scrollTop = 212;
    listing.dispatchEvent(new Event('scroll'));
    await flushPromises();
    routeLeaveGuards.forEach((guard) => guard());

    expect(stores.folderScroll.remember).not.toHaveBeenCalled();
    expect(stores.folderScroll.rememberTabPlace).not.toHaveBeenCalled();
  });

  /**
   * And nothing for the folder either, which is the same defect in the other
   * half of the same function and the one that was reported.
   *
   * Coming back, the file the reader had chosen was still chosen — that is
   * remembered separately, and was never the thing at fault — while the folder
   * sat at the top under it. The zero came from the page behind a listing that
   * had already gone, written over a position hundreds of pixels down a moment
   * before anybody could come back to it.
   */
  it('remembers nothing for the folder from it either', async () => {
    await mountFolder();
    wrapper.unmount();
    wrapper = null;

    expect(stores.folderScroll.remember).not.toHaveBeenCalled();
  });

  /**
   * But the half beside the reader writes down where it is, because it is on screen.
   *
   * The question this guard asks had been "is my tab the one in front", which is
   * the same question as "am I on screen" only while there is one pane. In a pair
   * the half the reader is not in never wrote down anything — so coming back to the
   * pair it had no place of its own and fell back to the folder's, which is shared
   * by every tab on that folder: it landed where another tab had been left, several
   * hundred pixels from where its own reader had left it.
   */
  it('writes down where the half beside the reader is', async () => {
    appTabs.paneId = 'tab-9';
    appTabs.panes = ['tab-1', 'tab-9'];
    await mountFolder();
    const listing = wrapper.find('.upload-drop-target').element;
    Object.defineProperty(listing, 'scrollHeight', { value: 4000, configurable: true });
    Object.defineProperty(listing, 'clientHeight', { value: 800, configurable: true });
    stores.folderScroll.remember.mockClear();
    stores.folderScroll.rememberTabPlace.mockClear();

    listing.scrollTop = 1355;
    listing.dispatchEvent(new Event('scroll'));
    await flushPromises();

    // Its own place above all, which is what makes two tabs on one folder two
    // places; the folder's own is written as well, as it always was.
    // With the row that was at the top of it, which jsdom lays out nowhere — so
    // there is none to name here. That it is the row rather than the number that
    // puts a reader back is asked in a browser, where a listing has a height.
    expect(stores.folderScroll.rememberTabPlace).toHaveBeenCalledWith(
      'tab-9::Docs::list',
      1355,
      ''
    );
    expect(stores.folderScroll.remember).toHaveBeenCalledWith('Docs::list', 1355);
  });

  /**
   * A folder that is not yet as tall as it will be.
   *
   * This is the case the whole thing exists for and the one that is invisible in
   * a browser test, because there it either happens or it does not depending on
   * the machine. A long list is drawn a screenful at a time: on the frame the tab
   * asks to be put back, the container is barely a screen tall, and a position it
   * cannot hold is a position the browser turns into the top. So the height is
   * made to grow here, frame by frame, the way it does on a slow render — and
   * what is asked is that the answer is still reached.
   *
   * It also holds the thing that went wrong in the first attempt at this: the fix
   * watched whether the position moved between two frames and gave up when it
   * did, reading a virtual list redrawing itself as a hand on the wheel.
   */
  it('keeps asking until a list long enough to hold the place has drawn itself', async () => {
    stores.folderScroll.hasTabPlace.mockReturnValue(true);
    stores.folderScroll.tabPlace.mockReturnValue(900);

    await mountFolder();
    const listing = wrapper.find('.upload-drop-target').element;

    // A container that cannot scroll at all to begin with, as a list that has
    // drawn one screenful of two thousand rows cannot.
    let height = 500;
    Object.defineProperty(listing, 'scrollHeight', { get: () => height });
    Object.defineProperty(listing, 'clientHeight', { get: () => 500 });
    // And a scrollTop the browser clamps to what the container can hold, which
    // is what makes the first few attempts land on nothing.
    let placed = 0;
    Object.defineProperty(listing, 'scrollTop', {
      get: () => placed,
      set: (value) => {
        placed = Math.min(value, Math.max(0, height - 500));
      },
    });

    // Several frames of drawing before it is tall enough, which is longer than
    // the two the first version of this allowed for — and one frame where it
    // gets *shorter*, which is what a windowed list does when it swaps the rows
    // on screen and recomputes the space above and below them. The browser
    // clamps the position when that happens, and the first attempt at this read
    // the clamp as a hand on the wheel and gave up.
    for (const step of [400, 400, -600, 400, 400, 400, 400, 400]) {
      height = Math.max(500, height + step);
      placed = Math.min(placed, Math.max(0, height - 500));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await flushPromises();
    }

    expect(placed).toBe(900);
  });

  /**
   * A tab brought forward before it ever listed anything has nothing to come
   * back to, so it reads the folder like any first arrival.
   */
  it('reads the folder when the tab has nothing in hand', async () => {
    stores.file.items = [];

    await mountFolder();

    expect(stores.file.fetchPathItems).toHaveBeenCalledWith('Docs');
  });

  /** Walking into a folder is not coming back to one, whatever the store holds. */
  it('reads the folder when no tab was brought forward', async () => {
    appTabs.takeBroughtForward.mockReturnValue(false);

    await mountFolder();

    expect(stores.file.fetchPathItems).toHaveBeenCalledWith('Docs');
  });
});
