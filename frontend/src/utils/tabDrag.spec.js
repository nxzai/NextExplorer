import { afterEach, describe, expect, it } from 'vitest';

import { beginTabDrag, endTabDrag, isTabDrag, tabDragging, TAB_DRAG_TYPE } from './tabDrag';

/**
 * A tab in the air, said in a way the rest of the window can hear.
 *
 * What it is for is the surfaces drawn outside the page — a document, a shell —
 * which sit over the pane they belong to without being inside it. They have to
 * stop taking pointers while a tab is being dragged, or the pane underneath never
 * hears about the drop.
 */
afterEach(endTabDrag);

describe('a tab being dragged', () => {
  it('is nothing until one is', () => {
    expect(tabDragging.value).toBe(false);
  });

  it('is said and unsaid', () => {
    beginTabDrag();
    expect(tabDragging.value).toBe(true);

    endTabDrag();
    expect(tabDragging.value).toBe(false);
  });

  /**
   * And it ends when the drag does, wherever that is.
   *
   * The strip says both, but a drag that ends somewhere else — on another
   * window's target, or with the tab it started on already gone — would leave the
   * flag set, and a flag left set is a document that takes no pointers at all.
   * That is a worse fault than the one it is here to fix, so the window ends it
   * too.
   */
  it('ends on a drop anywhere in the window', () => {
    beginTabDrag();
    window.dispatchEvent(new Event('drop'));

    expect(tabDragging.value).toBe(false);
  });

  it('ends when a drag ends anywhere in the window', () => {
    beginTabDrag();
    window.dispatchEvent(new Event('dragend'));

    expect(tabDragging.value).toBe(false);
  });

  /** And the listeners go with it, rather than one being added per drag. */
  it('leaves nothing behind listening', () => {
    beginTabDrag();
    window.dispatchEvent(new Event('dragend'));
    beginTabDrag();
    window.dispatchEvent(new Event('drop'));

    expect(tabDragging.value).toBe(false);
    beginTabDrag();
    expect(tabDragging.value).toBe(true);
  });
});

describe('what is being dragged', () => {
  it('is one of ours when it says so, and otherwise is not', () => {
    expect(isTabDrag({ dataTransfer: { types: [TAB_DRAG_TYPE, 'text/plain'] } })).toBe(true);
    expect(isTabDrag({ dataTransfer: { types: ['Files'] } })).toBe(false);
    expect(isTabDrag(null)).toBe(false);
  });
});
