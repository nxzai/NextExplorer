import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';

/**
 * The terminals, one per tab.
 *
 * It used to be one per *window*: a single drawer, a single folder, a single
 * shell. That is what made opening a terminal feel like leaving the application —
 * there was one of it, and it was in the way of everything else.
 *
 * A terminal belongs to the tab it was opened from. Each tab can have one, all of
 * them can be running at once, and bringing another tab forward neither closes a
 * shell nor shows somebody else's. With tabs turned off there is one tab, so
 * there is one terminal, which is what the application always did.
 *
 * Two ways of showing one, and the reader chooses which: the drawer beside what
 * the tab holds, which is the ordinary one, and the whole of the tab, which is
 * what a terminal opened deliberately into its own tab gets. Both are the same
 * session — see `TerminalHost.vue`, which draws them and is the only thing that
 * knows where each one goes.
 *
 * This store holds no shell and no socket. It says which tabs have a terminal,
 * where each starts, and whether it is on screen; what a terminal *is* belongs to
 * `TerminalSurface.vue`, and is kept alive by the host for as long as this store
 * says the session exists.
 */
export const useTerminalStore = defineStore('terminal', () => {
  /** Keyed by tab id. A tab with no entry has never opened one. */
  const sessions = reactive({});

  const sessionFor = (id) => (id && sessions[id]) || null;
  const isOpenIn = (id) => sessionFor(id)?.open === true;

  /**
   * Open one in this tab, in the folder given.
   *
   * `key` counts the launches rather than naming the session: a shell cannot change
   * its mind about where it started, so asking for another folder builds another
   * terminal instead of moving this one. Asking for the same folder again gives back
   * the shell that is already there — running, with everything it has printed and
   * everything that was typed into it — whether the drawer was open or shut.
   *
   * That last part is the whole of it: shutting the drawer used to end the shell, so
   * somebody who shut it to look at the folder underneath came back to a fresh prompt
   * with their history gone. A drawer is a drawer.
   */
  const openIn = (id, cwd = '', { input = '', mode = 'drawer' } = {}) => {
    if (!id) return null;
    const path = typeof cwd === 'string' ? cwd : '';
    const existing = sessions[id];
    if (existing && existing.path === path && existing.mode === mode && !input) {
      existing.open = true;
      return existing;
    }

    sessions[id] = {
      open: true,
      mode: mode === 'page' ? 'page' : 'drawer',
      path,
      input: typeof input === 'string' ? input : '',
      key: (existing?.key ?? 0) + 1,
    };
    return sessions[id];
  };

  /**
   * Shut the drawer, and keep what is in it.
   *
   * Shut rather than ended. It used to be ended, on the grounds that a terminal nobody
   * can see is a process nobody can see — but shutting a drawer is how somebody looks
   * at the folder underneath it, not how they say they are done, and coming back to a
   * fresh prompt with the history gone is not what a drawer means anywhere else.
   *
   * What does end a shell: typing `exit` in it, and closing the tab it belongs to.
   */
  const closeIn = (id) => {
    if (sessions[id]) sessions[id].open = false;
  };

  const toggleIn = (id, cwd = '', options = {}) =>
    isOpenIn(id) ? closeIn(id) : openIn(id, cwd, options);

  /** Tabs that are gone take their terminals with them. */
  const keepOnly = (ids) => {
    const live = new Set(ids || []);
    for (const id of Object.keys(sessions)) {
      if (!live.has(id)) delete sessions[id];
    }
  };

  /**
   * Which tabs have one at all, for whoever draws them.
   *
   * Every session, not only the ones on screen: a shut drawer is still a running shell,
   * and whoever draws them has to keep drawing it — hidden — or it is unmounted, and an
   * unmounted terminal is a killed shell.
   */
  const openIds = computed(() => Object.keys(sessions));

  return { sessions, sessionFor, isOpenIn, openIn, closeIn, toggleIn, keepOnly, openIds };
});
