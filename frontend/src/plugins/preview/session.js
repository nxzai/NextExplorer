import { computed, ref } from 'vue';

/**
 * One document on screen, and the whole of what it takes to end it.
 *
 * This was the preview manager's own state, and there was one of it, which is
 * exactly as much as an application that shows one document at a time needs. In
 * tabs there are several, so the state moved here and the manager keeps one of
 * these per tab — the same shape `stores/files/folderTab.js` gave the folder
 * listing, and for the same reason: what belongs to a *place* has to exist once
 * per place, or the second tab shows the first one's contents.
 *
 * Nothing here knows about tabs, plugins are handed to it, and it holds no
 * component. It is the answer to "what is this tab showing, and what has to be
 * said when it stops".
 */
export function createPreviewSession() {
  /** The plugin's context — item, paths, api — and the plugin showing it. */
  const item = ref(null);
  const plugin = ref(null);
  let pendingClose = null;

  const isOpen = computed(() => !!item.value);

  /**
   * What makes two openings the same document.
   *
   * The path is not enough on its own: the history panel opens an earlier
   * version of a file at the same path, and answering "already open" to that
   * would show the reader the current document and call it the version they
   * asked for.
   */
  const signatureOf = (context) =>
    context ? `${context.filePath}\u0000${context.item?.versionId ?? ''}` : '';

  /** Whether this session is already showing that exact document. */
  const shows = (context) => {
    const wanted = signatureOf(context);
    return Boolean(wanted) && signatureOf(item.value) === wanted;
  };

  const show = (matched, context) => {
    try {
      matched.onOpen?.(context);
    } catch (error) {
      console.error(`Plugin ${matched.id} onOpen error:`, error);
    }
    item.value = context;
    plugin.value = matched;
  };

  /**
   * The window is going away, and there is no time left to ask for anything.
   *
   * A page being closed gives a handler one synchronous moment: a promise
   * chained after a request will not run, and a second request that waited for
   * the first would never be sent. So the close hook is told that this is what
   * is happening, and a plugin that has something to tell the server sends it
   * in one breath — see the ONLYOFFICE plugin, which ends its editing session
   * with a single beacon rather than the two calls it makes when there is time.
   *
   * Nothing here touches the state: it is about to stop existing anyway, and
   * clearing it would only risk cancelling the very request being sent.
   */
  const endForUnload = () => {
    if (!plugin.value || !item.value) return false;
    try {
      plugin.value.onBeforeClose?.(item.value, { unloading: true });
    } catch (error) {
      console.warn(`Plugin ${plugin.value.id} onBeforeClose error while unloading:`, error);
    }
    return true;
  };

  const close = () => {
    if (pendingClose) return pendingClose;
    if (!plugin.value || !item.value) return;

    const closing = plugin.value;
    const closed = item.value;

    pendingClose = Promise.resolve(closing.onBeforeClose?.(closed, { unloading: false }))
      .catch((error) => {
        // A preview must always remain closable. Plugins can use this hook for
        // best-effort cleanup such as asking ONLYOFFICE to flush changes.
        console.warn(`Plugin ${closing.id} onBeforeClose error:`, error);
      })
      .then(() => {
        try {
          closing.onClose?.(closed);
        } catch (error) {
          console.error(`Plugin ${closing.id} onClose error:`, error);
        }

        // A new document may have been opened here while an asynchronous close
        // hook was pending; never close that newer one by accident.
        if (plugin.value === closing && item.value === closed) {
          item.value = null;
          plugin.value = null;
        }
      })
      .finally(() => {
        pendingClose = null;
      });

    return pendingClose;
  };

  return { item, plugin, isOpen, shows, show, close, endForUnload };
}
