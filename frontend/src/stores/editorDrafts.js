import { defineStore } from 'pinia';
import { watch } from 'vue';
import { useTabsStore } from '@/stores/tabs';

/**
 * Where a tab was in a file: what was typed, where the cursor is, how far down.
 *
 * The text editor is a page, and a page is unmounted the moment another tab comes
 * forward — so everything went with it. First everything typed since the last
 * save, silently, for a click that never said "discard"; and then, even with
 * nothing typed at all, the place: somebody who had scrolled two hundred lines
 * down and selected a paragraph came back to the top of the file with nothing
 * selected. A document open in the preview does not have this problem, because
 * its session lives in the preview manager and outlives the page (see
 * `plugins/preview/session.js`). This is the same promise for the one kind of
 * document that is not a preview.
 *
 * Three things, then, and each of them is the answer to "where was I": the text,
 * when it differs from the file; the selection, which is the cursor when it is
 * empty; and how far the editor was scrolled. Not the undo history — that lives
 * inside CodeMirror and would mean keeping the editor itself alive, which the
 * router cannot do for a page that is not on screen.
 *
 * And a fourth, which is not about where anybody was: `source`, the file as it was
 * last read. Without it a tab coming back read the file from the server again, so
 * every glance at another tab cost a spinner and a redraw — the page has gone, and
 * a page that has gone knows nothing. With it the editor is on screen
 * before anything is asked of the network, and the file is checked quietly
 * afterwards.
 *
 * Kept in memory only, and per tab: this is something the window holds between two
 * glances, not a second copy of somebody's file to be found later in their
 * browser's storage.
 */
export const useEditorDraftsStore = defineStore('editor-drafts', () => {
  const tabsStore = useTabsStore();

  /**
   * tab id → `{ address, text, selection, scrollTop }`. A plain Map: nothing is
   * rendered from it. `text` is null for a file nothing was typed into, which is
   * also how a file being read from the trash or from a history is kept — its
   * place is worth remembering, and it has no text of its own to save.
   */
  const drafts = new Map();

  // A tab that goes takes its draft with it. Closing a tab is a decision about
  // what is in it, and keeping the text would only make it reappear in whatever
  // tab happened to be given the same id later.
  watch(
    () => tabsStore.tabs.map((tab) => tab.id),
    (ids) => {
      for (const id of [...drafts.keys()]) {
        if (!ids.includes(id)) drafts.delete(id);
      }
    }
  );

  /**
   * Hold where the tab was, for the address it belongs to.
   *
   * Kept whole — everything handed over, not a list of the fields this store
   * happens to know the names of. It was written the other way round and it threw
   * one away: where the reader is in a long file is the *line* at the top of the
   * screen rather than a number of pixels, because a scroll position written into
   * CodeMirror before it has measured is clamped to whatever fits. The editor
   * started answering with that line; this store quietly dropped it on the way
   * past, and the reader came back to the top of the file with their cursor
   * intact beside them — the very thing the line was added to fix.
   *
   * @param {string} key  The tab.
   * @param {string} address  The address it is on; a draft belongs to one.
   * @param {object} where  Whatever the editor says a place is, plus `text` —
   *   null unless it differs from the file.
   */
  const keep = (key, address, where = {}) => {
    if (!key || !address) return;
    drafts.set(key, {
      ...where,
      address,
      text: typeof where.text === 'string' ? where.text : null,
      selection: where.selection || null,
      scrollTop: Number.isFinite(where.scrollTop) ? where.scrollTop : 0,
    });
  };

  const forget = (key) => {
    drafts.delete(key);
  };

  /**
   * What was kept for this tab at this address, or null.
   *
   * The address is half the question: a tab that was taken to another file has
   * nothing to do with what was typed into the previous one, and answering with it
   * would put one file's work — and one file's cursor — into another file.
   */
  const placeFor = (key, address) => {
    const draft = drafts.get(key);
    return draft && draft.address === address ? draft : null;
  };

  return { keep, forget, placeFor };
});
