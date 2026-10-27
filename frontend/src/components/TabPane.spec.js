import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

/**
 * One of the panes a split view is made of.
 *
 * What is wrong by default here, and was the first time, is which tab a pane
 * thinks it is drawing: it asked the pane composable, and `inject` does not see
 * what the same component provided — so both panes answered "the tab in front"
 * and both said they had focus. Which is why every assertion below is about the
 * pane that does *not* hold the active tab; a pane that does cannot tell the
 * difference, and neither could the store.
 *
 * The other fault that pane had is not visible from here: a tab dropped into it
 * never arrived, because the uploader's drop target is the scrolling area inside
 * the pane and stops a drop before it can bubble out. There is no uploader in
 * jsdom, so that one is held by the browser journey, where it was found.
 */

const appTabs = vi.hoisted(() => ({
  tabs: [
    { id: 'tab-here', kind: 'folder', path: '/browse/Here' },
    { id: 'tab-beside', kind: 'folder', path: '/browse/Beside' },
  ],
  activeId: 'tab-here',
}));
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => appTabs }));

/**
 * Moving the reader goes through the navigation, not through the store.
 *
 * Both of these gestures can change which tab the reader is in, and the window's
 * address belongs to that tab — so the store's move and the router's push are one
 * action, held in one place with its own spec. What is asked here is that the pane
 * asks for it rather than doing half of it itself.
 */
const navigation = vi.hoisted(() => ({
  activate: vi.fn(),
  showInPane: vi.fn(),
  closePane: vi.fn(),
}));
vi.mock('@/composables/tabNavigation', () => ({ useTabNavigation: () => navigation }));

const routerPush = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush, resolve: () => ({ matched: [] }) }),
  useRoute: () => ({ params: {}, query: {}, path: '/browse/Here', fullPath: '/browse/Here' }),
  // Mocking a router means mocking what builds one: the module the application
  // keeps its routes in is pulled in by what a pane resolves.
  createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), resolve: vi.fn() }),
  createWebHistory: () => ({}),
  RouterLink: { template: '<a><slot /></a>' },
}));

// A pane writes its tab's name in its header, which asks the catalogue.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key, te: () => false }),
  createI18n: () => ({ install: () => {}, global: { t: (key) => key } }),
}));

// The folder's own toolbar is held in its own place; what is asked here is
// whether a pane draws one at all.
vi.mock('@/components/FolderViewToolbar.vue', () => ({
  default: defineComponent({ setup: () => () => h('div', { 'data-test': 'folder-toolbar' }) }),
}));

import TabPane from './TabPane.vue';
import { TAB_DRAG_TYPE } from '@/utils/tabDrag';

const Drawn = defineComponent({
  setup: () => () => h('div', { 'data-test': 'drawn' }, 'a screen'),
});

const paneFor = (tabId, extra = {}) =>
  mount(TabPane, {
    props: { tabId, routedComponent: Drawn, routedKey: '/browse/Here', ...extra },
    global: { mocks: { $t: (key) => key } },
  });

/** A drag carrying a tab, as the strip starts one. */
const tabDrag = (id) => ({
  preventDefault: vi.fn(),
  currentTarget: null,
  relatedTarget: null,
  dataTransfer: {
    types: ['text/plain', TAB_DRAG_TYPE],
    getData: (type) => (type === TAB_DRAG_TYPE ? id : ''),
  },
});

beforeEach(() => {
  appTabs.tabs = [
    { id: 'tab-here', kind: 'folder', path: '/browse/Here' },
    { id: 'tab-beside', kind: 'folder', path: '/browse/Beside' },
  ];
  appTabs.activeId = 'tab-here';
  navigation.activate.mockReset();
  navigation.showInPane.mockReset();
  navigation.closePane.mockReset();
  routerPush.mockReset();
});

/**
 * Two tabs on one folder are two places.
 *
 * The screen in a pane is built for a *tab*: its listing, what is selected in it,
 * where the reader is in it and what they were half-way through renaming all belong
 * to that tab. Keyed on the address alone, a pane handed another tab on the same
 * folder kept the screen it had — so the second tab was a dead panel saying "this
 * folder is empty", with nothing asked of the server and nothing to click.
 * Duplicating a tab is exactly that gesture, and so is dropping a tab into the half
 * beside one already showing the same folder.
 */
