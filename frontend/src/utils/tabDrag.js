import { ref } from 'vue';

/**
 * A tab being dragged, said in a way a drop target can recognise.
 *
 * The strip already writes the tab's id as plain text, because Firefox starts no
 * drag at all without something on the transfer. Plain text is not enough for a
 * pane, though: a pane takes drops of files as well, and "some text that happens
 * to look like an id" is not something to act on. So a tab drag also carries its
 * own type, and a target asks for that.
 *
 * The type is read from the *types* list rather than by reading the data, because
 * a browser refuses to hand over the data during `dragover` — which is exactly
 * when a target has to decide whether it wants the drop.
 */
export const TAB_DRAG_TYPE = 'application/x-nextexplorer-tab';

/** Whether what is being dragged is one of this application's tabs. */
export const isTabDrag = (event) =>
  Array.from(event?.dataTransfer?.types || []).includes(TAB_DRAG_TYPE);

/** Which tab, once the drop has happened and the data can be read. */
export const draggedTabId = (event) => event?.dataTransfer?.getData(TAB_DRAG_TYPE) || '';

/**
 * Whether one of our tabs is being dragged, right now, anywhere in the window.
 *
 * Because a pane is not always the topmost thing over its own half. A document
 * and a shell are drawn outside the page and placed over the pane they belong to
 * — they have to be, or they would be unmounted every time their tab went behind
 * another — and neither of them is inside the pane in the page. So a tab dropped
 * on the half holding a document landed on the document, the pane never heard a
 * word about it, and the gesture did nothing at all: the one half a reader cannot
 * replace was the one with something interesting in it.
 *
 * A flag rather than drop handling on each surface: what a surface has to do with
 * a tab being dragged is get out of the way, which is `pointer-events: none` for
 * as long as the drag lasts. Nothing inside a document or a shell wants a pointer
 * while a tab is in the air.
 *
 * Module-level, like the sidebar's: one window, one drag.
 */
export const tabDragging = ref(false);

/** Said by the strip, which is the only place a tab drag can start. */
export const beginTabDrag = () => {
  tabDragging.value = true;
  if (typeof window === 'undefined') return;
  // And ended by the window as well, wherever the drag ends and whatever became
  // of the tab it started on. A flag left true is a document that takes no
  // pointers at all, which is worse than the fault it is here to fix.
  const done = () => {
    tabDragging.value = false;
    window.removeEventListener('dragend', done, true);
    window.removeEventListener('drop', done, true);
  };
  window.addEventListener('dragend', done, true);
  window.addEventListener('drop', done, true);
};

/**
 * And ended by it. `dragend` fires on the tab it started on whether the drop was
 * taken or refused, so there is no drag that ends without this.
 */
export const endTabDrag = () => {
  tabDragging.value = false;
};
