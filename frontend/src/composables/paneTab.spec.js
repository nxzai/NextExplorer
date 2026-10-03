import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { createMemoryHistory, createRouter } from 'vue-router';

import { providePaneTab, usePaneFolder, usePaneRoute, usePaneTabId } from './paneTab';
import { useTabsStore } from '@/stores/tabs';
import { useFileStore } from '@/stores/fileStore';

/**
 * Which tab a pane draws, which is the whole of what a split view costs the
 * screens inside it.
 *
 * The one case worth holding is the one that cannot happen with a single pane and
 * is wrong by default: a pane whose tab is *not* the tab in front still draws its
 * own. Everything that reads the store's own surface follows the tab in front,
 * and that is right for the clipboard and the toolbar — so the discriminating
 * assertion is not "it answers a tab", it is "it answers a tab that is not the
 * active one".
 */

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setActivePinia(createPinia());
});

/** A pane, as the layout draws one, with a child that asks where it is. */
const paneHolding = (tabId) => {
  const seen = {};
  const Child = defineComponent({
    setup() {
      seen.id = usePaneTabId();
      seen.pane = usePaneFolder();
      return () => h('div');
    },
  });
  const Pane = defineComponent({
    setup() {
      providePaneTab(tabId);
      return () => h(Child);
    },
  });
  mount(Pane);
  return seen;
};

describe('the tab a pane draws', () => {
  it('is the tab in front, where nobody has said otherwise', () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const second = tabs.open('/browse/Beta');

    const seen = paneHolding(ref(''));

    expect(seen.id.value).toBe(second.id);

    // And follows it, because that is what every screen outside a pane wants.
    tabs.activate(tabs.tabs[0].id);
    expect(seen.id.value).toBe(tabs.tabs[0].id);
  });

  /** The case a single pane cannot produce: drawing a tab that is not in front. */
  it('is the pane tab, even while another tab is in front', () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const first = tabs.tabs[0];
    const second = tabs.open('/browse/Beta');
    tabs.activate(first.id);

    const seen = paneHolding(ref(second.id));

    expect(tabs.activeId).toBe(first.id);
    expect(seen.id.value).toBe(second.id);
  });

  it('changes with the pane, because a pane can be given another tab', () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const first = tabs.tabs[0];
    const second = tabs.open('/browse/Beta');
    const held = ref(first.id);

    const seen = paneHolding(held);
    expect(seen.id.value).toBe(first.id);

    held.value = second.id;
    expect(seen.id.value).toBe(second.id);
  });

  /**
   * The facade reads and writes the pane's own folder, under the names the store
   * uses for the tab in front — which is what lets a screen move onto it by
   * renaming rather than by being rewritten.
   *
   * The assertion that matters is the write: a pane selecting something must not
   * select it in whichever tab happens to have focus.
   */
  it('selects in its own tab, not in the one in front', () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const fileStore = useFileStore();
    const first = tabs.tabs[0];
    const second = tabs.open('/browse/Beta');
    tabs.activate(first.id);

    const seen = paneHolding(ref(second.id));
    const chosen = [{ name: 'notes.txt' }];
    seen.pane.view.selectedItems = chosen;

    expect(fileStore.folderFor(second.id).selection.selectedItems.value).toEqual(chosen);
    expect(fileStore.folderFor(first.id).selection.selectedItems.value).toEqual([]);
    // And the store's own surface, which follows focus, is untouched.
    expect(fileStore.selectedItems).toEqual([]);
  });

  /** A ref reached through the facade unwraps, as it does through a store. */
  it('reads a path without anybody remembering a .value', () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const fileStore = useFileStore();
    const second = tabs.open('/browse/Beta');
    fileStore.folderFor(second.id).path.value = 'Beta';

    const seen = paneHolding(ref(second.id));

    expect(seen.pane.view.currentPath).toBe('Beta');
  });

  /**
   * And the folder it hands over is that tab's own — the listing, the selection
   * and the rename that belong to the place, not to whoever has focus.
   */
  it('hands over the folder belonging to its own tab', () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const fileStore = useFileStore();
    const first = tabs.tabs[0];
    const second = tabs.open('/browse/Beta');
    tabs.activate(first.id);

    const seen = paneHolding(ref(second.id));

    expect(seen.pane.folder.value).toBe(fileStore.folderFor(second.id));
    expect(seen.pane.folder.value).not.toBe(fileStore.folderFor(first.id));
  });
});

