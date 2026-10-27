import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

/**
 * The tabs, and which of them is in front.
 *
 * What is worth holding here is the arithmetic nobody thinks about until it is
 * wrong: which tab takes over when the one in front closes, where a new tab
 * lands, that the last one cannot be closed because there would be nowhere to be,
 * and that what was stored is read back as something openable rather than
 * trusted. The store navigates nothing, which is why all of this can be asserted
 * without a router.
 */

import { DEFAULT_TAB_LIMIT, HOME, useTabsStore } from './tabs';

const paths = (store) => store.tabs.map((tab) => tab.path);

/**
 * The window opened again, with the account asking for its tabs back.
 *
 * Not the default: off, only the kept tabs return, which is what keeping a tab is for.
 * Anything below that is about what persistence *stores* asks for them.
 */
const comingBack = () => {
  localStorage.setItem('settings:tabs:reopen', JSON.stringify(true));
  setActivePinia(createPinia());
  return withTabsOn();
};

/** The store as `useTabRouteSync` hands it over once the settings have arrived. */
const withTabsOn = () => {
  const store = useTabsStore();
  store.setEnabled(true);
  return store;
};

beforeEach(() => {
  localStorage.clear();
  // A fresh window each time: the mark one leaves is what tells a reload from a return.
  sessionStorage.clear();
  setActivePinia(createPinia());
});

describe('what a fresh window holds', () => {
  it('is one tab, at the volumes', () => {
    const store = withTabsOn();

    expect(store.count).toBe(1);
    expect(store.activeTab).toMatchObject({ kind: 'folder', path: HOME });
    expect(store.activeId).toBe(store.tabs[0].id);
  });

  it('cannot close it: there would be nowhere to be', () => {
    const store = withTabsOn();

    expect(store.canClose).toBe(false);
    expect(store.close(store.activeId)).toBeNull();
    expect(store.count).toBe(1);
  });
});

describe('what was stored is read back as something openable', () => {
  /**
   * Read back with the tabs coming back, which is not the default.
   *
   * Off by default, only the kept tabs return — which is what keeping a tab is *for*:
   * with everything coming back, "kept" said nothing that "open" did not already say.
   * These cases are about the reading itself, so they ask for the whole list.
   */
  const store = (open, active = '', reopen = true) => {
    localStorage.setItem('settings:tabs:open', JSON.stringify(open));
    localStorage.setItem('settings:tabs:active', JSON.stringify(active));
    localStorage.setItem('settings:tabs:reopen', JSON.stringify(reopen));
    setActivePinia(createPinia());
    return withTabsOn();
  };

  it('keeps the tabs that are still tabs', () => {
    const kept = store([
      { id: 'a', kind: 'folder', path: '/browse/Docs' },
      { id: 'b', kind: 'trash', path: '/trash' },
    ]);

    expect(paths(kept)).toEqual(['/browse/Docs', '/trash']);
  });

  it('drops a kind that no longer exists, and an entry that is not one', () => {
    const kept = store([
      { id: 'a', kind: 'folder', path: '/browse/Docs' },
      { id: 'b', kind: 'telepathy', path: '/wherever' },
      { id: 'c', path: '/browse/Media' },
      null,
      'nonsense',
    ]);

    expect(paths(kept)).toEqual(['/browse/Docs']);
  });

  /**
   * Somebody who closed the browser on a settings page was not mid-anything there
   * — but they *did* have that tab. It comes back at the volumes rather than not
   * coming back: dropping it lost a reader a tab because of the page it happened
   * to be showing, which the browser suite found by taking one to the settings.
   */
  it('brings a kind that should not come back to the volumes instead', () => {
    const kept = store([
      { id: 'a', kind: 'settings', path: '/settings/about' },
      { id: 'b', kind: 'search', path: '/search?q=x' },
      { id: 'c', kind: 'folder', path: '/browse/Docs' },
    ]);

    expect(paths(kept)).toEqual([HOME, HOME, '/browse/Docs']);
    expect(kept.tabs.map((tab) => tab.kind)).toEqual(['folder', 'folder', 'folder']);
  });

  it('keeps one tab when that is all there was', () => {
    const kept = store([{ id: 'a', kind: 'settings', path: '/settings/about' }]);

    expect(paths(kept)).toEqual([HOME]);
  });

  it('puts a tab in front that is there', () => {
    const kept = store(
      [
        { id: 'a', kind: 'folder', path: '/browse/Docs' },
        { id: 'b', kind: 'folder', path: '/browse/Media' },
      ],
      'gone'
    );

    expect(kept.activeId).toBe('a');
  });

  /**
   * Asserted as the next visit sees it rather than as the bytes in storage: what
   * matters is that a window opened again finds the tabs, and `useStorage` writes
   * on its own schedule.
   */
  it('writes what it holds, so the next visit finds it', async () => {
    const opened = withTabsOn();
    opened.open('/browse/Docs');
    const wasActive = opened.activeId;
    await nextTick();

    const returning = comingBack();

    expect(paths(returning)).toEqual([HOME, '/browse/Docs']);
    expect(returning.activeId).toBe(wasActive);
  });
});

