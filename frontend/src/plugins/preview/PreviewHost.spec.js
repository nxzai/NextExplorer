import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

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
  }),
}));

import PreviewHost from './PreviewHost.vue';

/**
 * Everything here is teleported to the body, so the page is what is asked rather
 * than the wrapper: `find` does not walk through a teleport.
 */
let wrapper = null;

const withTabs = (keys, active = keys[0]) => {
  surfaces.value = keys.map((key) => ({ key, session: { key } }));
  activeId.value = active;
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
