import { defineStore } from 'pinia';
import { computed, watch } from 'vue';
import { normalizePath } from '@/api';
import { useSettingsStore } from '@/stores/settings';
import { useFavoritesStore } from '@/stores/favorites';
import { useVolumeUsageStore } from '@/stores/volumeUsage';
import { useFolderSizeStore } from '@/stores/folderSize';
import { useFeaturesStore } from '@/stores/features';
import { useOperationTasksStore } from '@/stores/operationTasks';
import { useNotificationsStore } from '@/stores/notifications';
import { useTabsStore } from '@/stores/tabs';
import { sortItems } from './files/sorting';
import { createFolderTab } from './files/folderTab';
import {
  createOnlyofficeActivityPolling,
  createOnlyofficeWarning,
} from './files/onlyofficeActivity';
import { createTransfers } from './files/transfers';
import { createOperations } from './files/operations';

/**
 * The folder on screen: what it holds, what is selected in it, and what can be
 * done to it.
 *
 * One folder per tab, and the one in front is what components see. Everything a
 * folder *is* — its listing, its selection, its rename, its thumbnails, its
 * request in flight — lives in `files/folderTab.js`, one instance per tab. What
 * a person *does* stays here and there is one of each: the clipboard, so copying
 * in one tab and pasting in another works, and the operations, which act on
 * whichever folder is in front.
 *
 * The surface below is the one components have always seen. `currentPath` and its
 * neighbours became views of the tab in front rather than values of their own,
 * which is the whole of what tabs cost the rest of the application: nothing.
 */