describe('opening a tab', () => {
  /**
   * At the end of the row, wherever it was opened from — which is where Edge and
   * Chrome put one, and where somebody who opened it will look for it. It used to
   * land beside the tab it came from, so a row built up backwards.
   */
  it('lands it at the end of the row', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.activate(store.tabs[0].id);
    store.open('/browse/B');

    expect(paths(store)).toEqual([HOME, '/browse/A', '/browse/B']);
  });

  it('leaves the reader where they were when asked to', () => {
    const store = withTabsOn();
    const first = store.activeId;
    const tab = store.open('/browse/A', { activate: false });

    expect(store.activeId).toBe(first);
    expect(tab.path).toBe('/browse/A');
  });

  it('brings forward the one screen there is only one of', () => {
    const store = withTabsOn();
    const trash = store.open('/trash');
    store.activate(store.tabs[0].id);

    const again = store.open('/trash');

    expect(again.id).toBe(trash.id);
    expect(store.count).toBe(2);
    expect(store.activeId).toBe(trash.id);
  });

  it('refuses an address no tab can be on', () => {
    const store = withTabsOn();

    expect(store.open('/auth/login')).toBeNull();
    expect(store.count).toBe(1);
  });

  /** With the mode off there is one tab and it goes where it is told. */
  it('moves the one tab when tabs are off', () => {
    const store = useTabsStore();

    const tab = store.open('/browse/Docs');

    expect(store.count).toBe(1);
    expect(tab.path).toBe('/browse/Docs');
    expect(tab.kind).toBe('folder');
  });
});

/**
 * Whether the tabs come back, which is what keeping one is for.
 *
 * They always came back, and keeping a tab therefore said nothing that having it open
 * did not already say: the front of the row, no cross, and immunity from "close them
 * all" were all it amounted to. Off by default — the reader who wants a tab tomorrow
 * says so by keeping it.
 */
