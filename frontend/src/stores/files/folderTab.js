import { ref } from 'vue';
import { browse, browseShare, normalizePath } from '@/api';
import { useSettingsStore } from '@/stores/settings';
import { isAbortError, itemKey } from './items';
import { folderData, mergeListing } from './listing';
import { createSelection } from './selection';
import { createRename } from './rename';
import { createThumbnailQueue, createThumbnails } from './thumbnails';

/**
 * One folder, as one tab holds it.
 *
 * Everything in here belongs to a single tab and to nothing else: which folder
 * it is on, what that folder holds, what is selected in it, the rename it may be
 * in the middle of, the thumbnails it has asked for, and the request it has in
 * flight. Before tabs there was one of these and it was the store; the store now
 * keeps one per tab and shows whichever is in front.
 *
 * What is deliberately *not* here is the clipboard, the transfers and the
 * operations. Copying in one tab and pasting in another is the reason to have
 * tabs at all, so those stay one to the window, reading whichever folder is in
 * front. The line is: state belonging to a place is here, and actions belonging
 * to the person are not.
 *
 * Each tab has its own abort controller and its own generation counter, so a
 * folder opening in front never cancels the listing a tab behind it is waiting
 * for — which one shared controller did.
 *
 * @param {object} options
 * @param {(items: Array) => void} [options.onListed] called with what arrived,
 *   for the one thing that is the window's and not the tab's: the polling that
 *   asks who is editing what.
 * @param {() => void} [options.warn] carried to the rename, unchanged.
 */
export const createFolderTab = ({ onListed, warn } = {}) => {
  const path = ref('');
  const items = ref([]);
  const data = ref(null);

  let activeBrowseController = null;
  let browseRequestGeneration = 0;

  const selection = createSelection(items);
  const thumbnailQueue = createThumbnailQueue();
  const thumbnails = createThumbnails({
    findItemByKey: selection.findItemByKey,
    queue: thumbnailQueue,
  });

  const isBrowsing = () => Boolean(activeBrowseController);

  const setPath = (wanted) => {
    path.value = normalizePath(wanted);
  };

  // Reflect a confirmed delete immediately. The authoritative browse refresh
  // remains the source of truth and restores the list if the request is
  // rejected, but this avoids making a successful delete look inert while the
  // server finishes its cleanup work.
  const removeItems = (removed) => {
    const keys = new Set((Array.isArray(removed) ? removed : []).map((item) => itemKey(item)));
    if (keys.size === 0) return;
    items.value = items.value.filter((item) => !keys.has(itemKey(item)));
  };

  async function fetchItems(wanted, options = {}) {
    const previousItems = Array.isArray(items.value) ? items.value : [];

    const normalizedPath = normalizePath(typeof wanted === 'string' ? wanted : path.value);
    thumbnailQueue.cancel();
    const requestGeneration = ++browseRequestGeneration;
    activeBrowseController?.abort();
    const controller = new AbortController();
    activeBrowseController = controller;
    // How this folder is shown is a window-wide setting, so reading a folder for a
    // tab nobody is looking at must not touch it: preparing a background tab in
    // list view put the *window* into that folder's view, under a reader who was
    // looking at something else — and the folder they were in, remembered in one
    // view, came back measured in another.
    if (!options.background) useSettingsStore().restoreFolderPreferences(normalizedPath);
    path.value = normalizedPath;
    if (!options.preserveInteraction && !options.background) {
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
    const listing = folderData(response, normalizedPath);
    const incoming = listing ? response.items : Array.isArray(response) ? response : [];
    // Merged rather than replaced, which is what lets a tab coming back to the
    // front show what it held while the refresh is still on its way.
    items.value = mergeListing(previousItems, incoming);
    data.value = listing;

    onListed?.(items.value);
    return items.value;
  }

  const rename = createRename({
    currentPath: path,
    selection,
    fetchPathItems: fetchItems,
    warn,
  });

  /** Let go of what this tab was holding, for a tab that is being closed. */
  const dispose = () => {
    thumbnailQueue.cancel();
    activeBrowseController?.abort();
    activeBrowseController = null;
    items.value = [];
    data.value = null;
    selection.clearSelection();
  };

  return {
    path,
    items,
    data,
    selection,
    rename,
    thumbnails,
    thumbnailQueue,
    isBrowsing,
    setPath,
    fetchItems,
    removeItems,
    dispose,
  };
};
