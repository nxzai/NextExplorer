import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, defineComponent, h, reactive, ref, nextTick } from 'vue';

/**
 * Where each pane is, and who says so.
 *
 * The two surfaces drawn outside the page — a document, a shell — are placed from
 * these boxes, and the only placement left to them without one is the whole
 * window, over the pane beside them. So what matters here is not the arithmetic:
 * it is that a box exists for every pane on screen, from the first frame, and that
 * it does not go away under a pane that is being handed another tab.
 */
const tabsStore = reactive({
  panes: ['tab-1', 'tab-2'],
  // And which tabs exist at all, which is a different question: a tab off screen
  // still has a place, and what is drawn over it comes back to that place.
  tabs: [{ id: 'tab-1' }, { id: 'tab-2' }],
});
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => tabsStore }));

import { usePaneBoxes, useReportsPaneBox } from './paneBoxes';

/** jsdom lays nothing out, so a pane is as wide as the test says it is. */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    const left = Number(this.getAttribute('data-left') || 0);
    const width = Number(this.getAttribute('data-width') || 600);
    const height = Number(this.getAttribute('data-height') || 400);
    return {
      top: 40,
      bottom: 40 + height,
      left,
      right: left + width,
      x: left,
      y: 40,
      width,
      height,
    };
  };
});

/** A pane, as the layout draws one: an element that says where it is. */
const Pane = defineComponent({
  props: { tabId: { type: String, required: true }, left: { type: Number, default: 0 } },
  setup(props) {
    const root = ref(null);
    useReportsPaneBox(
      computed(() => props.tabId),
      root
    );
    return () =>
      h('section', {
        ref: root,
        'data-pane-tab': props.tabId,
        'data-left': String(props.left),
      });
  },
});

let wrapper = null;

/**
 * A window that opens with these panes already in it.
 *
 * Awaited, because a pane reports once it is laid out — which is one microtask
 * after it is mounted, and before anything is painted.
 */
const windowWith = async (...panes) => {
  wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          'div',
          panes.map((one) => h(Pane, { key: one.id, tabId: one.id, left: one.left ?? 0 }))
        ),
    }),
    { attachTo: document.body }
  );
  await nextTick();
  return wrapper;
};

beforeEach(() => {
  tabsStore.panes = ['tab-1', 'tab-2'];
});

afterEach(() => {
  // Nothing on screen, so every pane forgets its box on the way out and the next
  // test starts from nothing: these boxes belong to the window, not to a caller.
  tabsStore.panes = [];
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('the boxes of the panes', () => {
  /**
   * The case that was broken, and the only one a reader ever met: a window that
   * *opens* split.
   *
   * The boxes used to be gone looking for by whatever was drawn over them, when
   * the panes changed. On a reload of a window already showing a pair, that look
   * happened before the page existed, found no panes, and nothing looked again —
   * so every document and every shell was placed over the whole window, covering
   * the screen beside it, for as long as the page lived. That is the ONLYOFFICE
   * document across both halves.
   */
  it('are there from the first frame of a window that opens split', async () => {
    await windowWith({ id: 'tab-1', left: 0 }, { id: 'tab-2', left: 600 });
    const { boxFor } = usePaneBoxes();

    expect(boxFor('tab-1')).toEqual({
      top: '40px',
      left: '0px',
      width: '600px',
      height: '400px',
    });
    expect(boxFor('tab-2').left).toBe('600px');
  });

  it('are nothing for a tab that is in no pane', async () => {
    await windowWith({ id: 'tab-1' });

    expect(usePaneBoxes().boxFor('tab-9')).toBeNull();
  });

  /** A pane can be given another tab, and the box belongs to the tab it holds. */
  it('follow the tab a pane is handed', async () => {
    const held = ref('tab-1');
    wrapper = mount(
      defineComponent({
        setup: () => () => h(Pane, { tabId: held.value, left: 120 }),
      }),
      { attachTo: document.body }
    );
    await nextTick();
    const { boxFor } = usePaneBoxes();
    expect(boxFor('tab-1').left).toBe('120px');

    tabsStore.panes = ['tab-2'];
    held.value = 'tab-2';
    await nextTick();
    await nextTick();

    expect(boxFor('tab-2').left).toBe('120px');
  });

  /**
   * And a pane that is not laid out says nothing rather than saying nought.
   *
   * A box of nought by nought is not a placement, and a third-party editor handed
   * one does not always measure its way back out of it.
   */
  it('stand through a frame in which a pane has no area', async () => {
    await windowWith({ id: 'tab-1' });
    const { boxFor } = usePaneBoxes();
    expect(boxFor('tab-1').width).toBe('600px');

    document.querySelector('[data-pane-tab="tab-1"]').setAttribute('data-width', '0');
    window.dispatchEvent(new Event('resize'));
    await nextTick();

    expect(boxFor('tab-1').width).toBe('600px');
  });

  /**
   * A pane replaced mid-swap keeps its box.
   *
   * Swapping the halves of a pair unmounts both panes and mounts two more. The box
   * of a tab that is still on screen has to survive that frame: dropped, it leaves
   * a document with the whole window as its only placement, and nothing measures
   * again to take it back.
   */
  it('survive the pane being replaced while its tab is still on screen', async () => {
    await windowWith({ id: 'tab-1', left: 0 }, { id: 'tab-2', left: 600 });
    const { boxFor } = usePaneBoxes();
    expect(boxFor('tab-1')).not.toBeNull();

    // Both panes go; both tabs are still the two halves on screen.
    wrapper.unmount();
    wrapper = null;

    expect(boxFor('tab-1')).not.toBeNull();
    expect(boxFor('tab-2')).not.toBeNull();
  });

  /**
   * And a tab that is only off screen keeps its place.
   *
   * This is what a reader sees when they come back to a pair of documents: the
   * half on the right is destroyed when the pair leaves the window, so its box was
   * dropped — and coming back, the document in it was placed over the *whole
   * window* for a frame before the measurement arrived and put it back in its half.
   * Measured in a browser: 0+1280 on the frame it returned, 756+525 on the next. An
   * editor handed a window-wide box lays itself out for it, and lays itself out
   * again a frame later: the jump that looks like the document reloading.
   */
  it('stay for a tab that has only left the screen', async () => {
    await windowWith({ id: 'tab-1', left: 0 }, { id: 'tab-2', left: 600 });
    const { boxFor } = usePaneBoxes();

    // The reader goes to another tab: the pair is not drawn, and the right-hand
    // pane is destroyed with its props.
    tabsStore.panes = ['tab-9'];
    wrapper.unmount();
    wrapper = null;

    expect(boxFor('tab-2')).not.toBeNull();
  });

  /** What has gone for good is forgotten: a tab that has been closed. */
  it('are forgotten when the tab itself has gone', async () => {
    await windowWith({ id: 'tab-1', left: 0 }, { id: 'tab-2', left: 600 });
    const { boxFor } = usePaneBoxes();

    tabsStore.panes = ['tab-1'];
    tabsStore.tabs = [{ id: 'tab-1' }];
    wrapper.unmount();
    wrapper = null;

    expect(boxFor('tab-2')).toBeNull();
  });
});
