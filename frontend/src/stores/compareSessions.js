import { defineStore } from 'pinia';
import { watch } from 'vue';
import { useTabsStore } from '@/stores/tabs';

/**
 * A comparison a tab is in the middle of.
 *
 * The screen is a page, and a page is unmounted the moment another tab comes
 * forward — so a glance at another tab read both files again, redrew everything, and
 * lost the reader's place in the differences. Worse than that: lines taken across and
 * not yet saved exist nowhere but that screen, so they went too, silently, for a
 * click that never said discard.
 *
 * So what the comparison *is* lives here rather than in the page: the files, their
 * lines as they now stand, which of them have been changed, and which difference the
 * reader was on. The page reads it on the way in and writes it on the way out, which
 * is the only way a page can keep a promise it is not around to keep.
 *
 * Kept in memory only, and per tab: this is what the window holds between two
 * glances, not a second copy of somebody's files to be found later.
 */
export const useCompareSessionsStore = defineStore('compare-sessions', () => {
  const tabsStore = useTabsStore();

  /** tab id → `{ address, sides, at }`. A plain Map: nothing is rendered from it. */
  const sessions = new Map();

  // A tab that goes takes its comparison with it. Closing a tab is a decision about
  // what is in it, and keeping the lines would only make them reappear in whatever
  // tab happened to be given the same id later.
  watch(
    () => tabsStore.tabs.map((tab) => tab.id),
    (ids) => {
      for (const id of [...sessions.keys()]) {
        if (!ids.includes(id)) sessions.delete(id);
      }
    }
  );

  /**
   * Hold what this tab is comparing, for the address it is comparing it at.
   *
   * The whole of it, not a list of the fields this store happens to know the names
   * of: the editor's drafts were written that way and quietly dropped the one the
   * screen added later.
   */
  const keep = (key, address, state = {}) => {
    if (!key || !address) return;
    sessions.set(key, { ...state, address });
  };

  const forget = (key) => {
    sessions.delete(key);
  };

  /**
   * What was kept for this tab at this address, or null.
   *
   * The address is half the question: a tab taken to another comparison has nothing
   * to do with the lines of the previous one, and answering with them would put one
   * pair of files' work into another pair.
   */
  const sessionFor = (key, address) => {
    const held = sessions.get(key);
    return held && held.address === address ? held : null;
  };

  return { keep, forget, sessionFor };
});
