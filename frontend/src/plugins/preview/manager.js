import { defineStore } from 'pinia';
import { ref, computed, reactive, watch } from 'vue';
import {
  getPreviewUrl,
  normalizePath,
  downloadItems,
  fetchFileContent,
  fetchMediaTracks,
  getSubtitleUrl,
} from '@/api';
import { useFileStore } from '@/stores/fileStore';
import { useTabsStore } from '@/stores/tabs';
import { useTabLoadingStore } from '@/stores/tabLoading';
import { createPreviewSession } from './session';
import router from '@/router';

/**
 * Which plugin opens what, and what each tab is showing.
 *
 * The register of plugins belongs to the window: one list, sorted once, asked by
 * everything. What is *open* belongs to a tab, and there is one session per tab —
 * see `session.js`. That split is the whole of what tabs changed here, and it is
 * what lets an ONLYOFFICE document go on existing while its reader looks at a
 * folder in another tab: the session is not torn down when the page showing it is,
 * because the page is not what it belongs to.
 *
 * The surface below is the one everything has always called: `open`, `close`,
 * `isOpen`, `activeItem` all mean "the tab in front", which is what they meant
 * when there was only ever one.
 */
export const usePreviewManager = defineStore('preview-manager', () => {
  const tabsStore = useTabsStore();
  const plugins = ref([]);

  /**
   * One session per tab, made when the tab is and ended when it goes.
   *
   * Ended, not dropped: a tab closed on an ONLYOFFICE document has to tell the
   * server that the editing session is over, exactly as closing the document
   * would. Before tabs that was the document page's business, on its way out;
   * now the page is not the last thing to know.
   */
  const sessions = new Map();
  const ensureSession = (key) => {
    if (!sessions.has(key)) sessions.set(key, createPreviewSession());
    return sessions.get(key);
  };

  for (const tab of tabsStore.tabs) ensureSession(tab.id);

  watch(
    () => tabsStore.tabs.map((tab) => tab.id),
    (ids) => {
      for (const id of ids) ensureSession(id);
      for (const id of [...sessions.keys()]) {
        if (ids.includes(id)) continue;
        void sessions.get(id).close();
        sessions.delete(id);
      }
    }
  );

  /** The session of the tab in front. Never null: there is always a tab. */
  const activeSession = computed(() => ensureSession(tabsStore.activeId));

  const activeItem = computed(() => activeSession.value.item.value);
  const activePlugin = computed(() => activeSession.value.plugin.value);
  const isOpen = computed(() => activeSession.value.isOpen.value);

  /**
   * One surface per tab, in the order the sessions were made — **never** in the
   * order of the tabs.
   *
   * What `PreviewHost` renders: all of them, all of the time, with only the one
   * in front visible. They are not rendered one at a time on purpose — a surface
   * that is unmounted and mounted again is a new one, and ONLYOFFICE would open
   * the document from scratch each time a reader came back to its tab.
   *
   * The order is the point, and it cost an afternoon to learn: an `iframe` reloads
   * every time it is inserted into the document, and moving a node in the DOM *is*
   * an insertion. Rendered in the order of the tabs, dragging one tab past another
   * made Vue move the surfaces to match — and every office document in the row
   * came back from the Document Server having forgotten where its reader was.
   * Nothing on screen depends on this order: each surface covers the window and
   * only the one in front is visible, so the row can be in whatever order never
   * moves. That is the order they were made in, which is the map's own.
   *
   * Every tab and not only the ones holding something: a surface whose session is
   * empty draws nothing, and keeping it means opening and closing a document is
   * the same fade in and out of one component it has always been.
   */
  const surfaces = computed(() => {
    const live = new Set(tabsStore.tabs.map((tab) => tab.id));
    for (const id of live) ensureSession(id);
    return [...sessions.keys()]
      .filter((key) => live.has(key))
      .map((key) => ({ key, session: sessions.get(key) }));
  });

  const getExtension = (item) => {
    if (!item) return '';
    const kind = String(item.kind || '').toLowerCase();
    if (kind && kind !== 'directory') return kind;

    const name = String(item.name || '');
    const lastDot = name.lastIndexOf('.');
    return lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : '';
  };

  // Helper: Build full path
  const getFullPath = (item) => {
    if (!item?.name) return '';
    const parent = normalizePath(item.path || '');
    return normalizePath(parent ? `${parent}/${item.name}` : item.name);
  };

  // Get siblings from the same directory
  const getSiblings = () => {
    const fileStore = useFileStore();
    const items = fileStore.getCurrentPathItems || [];
    return items;
  };

  /**
   * What a plugin is given.
   *
   * `key` is the tab this will be shown in, so that a document closing itself
   * closes its own session and not whichever one happens to be in front. It is
   * absent when the context is built only to ask *whether* something has a
   * plugin, and then closing falls back to the tab in front, as it always did.
   */
  const createApi = (item, key) => ({
    getPreviewUrl: (targetItem) => getPreviewUrl(getFullPath(targetItem || item)),
    getMediaTracks: (targetItem) => fetchMediaTracks(getFullPath(targetItem || item)),
    getSubtitleUrl: (targetItem, track) => getSubtitleUrl(getFullPath(targetItem || item), track),
    fetchContent: () => fetchFileContent(getFullPath(item)),
    getSiblings: (target) => getSiblings(target || item),
    openEditor: () => {
      const path = getFullPath(item);
      if (path) {
        // Encode each segment to handle special characters like #
        const encodedPath = path.split('/').map(encodeURIComponent).join('/');
        router.push({ path: `/editor/${encodedPath}` });
      }
    },
    download: async (targetItem = item) => {
      const path = getFullPath(targetItem);
      if (!path) return;

      const response = await downloadItems([path]);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = targetItem.name || 'download';
      link.click();

      URL.revokeObjectURL(url);
    },
    close: () => (key === undefined ? close() : closeIn(key)),
  });

  // Plugin Management
  const register = (plugin) => {
    if (!plugin?.id) return;

    // Remove existing plugin with same id
    plugins.value = plugins.value.filter((p) => p.id !== plugin.id);

    // Add and sort by priority (descending)
    plugins.value.push(plugin);
    plugins.value.sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      return priorityB - priorityA || a.id.localeCompare(b.id);
    });
  };

  const unregister = (pluginId) => {
    plugins.value = plugins.value.filter((p) => p.id !== pluginId);
  };

  // Find matching plugin
  const findPlugin = (item, key) => {
    if (!item) return null;

    const extension = getExtension(item);
    const fullPath = getFullPath(item);
    const previewUrl = getPreviewUrl(fullPath);
    const api = createApi(item, key);

    const context = {
      item: { ...item },
      extension,
      filePath: fullPath,
      previewUrl,
      // Preview components can keep small, ephemeral state which their
      // lifecycle hooks need when the preview is about to close — and, for a
      // viewer that takes real time to arrive, `isReady`, which is how it says
      // the wait is over. See `waitForViewer` below.
      previewState: reactive({}),
      api,
    };

    // Find first matching plugin
    for (const plugin of plugins.value) {
      try {
        if (plugin.match?.(context)) {
          return { plugin, context };
        }
      } catch (error) {
        console.error(`Plugin ${plugin.id} match error:`, error);
      }
    }

    return null;
  };

  /**
   * Whether a tab is already showing this exact document.
   *
   * Asked before opening, by the page that a tab coming forward mounts again:
   * the answer is what stops it rebuilding what is already there.
   */
  const shows = (key, item) => {
    if (!item) return false;
    return sessions.get(key)?.shows({ filePath: getFullPath(item), item }) ?? false;
  };

  /**
   * Whether a given tab is showing anything at all.
   *
   * Asked by the document page about *its own* tab rather than about whichever
   * is in front: a document closing itself is the reader pressing a cross, and a
   * session ending because its tab went is not. Deliberately does not make a
   * session it cannot find — a tab that has gone should not come back as an empty
   * one because somebody asked about it on the way out.
   */
  const isOpenIn = (key) => sessions.get(key)?.isOpen.value ?? false;

  /**
   * What a given tab is showing, as the plugin was handed it.
   *
   * Asked about a tab that is not in front, which `activeItem` cannot answer — and
   * the way to reach `previewState`, which is how a viewer says it has really
   * arrived. Makes no session: asking is not opening.
   */
  const itemIn = (key) => sessions.get(key)?.item.value ?? null;

  /**
   * How long a viewer that reports its own readiness is given to say so.
   *
   * A tab that says it is working for ever is worse than one that never said it:
   * the reader is told to wait for something that is not coming. A document server
   * that has to be woken up can take a while, so the wait is generous — but it
   * ends.
   */
  const VIEWER_PATIENCE_MS = 45_000;

  /**
   * The tab is working until its viewer is really there.
   *
   * Which is not the same as "the component has loaded". An image is on screen the
   * moment its component is; an ONLYOFFICE document then has to reach a document
   * server, be given a session on it and load the file into an iframe, which is
   * seconds — and it is exactly the wait worth showing. Only the viewer knows when
   * that is over, so a plugin that has a real wait declares `reportsReady` and says
   * so through `previewState.isReady`; everything else is done as soon as it is
   * shown.
   */
  const waitForViewer = (key, match) => {
    const busy = useTabLoadingStore();
    const done = busy.begin(key);
    if (!match.plugin.reportsReady) {
      done();
      return;
    }

    const patience = setTimeout(() => {
      stop();
      done();
    }, VIEWER_PATIENCE_MS);
    const stop = watch(
      () => match.context.previewState.isReady === true,
      (ready) => {
        if (!ready) return;
        clearTimeout(patience);
        stop();
        done();
      },
      { immediate: true }
    );
  };

  /** Open a document in a given tab, and say whether anything opens it at all. */
  const openIn = (key, item) => {
    const match = findPlugin(item, key);
    if (!match) return false;

    const session = ensureSession(key);
    // Asked for what is already here — the same document opened twice from the
    // same tab. Left exactly as it is, rather than built again underneath
    // somebody who may be halfway through a sentence.
    if (session.shows(match.context)) return true;

    session.show(match.plugin, match.context);
    waitForViewer(key, match);
    return true;
  };

  const open = (item) => openIn(tabsStore.activeId, item);

  const closeIn = (key) => sessions.get(key)?.close();
  const close = () => activeSession.value.close();

  /**
   * The window is going away — every session, not only the one in front.
   *
   * A document being edited in a background tab is being edited: it has a
   * session on the server and the server has to be told. Answers whether any of
   * them had something to say.
   */
  const endForUnload = () => {
    let spoke = false;
    for (const session of sessions.values()) spoke = session.endForUnload() || spoke;
    return spoke;
  };

  return {
    // State
    plugins,
    isOpen,
    activeItem,
    activePlugin,
    surfaces,

    // Actions
    register,
    unregister,
    open,
    openIn,
    shows,
    isOpenIn,
    itemIn,
    close,
    closeIn,
    endForUnload,
    findPlugin,
  };
});