describe('coming back to the window', () => {
  const lastTime = (open, reopen) => {
    localStorage.setItem('settings:tabs:open', JSON.stringify(open));
    localStorage.setItem('settings:tabs:reopen', JSON.stringify(reopen));
    // A window that has not been here yet: this is a return, not a reload.
    sessionStorage.clear();
    setActivePinia(createPinia());
    return withTabsOn();
  };

  const three = [
    { id: 'a', kind: 'folder', path: '/browse/Docs' },
    { id: 'b', kind: 'folder', path: '/browse/Media', pinned: true },
    { id: 'c', kind: 'trash', path: '/trash' },
  ];

  it('brings back only the kept tabs, and lands on a fresh one', () => {
    const back = lastTime(three, false);

    expect(paths(back)).toEqual(['/browse/Media', HOME]);
    // A kept tab is a place somebody keeps, not necessarily where they want to land.
    expect(back.activeTab.path).toBe(HOME);
    expect(back.tabs[0].pinned).toBe(true);
  });

  it('brings back one fresh tab when nothing was kept', () => {
    const back = lastTime([three[0], three[2]], false);

    expect(paths(back)).toEqual([HOME]);
  });

  /**
   * A kept tab comes back as it was, whatever its kind.
   *
   * `restores` says what to do with a tab that merely happened to be showing something
   * — a shell that is not running any more, a settings page nobody was mid-anything on.
   * Keeping a tab is a statement about tomorrow, and answering it with the volumes is
   * answering a question the reader did not ask.
   */
  it('brings a kept tab back on what it was kept on, whatever it was', () => {
    const back = lastTime(
      [
        { id: 'a', kind: 'terminal', path: '/terminal/Projects', pinned: true },
        { id: 'b', kind: 'settings', path: '/settings/about', pinned: true },
        { id: 'c', kind: 'document', path: '/open/Docs/a.md', pinned: true },
      ],
      false
    );

    expect(paths(back)).toEqual(['/terminal/Projects', '/settings/about', '/open/Docs/a.md', HOME]);
    expect(back.tabs.map((tab) => tab.kind)).toEqual([
      'terminal',
      'settings',
      'document',
      'folder',
    ]);
  });

  /** And one that was not kept still comes back at the volumes, as it always did. */
  it('still brings an unkept shell back to the volumes', () => {
    const back = lastTime(
      [
        { id: 'a', kind: 'terminal', path: '/terminal/Projects' },
        { id: 'b', kind: 'folder', path: '/browse/Docs', pinned: true },
      ],
      true
    );

    expect(paths(back)).toEqual([HOME, '/browse/Docs']);
    expect(back.tabs[0].kind).toBe('folder');
  });

  /**
   * Reloading is not returning.
   *
   * The preference is about coming back to the application, not about staying in it —
   * so a reader who presses F5, or follows a link that loads the application again,
   * keeps every tab they had whatever the preference says. Session storage is the one
   * thing that tells the two apart: it survives a reload and goes with the window.
   */
  it('keeps every tab through a reload, whatever the preference says', () => {
    localStorage.setItem('settings:tabs:open', JSON.stringify(three));
    localStorage.setItem('settings:tabs:reopen', JSON.stringify(false));
    // The mark a window leaves the first time it is here, which a reload does not undo.
    sessionStorage.setItem('settings:tabs:here', '1');
    setActivePinia(createPinia());

    expect(paths(withTabsOn())).toEqual(['/browse/Docs', '/browse/Media', '/trash']);
  });

  it('brings them all back when the account asks for that', () => {
    const back = lastTime(three, true);

    expect(paths(back)).toEqual(['/browse/Docs', '/browse/Media', '/trash']);
  });

  /** Nobody has said yet, and a question with no answer is not a yes. */
  it('brings back only the kept tabs when nobody has said', () => {
    localStorage.setItem('settings:tabs:open', JSON.stringify(three));
    localStorage.removeItem('settings:tabs:reopen');
    setActivePinia(createPinia());

    expect(paths(withTabsOn())).toEqual(['/browse/Media', HOME]);
  });

  /**
   * Written down when the answer is known, and read the next time.
   *
   * The tabs are restored while the store is still being built, and the account's
   * settings have not arrived then: asking them would be asking a question whose answer
   * is "unknown", and acting on it would throw away what somebody had.
   */
  it('remembers the answer for next time, and changes nothing now', () => {
    const store = lastTime(three, false);
    const before = paths(store);

    store.setReopen(true);

    expect(paths(store)).toEqual(before);
    expect(
      paths(lastTime(three, JSON.parse(localStorage.getItem('settings:tabs:reopen'))))
    ).toEqual(['/browse/Docs', '/browse/Media', '/trash']);
  });
});