describe('a pane given another tab', () => {
  it('draws the screen again, even at the same address', async () => {
    const built = [];
    const Counting = defineComponent({
      setup() {
        built.push('built');
        return () => h('div', { 'data-test': 'drawn' });
      },
    });
    appTabs.tabs = [
      { id: 'tab-here', kind: 'folder', path: '/browse/Here' },
      { id: 'tab-twin', kind: 'folder', path: '/browse/Here' },
    ];
    const pane = mount(TabPane, {
      props: { tabId: 'tab-here', routedComponent: Counting, routedKey: '/browse/Here' },
      global: { mocks: { $t: (key) => key } },
    });
    expect(built).toHaveLength(1);

    // The copy comes forward in this very pane, on the same folder.
    appTabs.activeId = 'tab-twin';
    await pane.setProps({ tabId: 'tab-twin' });

    expect(built).toHaveLength(2);
  });

  /** And the same tab at the same address is left exactly as it is. */
  it('keeps the screen it has when nothing changed', async () => {
    const built = [];
    const Counting = defineComponent({
      setup() {
        built.push('built');
        return () => h('div', { 'data-test': 'drawn' });
      },
    });
    const pane = mount(TabPane, {
      props: { tabId: 'tab-here', routedComponent: Counting, routedKey: '/browse/Here' },
      global: { mocks: { $t: (key) => key } },
    });

    await pane.setProps({ split: true });

    expect(built).toHaveLength(1);
  });
});

describe('a pane', () => {
  it('has focus only when it holds the tab in front', () => {
    expect(paneFor('tab-here').attributes('data-focused')).toBe('true');
    expect(paneFor('tab-beside').attributes('data-focused')).toBe('false');
  });

  it('says which tab it is drawing, so the screens inside it can ask', () => {
    expect(paneFor('tab-beside').attributes('data-pane-tab')).toBe('tab-beside');
  });

  /**
   * The router's own component is for the pane the reader is in: that pane keeps
   * every route guard and the address bar. The other is on an address the router
   * is not, so it resolves its own.
   */
  it('draws the router’s screen while it is the pane in front', () => {
    expect(paneFor('tab-here').find('[data-test="drawn"]').exists()).toBe(true);
    expect(paneFor('tab-beside').find('[data-test="drawn"]').exists()).toBe(false);
  });

  it('puts the reader in it when pressed, and takes the address with it', async () => {
    const pane = paneFor('tab-beside');

    await pane.trigger('pointerdown');

    expect(navigation.activate).toHaveBeenCalledWith('tab-beside');
  });

  it('does not move the reader when they are already in it', async () => {
    const pane = paneFor('tab-here');

    await pane.trigger('pointerdown');

    expect(navigation.activate).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  /** Only when there are two of them: one pane has nothing to add to say where it is. */
  it('says where it is only while it sits beside another', () => {
    expect(paneFor('tab-here').find('[data-test="pane-header"]').exists()).toBe(false);
    expect(paneFor('tab-here', { split: true }).find('[data-test="pane-header"]').exists()).toBe(
      true
    );
  });

  /**
   * The folder's own toolbar, for a pane that holds a folder and for no other.
   *
   * All of it is about a folder, so two panes on two folders are two of them —
   * and a pane showing a document or a shell has nothing to put in one.
   */
  it('draws the folder’s own toolbar only for a folder', () => {
    expect(paneFor('tab-here').find('[data-test="folder-toolbar"]').exists()).toBe(true);

    appTabs.tabs = [{ id: 'tab-doc', kind: 'document', path: '/open/Docs/notes.md' }];
    appTabs.activeId = 'tab-doc';
    expect(paneFor('tab-doc').find('[data-test="folder-toolbar"]').exists()).toBe(false);
  });

  it('closes its own side, not whichever pane has focus', async () => {
    const pane = paneFor('tab-beside', { split: true, side: 'right' });

    await pane.find('[data-test="pane-close"]').trigger('click');

    expect(navigation.closePane).toHaveBeenCalledWith('right');
  });
});

describe('a tab dropped into a pane', () => {
  it('goes into the pane it was dropped on', () => {
    const pane = paneFor('tab-here', { split: true, side: 'right' });

    // Through the element rather than by reaching for the handler. Which phase
    // it listens in is not observable here — there is no uploader in jsdom to
    // swallow the drop — so that part is held by the browser journey, where it
    // was found.
    pane.element.dispatchEvent(
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        dataTransfer: tabDrag('tab-beside').dataTransfer,
      })
    );

    expect(navigation.showInPane).toHaveBeenCalledWith('right', 'tab-beside');
  });

  /** A file drag falls straight through, so nothing below loses a drop it wanted. */
  it('leaves a drag that is not a tab alone', () => {
    const pane = paneFor('tab-here', { split: true, side: 'right' });

    pane.element.dispatchEvent(
      Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
        dataTransfer: { types: ['Files'], getData: () => '' },
      })
    );

    expect(navigation.showInPane).not.toHaveBeenCalled();
  });
});
