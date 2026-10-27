import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';

/**
 * Which tabs are still busy, so the strip can say so.
 *
 * What a browser does, and for a reason that matters more here than there: a tab
 * got ready in the background is doing its work while the reader is looking at
 * something else, and without a word from it there is nothing to distinguish "not
 * loaded yet" from "loaded and empty". A reader who opens four documents behind
 * and goes to the third wants to know whether it is nearly there.
 *
 * A count rather than a flag, because more than one thing is in flight at once —
 * a document tab reads the folder behind it for the arrows while its editor is
 * still connecting — and the first of them to finish must not declare the tab done.
 *
 * Nothing here knows what the work *is*. Whoever starts something says so and
 * says when it is over, which is why the same store serves a listing being read,
 * a file being fetched and a document server being reached.
 */
export const useTabLoadingStore = defineStore('tab-loading', () => {
  /** Tab id → how many things are in flight for it. */
  const inFlight = reactive({});

  const isLoading = (id) => (id ? (inFlight[id] ?? 0) > 0 : false);

  const begin = (id) => {
    if (!id) return () => {};
    inFlight[id] = (inFlight[id] ?? 0) + 1;
    let released = false;
    // Answers with the way to end it, so no caller has to remember to pair them
    // and none can end somebody else's work by ending its own twice.
    return () => {
      if (released) return;
      released = true;
      end(id);
    };
  };

  const end = (id) => {
    if (!id) return;
    const left = (inFlight[id] ?? 0) - 1;
    if (left > 0) inFlight[id] = left;
    else delete inFlight[id];
  };

  /** Everything this tab was waiting for, forgotten: the tab has gone. */
  const forget = (id) => {
    delete inFlight[id];
  };

  const keepOnly = (ids) => {
    const live = new Set(ids || []);
    for (const id of Object.keys(inFlight)) {
      if (!live.has(id)) delete inFlight[id];
    }
  };

  const busyIds = computed(() => Object.keys(inFlight));

  return { isLoading, begin, end, forget, keepOnly, busyIds };
});