describe('closing a tab', () => {
  const three = () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.open('/browse/B');
    return store;
  };

  it('hands over to the one on its right', () => {
    const store = three();
    store.activate(store.tabs[1].id);

    const now = store.close(store.tabs[1].id);

    expect(now.path).toBe('/browse/B');
    expect(paths(store)).toEqual([HOME, '/browse/B']);
  });

  it('hands over to the left when there is no right', () => {
    const store = three();
    const last = store.tabs[2].id;
    store.activate(last);

    const now = store.close(last);

    expect(now.path).toBe('/browse/A');
  });

  it('moves nobody when the tab closed was not in front', () => {
    const store = three();
    const inFront = store.activeId;

    expect(store.close(store.tabs[0].id)).toBeNull();
    expect(store.activeId).toBe(inFront);
  });

  it('leaves one when asked to close the others', () => {
    const store = three();
    const keep = store.tabs[0].id;

    store.closeOthers(keep);

    expect(store.count).toBe(1);
    expect(store.activeId).toBe(keep);
  });
});

describe('finding the next tab', () => {
  it('wraps in both directions', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.open('/browse/B');
    store.activate(store.tabs[2].id);

    expect(store.neighbour(1).path).toBe(HOME);
    expect(store.neighbour(-1).path).toBe('/browse/A');
  });

  it('has no neighbour to find with one tab', () => {
    expect(withTabsOn().neighbour(1)).toBeNull();
  });

  it('counts from one, as a reader would', () => {
    const store = withTabsOn();
    store.open('/browse/A');

    expect(store.at(1).path).toBe(HOME);
    expect(store.at(2).path).toBe('/browse/A');
    expect(store.at(3)).toBeNull();
  });
});

describe('the tab in front follows the address', () => {
  it('becomes whatever the router is showing', () => {
    const store = withTabsOn();

    store.syncActive('/trash');

    expect(store.activeTab).toMatchObject({ kind: 'trash', path: '/trash' });
    expect(store.count).toBe(1);
  });

  it('is left alone by an address no tab can be on', () => {
    const store = withTabsOn();
    store.syncActive('/browse/Docs');

    store.syncActive('/auth/login');

    expect(store.activeTab).toMatchObject({ kind: 'folder', path: '/browse/Docs' });
  });
});

describe('turning the mode off', () => {
  it('leaves the tab in front and nothing kept behind it', async () => {
    const store = withTabsOn();
    store.open('/browse/A');
    const inFront = store.activeId;
    expect(store.count).toBe(2);

    store.setEnabled(false);

    expect(store.count).toBe(1);
    expect(store.activeId).toBe(inFront);
  });
});

/**
 * Which tabs exist for one thing, and which were merely taken there.
 *
 * A document's close button closes the tab it is in — and must close only a tab
 * that was opened for it. Closing one somebody had been browsing in, and happened
 * to open a document in, takes a tab away from them. It is the distinction a
 * browser draws when it refuses `window.close()` to a tab that has been elsewhere.
 */
describe('a tab opened for one thing', () => {
  it('says so, and a tab opened blank does not', () => {
    const store = withTabsOn();

    expect(store.open('/open/Docs/a.md', { own: true }).own).toBe(true);
    expect(store.open(HOME).own).toBe(false);
  });

  it('stops saying so once it is taken somewhere else', () => {
    const store = withTabsOn();
    const tab = store.open('/open/Docs/a.md', { own: true });

    store.syncActive('/browse/Docs');

    expect(tab.own).toBe(false);
  });

  it('keeps saying so while the address does not change', () => {
    const store = withTabsOn();
    const tab = store.open('/open/Docs/a.md', { own: true });

    store.syncActive('/open/Docs/a.md');

    expect(tab.own).toBe(true);
  });

  /** Brought forward is not made: the tab was already somebody's. */
  it('is not claimed by bringing a single screen forward', () => {
    const store = withTabsOn();
    store.open('/trash', { own: true });
    store.activate(store.tabs[0].id);

    const again = store.open('/trash', { own: true });

    expect(again.own).toBe(false);
  });

  it('is remembered, because the tab still exists for one thing', () => {
    const opened = withTabsOn();
    opened.open('/open/Docs/a.md', { own: true });

    const returning = comingBack();

    expect(returning.tabs.map((tab) => tab.own)).toEqual([false, true]);
  });
});

