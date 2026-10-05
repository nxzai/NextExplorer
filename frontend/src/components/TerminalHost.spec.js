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
/**
 * Where the tab is, which a terminal that *is* the tab now asks before drawing itself:
 * it used to cover whatever the tab held for as long as the tab was in front, so
 * leaving it did nothing at all.
 */
const where = reactive({ path: '/terminal/Projects' });
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => where }));

const tabsStore = reactive({
  tabs: [{ id: 'tab-1' }, { id: 'tab-2' }],
  activeId: 'tab-1',
  canClose: true,
});
vi.mock('@/stores/tabs', async () => {
  const actual = await vi.importActual('@/stores/tabs');
  return { ...actual, useTabsStore: () => tabsStore };
});

const closeTab = vi.hoisted(() => vi.fn());
vi.mock('@/composables/tabNavigation', () => ({
  useTabNavigation: () => ({ close: closeTab }),
}));

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
  tabsStore.tabs = [{ id: 'tab-1' }, { id: 'tab-2' }];
  tabsStore.activeId = 'tab-1';
  tabsStore.canClose = true;
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

    where.path = '/browse/Projects';
    await nextTick();
    expect(surface().classes()).toContain('invisible');

    // And the session is not ended by leaving: stepping back finds the shell.
    where.path = '/terminal/Projects';
    await nextTick();
    expect(surface().classes()).not.toContain('invisible');
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

    where.path = '/browse/Projects';
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
