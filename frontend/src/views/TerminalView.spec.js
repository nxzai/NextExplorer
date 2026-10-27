import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

/**
 * A tab that is a terminal.
 *
 * The page draws none: it says that its tab wants one and that it wants the whole
 * of the tab, and the host draws it. Not an indirection for its own sake — a page
 * is unmounted the moment another tab comes forward, and a terminal that is
 * unmounted is a shell that has been killed. So what this page owes is exactly
 * two things: the folder the shell starts in, and asking again for the session it
 * already has rather than for a new one.
 */

const routePath = ref('Docs/2026');

/**
 * The pane's own address, which is where a screen reads its place from now: in a
 * pair only one pane is the route, and a screen that read the window's address
 * drew somebody else's place. The same route this spec already states.
 */
const paneTab = vi.hoisted(() => ({ id: 'tab-1' }));
vi.mock('@/composables/paneTab', () => ({
  usePaneRoute: () => ({
    get params() {
      return { path: routePath.value };
    },
  }),
  // And the tab of the pane it is drawn in, which is the tab in front only when
  // there is one pane.
  usePaneTabId: () => ({
    get value() {
      return paneTab.id;
    },
  }),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    get params() {
      return { path: routePath.value };
    },
  }),
}));

vi.mock('@/api', () => ({
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

// The instance's name, for the browser tab's title.
vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({ state: { branding: { appName: 'Chez Benjy' } } }),
}));

const openIn = vi.hoisted(() => vi.fn());
vi.mock('@/stores/terminal', () => ({ useTerminalStore: () => ({ openIn }) }));

import TerminalView from './TerminalView.vue';

const show = (path = 'Docs/2026') => {
  routePath.value = path;
  return mount(TerminalView, { global: { mocks: { $t: (key) => key } } });
};

beforeEach(() => {
  openIn.mockClear();
  paneTab.id = 'tab-1';
});

describe('a terminal that is a whole tab', () => {
  it('asks for one in this tab, in the folder the address names', () => {
    show('Docs/2026');

    expect(openIn).toHaveBeenCalledWith('tab-1', 'Docs/2026', { mode: 'page' });
  });

  /** Nowhere in particular, which is where the home page opens one. */
  it('starts nowhere in particular when the address names no folder', () => {
    show('');

    expect(openIn).toHaveBeenCalledWith('tab-1', '', { mode: 'page' });
  });

  it('names the browser tab after the folder, and the instance', () => {
    show('Docs/2026');

    expect(window.document.title).toBe('titles.terminal — 2026 | Chez Benjy');
  });

  /**
   * A shell cannot change its mind about where it started, so a tab taken to
   * another folder asks for a terminal in that one; the store decides whether
   * that is the session it already has.
   */
  it('asks again when its tab is taken to another folder', async () => {
    const wrapper = show('Docs/2026');
    expect(openIn).toHaveBeenCalledTimes(1);

    routePath.value = 'Media';
    await wrapper.vm.$nextTick();

    expect(openIn).toHaveBeenLastCalledWith('tab-1', 'Media', { mode: 'page' });
  });

  /**
   * And it asks in the tab of the pane it is drawn in, not in the tab in front.
   *
   * A shell beside a folder is this page drawn in the half the reader is *not* in.
   * Asking for the tab in front gave the session to the neighbour — the folder tab
   * — so the folder tab owned a shell it never showed, and the half holding the
   * shell drew this page's dark ground and nothing else. Which is "the terminal
   * does not work in two tabs side by side", exactly.
   */
  it('asks in its own pane tab, not in the tab in front', () => {
    paneTab.id = 'tab-2';

    show('Docs/2026');

    expect(openIn).toHaveBeenCalledWith('tab-2', 'Docs/2026', { mode: 'page' });
  });

  /** And it draws no terminal itself: that is what keeps the shell alive. */
  it('draws none of it', () => {
    const wrapper = show('Docs/2026');

    expect(wrapper.find('[data-test="terminal-page"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'TerminalSurface' }).exists()).toBe(false);
  });
});
