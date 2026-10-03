import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';

/**
 * Every tab's document, and the one in front.
 *
 * Two things are worth holding here, and neither of them is what the page looks
 * like.
 *
 * A surface that is not in front stays **mounted**. Rendering one tab at a time
 * would unmount the others, and a surface that is unmounted and mounted again is
 * a new one: ONLYOFFICE would open the document from nothing every time somebody
 * came back to its tab — new connection, no cursor, no undo. The test for it
 * counts how many times a surface was built, which is the only thing that
 * distinguishes "hidden" from "rebuilt".
 *
 * And it hides with `visibility`, not `display`. A third-party editor that comes
 * back to a box of zero by zero has to be told to measure itself again, assuming
 * it notices.
 */

const builds = vi.fn();
vi.mock('@/plugins/preview/PreviewSurface.vue', () => ({
  default: {
    name: 'PreviewSurface',
    props: ['session'],
    setup: (props) => builds(props.session.key),
    template: '<div class="surface" :data-session="session.key"></div>',
  },
}));

const surfaces = ref([]);
const activeId = ref('tab-1');
// The tabs on screen: one, or the two halves of a pair.
const panes = ref(['tab-1']);
const endForUnload = vi.fn();
vi.mock('@/plugins/preview/manager', () => ({
  usePreviewManager: () => ({
    get surfaces() {
      return surfaces.value;
    },
    endForUnload: (...args) => endForUnload(...args),
  }),
}));
vi.mock('@/stores/tabs', () => ({
  useTabsStore: () => ({
    get activeId() {
      return activeId.value;
    },
    get panes() {
      return panes.value;
    },
  }),
}));

import { beginTabDrag, endTabDrag } from '@/utils/tabDrag';
import PreviewHost from './PreviewHost.vue';

/**
 * Everything here is teleported to the body, so the page is what is asked rather
 * than the wrapper: `find` does not walk through a teleport.
 */
let wrapper = null;

const withTabs = (keys, active = keys[0], shown = [active]) => {
  surfaces.value = keys.map((key) => ({ key, session: { key } }));
  activeId.value = active;
  panes.value = shown;
  wrapper = mount(PreviewHost);
  return wrapper;
};

const drawn = () => document.body.querySelectorAll('.surface');
const surfaceFor = (key) => document.body.querySelector(`[data-session="${key}"]`);

beforeEach(() => {
  builds.mockClear();
  endForUnload.mockClear();
});

