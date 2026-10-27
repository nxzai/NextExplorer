import { defineStore } from 'pinia';

// Navigation history should feel local to the current browser session, not like
// a user preference. Keep a bounded LRU cache so a long browse session cannot
// accumulate positions indefinitely.
export const FOLDER_SCROLL_POSITION_LIMIT = 100;
const EXPLICIT_RESTORE_TTL_MS = 30000;

export const useFolderScrollStore = defineStore('folderScroll', () => {
  const positions = new Map();
  const activeItemKeys = new Map();
  const permittedRestorePaths = new Set();
  const explicitRestoreDeadlines = new Map();

  const remember = (key, scrollTop) => {
    if (!key || !Number.isFinite(scrollTop)) return;

    positions.delete(key);
    positions.set(key, Math.max(0, Math.round(scrollTop)));

    while (positions.size > FOLDER_SCROLL_POSITION_LIMIT) {
      positions.delete(positions.keys().next().value);
    }
  };

  const get = (key) => positions.get(key) ?? 0;

  const has = (key) => positions.has(key);

  // Keep the active item with the scroll position so keyboard navigation can
  // resume from the same row after an intentional return to this folder.
  const rememberActiveItem = (key, itemKey) => {
    if (!key || !itemKey) return;

    activeItemKeys.delete(key);
    activeItemKeys.set(key, itemKey);

    while (activeItemKeys.size > FOLDER_SCROLL_POSITION_LIMIT) {
      activeItemKeys.delete(activeItemKeys.keys().next().value);
    }
  };

  const getActiveItem = (key) => activeItemKeys.get(key) ?? '';

  /**
   * A permission to be put back, and whose it is.
   *
   * Keyed by the tab as well as by the folder, because the folder's own memory is
   * shared by every tab on it: a tab that walked up into a folder, or came back out
   * of a file in it, left a permission that *another* tab on that same folder then
   * consumed — and jumped to where the first one had been. Three tabs on one folder
   * and one of them opening a document was enough to move the other two.
   */
  const permitKey = (path, tabId) => `${tabId || ''}\u0000${path}`;

  // Positions are retained in the small LRU cache, but are restored only for
  // an intentional upward navigation within the same mount. This avoids
  // surprising jumps when the user switches volume and later opens a folder
  // that happened to be visited earlier in the session.
  const permitRestore = (path, tabId) => {
    if (path) permittedRestorePaths.add(permitKey(path, tabId));
  };

  // Some routes, such as the text editor, leave BrowserLayout completely.
  // Their return path is known by the departing view, but not by the generic
  // router rule. Keep that one explicit return through the global guard, and
  // expire it in case the navigation is cancelled before FolderView mounts.
  const permitExplicitRestore = (path, tabId) => {
    if (!path) return;
    const key = permitKey(path, tabId);
    permittedRestorePaths.add(key);
    explicitRestoreDeadlines.set(key, Date.now() + EXPLICIT_RESTORE_TTL_MS);
  };

  const hasActiveExplicitRestore = (path, tabId) => {
    const key = permitKey(path, tabId);
    const deadline = explicitRestoreDeadlines.get(key);
    if (!deadline) return false;
    if (deadline > Date.now()) return true;
    explicitRestoreDeadlines.delete(key);
    permittedRestorePaths.delete(key);
    return false;
  };

  const preventRestore = (path, tabId) => {
    if (!path || hasActiveExplicitRestore(path, tabId)) return;
    permittedRestorePaths.delete(permitKey(path, tabId));
  };

  /**
   * Where a tab was in the folder it is on.
   *
   * Not the same question as the one above, and it has its own answer. That one
   * is "where was the reader last time they walked into this folder", which is
   * only worth restoring when they walked back up to it on purpose — otherwise
   * opening a folder visited an hour ago jumps somewhere surprising. This one is
   * "where is this tab right now", which is always worth restoring, because the
   * tab never left: another one simply came in front of it.
   *
   * Keyed per tab, so two tabs on the same folder keep their own places. Read
   * without consuming, since a reader crosses back and forth.
   */
  const tabPlaces = new Map();

  const rememberTabPlace = (key, scrollTop, anchor = '') => {
    if (!key || !Number.isFinite(scrollTop)) return;
    tabPlaces.delete(key);
    // The row the reader was on, beside the number of pixels it took to get there.
    // The two answer the same question and the row answers it better: a pane that
    // changes width — one of a pair, or a pair becoming one — re-flows its listing,
    // and the same number of pixels is then a different place in the folder.
    tabPlaces.set(key, { top: Math.max(0, Math.round(scrollTop)), anchor: anchor || '' });
    while (tabPlaces.size > FOLDER_SCROLL_POSITION_LIMIT) {
      tabPlaces.delete(tabPlaces.keys().next().value);
    }
  };

  const tabPlace = (key) => tabPlaces.get(key)?.top ?? 0;

  /** The row that was at the top of it, if the tab said which. */
  const tabAnchor = (key) => tabPlaces.get(key)?.anchor ?? '';

  /**
   * Whether this tab has a place in this folder at all, which is not the same
   * question as where it is.
   *
   * The top is an answer: a tab that has been drawn in a folder and left at the top
   * belongs at the top. Asked as a number, that answer is zero and reads as "no
   * answer", and the caller falls through to the folder's own memory — which every
   * tab on that folder shares.
   */
  const hasTabPlace = (key) => tabPlaces.has(key);

  const forgetTabPlace = (key) => {
    tabPlaces.delete(key);
  };

  const consumeRestoreState = (key, tabId) => {
    const path = String(key || '').split('::')[0];
    const permit = permitKey(path, tabId);
    if (!path || !permittedRestorePaths.has(permit)) {
      return { permitted: false, scrollTop: 0, activeItemKey: '' };
    }
    if (explicitRestoreDeadlines.has(permit) && !hasActiveExplicitRestore(path, tabId)) {
      return { permitted: false, scrollTop: 0, activeItemKey: '' };
    }
    permittedRestorePaths.delete(permit);
    explicitRestoreDeadlines.delete(permit);
    return {
      permitted: true,
      scrollTop: get(key),
      activeItemKey: getActiveItem(key),
    };
  };

  const consumeRestore = (key, tabId) => consumeRestoreState(key, tabId).scrollTop;

  const clear = () => {
    positions.clear();
    activeItemKeys.clear();
    permittedRestorePaths.clear();
    explicitRestoreDeadlines.clear();
  };

  return {
    rememberTabPlace,
    tabPlace,
    tabAnchor,
    hasTabPlace,
    forgetTabPlace,
    remember,
    get,
    has,
    rememberActiveItem,
    getActiveItem,
    permitRestore,
    permitExplicitRestore,
    preventRestore,
    consumeRestoreState,
    consumeRestore,
    clear,
  };
});
