import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

/**
 * Every terminal that is open, drawn where its tab wants it.
 *
 * What matters here is what is *not* done: a terminal whose tab is behind another
 * is hidden, never unmounted. Unmounting is what kills a shell, and a shell that
 * dies when its tab goes behind another is the whole complaint — four folders can
 * each have a terminal running in them, and coming back to one is coming back to
 * what it has been doing.
 *
 * xterm is stubbed out because it reaches for a canvas jsdom does not have; what
 * it is asked here is which surfaces exist and which of them is on screen, and
 * that is a question about this component rather than about a terminal.
 */

vi.mock('@/components/TerminalSurface.vue', () => ({
  default: {
    name: 'TerminalSurface',
    props: ['path', 'initialInput', 'active', 'visible'],
    setup: () => () => null,
  },
}));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

const push = vi.hoisted(() => vi.fn());
// Only to take a tab home when the last one shuts its shell.
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const tabsStore = reactive({
  // Each tab's own address, which is what a terminal that *is* the tab asks
  // before drawing itself. Its own and not the window's: in a pair the window is
  // at whichever pane the reader is in, so a shell beside a folder that asked the
  // window was asking about the folder.
  tabs: [
    { id: 'tab-1', path: '/terminal/Projects' },
    { id: 'tab-2', path: '/browse/Media' },
  ],
  activeId: 'tab-1',
  canClose: true,
  // The tabs on screen: one, or the two halves of a pair. A shell is shown for
  // every pane rather than for the tab in front, which is what lets one sit in
  // the half beside the reader.
  // Set by a test that wants a pair; otherwise the tab in front, alone.
  shown: null,
  get panes() {
    return this.shown || [this.activeId];
  },
});
vi.mock('@/stores/tabs', async () => {
  const actual = await vi.importActual('@/stores/tabs');
  return { ...actual, useTabsStore: () => tabsStore };
});

const closeTab = vi.hoisted(() => vi.fn());
vi.mock('@/composables/tabNavigation', () => ({
  useTabNavigation: () => ({ close: closeTab }),
}));

import { beginTabDrag, endTabDrag } from '@/utils/tabDrag';
import { useTerminalStore } from '@/stores/terminal';
import { createPinia, setActivePinia } from 'pinia';
import TerminalHost from './TerminalHost.vue';

let terminals;

const show = () => mount(TerminalHost, { global: { mocks: { $t: (key) => key } } });
const boxes = (wrapper) => wrapper.findAll('[data-test="terminal-surface-host"]');

beforeEach(() => {
  setActivePinia(createPinia());
  terminals = useTerminalStore();
  push.mockClear();
  closeTab.mockClear();
  tabsStore.tabs = [
    { id: 'tab-1', path: '/terminal/Projects' },
    { id: 'tab-2', path: '/browse/Media' },
  ];
  tabsStore.activeId = 'tab-1';
  tabsStore.shown = null;
  tabsStore.canClose = true;
  endTabDrag();
});

