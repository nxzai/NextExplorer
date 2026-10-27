import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { TAB_KINDS_BY_ID, tabKindForPath } from '@/config/tabKinds';

/**
 * The tabs, and which of them is in front.
 *
 * A tab is an address: whichever screen the router is showing is the active tab,
 * and the others are addresses being kept. That is the whole model, and it is why
 * a tab can hold a folder, a document open in ONLYOFFICE or the trash without any
 * of them being a special case — the kinds are declared in `config/tabKinds.js`
 * and recognised from the address.
 *
 * This store never navigates. It says what the tabs are and answers where a tab
 * wants to go; pushing that address is the caller's, which keeps it testable
 * without a router and keeps one place deciding what the address bar says.
 *
 * Kept per device rather than per account: which folders are open on this screen
 * is not a preference that should follow somebody to their phone. Whether tabs
 * exist at all *is* an account preference — `browseInTabs` — but this store does
 * not go and read it. It is told, by `useTabRouteSync`, and that is not a detail:
 * reaching into the settings store from here put pinia and the router into the
 * module graph of every screen that opens a file, and two specs that had mocked
 * neither stopped loading at all. A store that is told what it needs is a store
 * anything can hold.
 */

/** A shape the persisted list can be trusted to have, or it is dropped. */
const isTab = (entry) =>
  Boolean(
    entry &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    entry.id &&
    typeof entry.path === 'string' &&
    TAB_KINDS_BY_ID[entry.kind]
  );

/**
 * How far back a tab remembers.
 *
 * Long enough that nobody reaches the end of it in an afternoon's browsing, short
 * enough that twenty tabs of it are a few kilobytes in a store that is written on
 * every click.
 */
const HISTORY_DEPTH = 50;

/** A remembered list of addresses, or a fresh one at the tab's own address. */
const historyOf = (entry, path) => {
  const kept = Array.isArray(entry?.history)
    ? entry.history.filter((step) => typeof step === 'string' && step).slice(-HISTORY_DEPTH)
    : [];
  if (kept.length === 0) return { history: [path], at: 0 };
  const at = Number.isInteger(entry?.at)
    ? Math.max(0, Math.min(entry.at, kept.length - 1))
    : kept.length - 1;
  return { history: kept, at };
};

export const HOME = '/browse/';

/**
 * How many tabs a row holds before it refuses another, when nobody has said.
 *
 * Ten is what the settings offer as their middle choice, and what an installation
 * that never opens the setting gets.
 */
export const DEFAULT_TAB_LIMIT = 10;