/**
 * The order of the tabs is the reader's.
 *
 * Two folders being compared belong side by side, whichever order they happened
 * to be opened in — and until this the only order on offer was the order things
 * were opened in.
 */
describe('moving a tab along the row', () => {
  const three = () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    tabs.syncActive('/browse/A');
    const b = tabs.open('/browse/B');
    const c = tabs.open('/browse/C');
    return { tabs, first: tabs.tabs[0].id, b: b.id, c: c.id };
  };

  const order = (tabs) => tabs.tabs.map((tab) => tab.path);

  it('puts it where it was asked for', () => {
    const { tabs, c } = three();

    tabs.move(c, 0);

    expect(order(tabs)).toEqual(['/browse/C', '/browse/A', '/browse/B']);
  });

  it('leaves the tab in front in front', () => {
    const { tabs, first, c } = three();
    tabs.activate(first);

    tabs.move(c, 0);

    // Moving something is not choosing it: the reader is still where they were.
    expect(tabs.activeId).toBe(first);
    expect(tabs.activeTab.path).toBe('/browse/A');
  });

  /**
   * A finger dragging past the last tab means the end, not nothing.
   *
   * And `-1` is the end on the other side, which is the case worth spelling out:
   * handed to `splice` as it stands, a negative index counts back from the end
   * and the tab lands one place from the right — the opposite of what was asked.
   */
  it('stops at the ends rather than refusing', () => {
    const { tabs, first } = three();

    tabs.move(first, 99);
    expect(order(tabs)).toEqual(['/browse/B', '/browse/C', '/browse/A']);

    tabs.move(first, -1);
    expect(order(tabs)).toEqual(['/browse/A', '/browse/B', '/browse/C']);
  });

  it('moves one place at a time when asked that way', () => {
    const { tabs, b } = three();

    tabs.nudge(b, 1);
    expect(order(tabs)).toEqual(['/browse/A', '/browse/C', '/browse/B']);

    tabs.nudge(b, -1);
    expect(order(tabs)).toEqual(['/browse/A', '/browse/B', '/browse/C']);
  });

  it('says where there is nowhere to go', () => {
    const { tabs, first, b, c } = three();

    expect(tabs.canMove(first, -1)).toBe(false);
    expect(tabs.canMove(first, 1)).toBe(true);
    expect(tabs.canMove(b, -1)).toBe(true);
    expect(tabs.canMove(c, 1)).toBe(false);
  });

  it('is nothing at all for a tab that has gone', () => {
    const { tabs, c } = three();
    tabs.close(c);

    expect(tabs.move(c, 0)).toBeNull();
    expect(tabs.canMove(c, -1)).toBe(false);
    expect(order(tabs)).toEqual(['/browse/A', '/browse/B']);
  });

  it('is remembered, like everything else about the row', () => {
    const { tabs, c } = three();

    tabs.move(c, 0);

    expect(JSON.parse(localStorage.getItem('settings:tabs:open')).map((tab) => tab.path)).toEqual([
      '/browse/C',
      '/browse/A',
      '/browse/B',
    ]);
  });
});

/**
 * Which tab the reader has just brought forward.
 *
 * A page cannot tell that on its own: bringing a tab forward and walking into a
 * folder both arrive as a new address on the same route, and the listing that
 * mounts for either of them looks exactly the same. Guessed from what a store
 * happens to hold, a search result landing in a folder somebody was just in reads
 * as a return too — so the store says it, and whoever it is for takes it.
 */