describe('the terminals on screen', () => {
  /**
   * A terminal that *is* the tab is drawn while the tab is at one — and gets out of the
   * way when the tab goes somewhere else.
   *
   * It did not. It covered whatever the tab held for as long as that tab was in front,
   * so a favourite or a volume pressed in the sidebar took the tab to that folder, the
   * folder was drawn underneath, and the terminal stayed on top of it. The reader had a
   * sidebar that answered nothing.
   */
  it('gets out of the way when its tab goes somewhere else', async () => {
    terminals.openIn('tab-1', 'Projects', { mode: 'page' });
    const wrapper = show();

    const surface = () => wrapper.get('[data-tab="tab-1"]');
    expect(surface().classes()).not.toContain('invisible');

    tabsStore.tabs[0].path = '/browse/Projects';
    await nextTick();
    expect(surface().classes()).toContain('invisible');

    // And the session is not ended by leaving: stepping back finds the shell.
    tabsStore.tabs[0].path = '/terminal/Projects';
    await nextTick();
    expect(surface().classes()).not.toContain('invisible');
  });

  /**
   * And it steps out of the way while a tab is being dragged.
   *
   * A shell is drawn over the pane it belongs to without being inside it, so a
   * tab dropped on the half holding a shell landed on the shell and the pane
   * never heard a word about it — the one half a reader could not replace was the
   * one with something in it.
   */
  it('takes no pointers while a tab is being dragged', async () => {
    terminals.openIn('tab-1', 'Projects', { mode: 'page' });
    const wrapper = show();
    const surface = () => wrapper.get('[data-tab="tab-1"]');
    expect(surface().classes()).not.toContain('pointer-events-none');

    beginTabDrag();
    await nextTick();
    expect(surface().classes()).toContain('pointer-events-none');

    endTabDrag();
    await nextTick();
    expect(surface().classes()).not.toContain('pointer-events-none');
  });

  /**
   * A shut drawer is still drawn — hidden.
   *
   * Shutting it no longer ends the shell, so the surface has to stay on the page or it
   * is unmounted, and an unmounted terminal is a killed shell. Hidden is the whole
   * mechanism: the box keeps its place, the socket keeps printing, and opening the
   * drawer again is looking at what has been there all along.
   */
  it('keeps a shut drawer on the page, out of sight', async () => {
    terminals.openIn('tab-1', 'Projects');
    const wrapper = show();

    terminals.closeIn('tab-1');
    await nextTick();

    const surface = wrapper.find('[data-tab="tab-1"]');
    expect(surface.exists()).toBe(true);
    expect(surface.classes()).toContain('invisible');

    terminals.openIn('tab-1', 'Projects');
    await nextTick();
    expect(wrapper.get('[data-tab="tab-1"]').classes()).not.toContain('invisible');
  });

  /** A drawer is the other case: it floats over whatever the tab is on. */
  it('leaves a drawer where it is, whatever the tab is showing', async () => {
    terminals.openIn('tab-1', 'Projects', { mode: 'drawer' });
    const wrapper = show();

    tabsStore.tabs[0].path = '/browse/Projects';
    await nextTick();

    expect(wrapper.get('[data-tab="tab-1"]').classes()).not.toContain('invisible');
  });

  it('are one per tab that has one, and none for a tab that has not', () => {
    terminals.openIn('tab-2', 'Media');
    const wrapper = show();

    expect(boxes(wrapper)).toHaveLength(1);
    expect(boxes(wrapper)[0].attributes('data-tab')).toBe('tab-2');
  });

  /**
   * Both there, one of them looked at. Hidden rather than taken away: what is
   * taken away is a running shell.
   */
  it('are all of them at once, with only the tab in front showing', () => {
    terminals.openIn('tab-1', 'Docs');
    terminals.openIn('tab-2', 'Media');
    const wrapper = show();

    const [first, second] = boxes(wrapper);
    expect(boxes(wrapper)).toHaveLength(2);
    expect(first.attributes('data-active')).toBe('true');
    expect(second.attributes('data-active')).toBe('false');
    expect(second.classes()).toContain('invisible');
    // Still mounted, which is what keeps the shell alive.
    expect(second.findComponent({ name: 'TerminalSurface' }).exists()).toBe(true);
  });

  it('follow the tab in front rather than being rebuilt for it', async () => {
    terminals.openIn('tab-1', 'Docs');
    terminals.openIn('tab-2', 'Media');
    const wrapper = show();
    const before = wrapper.findAllComponents({ name: 'TerminalSurface' }).length;

    tabsStore.activeId = 'tab-2';
    await flushPromises();

    expect(wrapper.findAllComponents({ name: 'TerminalSurface' })).toHaveLength(before);
    expect(boxes(wrapper)[1].attributes('data-active')).toBe('true');
  });

  /**
   * And a shell in the pane *beside* the reader is shown too.
   *
   * Keyed on the tab in front, that half of the screen had a running shell and
   * drew nothing at all.
   */
  it('are shown for every pane, not only for the tab in front', async () => {
    terminals.openIn('tab-1', 'Docs');
    terminals.openIn('tab-2', 'Media');
    const wrapper = show();

    tabsStore.shown = ['tab-1', 'tab-2'];
    await flushPromises();

    expect(boxes(wrapper)[0].attributes('data-active')).toBe('true');
    expect(boxes(wrapper)[1].attributes('data-active')).toBe('true');
  });

  /**
   * A shell that *is* its tab, in the pane beside the reader, with the reader in a
   * folder.
   *
   * It drew nothing. Whether a terminal that is the tab is on screen was decided by
   * asking the *window* where it was, and in a pair the window is at whichever pane
   * the reader is in — so the half holding the shell was asked whether the folder in
   * the other half was a terminal, and hid itself. A black rectangle beside a folder,
   * for the whole point of putting a shell next to one.
   */
  it('show a shell beside a folder, asking its own tab where it is', async () => {
    terminals.openIn('tab-1', 'Projects', { mode: 'page' });
    const wrapper = show();

    // The reader is in the folder; the shell is the other half of the pair.
    tabsStore.shown = ['tab-1', 'tab-2'];
    tabsStore.activeId = 'tab-2';
    await flushPromises();

    expect(wrapper.get('[data-tab="tab-1"]').classes()).not.toContain('invisible');
  });

  it('go when their tab does', async () => {
    terminals.openIn('tab-1', 'Docs');
    terminals.openIn('tab-2', 'Media');
    const wrapper = show();

    tabsStore.tabs = [{ id: 'tab-1' }];
    await flushPromises();

    expect(boxes(wrapper)).toHaveLength(1);
    expect(terminals.isOpenIn('tab-2')).toBe(false);
  });
});

describe('shutting one', () => {
  it('leaves the tab where it was, when it is the drawer', async () => {
    terminals.openIn('tab-1', 'Docs');
    const wrapper = show();

    await wrapper.find('[data-test="terminal-close"]').trigger('click');

    expect(terminals.isOpenIn('tab-1')).toBe(false);
    expect(closeTab).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('is shut by a click beside it, which is what a drawer is', async () => {
    terminals.openIn('tab-1', 'Docs');
    const wrapper = show();

    await wrapper.find('[data-test="terminal-backdrop"]').trigger('click');

    expect(terminals.isOpenIn('tab-1')).toBe(false);
  });

  /** A terminal that *is* the tab has nothing behind it: shutting it is closing it. */
  it('closes the tab, when it is the whole of one', async () => {
    terminals.openIn('tab-1', 'Docs', { mode: 'page' });
    const wrapper = show();

    await wrapper.find('[data-test="terminal-close"]').trigger('click');

    expect(closeTab).toHaveBeenCalledWith('tab-1');
  });

  it('goes back to the volumes when that tab is the only one', async () => {
    tabsStore.canClose = false;
    terminals.openIn('tab-1', 'Docs', { mode: 'page' });
    const wrapper = show();

    await wrapper.find('[data-test="terminal-close"]').trigger('click');

    expect(closeTab).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/browse/');
  });
});