export const useTabsStore = defineStore('tabs', () => {
  /**
   * Read once and written by hand, rather than through `useStorage`.
   *
   * Two reasons, both found rather than guessed. Its write is deferred, and a
   * reload can arrive first: open a tab, press F5, and the tab was never written —
   * the browser suite came back to one tab and so would a person. Asked to flush
   * synchronously it stopped writing the second change at all, which a test of the
   * round trip caught. A list of three small objects does not need a mechanism; it
   * needs a `setItem` where the change is.
   *
   * Every touch is guarded: a browser with storage blocked or full must still
   * browse, it just will not remember its tabs.
   */
  const OPEN_KEY = 'settings:tabs:open';
  /**
   * Whether the tabs come back, kept beside them rather than read from the settings.
   *
   * The tabs are restored while this file is still being evaluated, and the account's
   * settings have not arrived then — so asking the settings would be asking a question
   * whose answer is "unknown", and acting on it would throw away what somebody had. The
   * answer is written here the moment it is known, and read from here the next time.
   */
  const REOPEN_KEY = 'settings:tabs:reopen';
  /**
   * That this window has already been here, which reloading does not undo.
   *
   * Session storage is the one thing that tells a *reload* from a *return*: it survives
   * F5 and every navigation within the window, and goes when the window does. Without
   * it, "only the kept tabs come back" applied to reloading a page — so a reader who
   * pressed F5, or followed a link that reloaded the application, lost every tab they
   * had. That is not what any browser does, and it is not what the preference means:
   * it is about coming back, not about staying.
   */
  const SESSION_KEY = 'settings:tabs:here';

  const stillHere = () => {
    try {
      return sessionStorage.getItem(SESSION_KEY) !== null;
    } catch {
      return false;
    }
  };

  const markHere = () => {
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // A window that will not hold a mark simply restores the way a return does.
    }
  };
  const ACTIVE_KEY = 'settings:tabs:active';

  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked, or full. The tabs still work for as long as this window.
    }
  };

  let nextId = 0;
  const makeId = () => {
    nextId += 1;
    return `tab-${Date.now().toString(36)}-${nextId}`;
  };

  /**
   * `own` says the tab was opened *for* this address rather than taken to it.
   *
   * It is what lets a document's close button close the tab it is in, and only
   * that tab: closing one somebody had been browsing in and happened to open a
   * document in would take a tab away from them. The same distinction a browser
   * draws when it refuses `window.close()` to a tab that has been somewhere else,
   * and for the same reason.
   */
  const makeTab = (path, own = false) => {
    const kind = tabKindForPath(path);
    return kind
      ? { id: makeId(), kind: kind.id, path, own, pinned: false, history: [path], at: 0 }
      : null;
  };

  /**
   * What was stored, as something openable.
   *
   * A kind that no longer exists goes with the malformed entries, because there is
   * nothing to open. A kind that says it should not come back where it was keeps
   * its tab and comes back at the volumes: the reader had that tab, and losing it
   * because of the page it happened to be showing is not something they asked for.
   * What is left is at least one tab, because a window with no tabs has nowhere to
   * be.
   */
  const load = () => {
    const remembered = read(OPEN_KEY, []);
    // Off by default, which is what makes keeping a tab mean something: with everything
    // coming back, "kept" said nothing that "open" did not already say. A window that
    // has already been here is reloading rather than returning, and a reload keeps what
    // the reader had.
    const reopen = stillHere() || read(REOPEN_KEY, false) === true;
    const wanted = (Array.isArray(remembered) ? remembered : []).filter(isTab);
    const kept = (reopen ? wanted : wanted.filter((entry) => entry.pinned === true)).map((entry) =>
      // A kept tab comes back as it was, whatever its kind. `restores` says what to do
      // with a tab that merely happened to be showing something — a shell that is not
      // running any more, a settings page nobody was mid-anything on. Keeping a tab is
      // a statement about tomorrow, and answering it with the volumes is answering
      // something the reader did not ask.
      entry.pinned === true || TAB_KINDS_BY_ID[entry.kind].restores
        ? {
            id: entry.id,
            kind: entry.kind,
            path: entry.path,
            own: entry.own === true,
            pinned: entry.pinned === true,
            ...historyOf(entry, entry.path),
          }
        : {
            id: entry.id,
            kind: 'folder',
            path: HOME,
            own: false,
            pinned: entry.pinned === true,
            history: [HOME],
            at: 0,
          }
    );
    // A kept tab is a place somebody keeps, not necessarily where they want to land, so
    // coming back lands on a fresh tab at the volumes — which is also the only tab there
    // is when nothing was kept.
    if (reopen && kept.length > 0) return kept;
    landOnFresh = true;
    return [...kept, makeTab(HOME)];
  };

  /** Whether the tab to land on is the fresh one `load` just made, rather than a kept one. */
  let landOnFresh = false;

  const tabs = ref(load());
  markHere();
  const rememberedActive = read(ACTIVE_KEY, '');
  const activeId = ref(
    // The fresh tab is the last one, and it is where a return lands when the tabs did
    // not come back: a kept tab is a place somebody keeps, not where they want to be.
    landOnFresh
      ? tabs.value[tabs.value.length - 1].id
      : tabs.value.some((tab) => tab.id === rememberedActive)
        ? rememberedActive
        : tabs.value[0].id
  );

  /** Whether this account asked for tabs at all. Set from the settings, not read. */
  const enabled = ref(false);

  const activeTab = computed(
    () => tabs.value.find((tab) => tab.id === activeId.value) || tabs.value[0] || null
  );
  const activeIndex = computed(() => tabs.value.findIndex((tab) => tab.id === activeId.value));
  const count = computed(() => tabs.value.length);
  /** The last tab cannot be closed: there would be nowhere to be. */
  const canClose = computed(() => tabs.value.length > 1);

  /**
   * Write the tabs down, called by each thing that changes them.
   *
   * Explicitly, and not from a deep watcher over the list: that was the first
   * version, and it ran once — on the immediate pass — and never again, so a tab
   * opened after the page loaded was never written. Whatever the reason inside
   * Vue's traversal of a multi-source watcher, a list this small is not worth a
   * mechanism nobody can point at. Five callers say when they changed something.
   */
  const persist = () => {
    write(
      OPEN_KEY,
      tabs.value.map(({ id, kind, path, own, pinned, history, at }) => ({
        id,
        kind,
        path,
        own,
        pinned,
        history,
        at,
      }))
    );
    write(ACTIVE_KEY, activeId.value);
  };
  persist();

  /**
   * The tab the reader has just brought forward, until a page asks about it.
   *
   * A page cannot tell that on its own. Bringing a tab forward and walking into a
   * folder both arrive as a new address on the same route, and the listing that
   * mounts for either of them looks exactly the same — which is why coming back
   * to a folder tab read the folder again from the server and landed the reader
   * at the top of it, having thrown away what they had selected.
   *
   * A flag, consumed by whoever it is for, rather than a guess made from what the
   * store happens to be holding: a store already on a folder is also what somebody
   * walking back up to it, or landing on a search result in it, looks like.
   */
  const broughtForward = ref('');

  /** Whether this tab is the one just brought forward. Asking clears it. */
  const takeBroughtForward = (id) => {
    if (!id || broughtForward.value !== id) return false;
    broughtForward.value = '';
    return true;
  };

  const activate = (id) => {
    if (!tabs.value.some((tab) => tab.id === id)) return null;
    activeId.value = id;
    broughtForward.value = id;
    persist();
    return activeTab.value;
  };

  /**
   * How many tabs this installation allows, told by whoever knows.
   *
   * A row of tabs that never scrolls has to stop somewhere: past a certain number
   * they are too narrow to read, and a strip that scrolls hides the very tabs
   * somebody opened. The number is an administrator's to choose — see the Tabs
   * settings — and is told to this store rather than read from here, for the same
   * reason `enabled` is.
   */
  const limit = ref(DEFAULT_TAB_LIMIT);

  const setLimit = (value) => {
    const asked = Number(value);
    limit.value = Number.isFinite(asked) ? Math.max(1, Math.round(asked)) : DEFAULT_TAB_LIMIT;
  };

  /** Whether there is room for another. */
  const atLimit = computed(() => enabled.value && tabs.value.length >= limit.value);

  /**
   * Open an address in a tab, and answer with the tab it is in.
   *
   * A second tab on a screen there is only one of — the trash, the settings — is
   * two views of one thing, so the one already open is brought forward instead.
   * A new tab lands at the end of the row, which is where Edge and Chrome put one
   * and where the reader will look for it.
   *
   * Nothing opens once the row is full: answering null leaves the gesture to say
   * so, rather than making a tab too narrow to read or pushing one out of sight.
   *
   * With tabs turned off there is one tab and it goes where it is told, which is
   * what the application did before any of this existed.
   */
  const open = (path, { activate: shouldActivate = true, own = false } = {}) => {
    const kind = tabKindForPath(path);
    if (!kind) return null;

    if (!enabled.value) {
      const current = activeTab.value;
      if (current) {
        current.kind = kind.id;
        current.path = path;
        persist();
      }
      return current;
    }

    if (kind.singleton) {
      const existing = tabs.value.find((tab) => tab.kind === kind.id);
      if (existing) {
        existing.path = path;
        // Brought forward rather than made, so it is not a tab opened for this.
        existing.own = false;
        persist();
        return shouldActivate ? activate(existing.id) : existing;
      }
    }

    if (atLimit.value) return null;

    const tab = makeTab(path, own);
    tabs.value.push(tab);
    persist();
    return shouldActivate ? activate(tab.id) : tab;
  };

  /**
   * The same place again, in a tab beside it.
   *
   * What a browser offers for duplicating a tab, and for the same reason: two
   * views of one folder, one of them about to be taken somewhere else. Beside the tab it
   * came from rather than at the end of the row, because that is where the reader
   * is looking — and it is a tab of its own from the moment it exists, so it never
   * inherits `own` and cannot be closed by a document's cross.
   *
   * Its history is the original's, up to where the original is: the copy can walk
   * back the way the tab it came from walked in.
   */
  const duplicate = (id) => {
    const from = tabs.value.findIndex((tab) => tab.id === id);
    if (from < 0 || atLimit.value) return null;

    const source = tabs.value[from];
    const copy = {
      id: makeId(),
      kind: source.kind,
      path: source.path,
      own: false,
      pinned: false,
      history: source.history.slice(0, source.at + 1),
      at: source.at,
    };
    // After the pinned run when the original is in it: a copy is not pinned, and
    // an unpinned tab does not belong among the pinned ones.
    tabs.value.splice(source.pinned ? pinnedCount() : from + 1, 0, copy);
    persist();
    return activate(copy.id);
  };

  /**
   * Kept: at the front of the row, narrow, and not taken away by "close them all".
   *
   * Which is what somebody means by pinning a folder they work in every day — it
   * should be there when they open the application and it should not be one
   * mis-aimed click from being gone. A pinned tab has no cross for that reason;
   * unpinning it gives it one back.
   *
   * The pinned ones are a run at the front of the row, so pinning moves a tab to
   * the end of that run and unpinning moves it to the start of what follows.
   * Nothing else may cross that line — see `move`.
   */
  const pinnedCount = () => tabs.value.filter((tab) => tab.pinned).length;

  const setPinned = (id, pinned) => {
    const from = tabs.value.findIndex((tab) => tab.id === id);
    if (from < 0 || tabs.value[from].pinned === pinned) return null;

    const [tab] = tabs.value.splice(from, 1);
    tab.pinned = pinned;
    tabs.value.splice(pinnedCount(), 0, tab);
    persist();
    return tab;
  };

  const pin = (id) => setPinned(id, true);
  const unpin = (id) => setPinned(id, false);
  const togglePinned = (id) => {
    const tab = tabs.value.find((entry) => entry.id === id);
    return tab ? setPinned(id, !tab.pinned) : null;
  };

  /**
   * Everything closed, and one new tab at the volumes.
   *
   * A window with no tabs has nowhere to be, so "close them all" means "start
   * again" — which is what it means in a browser, and what somebody who has
   * twelve of them open and wants none of them is asking for.
   */
  const closeAll = () => {
    // Except the pinned ones, which is what pinning is for: a tab kept on purpose
    // is not swept away by a button that means "I am done with all of this".
    const kept = tabs.value.filter((tab) => tab.pinned);
    tabs.value = kept.length > 0 ? kept : [makeTab(HOME)];
    activeId.value = tabs.value[0].id;
    persist();
    return activeTab.value;
  };

  /**
   * Close a tab, and answer with the one now in front — or null when nothing
   * moved, which is what closing the only tab does.
   *
   * The tab to the right takes over, and the one to the left when there is no
   * right: closing a run of tabs from one place then walks in one direction
   * rather than jumping about.
   */
  const close = (id) => {
    if (!canClose.value) return null;
    const at = tabs.value.findIndex((tab) => tab.id === id);
    if (at < 0) return null;

    const wasActive = tabs.value[at].id === activeId.value;
    tabs.value.splice(at, 1);
    persist();
    if (!wasActive) return null;

    const next = tabs.value[at] || tabs.value[at - 1];
    return activate(next.id);
  };

  /** Every tab but this one, for the strip's own menu. */
  const closeOthers = (id) => {
    if (!tabs.value.some((tab) => tab.id === id)) return null;
    tabs.value = tabs.value.filter((tab) => tab.id === id || tab.pinned);
    persist();
    return activate(id);
  };

  /**
   * Put a tab somewhere else in the row, and answer with it.
   *
   * The order of the tabs is the reader's, not the application's: they open a
   * folder to compare against another and want the two side by side, and until
   * now the only order available was the order things happened to be opened in.
   *
   * A place outside the row is the nearest end of it rather than nothing, because
   * this is also what a finger dragging a tab past the last one means. Which tab
   * is in front does not change: moving something is not choosing it.
   */
  /**
   * Where a tab may go: inside its own run, pinned or not.
   *
   * The pinned tabs are a run at the front of the row. A tab dragged out of that
   * run would be pinned and not at the front, or unpinned and among the pinned
   * ones, and either way the row would stop saying what it means.
   */
  const rangeFor = (tab) => {
    const pinned = pinnedCount();
    return tab.pinned ? [0, pinned - 1] : [pinned, tabs.value.length - 1];
  };

  const move = (id, index) => {
    const from = tabs.value.findIndex((tab) => tab.id === id);
    if (from < 0) return null;
    const [low, high] = rangeFor(tabs.value[from]);
    const to = Math.max(low, Math.min(high, index));
    if (to === from) return tabs.value[from];

    const [moved] = tabs.value.splice(from, 1);
    tabs.value.splice(to, 0, moved);
    persist();
    return moved;
  };

  /** One place along, which is what the menu offers and the ends refuse. */
  const nudge = (id, step) => {
    const from = tabs.value.findIndex((tab) => tab.id === id);
    return from < 0 ? null : move(id, from + step);
  };

  /** Whether there is anywhere that way to go: what greys the menu out. */
  const canMove = (id, step) => {
    const from = tabs.value.findIndex((tab) => tab.id === id);
    if (from < 0) return false;
    const [low, high] = rangeFor(tabs.value[from]);
    return from + step >= low && from + step <= high;
  };

  /**
   * Where this tab has been, and walking it.
   *
   * A window's history is the window's: pressing Back in a window with six tabs
   * open took the reader to whatever address they last looked at, in whichever tab
   * that was, and left the tab they were in pointing somewhere it had never been.
   * A tab that keeps its own trail answers the question people are actually
   * asking — "where was *this* one before".
   *
   * Recorded here rather than by whoever navigates, because every way of arriving
   * somewhere ends in the same place: the address changed, and `syncActive` is
   * told. What that leaves is telling a step back from a walk forward, and the
   * trail itself says which: a step lands on the address already under the mark,
   * so there is nothing to record.
   */
  const canGoBack = (id) => {
    const tab = tabs.value.find((entry) => entry.id === id);
    return Boolean(tab && tab.at > 0);
  };

  const canGoForward = (id) => {
    const tab = tabs.value.find((entry) => entry.id === id);
    return Boolean(tab && tab.at < tab.history.length - 1);
  };

  const step = (id, delta) => {
    const tab = tabs.value.find((entry) => entry.id === id);
    if (!tab) return null;
    const to = tab.at + delta;
    if (to < 0 || to >= tab.history.length) return null;

    tab.at = to;
    tab.path = tab.history[to];
    tab.kind = tabKindForPath(tab.path)?.id || tab.kind;
    // Walked to rather than opened for: a document's cross must not close a tab
    // somebody walked back into.
    tab.own = false;
    persist();
    return tab;
  };

  const back = (id) => step(id, -1);
  const forward = (id) => step(id, 1);

  /** The one after, or the one before, wrapping — what ctrl+Tab does. */
  const neighbour = (step) => {
    if (tabs.value.length < 2) return null;
    const at = activeIndex.value;
    const to = (at + step + tabs.value.length) % tabs.value.length;
    return tabs.value[to];
  };

  /** The tab at a position, counting from one, as ctrl+1…9 does. */
  const at = (position) => tabs.value[position - 1] || null;

  /**
   * The same tab, at an address it gave itself.
   *
   * A screen that rewrites its own address has not been taken anywhere: a comparison
   * whose two sides were swapped over is the same tab, holding the same thing, saying
   * it the other way round. The ordinary landing cannot tell that apart from the reader
   * walking somewhere, so it did what it does for a walk — dropped `own`, which is the
   * flag a screen's own cross closes the tab by, and left a trail entry for a place the
   * tab never left. The cross then stopped closing anything and pushed a folder over
   * the comparison instead, and Back came out at the same comparison mirrored.
   *
   * Said before the address changes, so the landing that follows sees an address the
   * tab is already on and leaves both of those alone.
   */
  const retarget = (id, path) => {
    const tab = tabs.value.find((entry) => entry.id === id);
    if (!tab || !path || tab.path === path) return null;
    const kind = tabKindForPath(path);
    if (!kind) return null;
    tab.path = path;
    tab.kind = kind.id;
    // The mark stays where it is and what it points at is rewritten: a replaced
    // address is one place, not two.
    tab.history = tab.history.map((one, index) => (index === tab.at ? path : one));
    persist();
    return tab;
  };

  /**
   * The router landed somewhere: the active tab is now that place.
   *
   * An address that is not a kind — signing in, a share's password — leaves the
   * tabs alone rather than turning the tab in front into something it cannot be.
   */
  const syncActive = (path) => {
    const kind = tabKindForPath(path);
    const current = activeTab.value;
    if (!kind || !current) return null;
    // Taken somewhere else, so it is no longer a tab that exists for one thing.
    if (current.path !== path) current.own = false;
    current.kind = kind.id;
    current.path = path;

    // A new place in this tab's trail — unless it is the place the mark is
    // already on, which is what a step back or forward has just made it. Walking
    // on from the middle of a trail forgets what was ahead, as a browser does.
    if (current.history[current.at] !== path) {
      current.history = [...current.history.slice(0, current.at + 1), path].slice(-HISTORY_DEPTH);
      current.at = current.history.length - 1;
    }

    persist();
    return current;
  };

  /**
   * Told what the account asked for, and told only once that is known.
   *
   * With tabs off there is one tab, and it is the one in front: the others would
   * otherwise be kept and unreachable, and turning the setting back on would bring
   * back tabs from before it was turned off — state the reader cannot see is state
   * the reader cannot trust.
   *
   * Which is why this is a `set` and not a watcher over the settings. At the first
   * paint the settings have not arrived, so `browseInTabs` is not false, it is
   * *unknown* — and the watcher that could not tell the difference threw away every
   * tab a reader had, on every page load, a moment before the answer came. Whoever
   * calls this knows the answer; nobody calls it guessing.
   */
  const setEnabled = (value) => {
    enabled.value = value === true;
    if (!enabled.value && tabs.value.length > 1) closeOthers(activeId.value);
  };

  /**
   * Whether the tabs come back next time, written down for the next load.
   *
   * Told the same way and for the same reason as the one above: before the settings
   * arrive the answer is unknown, and nobody calls this guessing. Nothing on screen
   * changes when it is told — this is about the return, not about now.
   */
  const setReopen = (value) => {
    write(REOPEN_KEY, value === true);
  };

  return {
    tabs,
    activeId,
    activeTab,
    activeIndex,
    count,
    canClose,
    enabled,
    setEnabled,
    setReopen,
    limit,
    setLimit,
    atLimit,
    open,
    close,
    closeOthers,
    closeAll,
    activate,
    takeBroughtForward,
    move,
    nudge,
    canMove,
    neighbour,
    at,
    syncActive,
    retarget,
    duplicate,
    pin,
    unpin,
    togglePinned,
    pinnedCount,
    back,
    forward,
    canGoBack,
    canGoForward,
  };
});