describe('the tab just brought forward', () => {
  const twoTabs = () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const first = tabs.activeId;
    const second = tabs.open('/browse/Media');
    return { tabs, first, second: second.id };
  };

  it('is the one activated, and only it', () => {
    const { tabs, first, second } = twoTabs();

    tabs.activate(first);

    expect(tabs.takeBroughtForward(second)).toBe(false);
    expect(tabs.takeBroughtForward(first)).toBe(true);
  });

  /** Taken once: the next page to mount was not the reason for the activation. */
  it('is taken once', () => {
    const { tabs, first } = twoTabs();
    tabs.activate(first);

    expect(tabs.takeBroughtForward(first)).toBe(true);
    expect(tabs.takeBroughtForward(first)).toBe(false);
  });

  it('is nobody until a tab is brought forward', () => {
    const { tabs, first } = twoTabs();

    // Opening one activates it, which is a tab coming forward like any other.
    tabs.takeBroughtForward(tabs.activeId);

    expect(tabs.takeBroughtForward(first)).toBe(false);
  });

  /** A tab taking over because its neighbour closed also came forward. */
  it('is the tab that takes over when one is closed', () => {
    const { tabs, first, second } = twoTabs();
    tabs.activate(second);
    tabs.takeBroughtForward(second);

    tabs.close(second);

    expect(tabs.takeBroughtForward(first)).toBe(true);
  });
});

/**
 * How many tabs a row holds.
 *
 * A row that never scrolls has to stop somewhere: past a certain number they are
 * too narrow to read, and a strip that scrolls hides the very tabs somebody
 * opened. The number is an administrator's, and this store is told it.
 */
describe('the room there is for another tab', () => {
  it('starts at ten, which is what an installation that never said gets', () => {
    const store = withTabsOn();

    expect(store.limit).toBe(DEFAULT_TAB_LIMIT);
  });

  it('opens nothing once the row is full, and says so', () => {
    const store = withTabsOn();
    store.setLimit(3);
    store.open('/browse/A');
    store.open('/browse/B');

    expect(store.atLimit).toBe(true);
    expect(store.open('/browse/C')).toBeNull();
    expect(store.count).toBe(3);
  });

  /** A singleton screen already open is brought forward, not opened again. */
  it('still brings forward a screen there is only one of', () => {
    const store = withTabsOn();
    store.setLimit(2);
    store.open('/trash');

    expect(store.count).toBe(2);
    expect(store.open('/trash')?.path).toBe('/trash');
    expect(store.count).toBe(2);
  });

  it('is nothing at all with tabs turned off, where there is one tab anyway', () => {
    const store = useTabsStore();
    store.setEnabled(false);
    store.setLimit(1);

    expect(store.atLimit).toBe(false);
    expect(store.open('/browse/A')?.path).toBe('/browse/A');
  });

  it('takes a number, and nothing else', () => {
    const store = withTabsOn();

    store.setLimit('15');
    expect(store.limit).toBe(15);

    store.setLimit('not a number');
    expect(store.limit).toBe(DEFAULT_TAB_LIMIT);

    store.setLimit(0);
    expect(store.limit).toBe(1);
  });
});

/**
 * Closing all of them.
 *
 * A window with no tabs has nowhere to be, so this means "start again" — which is
 * what it means in a browser, and what somebody with twelve open and none of them
 * wanted is asking for.
 */
describe('closing every tab', () => {
  it('leaves one, at the volumes, in front', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.open('/trash');

    const left = store.closeAll();

    expect(paths(store)).toEqual([HOME]);
    expect(store.activeId).toBe(left.id);
    expect(left.path).toBe(HOME);
  });

  it('is written down, like everything else about the row', () => {
    const store = withTabsOn();
    store.open('/browse/A');

    store.closeAll();

    expect(JSON.parse(localStorage.getItem('settings:tabs:open')).map((tab) => tab.path)).toEqual([
      HOME,
    ]);
  });
});