afterEach(() => {
  endTabDrag();
  // Each of these listens for `pagehide` on the window; one left mounted answers
  // the next test's events too.
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('the surfaces', () => {
  it('draws one per tab', () => {
    withTabs(['tab-1', 'tab-2', 'tab-3']);

    expect(drawn()).toHaveLength(3);
  });

  it('shows the one in front and hides the rest', () => {
    withTabs(['tab-1', 'tab-2']);

    const hidden = surfaceFor('tab-2').parentElement;
    expect(hidden.className).toContain('invisible');
    expect(surfaceFor('tab-1').parentElement.className).not.toContain('invisible');

    // Not clickable either, however a descendant feels about its own visibility.
    expect(hidden.className).toContain('pointer-events-none');
  });

  /**
   * And shows *both* when two tabs are drawn side by side.
   *
   * A document in the pane beside the reader is as much on screen as the one
   * they are in. Keyed on the tab in front, that pane showed nothing at all.
   */
  it('shows every tab that is on screen, not only the one in front', () => {
    withTabs(['tab-1', 'tab-2', 'tab-3'], 'tab-1', ['tab-1', 'tab-2']);

    expect(surfaceFor('tab-1').parentElement.className).not.toContain('invisible');
    expect(surfaceFor('tab-2').parentElement.className).not.toContain('invisible');
    expect(surfaceFor('tab-3').parentElement.className).toContain('invisible');
  });

  /**
   * And steps out of the way while a tab is being dragged.
   *
   * A document is drawn over the pane it belongs to without being inside it —
   * it has to be, or it would be unmounted every time its tab went behind
   * another. So a tab dropped on the half holding a document landed on the
   * document, the pane never heard a word about it, and the gesture did nothing:
   * the one half a reader could not replace was the one with something in it.
   */
  it('takes no pointers while a tab is being dragged', async () => {
    withTabs(['tab-1']);
    const shown = () => surfaceFor('tab-1').parentElement.className;
    expect(shown()).not.toContain('pointer-events-none');

    beginTabDrag();
    await nextTick();
    expect(shown()).toContain('pointer-events-none');

    endTabDrag();
    await nextTick();
    expect(shown()).not.toContain('pointer-events-none');
  });

  /**
   * The wrapper positions nothing itself.
   *
   * It carries where its pane is, as custom properties, and the surface inside
   * it goes there. Giving the wrapper the box instead put a transparent sheet
   * over the content area for every open document whether or not it was drawing
   * anything — and a sheet over the application swallows every click in it,
   * which is what it did: the sign-in button could not be pressed.
   */
  it('positions nothing itself, and says where its pane is', () => {
    withTabs(['tab-1']);

    const wrapper = surfaceFor('tab-1').parentElement;
    expect(wrapper.className).not.toContain('fixed');
    expect(wrapper.className).not.toContain('absolute');
    // And the box is handed down rather than applied.
    expect(wrapper.style.getPropertyValue('--pane-top')).toBeTruthy();
    expect(wrapper.style.getPropertyValue('--pane-height')).toBeTruthy();
  });

  /**
   * Before any pane has been measured it is the window below the strip, which is
   * what every one of these was positioned against until panes existed: the
   * first paint is what it always was, and a measurement only moves it inwards.
   */
  it('falls back to the content area for a pane it has not measured', () => {
    withTabs(['tab-1']);

    const wrapper = surfaceFor('tab-1').parentElement;
    expect(wrapper.style.getPropertyValue('--pane-top')).toBe('var(--tab-strip-height)');
    expect(wrapper.style.getPropertyValue('--pane-left')).toBe('0px');
  });

  /**
   * The one that matters. Bringing another tab forward must change which surface
   * is visible and nothing else: a surface built a second time is a document
   * opened a second time.
   */
  it('does not build a surface again when another tab comes forward', async () => {
    const host = withTabs(['tab-1', 'tab-2']);
    expect(builds).toHaveBeenCalledTimes(2);

    activeId.value = 'tab-2';
    await host.vm.$nextTick();
    activeId.value = 'tab-1';
    panes.value = ['tab-1'];
    await host.vm.$nextTick();

    expect(builds).toHaveBeenCalledTimes(2);
    expect(surfaceFor('tab-1')).not.toBeNull();
  });

  /** Hidden, not removed: `display: none` is a box of zero by zero to come back to. */
  it('keeps a hidden surface in the page', () => {
    withTabs(['tab-1', 'tab-2']);

    const hidden = surfaceFor('tab-2');
    expect(hidden).not.toBeNull();
    expect(hidden.parentElement.className).not.toContain('hidden');
  });
});

describe('the window going away', () => {
  /**
   * Here rather than on the page showing a document, because the page is not
   * where a document lives any more: a spreadsheet being edited in a background
   * tab still has a session on the server, and so does a preview opened over a
   * folder listing — which had no such hook at all and left its session behind.
   */
  it('tells the manager, once', () => {
    withTabs(['tab-1']);

    window.dispatchEvent(new Event('pagehide'));

    expect(endForUnload).toHaveBeenCalledTimes(1);
  });

  it('stops listening once it is gone', () => {
    const host = withTabs(['tab-1']);
    host.unmount();

    window.dispatchEvent(new Event('pagehide'));

    expect(endForUnload).not.toHaveBeenCalled();
  });
});
