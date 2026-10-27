import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { browse, normalizePath, browseShare } from '@/api';
import { useSettingsStore } from '@/stores/settings';
import { useFavoritesStore } from '@/stores/favorites';
import { useVolumeUsageStore } from '@/stores/volumeUsage';
import { useFolderSizeStore } from '@/stores/folderSize';
import { useFeaturesStore } from '@/stores/features';
import { useOperationTasksStore } from '@/stores/operationTasks';
import { useNotificationsStore } from '@/stores/notifications';
import { isAbortError, itemKey } from './files/items';
import { sortItems } from './files/sorting';
import { mergeListing, folderData } from './files/listing';
import { createThumbnailQueue, createThumbnails } from './files/thumbnails';
import {
  createOnlyofficeActivityPolling,
  createOnlyofficeWarning,
} from './files/onlyofficeActivity';
import { createSelection } from './files/selection';
import { createRename } from './files/rename';
import { createTransfers } from './files/transfers';
import { createOperations } from './files/operations';

/**
 * The folder on screen: what it holds, what is selected in it, and what can be
 * done to it.
 *
 * The listing lives here; everything else is in `stores/files/`, each part
 * given only what it needs — the selection the entries on screen, the
 * clipboard the selection and a way to list again. What components see is the
 * same store it always was.
 */
export const useFileStore = defineStore('fileStore', () => {
  // State
  const currentPath = ref('');
  const currentPathItems = ref([]);
  const currentPathData = ref(null);

  const favoritesStore = useFavoritesStore();
  const volumeUsageStore = useVolumeUsageStore();
  const folderSizeStore = useFolderSizeStore();
  const featuresStore = useFeaturesStore();
  const operationTasksStore = useOperationTasksStore();
  const notificationsStore = useNotificationsStore();

  let activeBrowseController = null;
  let browseRequestGeneration = 0;

  const refreshSizes = () => {
    volumeUsageStore.scheduleRefresh();
    folderSizeStore.scheduleRefresh();
  };

  const warnAboutOnlyOfficeActivity = createOnlyofficeWarning(notificationsStore);
  const selection = createSelection(currentPathItems);
  const thumbnailQueue = createThumbnailQueue();
  const thumbnails = createThumbnails({
    findItemByKey: selection.findItemByKey,
    queue: thumbnailQueue,
  });
  const onlyofficeActivity = createOnlyofficeActivityPolling({
    featuresStore,
    isBrowsing: () => Boolean(activeBrowseController),
    refresh: () => fetchPathItems(currentPath.value, { preserveInteraction: true }),
  });
  const rename = createRename({
    currentPath,
    selection,
    fetchPathItems,
    warn: warnAboutOnlyOfficeActivity,
  });
  const transfers = createTransfers({
    currentPath,
    selection,
    fetchPathItems,
    refreshSizes,
    operationTasksStore,
    warn: warnAboutOnlyOfficeActivity,
  });

  // Reflect a confirmed delete immediately. The authoritative browse refresh
  // below remains the source of truth and restores the list if the request is
  // rejected, but this avoids making a successful delete look inert while the
  // server finishes its cleanup work.
  const removeItemsFromCurrentView = (items) => {
    const keys = new Set((Array.isArray(items) ? items : []).map((item) => itemKey(item)));
    if (keys.size === 0) return;
    currentPathItems.value = currentPathItems.value.filter((item) => !keys.has(itemKey(item)));
  };

  const operations = createOperations({
    currentPath,
    selection,
    fetchPathItems,
    removeItemsFromCurrentView,
    beginRename: rename.beginRename,
    refreshSizes,
    favoritesStore,
    operationTasksStore,
    warn: warnAboutOnlyOfficeActivity,
  });

  const getCurrentPath = computed(() => currentPath.value);

  const getCurrentPathItems = computed(() =>
    sortItems(
      currentPathItems.value,
      useSettingsStore().sortBy,
      (full) => folderSizeStore.sizeFor(full),
      // One list or folders first is the person's own preference (#495).
      { foldersFirst: useSettingsStore().foldersFirst }
    )
  );

  // Actions
  function setCurrentPath(path) {
    currentPath.value = normalizePath(path);
  }

  async function fetchPathItems(path, options = {}) {
    const previousItems = Array.isArray(currentPathItems.value) ? currentPathItems.value : [];

    const normalizedPath = normalizePath(typeof path === 'string' ? path : currentPath.value);
    thumbnailQueue.cancel();
    const requestGeneration = ++browseRequestGeneration;
    activeBrowseController?.abort();
    const controller = new AbortController();
    activeBrowseController = controller;
    useSettingsStore().restoreFolderPreferences(normalizedPath);
    currentPath.value = normalizedPath;
    if (!options.preserveInteraction) {
      selection.clearSelection();
      // When changing folders, exit selection mode (mobile UX).
      selection.setSelectionMode(false, { clearOnDisable: false });
    }

    let response;

    // For share paths, use the dedicated share browse endpoint so that
    // file shares can be treated as virtual one-item directories.
    try {
      if (normalizedPath && normalizedPath.startsWith('share/')) {
        const segments = normalizedPath.split('/');
        const shareToken = segments[1];
        const innerPath = segments.slice(2).join('/');
        response = await browseShare(shareToken, innerPath, { signal: controller.signal });
      } else {
        response = await browse(normalizedPath, { signal: controller.signal });
      }
    } catch (error) {
      // A newer navigation supersedes this request. Let it finish quietly:
      // otherwise a rapid folder traversal can surface a stale failure.
      if (requestGeneration !== browseRequestGeneration && isAbortError(error)) {
        return null;
      }
      throw error;
    } finally {
      if (activeBrowseController === controller) {
        activeBrowseController = null;
      }
    }

    // Browsing a deep tree can start several requests before the first one
    // returns. Ignore an older response even when it raced with abort(), so it
    // can never overwrite the listing for the route currently in the address
    // bar and breadcrumb.
    if (requestGeneration !== browseRequestGeneration) {
      return null;
    }

    // The current answer carries the items with what the folder allows; an
    // older one was the bare array of items.
    const data = folderData(response, normalizedPath);
    const incoming = data ? response.items : Array.isArray(response) ? response : [];
    currentPathItems.value = mergeListing(previousItems, incoming);
    currentPathData.value = data;

    void onlyofficeActivity.start();
    return currentPathItems.value;
  }

  return {
    currentPath,
    getCurrentPath,
    setCurrentPath,
    currentPathItems,
    currentPathData,
    getCurrentPathItems,
    fetchPathItems,
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
    ensureItemThumbnail: thumbnails.ensureItemThumbnail,
    prefetchItemThumbnail: thumbnails.prefetchItemThumbnail,
  };
});