describe('the same place again, beside itself', () => {
  it('is a copy next to the tab it came from, and in front', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.open('/browse/B');
    const first = store.tabs[1];

    const copy = store.duplicate(first.id);

    expect(paths(store)).toEqual([HOME, '/browse/A', '/browse/A', '/browse/B']);
    expect(store.activeId).toBe(copy.id);
    expect(copy.id).not.toBe(first.id);
  });

  /**
   * A copy is a tab of its own from the moment it exists. Inheriting `own` would
   * hand the document's cross a tab the reader never opened for that document.
   */
  it('is never a tab opened for one thing, whatever it was copied from', () => {
    const store = withTabsOn();
    const source = store.open('/open/Docs/report.docx', { own: true });

    expect(store.duplicate(source.id).own).toBe(false);
  });

  it('can walk back the way the tab it came from walked in', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.syncActive('/browse/A/inside');
    const source = store.activeTab;

    const copy = store.duplicate(source.id);

    expect(store.canGoBack(copy.id)).toBe(true);
    expect(store.back(copy.id).path).toBe('/browse/A');
  });

  it('is refused when the row is full, like anything else that opens a tab', () => {
    const store = withTabsOn();
    store.setLimit(2);
    const source = store.open('/browse/A');

    expect(store.duplicate(source.id)).toBeNull();
    expect(store.count).toBe(2);
  });
});

describe('a tab kept on purpose', () => {
  it('moves to the front of the row and stays there', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    const b = store.open('/browse/B');

    store.pin(b.id);

    expect(paths(store)).toEqual(['/browse/B', HOME, '/browse/A']);
  });

  it('lines up behind the ones already kept', () => {
    const store = withTabsOn();
    const a = store.open('/browse/A');
    const b = store.open('/browse/B');

    store.pin(a.id);
    store.pin(b.id);

    expect(paths(store)).toEqual(['/browse/A', '/browse/B', HOME]);
  });

  /**
   * At the head of the rest rather than back where it came from: nothing records
   * where it was, and the head of the row is where the reader is looking — it is
   * the tab they just let go of.
   */
  it('goes to the head of the rest when it is let go', () => {
    const store = withTabsOn();
    const a = store.open('/browse/A');
    store.open('/browse/B');
    store.pin(a.id);

    store.unpin(a.id);

    expect(paths(store)).toEqual(['/browse/A', HOME, '/browse/B']);
    expect(store.tabs[0].pinned).toBe(false);
  });

  /** The line between the kept ones and the rest is not a line a drag may cross. */
  it('cannot be dragged out of the run it belongs to', () => {
    const store = withTabsOn();
    const a = store.open('/browse/A');
    store.open('/browse/B');
    store.pin(a.id);

    store.move(a.id, 2);

    expect(paths(store)).toEqual(['/browse/A', HOME, '/browse/B']);
    expect(store.canMove(a.id, 1)).toBe(false);
  });

  it('is not swept away by closing them all', () => {
    const store = withTabsOn();
    const a = store.open('/browse/A');
    store.open('/browse/B');
    store.pin(a.id);

    store.closeAll();

    expect(paths(store)).toEqual(['/browse/A']);
  });

  it('is not swept away by closing the others either', () => {
    const store = withTabsOn();
    const a = store.open('/browse/A');
    const b = store.open('/browse/B');
    store.pin(a.id);

    store.closeOthers(b.id);

    expect(paths(store)).toEqual(['/browse/A', '/browse/B']);
  });

  it('comes back kept when the window is opened again', () => {
    const opened = withTabsOn();
    const a = opened.open('/browse/A');
    opened.pin(a.id);

    setActivePinia(createPinia());
    const returning = withTabsOn();

    expect(returning.tabs[0].path).toBe('/browse/A');
    expect(returning.tabs[0].pinned).toBe(true);
  });
});

