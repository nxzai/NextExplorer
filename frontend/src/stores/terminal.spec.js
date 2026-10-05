import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useTerminalStore } from './terminal';

/**
 * One terminal per tab.
 *
 * It used to be one per window — one drawer, one folder, one shell — which is
 * what made opening a terminal feel like leaving the application. Four folders
 * open in four tabs is four places somebody may want a shell in, and bringing one
 * tab forward must show that tab's, not the last one anybody opened.
 */

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('a terminal in a tab', () => {
  it('is open in the tab it was asked for, and in no other', () => {
    const terminals = useTerminalStore();

    terminals.openIn('tab-1', 'Docs');

    expect(terminals.isOpenIn('tab-1')).toBe(true);
    expect(terminals.isOpenIn('tab-2')).toBe(false);
    expect(terminals.sessionFor('tab-1').path).toBe('Docs');
  });

  it('is one of several, each in its own folder', () => {
    const terminals = useTerminalStore();

    terminals.openIn('tab-1', 'Docs');
    terminals.openIn('tab-2', 'Media/2026');

    expect(terminals.openIds).toEqual(['tab-1', 'tab-2']);
    expect(terminals.sessionFor('tab-2').path).toBe('Media/2026');
    // Untouched by the second: the point of the whole thing.
    expect(terminals.sessionFor('tab-1').path).toBe('Docs');
  });

  /**
   * A shell cannot change its mind about where it started, so another folder is
   * another shell — which is what the key counts, and what makes the host build
   * a new one rather than move this one.
   */
  it('is built again when the same tab asks for another folder', () => {
    const terminals = useTerminalStore();

    terminals.openIn('tab-1', 'Docs');
    const first = terminals.sessionFor('tab-1').key;
    terminals.openIn('tab-1', 'Media');

    expect(terminals.sessionFor('tab-1').key).toBeGreaterThan(first);
    expect(terminals.sessionFor('tab-1').path).toBe('Media');
  });

  /**
   * And is not built again when nothing was asked for. A tab coming back to
   * itself asks for the terminal it already has — a page mounts again every time
   * its tab comes forward — and answering that with a new shell would be the
   * reload this whole design exists to prevent.
   */
  it('is the same one when the same tab asks for the same folder again', () => {
    const terminals = useTerminalStore();

    terminals.openIn('tab-1', 'Docs', { mode: 'page' });
    const first = terminals.sessionFor('tab-1').key;
    terminals.openIn('tab-1', 'Docs', { mode: 'page' });

    expect(terminals.sessionFor('tab-1').key).toBe(first);
  });

  it('is built again when the same folder is asked for with something to type', () => {
    const terminals = useTerminalStore();

    terminals.openIn('tab-1', 'Docs');
    const first = terminals.sessionFor('tab-1').key;
    terminals.openIn('tab-1', 'Docs', { input: './build.sh\n' });

    expect(terminals.sessionFor('tab-1').key).toBeGreaterThan(first);
    expect(terminals.sessionFor('tab-1').input).toBe('./build.sh\n');
  });

  it('is shut on its own, and the others keep running', () => {
    const terminals = useTerminalStore();
    terminals.openIn('tab-1', 'Docs');
    terminals.openIn('tab-2', 'Media');

    terminals.closeIn('tab-1');

    expect(terminals.isOpenIn('tab-1')).toBe(false);
    expect(terminals.isOpenIn('tab-2')).toBe(true);
  });

  it('is toggled by the same gesture that opened it', () => {
    const terminals = useTerminalStore();

    terminals.toggleIn('tab-1', 'Docs');
    expect(terminals.isOpenIn('tab-1')).toBe(true);

    terminals.toggleIn('tab-1', 'Docs');
    expect(terminals.isOpenIn('tab-1')).toBe(false);
  });

  /** A tab that has gone takes its shell with it: nobody can reach it now. */
  it('goes when its tab does', () => {
    const terminals = useTerminalStore();
    terminals.openIn('tab-1', 'Docs');
    terminals.openIn('tab-2', 'Media');

    terminals.keepOnly(['tab-2']);

    expect(terminals.openIds).toEqual(['tab-2']);
  });

  it('is asked for by a tab that does not exist, and nothing happens', () => {
    const terminals = useTerminalStore();

    expect(terminals.openIn('', 'Docs')).toBeNull();
    expect(terminals.openIds).toEqual([]);
  });
});

/**
 * A drawer is a drawer: shutting it is how somebody looks at the folder underneath,
 * not how they say they are done with the shell.
 *
 * It used to end the shell, on the grounds that a terminal nobody can see is a process
 * nobody can see. Coming back to a fresh prompt with the history gone is not what a
 * drawer means anywhere else, and it is not what the reader shutting it asked for.
 */
describe('shutting the drawer and opening it again', () => {
  it('gives back the shell that was in it, not another one', () => {
    const store = useTerminalStore();
    const first = store.openIn('tab-1', 'Projects');

    store.closeIn('tab-1');
    const again = store.openIn('tab-1', 'Projects');

    // The same launch: the surface is keyed on this, so it is not rebuilt.
    expect(again.key).toBe(first.key);
    expect(store.isOpenIn('tab-1')).toBe(true);
  });

  it('keeps the shell running while the drawer is shut', () => {
    const store = useTerminalStore();
    store.openIn('tab-1', 'Projects');

    store.closeIn('tab-1');

    // Not on screen…
    expect(store.isOpenIn('tab-1')).toBe(false);
    // …but still there to be drawn, hidden, which is what keeps it alive.
    expect(store.sessionFor('tab-1')).not.toBe(null);
    expect(store.openIds).toContain('tab-1');
  });

  /** Another folder is another shell: one cannot change its mind about where it started. */
  it('builds another when another folder is asked for', () => {
    const store = useTerminalStore();
    const first = store.openIn('tab-1', 'Projects');

    store.closeIn('tab-1');
    const other = store.openIn('tab-1', 'Media');

    expect(other.key).not.toBe(first.key);
    expect(other.path).toBe('Media');
  });

  /** And closing the tab ends it, which is the gesture that means "done". */
  it('ends with the tab it belongs to', () => {
    const store = useTerminalStore();
    store.openIn('tab-1', 'Projects');
    store.closeIn('tab-1');

    store.keepOnly(['tab-9']);

    expect(store.sessionFor('tab-1')).toBe(null);
    expect(store.openIds).toEqual([]);
  });
});
