import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

/**
 * Closing the tab a document was opened for.
 *
 * The rule lives here because two crosses mean it — the preview's and the text
 * editor's — and a rule kept in two places is a rule that will disagree with
 * itself. It is also the rule with the most to lose if it is too eager: closing a
 * tab somebody had been browsing in, because they shut a document they happened
 * to open in it, takes a tab away from them and there is no undo.
 *
 * Held against the real tabs store rather than a stand-in, because `own` is the
 * whole of the question and it is the store that decides when it stops being
 * true.
 */

const push = vi.fn();
const replace = vi.fn();
const route = { fullPath: '/browse/' };

vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => route,
}));

/**
 * Asking for a tab to be got ready before the reader arrives at it.
 *
 * What this file owns is *when*: a tab opened behind is a tab with time to spare.
 * What that costs, what each kind of tab does about it and whether this account
 * wants it at all belong to `tabWarmup.js` — which every gesture goes through,
 * because three of them open a tab behind and only this one comes through here.
 *
 * Fetched when it is needed rather than imported, so reaching for the preview
 * manager does not put it into the module graph of every screen that draws a tab.
 * Standing in for it here is how that stays true in the test as well.
 */
const warmInBackground = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/composables/tabWarmup', () => ({ warmInBackground, WARM_TAB_LIMIT: 3 }));

/**
 * Work can outlive the tab it was for, so what a tab was waiting for is forgotten
 * when the tab goes — otherwise the count is a spinner on whatever tab is given
 * that id next.
 */
const tabLoading = vi.hoisted(() => ({ keepOnly: vi.fn(), begin: () => () => {} }));
vi.mock('@/stores/tabLoading', () => ({ useTabLoadingStore: () => tabLoading }));

/**
 * What a tab has to say before it is closed. Closing is the one gesture that destroys
 * what a tab was holding, and this store is where a screen with something to lose
 * leaves its question.
 */
// Answers with a promise, as the store does: the question is the application's own
// dialog now, and a dialog cannot answer before it has been read.
const guards = vi.hoisted(() => ({ mayClose: vi.fn(async () => true), release: vi.fn() }));
vi.mock('@/stores/tabGuards', () => ({ useTabGuardsStore: () => guards }));

const settings = vi.hoisted(() => ({ loaded: true, userSettings: {} }));
vi.mock('@/stores/appSettings', () => ({ useAppSettings: () => settings }));
vi.mock('@/stores/features', () => ({ useFeaturesStore: () => ({ maxTabs: 10 }) }));

import { useTabNavigation, useTabRouteSync } from './tabNavigation';
import { useTabsStore } from '@/stores/tabs';

beforeEach(() => {
  setActivePinia(createPinia());
  push.mockClear();
  replace.mockClear();
  route.fullPath = '/browse/';
  warmInBackground.mockClear();
  tabLoading.keepOnly.mockClear();
  guards.mayClose.mockClear();
  guards.mayClose.mockResolvedValue(true);
  guards.release.mockClear();
  settings.loaded = true;
  settings.userSettings = {};
  route.fullPath = '/browse/';
});

/** Tabs on, and a second tab opened *for* a document, in front. */
const withOwnDocumentTab = () => {
  const tabs = useTabsStore();
  tabs.setEnabled(true);
  const tab = tabs.open('/open/Docs/report.docx', { own: true });
  return { tabs, tab };
};

describe('closing the tab something was opened for', () => {
  it('closes it, and says so', async () => {
    const { tabs, tab } = withOwnDocumentTab();
    const navigation = useTabNavigation();

    expect(await navigation.closeOwn()).toBe(true);
    expect(tabs.tabs.some((entry) => entry.id === tab.id)).toBe(false);
  });

  /**
   * Taken somewhere else, so it is not a tab that exists for one thing any more.
   * The store stops saying `own` the moment the address changes; this is what
   * that is for.
   */
  it('leaves alone a tab somebody had been browsing in', async () => {
    const { tabs } = withOwnDocumentTab();
    tabs.syncActive('/browse/Docs');
    const navigation = useTabNavigation();

    expect(await navigation.closeOwn()).toBe(false);
    expect(tabs.count).toBe(2);
  });

  /** The last tab cannot close: there would be nowhere to be. */
  it('refuses the only tab', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    tabs.syncActive('/open/Docs/report.docx');
    tabs.activeTab.own = true;
    const navigation = useTabNavigation();

    expect(await navigation.closeOwn()).toBe(false);
    expect(tabs.count).toBe(1);
  });

  /** With tabs off there is one tab and it is the window; closing is not ours. */
  it('refuses when tabs are turned off', async () => {
    const { tabs } = withOwnDocumentTab();
    tabs.setEnabled(false);
    tabs.activeTab.own = true;
    const navigation = useTabNavigation();

    expect(await navigation.closeOwn()).toBe(false);
  });

  /** Whatever is left takes over, and the address follows it. */
  it('goes where the tab that takes over says it is', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    tabs.syncActive('/browse/Photos');
    const second = tabs.open('/open/Docs/report.docx', { own: true });
    const navigation = useTabNavigation();

    expect(await navigation.closeOwn()).toBe(true);
    expect(tabs.activeId).not.toBe(second.id);
    expect(push).toHaveBeenCalledWith('/browse/Photos');
  });
});