export const useFileStore = defineStore('fileStore', () => {
  const favoritesStore = useFavoritesStore();
  const volumeUsageStore = useVolumeUsageStore();
  const folderSizeStore = useFolderSizeStore();
  const featuresStore = useFeaturesStore();
  const operationTasksStore = useOperationTasksStore();
  const notificationsStore = useNotificationsStore();
  const tabsStore = useTabsStore();

  const refreshSizes = () => {
    volumeUsageStore.scheduleRefresh();
    folderSizeStore.scheduleRefresh();
  };

  const warnAboutOnlyOfficeActivity = createOnlyofficeWarning(notificationsStore);

  /**
   * One folder per tab, made when the tab is and let go when it goes.
   *
   * A plain Map: what is reactive is inside each folder, and the one thing that
   * decides which of them is read — the active tab's id — is reactive on its own.
   * Entries are made before anything can ask for them, so nothing reads a folder
   * that is not there.
   */
  const folders = new Map();
  const ensureFolder = (id) => {
    if (!folders.has(id)) {
      folders.set(
        id,
        createFolderTab({
          warn: warnAboutOnlyOfficeActivity,
          // The polling belongs to the window and asks about what is on screen,
          // so a tab that is not in front does not start it.
          onListed: () => {
            if (tabsStore.activeId === id) void onlyofficeActivity.start();
          },
        })
      );
    }
    return folders.get(id);
  };

  for (const tab of tabsStore.tabs) ensureFolder(tab.id);

  watch(
    () => tabsStore.tabs.map((tab) => tab.id),
    (ids) => {
      for (const id of ids) ensureFolder(id);
      for (const id of [...folders.keys()]) {
        if (ids.includes(id)) continue;
        folders.get(id).dispose();
        folders.delete(id);
      }
    }
  );

  /** The folder in front. Never null: the tabs store always has a tab. */
  const active = computed(() => ensureFolder(tabsStore.activeId));

  /**
   * A named tab's folder, for a screen that is not the one in front.
   *
   * Everything above reads `active`, which is right for the window: the
   * clipboard, the operations and the toolbar all act on whichever tab the
   * reader is in. A pane in a split view is different — it draws a *place*, and
   * the place it draws is its own tab whether or not that tab has focus. A pane
   * reading `active` drew whichever tab had just been clicked, which is the same
   * fault a folder's scroll position hit before tabs had folders of their own.
   *
   * Handed out as the folder itself rather than as copies of its refs: the pane
   * wants the listing, the selection and the rename that belong to that tab, and
   * they already live together.
   */
  const folderFor = (id) => ensureFolder(id || tabsStore.activeId);

  /**
   * One of the folder's own refs, as the store has always exposed it.
   *
   * Writable, because it always was: `fileStore.currentPathItems = […]` is what
   * a confirmed delete and a test both do, and a read-only computed would have
   * turned that into a silent no-op.
   */
  const activeRef = (pick) =>
    computed({
      get: () => pick(active.value).value,
      set: (value) => {
        pick(active.value).value = value;
      },
    });

  const currentPath = activeRef((folder) => folder.path);
  const currentPathItems = activeRef((folder) => folder.items);
  const currentPathData = activeRef((folder) => folder.data);

  const fetchPathItems = (path, options) => active.value.fetchItems(path, options);

  /**
   * A listing read into a named tab rather than into the one in front.
   *
   * Every folder already has its own listing, its own selection and its own
   * request in flight — that is what makes a tab keep what it was holding. What
   * was missing was a way to fill one the reader is not looking at, which is what
   * preparing a tab opened in the background means: by the time they arrive, the
   * folder is there instead of a spinner.
   */
  const fetchIn = (id, path, options) =>
    ensureFolder(id).fetchItems(path, { ...options, background: true });

  /**
   * Whether a tab already holds a folder, listed.
   *
   * Asked before preparing one: a tab that has been there has its listing, its
   * selection and possibly a rename half typed, and reading the folder again would
   * be a head start on nothing at the cost of disturbing all of it. Does not make
   * a folder for a tab it has never heard of — asking is not visiting.
   */
  const holdsFolder = (id, wanted) => {
    const folder = folders.get(id);
    if (!folder) return false;
    return (
      normalizePath(folder.path.value) === normalizePath(wanted) &&
      (folder.items.value?.length ?? 0) > 0
    );
  };

  /**
   * The folder already on screen, read again.
   *
   * The other half of `fetchPathItems`, and the difference between them is not
   * the path — it is what it means. Fetching a path is *going* somewhere, so it
   * clears what was selected and leaves selection mode, because what was chosen
   * was chosen in another folder. Refreshing is this folder changing underneath
   * somebody: an upload landing, a shell writing a file, ONLYOFFICE saving. They
   * have to see the new file; they must not lose what they were holding.
   *
   * Written down as its own word because every caller that got this wrong got it
   * wrong the same way — by reaching for the one function there was.
   */
  const refresh = () =>
    active.value.fetchItems(active.value.path.value, { preserveInteraction: true });

  const onlyofficeActivity = createOnlyofficeActivityPolling({
    featuresStore,
    isBrowsing: () => active.value.isBrowsing(),
    refresh,
  });

  const selection = {
    selectedItems: activeRef((folder) => folder.selection.selectedItems),
    selectionMode: activeRef((folder) => folder.selection.selectionMode),
    hasSelection: computed(() => active.value.selection.hasSelection.value),
    selectedItemKeys: computed(() => active.value.selection.selectedItemKeys.value),
    keyboardActionItem: computed(() => active.value.selection.keyboardActionItem.value),
    clearSelection: () => active.value.selection.clearSelection(),
    setSelectionMode: (...args) => active.value.selection.setSelectionMode(...args),
    toggleSelectionMode: (...args) => active.value.selection.toggleSelectionMode(...args),
    setKeyboardActionItem: (...args) => active.value.selection.setKeyboardActionItem(...args),
    clearKeyboardActionItem: () => active.value.selection.clearKeyboardActionItem(),
    findItemByKey: (...args) => active.value.selection.findItemByKey(...args),
    selectItemsByName: (...args) => active.value.selection.selectItemsByName(...args),
    selectCreated: (...args) => active.value.selection.selectCreated(...args),
  };

  /**
   * Each of these hands on everything it was given.
   *
   * A wrapper that names its arguments silently drops the ones it did not name,
   * and the first version of this one did: `beginRename(item, { isNew: true })`
   * arrived as `beginRename(item)`, so a folder the store had just made opened its
   * rename box without being flagged as new. Spread, and the suite went quiet.
   */
  const rename = {
    renameState: activeRef((folder) => folder.rename.renameState),
    beginRename: (...args) => active.value.rename.beginRename(...args),
    setRenameDraft: (...args) => active.value.rename.setRenameDraft(...args),
    cancelRename: () => active.value.rename.cancelRename(),
    applyRename: (...args) => active.value.rename.applyRename(...args),
    isItemBeingRenamed: (...args) => active.value.rename.isItemBeingRenamed(...args),
  };

  const transfers = createTransfers({
    currentPath,
    selection,
    fetchPathItems,
    refreshSizes,
    operationTasksStore,
    warn: warnAboutOnlyOfficeActivity,
  });

  const operations = createOperations({
    currentPath,
    selection,
    fetchPathItems,
    removeItemsFromCurrentView: (...args) => active.value.removeItems(...args),
    beginRename: rename.beginRename,
    refreshSizes,
    favoritesStore,
    operationTasksStore,
    warn: warnAboutOnlyOfficeActivity,
  });

  const getCurrentPath = computed(() => currentPath.value);

  /**
   * A listing in the order the reader asked for, with the sizes it knows.
   *
   * Named rather than inlined into the computed below because a pane that is not
   * the one in front needs the same arrangement of its own listing, and two
   * copies of "how a folder is ordered" would drift the first time somebody
   * added a sort key.
   */
  const arrange = (items) =>
    sortItems(items, useSettingsStore().sortBy, (full) => folderSizeStore.sizeFor(full));

  const getCurrentPathItems = computed(() => arrange(currentPathItems.value));

  function setCurrentPath(path) {
    currentPath.value = normalizePath(path);
  }

  return {
    folderFor,
    arrange,
    currentPath,
    getCurrentPath,
    setCurrentPath,
    currentPathItems,
    currentPathData,
    getCurrentPathItems,
    fetchPathItems,
    fetchIn,
    holdsFolder,
    refresh,
    selectedItems: selection.selectedItems,
    keyboardActionItem: selection.keyboardActionItem,
    setKeyboardActionItem: selection.setKeyboardActionItem,
    clearKeyboardActionItem: selection.clearKeyboardActionItem,
    selectedItemKeys: selection.selectedItemKeys,
    selectionMode: selection.selectionMode,
    setSelectionMode: selection.setSelectionMode,
    toggleSelectionMode: selection.toggleSelectionMode,
    clearSelection: selection.clearSelection,
    repositionAfterTransfer: transfers.repositionAfterTransfer,
    copiedItems: transfers.copiedItems,
    cutItems: transfers.cutItems,
    hasSelection: selection.hasSelection,
    hasClipboardItems: transfers.hasClipboardItems,
    copy: transfers.copy,
    cut: transfers.cut,
    paste: transfers.paste,
    transferSelectionTo: transfers.transferSelectionTo,
    del: operations.del,
    resetClipboard: transfers.resetClipboard,
    createFolder: operations.createFolder,
    createFile: operations.createFile,
    createOfficeDocument: operations.createOfficeDocument,
    extractZipArchive: operations.extractZipArchive,
    compressSelectionToZip: operations.compressSelectionToZip,
    renameState: rename.renameState,
    beginRename: rename.beginRename,
    setRenameDraft: rename.setRenameDraft,
    cancelRename: rename.cancelRename,
    applyRename: rename.applyRename,
    isItemBeingRenamed: rename.isItemBeingRenamed,
    warnAboutOnlyOfficeActivity,
    ensureItemThumbnail: (...args) => active.value.thumbnails.ensureItemThumbnail(...args),
    prefetchItemThumbnail: (...args) => active.value.thumbnails.prefetchItemThumbnail(...args),
  };
});
