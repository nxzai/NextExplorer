import { defineStore } from 'pinia';

/**
 * A tab that has something to say before it is closed.
 *
 * Closing a tab is the one gesture that destroys what the tab was holding, and the
 * tabs store cannot know whether that matters: it holds addresses, not work. A
 * comparison with lines copied across and not saved has something to lose; a folder
 * has not, and being asked about a folder would train everybody to click through the
 * question without reading it.
 *
 * So a screen that has something to lose says so, by leaving a question here for its
 * own tab. Whoever closes a tab asks; anything with no question closes as it always
 * has.
 *
 * Not a watcher over anything: a screen registers on the way in and takes it back on
 * the way out, which is the only shape that works for a page the router unmounts
 * whenever another tab comes forward.
 */
export const useTabGuardsStore = defineStore('tab-guards', () => {
  /** tab id → a function answering whether that tab may close. */
  const questions = new Map();

  const guard = (id, ask) => {
    if (!id || typeof ask !== 'function') return () => {};
    questions.set(id, ask);
    // Answers with the way to take it back, so no caller has to remember to pair them
    // and none can take back somebody else's.
    return () => {
      if (questions.get(id) === ask) questions.delete(id);
    };
  };

  /**
   * Whether this tab may close.
   *
   * True for a tab nobody asked about, which is nearly all of them — and true if the
   * question itself goes wrong, because a screen with a broken question must not be
   * able to make a tab unclosable.
   *
   * Answers with a promise, because the question is now the application's own dialog
   * rather than the browser's box. `window.confirm` gave an answer on the spot by
   * stopping the world; a dialog that is part of the page cannot, so everything from
   * here to the cross on the tab waits for it.
   */
  const mayClose = async (id) => {
    const ask = questions.get(id);
    if (!ask) return true;
    try {
      return (await ask()) !== false;
    } catch {
      return true;
    }
  };

  const release = (id) => {
    questions.delete(id);
  };

  return { guard, mayClose, release };
});