describe('a tab opened behind', () => {
  const openBehind = (path = '/open/Docs/report.docx') => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const navigation = useTabNavigation();
    const tab = navigation.open(path, { behind: true, own: true });
    return { tabs, tab };
  };

  /**
   * Waited for on the clock rather than on a turn of the microtask queue: what
   * the warming needs is fetched with dynamic imports, and a handful of
   * `Promise.resolve()` comes back while they are still loading.
   */
  const loaded = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** The reader is still looking at something else, which is when there is time. */
  it('is got ready, and the reader is left where they were', async () => {
    const { tab } = openBehind();
    await loaded();

    expect(warmInBackground).toHaveBeenCalledWith([
      expect.objectContaining({ id: tab.id, kind: 'document' }),
    ]);
    expect(push).not.toHaveBeenCalled();
  });

  /** A tab opened in front is already being drawn: there is nothing to prepare. */
  it('is not got ready when it is opened in front', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    useTabNavigation().open('/open/Docs/report.docx', { own: true });
    await loaded();

    expect(warmInBackground).not.toHaveBeenCalled();
  });

  // Whether this account wants anything got ready is asked where the getting ready
  // happens — see `tabWarmup.spec.js`. Asking twice would be two answers to keep
  // in step, and three gestures asking one of them.

  it('is not got ready when the row was full and no tab was opened', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    tabs.setLimit(1);
    useTabNavigation().open('/open/Docs/report.docx', { behind: true });
    await loaded();

    expect(warmInBackground).not.toHaveBeenCalled();
  });
});

describe('a tab that has gone', () => {
  /**
   * Work can outlive the tab it was for — a listing already asked for, a viewer
   * halfway through arriving — and a count left standing would be a spinner on
   * whatever tab is given that id next.
   */
  it('is no longer waiting for anything', async () => {
    // Told through the settings, as the application tells it: `useTabRouteSync`
    // answers the store from there, and would otherwise turn tabs off underneath
    // this test.
    settings.userSettings = { browseInTabs: true };
    const tabs = useTabsStore();
    useTabRouteSync();
    const opened = tabs.open('/browse/Docs');
    await nextTick();
    tabLoading.keepOnly.mockClear();
    guards.mayClose.mockClear();
    guards.mayClose.mockResolvedValue(true);
    guards.release.mockClear();

    tabs.close(opened.id);
    await nextTick();

    expect(tabLoading.keepOnly).toHaveBeenCalledWith(tabs.tabs.map((tab) => tab.id));
    expect(tabLoading.keepOnly.mock.calls.at(-1)[0]).not.toContain(opened.id);
  });
});

/**
 * Closing a tab, once whatever is in it has had its say.
 *
 * A comparison with lines copied across and not saved has something to lose; a folder
 * has not, and being asked about a folder would train everybody to click through the
 * question without reading it.
 */
describe('closing a tab that has something to say', () => {
  const twoTabs = () => {
    settings.userSettings = { browseInTabs: true };
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const opened = tabs.open('/browse/Docs');
    return { tabs, opened };
  };

  it('asks, and closes it when the answer is yes', async () => {
    const { tabs, opened } = twoTabs();

    await useTabNavigation().close(opened.id);

    expect(guards.mayClose).toHaveBeenCalledWith(opened.id);
    expect(tabs.tabs.some((tab) => tab.id === opened.id)).toBe(false);
  });

  it('leaves it alone when the answer is no', async () => {
    const { tabs, opened } = twoTabs();
    guards.mayClose.mockResolvedValue(false);

    expect(await useTabNavigation().close(opened.id)).toBeNull();
    expect(tabs.tabs.some((tab) => tab.id === opened.id)).toBe(true);
  });

  /** One tab refusing holds the whole gesture: nothing half-closed. */
  it('closes none of the others when one of them refuses', async () => {
    const { tabs } = twoTabs();
    const second = tabs.open('/browse/Media');
    guards.mayClose.mockImplementation(async (id) => id !== second.id);

    expect(await useTabNavigation().closeAll()).toBeNull();
    expect(tabs.count).toBe(3);
  });

  it('closes them all when none of them minds', async () => {
    const { tabs } = twoTabs();
    tabs.open('/browse/Media');

    await useTabNavigation().closeAll();

    expect(tabs.count).toBe(1);
  });

  /** A question for a tab that has gone is a question nobody will ever answer. */
  it('lets go of the question once the tab is closed', async () => {
    const { opened } = twoTabs();

    await useTabNavigation().close(opened.id);

    expect(guards.release).toHaveBeenCalledWith(opened.id);
  });
});

/**
 * Opening the application is not a statement about any tab.
 *
 * The address is the truth, and the tab in front is told what it is — which is right
 * for a deep link and wrong for the one address that says nothing. Arriving at the root
 * means "open the application", and writing it into the tab in front is how a kept tab
 * came back on the volumes: kept tabs sit at the front of the row, so the front tab is
 * very often the kept one, and the landing quietly took away the folder it was kept on.
 */
describe('landing on the application', () => {
  const landOn = (where, tabPath) => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const tab = tabs.open(tabPath);
    tabs.activate(tab.id);
    route.fullPath = where;
    useTabRouteSync();
    return { tabs, tab };
  };

  it('goes to the tab’s own address rather than writing the root into it', async () => {
    const { tab } = landOn('/browse/', '/browse/Docs');
    await nextTick();

    expect(replace).toHaveBeenCalledWith('/browse/Docs');
    expect(tab.path).toBe('/browse/Docs');
  });

  /** A deep link is a statement, and the tab is told what it is, as before. */
  it('takes a deep link as the truth', async () => {
    const { tab } = landOn('/browse/Media/Photos', '/browse/Docs');
    await nextTick();

    expect(replace).not.toHaveBeenCalled();
    expect(tab.path).toBe('/browse/Media/Photos');
  });

  /** And a tab already at the root has nothing to be taken back to. */
  it('leaves a tab that is already at the volumes alone', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    route.fullPath = '/browse/';
    useTabRouteSync();
    await nextTick();

    expect(replace).not.toHaveBeenCalled();
    expect(tabs.activeTab.path).toBe('/browse/');
  });
});