describe('where a tab has been', () => {
  it('is walked back one address at a time, in that tab alone', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.syncActive('/browse/A/one');
    store.syncActive('/browse/A/one/two');

    expect(store.back(store.activeId).path).toBe('/browse/A/one');
    expect(store.back(store.activeId).path).toBe('/browse/A');
    expect(store.canGoBack(store.activeId)).toBe(false);
  });

  it('is walked forward again from wherever the reader stopped', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.syncActive('/browse/A/one');
    store.back(store.activeId);

    expect(store.canGoForward(store.activeId)).toBe(true);
    expect(store.forward(store.activeId).path).toBe('/browse/A/one');
    expect(store.canGoForward(store.activeId)).toBe(false);
  });

  /**
   * The address a step lands on is already under the mark, so arriving there is
   * not somewhere new. Without this every step back would record itself and the
   * trail would never get anywhere.
   */
  it('is not added to by the step that walks it', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.syncActive('/browse/A/one');

    const stepped = store.back(store.activeId);
    store.syncActive(stepped.path);

    expect(store.canGoForward(store.activeId)).toBe(true);
  });

  it('forgets what was ahead once the reader walks somewhere else', () => {
    const store = withTabsOn();
    store.open('/browse/A');
    store.syncActive('/browse/A/one');
    store.back(store.activeId);
    store.syncActive('/browse/A/other');

    expect(store.canGoForward(store.activeId)).toBe(false);
    expect(store.back(store.activeId).path).toBe('/browse/A');
  });

  it('belongs to one tab: another tab has its own, and neither is the window’s', () => {
    const store = withTabsOn();
    const first = store.open('/browse/A');
    store.syncActive('/browse/A/one');
    const second = store.open('/browse/B');
    store.syncActive('/browse/B/deep');

    expect(store.back(second.id).path).toBe('/browse/B');
    expect(store.canGoBack(second.id)).toBe(false);
    // Untouched by any of it.
    expect(store.canGoBack(first.id)).toBe(true);
  });

  it('comes back with the tab when the window is opened again', () => {
    const opened = withTabsOn();
    opened.open('/browse/A');
    opened.syncActive('/browse/A/one');

    const returning = comingBack();

    expect(returning.canGoBack(returning.tabs[1].id)).toBe(true);
    expect(returning.back(returning.tabs[1].id).path).toBe('/browse/A');
  });
});

/**
 * A screen that rewrites its own address.
 *
 * The comparison does: swapping its two sides over changes which paths the address
 * names, and the tab has to follow or its name and a reload would disagree with what
 * is on screen. What it must *not* do is look like the reader walking somewhere — the
 * tab is still the tab that was opened for that comparison, and it is still on one
 * place, not two.
 */
describe('the same tab at an address it gave itself', () => {
  const left = '/compare?paths=Docs%2Fa.txt&paths=Docs%2Fb.txt';
  const right = '/compare?paths=Docs%2Fb.txt&paths=Docs%2Fa.txt';

  it('follows the address', () => {
    const store = withTabsOn();
    const tab = store.open(left, { own: true });

    store.retarget(tab.id, right);

    expect(tab.path).toBe(right);
  });

  /**
   * The defect this exists for: the cross in a screen's own bar closes the tab by
   * `own`, so a swap that dropped it left the cross pushing a folder over the
   * comparison instead of closing anything.
   */
  it('is still the tab that was opened for it', () => {
    const store = withTabsOn();
    const tab = store.open(left, { own: true });

    store.retarget(tab.id, right);
    // And the landing that follows the address change agrees, because the tab is
    // already there.
    store.syncActive(right);

    expect(tab.own).toBe(true);
  });

  it('is one place in the tab’s trail, not two', () => {
    const store = withTabsOn();
    const tab = store.open(left, { own: true });

    store.retarget(tab.id, right);
    store.syncActive(right);

    expect(tab.history).toEqual([right]);
    expect(store.canGoBack(tab.id)).toBe(false);
  });

  /** Only the entry under the mark: a swap does not rewrite where the tab has been. */
  it('leaves the rest of the trail alone', () => {
    const store = withTabsOn();
    const tab = store.open('/browse/Docs', { own: true });
    store.syncActive(left);

    store.retarget(tab.id, right);

    expect(tab.history).toEqual(['/browse/Docs', right]);
  });

  it('answers with nothing for an address that is nowhere, or a tab that is gone', () => {
    const store = withTabsOn();
    const tab = store.open(left, { own: true });

    expect(store.retarget(tab.id, '/not-a-place')).toBe(null);
    expect(store.retarget('no-such-tab', right)).toBe(null);
    expect(tab.path).toBe(left);
  });
});