/**
 * A window that has a router, because an address is what this one is about.
 *
 * The few addresses these panes are on, shaped as the application shapes them,
 * so `params.path` means here what it means to a screen.
 */
const windowAt = async (address) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/browse/:path(.*)*', '/editor/:path(.*)*', '/open/:path(.*)*'].map((path) => ({
      path,
      component: defineComponent({ setup: () => () => h('div') }),
    })),
  });
  await router.push(address);
  await router.isReady();
  return router;
};

/** A pane with a child that reads its address, inside a window at `address`. */
const paneReadingAddress = async (tabId, address) => {
  const router = await windowAt(address);
  const seen = {};
  const Child = defineComponent({
    setup() {
      seen.route = usePaneRoute();
      return () => h('div');
    },
  });
  const Pane = defineComponent({
    setup() {
      providePaneTab(tabId);
      return () => h(Child);
    },
  });
  mount(Pane, { global: { plugins: [router] } });
  return seen;
};

describe('the address a pane reads', () => {
  /**
   * The case the whole thing exists for: the pane beside the reader.
   *
   * A screen asks the router where it is, and in a pair only one pane is the
   * router's answer — so the other one drew somebody else's place. With a folder
   * in front and the editor beside it, the editor was handed the folder's address
   * and refused it: "Cannot open a directory in the text editor", over a file it
   * had been opened on.
   */
  it('is its own tab, while another tab is the window', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const folder = tabs.tabs[0];
    const editing = tabs.open('/editor/Docs/notes.txt');
    tabs.activate(folder.id);

    const seen = await paneReadingAddress(ref(editing.id), '/browse/Docs');

    expect(seen.route.path).toBe('/editor/Docs/notes.txt');
    expect(seen.route.params.path).toEqual(['Docs', 'notes.txt']);
  });

  /** And follows its own tab, because a pane can be given another one. */
  it('changes when the pane is given another tab', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const folder = tabs.tabs[0];
    const editing = tabs.open('/editor/Docs/notes.txt');
    const reading = tabs.open('/open/Docs/report.docx');
    tabs.activate(folder.id);

    const held = ref(editing.id);
    const seen = await paneReadingAddress(held, '/browse/Docs');
    expect(seen.route.path).toBe('/editor/Docs/notes.txt');

    held.value = reading.id;
    expect(seen.route.path).toBe('/open/Docs/report.docx');
  });

  /**
   * Its own tab's address even when that tab is the one in front, because the two
   * do not always agree.
   *
   * Bringing a tab forward is two moves: the store is told first and the address
   * bar follows. For that tick the pane that has just come forward is "the tab in
   * front" while the window is still on the address of the tab being *left* — and
   * a pane that read the window then read the neighbour's place. Measured in a
   * browser: crossing from one editor to another made the second read the first
   * one's file, re-read it and build a new CodeMirror, twice over.
   *
   * Nothing is lost by resolving instead: the resolution is the same record, the
   * same params and the same query, since the tab holds the whole address.
   */
  it('is its own tab even when that tab is the one in front', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const editing = tabs.open('/editor/Docs/notes.txt?view=wide');

    const seen = await paneReadingAddress(ref(editing.id), '/browse/Elsewhere?sort=name');

    expect(seen.route.path).toBe('/editor/Docs/notes.txt');
    expect(seen.route.query).toEqual({ view: 'wide' });
  });

  /** And the window's own address wherever a tab has none to give. */
  it('is the window for a tab with no address of its own', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const editing = tabs.open('/editor/Docs/notes.txt');
    editing.path = '';

    const seen = await paneReadingAddress(ref(editing.id), '/browse/Elsewhere?sort=name');

    expect(seen.route.path).toBe('/browse/Elsewhere');
  });

  /** Outside any pane it is the window, which is every screen that is not one. */
  it('is the window where no pane has said otherwise', async () => {
    const router = await windowAt('/browse/Docs?sort=name');
    const seen = {};
    mount(
      defineComponent({
        setup() {
          seen.route = usePaneRoute();
          return () => h('div');
        },
      }),
      { global: { plugins: [router] } }
    );

    expect(seen.route.fullPath).toBe('/browse/Docs?sort=name');
  });
});
