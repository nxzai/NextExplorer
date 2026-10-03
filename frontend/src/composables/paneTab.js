import { computed, inject, provide, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTabsStore } from '@/stores/tabs';
import { useFileStore } from '@/stores/fileStore';
import { tabFolderPath } from '@/config/tabKinds';

/**
 * Which tab a pane is drawing.
 *
 * A screen draws a *place*, and in a split view the place it draws is its own
 * pane's tab — not whichever tab happens to have focus. Everything that acts for
 * the *person* keeps reading the store's own surface, which follows the tab in
 * front: the clipboard, the operations, the toolbar's buttons. The line is the
 * same one `files/folderTab.js` already draws, and this is how a component on the
 * far side of it asks which side it is on.
 *
 * Passed down rather than looked up, because a pane cannot be recognised from
 * anywhere else: both panes render the same components, at the same addresses,
 * from the same store.
 */
const PANE_TAB = Symbol('pane-tab-id');

/** Said by whoever draws a pane, once, with a ref so the pane can change tabs. */
export const providePaneTab = (tabId) => {
  provide(
    PANE_TAB,
    computed(() => tabId.value)
  );
};

/**
 * The tab this component belongs to.
 *
 * Falls back to the tab in front, which is what every screen outside a pane
 * wants and what every screen wanted before panes existed: one pane, and it
 * holds the tab in front. So a component may ask without knowing whether
 * anybody is answering.
 */
export const usePaneTabId = () => {
  const provided = inject(PANE_TAB, null);
  const tabsStore = useTabsStore();
  return computed(() => provided?.value || tabsStore.activeId);
};

/**
 * The folder this component's tab is on — its listing, its selection, its
 * rename, its thumbnails.
 *
 * The same object the store reads for the tab in front, so a component that
 * takes this instead of the store's surface behaves identically in a window
 * with one pane, and correctly in a window with two.
 */
export const usePaneFolder = () => {
  const fileStore = useFileStore();
  const tabId = usePaneTabId();
  const folder = computed(() => fileStore.folderFor(tabId.value));
  const tabsStore = useTabsStore();

  /** The address this pane's tab is on, which is what the strip shows for it. */
  const address = computed(() => tabsStore.tabs.find((tab) => tab.id === tabId.value)?.path || '');

  /** One of the folder's own refs, readable and writable through the pane. */
  const asRef = (pick) =>
    computed({
      get: () => pick(folder.value).value,
      set: (value) => {
        pick(folder.value).value = value;
      },
    });

  /**
   * The pane's own folder under the names the store already uses for the one in
   * front, and `reactive` so a ref unwraps on access exactly as a store's does.
   *
   * Which is the point: a screen that read `fileStore.selectedItems` reads
   * `pane.selectedItems` and nothing else about it changes — same shape, same
   * assignment, same template. A facade with different ergonomics would have
   * turned a rename into a rewrite of the largest view in the application, and
   * every `.value` forgotten along the way into a silent no-op.
   */
  const view = reactive({
    currentPath: computed(() => folder.value.path.value),
    currentPathData: computed(() => folder.value.data.value),
    getCurrentPathItems: computed(() => fileStore.arrange(folder.value.items.value)),
    selectedItems: asRef((one) => one.selection.selectedItems),
    selectedItemKeys: computed(() => folder.value.selection.selectedItemKeys.value),
    renameState: asRef((one) => one.rename.renameState),
    setKeyboardActionItem: (...args) => folder.value.selection.setKeyboardActionItem(...args),
    clearKeyboardActionItem: () => folder.value.selection.clearKeyboardActionItem(),
    prefetchItemThumbnail: (...args) => folder.value.thumbnails.prefetchItemThumbnail(...args),
    fetchPathItems: (...args) => folder.value.fetchItems(...args),
  });

  return {
    tabId,
    folder,
    address,
    view,
    /** Where the pane is, as the application names folders: `Docs/2026`. */
    folderPath: computed(() => tabFolderPath({ kind: 'folder', path: address.value })),
    /** Its listing, ordered the way the reader asked for. */
    items: computed(() => fileStore.arrange(folder.value.items.value)),
    /** Whether the reader is in this pane, which is what makes it act. */
    focused: computed(() => tabId.value === tabsStore.activeId),
  };
};

/**
 * The address this component's pane is on, in the shape the router hands over.
 *
 * A screen reads its own place from the router — `route.params.path` is how a
 * folder, an editor and a document all know what they are showing. In a pair
 * only one pane is the route, so the other read the window's address and drew
 * somebody else's place: the editor opened the folder in the pane beside it and
 * said it could not open a directory, and the shell beside a folder drew nothing
 * because the window's address was not a shell's.
 *
 * Shaped like a route and `reactive`, so a screen swaps `useRoute()` for this and
 * nothing else about it changes. Guards and navigation keep using the real
 * router, which is right: only the pane the reader is in is the address.
 */
export const usePaneRoute = () => {
  const provided = inject(PANE_TAB, null);
  const route = useRoute();
  const router = useRouter();
  const tabsStore = useTabsStore();

  const resolved = computed(() => {
    const id = provided?.value;
    const tab = id ? tabsStore.tabs.find((one) => one.id === id) : null;
    // A pane reads its own tab's address — *including* the pane the reader is in.
    //
    // That one used to read the window's, on the grounds that it is the window.
    // It is, once the two agree; bringing a tab forward is two moves and they do
    // not agree in between. The store is told first and the address bar follows,
    // so for one tick the pane that has just come forward is "the tab in front"
    // while the window is still on the address of the tab being left — and every
    // screen in it read the neighbour's place. Measured: crossing from one editor
    // to another made the second read the first one's file, re-read it, and build
    // a new CodeMirror, twice over, which is the editor flashing on every crossing.
    //
    // The other direction needs no care: walking somewhere changes the address,
    // and the tab in front is told in a watcher that runs before anything renders.
    if (!tab?.path) return route;
    try {
      return router.resolve(tab.path);
    } catch (_) {
      // An address no route claims leaves the screen reading the window's, which
      // is what it did before panes existed.
      return route;
    }
  });

  return reactive({
    path: computed(() => resolved.value.path),
    fullPath: computed(() => resolved.value.fullPath),
    params: computed(() => resolved.value.params),
    query: computed(() => resolved.value.query),
    hash: computed(() => resolved.value.hash),
    name: computed(() => resolved.value.name),
    meta: computed(() => resolved.value.meta),
  });
};
