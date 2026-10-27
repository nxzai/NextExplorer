import { describe, expect, it } from 'vitest';
import { TAB_KIND_IDS, TAB_KINDS_BY_ID, tabKindForPath, tabTitle } from './tabKinds';

/**
 * What a tab can hold, recognised from the address.
 *
 * The address is what the application already agrees on, so this is the whole of
 * how a tab knows what it is. Two things are worth holding: that the screens
 * which are *not* places — signing in, a share's password — are recognised as
 * such, because a strip of tabs over them would offer to leave the question
 * unanswered; and that a tab is named after the thing it holds rather than after
 * its address.
 */

const t = (key) => key;

describe('the kind an address belongs to', () => {
  it.each([
    ['/browse/', 'folder'],
    ['/browse/Docs/2026', 'folder'],
    ['/open/Docs/notes.md', 'document'],
    ['/editor/Docs/deploy.sh', 'editor'],
    ['/editor', 'editor'],
    ['/search?q=pangolin', 'search'],
    ['/trash', 'trash'],
    ['/trash/view/12/a.txt', 'trash'],
    ['/versions/view/3/Docs/a.txt', 'versions'],
    ['/shares/shared-with-me', 'shares'],
    ['/settings/about', 'settings'],
  ])('reads %s as %s', (path, kind) => {
    expect(tabKindForPath(path).id).toBe(kind);
  });

  /** A question the application is asking is not a place to keep a tab on. */
  it.each(['/auth/login', '/auth/setup', '/share/abc123', '/', '/browsers', ''])(
    'reads %s as no kind at all',
    (path) => {
      expect(tabKindForPath(path)).toBeNull();
    }
  );

  it('recognises every kind it declares', () => {
    expect(TAB_KIND_IDS.length).toBeGreaterThan(1);
    for (const id of TAB_KIND_IDS) expect(TAB_KINDS_BY_ID[id].icon).toBeTruthy();
  });
});

describe('what a tab is called', () => {
  it('is the folder, for a folder', () => {
    expect(tabTitle({ kind: 'folder', path: '/browse/Docs/2026' }, t)).toBe('2026');
  });

  it('is the volumes, at the top', () => {
    expect(tabTitle({ kind: 'folder', path: '/browse/' }, t)).toBe('breadcrumb.volumes');
    expect(tabTitle({ kind: 'folder', path: '/browse' }, t)).toBe('breadcrumb.volumes');
  });

  it('is the file, for a document and for the editor', () => {
    expect(tabTitle({ kind: 'document', path: '/open/Docs/notes.md' }, t)).toBe('notes.md');
    expect(tabTitle({ kind: 'editor', path: '/editor/Docs/deploy.sh' }, t)).toBe('deploy.sh');
  });

  /** The words the application already uses, rather than a second translation. */
  it('is the name of a named screen', () => {
    expect(tabTitle({ kind: 'trash', path: '/trash' }, t)).toBe('trash.title');
    expect(tabTitle({ kind: 'settings', path: '/settings/about' }, t)).toBe('common.settings');
  });

  it('is decoded, because the address is not', () => {
    expect(tabTitle({ kind: 'folder', path: '/browse/Docs/Mes%20photos' }, t)).toBe('Mes photos');
  });

  /** A percent sign that decodes to nothing is still a name. */
  it('keeps a name that is not valid encoding at all', () => {
    expect(tabTitle({ kind: 'folder', path: '/browse/100%' }, t)).toBe('100%');
  });

  it('says nothing for something that is not a tab', () => {
    expect(tabTitle({ kind: 'telepathy', path: '/wherever' }, t)).toBe('');
    expect(tabTitle(null, t)).toBe('');
  });

  it('drops the query, which is not part of a name', () => {
    expect(tabTitle({ kind: 'search', path: '/search?q=x' }, t)).toBe('actions.search');
  });
});

/**
 * A terminal is a place: it has an address, so it has a tab, so there can be as
 * many as there are tabs. The drawer could never do that — it belongs to the
 * window rather than to anything in it.
 */
describe('a terminal', () => {
  it('is recognised from its address, with a folder and without one', () => {
    expect(tabKindForPath('/terminal')?.id).toBe('terminal');
    expect(tabKindForPath('/terminal/Docs/2026')?.id).toBe('terminal');
  });

  /** Several at once is the point, so it is not a screen there is one of. */
  it('is not a screen there is only one of', () => {
    expect(TAB_KINDS_BY_ID.terminal.singleton).toBe(false);
  });

  /**
   * A shell that was running is not running any more, and a tab that comes back
   * to a dead one is worse than a tab that comes back to the volumes.
   */
  it('is not brought back when the reader returns', () => {
    expect(TAB_KINDS_BY_ID.terminal.restores).toBe(false);
  });

  /**
   * Named for the folder its shell is in.
   *
   * It used to be named for what it is, on the grounds that a terminal is a terminal.
   * That was wrong for the same reason it was wrong for a comparison: three shells open
   * were three tabs all reading "Terminal", and there was no telling which was which. A
   * shell is always somewhere, so there is always something better to say.
   */
  it('is named for the folder its shell is in', () => {
    expect(tabTitle({ kind: 'terminal', path: '/terminal/Docs/Reports' }, (key) => key)).toBe(
      'Reports'
    );
    expect(tabTitle({ kind: 'terminal', path: '/terminal/Docs' }, (key) => key)).toBe('Docs');
  });

  /** A name a folder cannot give: the address is written the way an address is. */
  it('reads a folder whose name was escaped in the address', () => {
    expect(tabTitle({ kind: 'terminal', path: '/terminal/Docs/Mes%20notes' }, (key) => key)).toBe(
      'Mes notes'
    );
  });

  /** And the word for it where the address names no folder at all. */
  it('falls back to the word for it at the top', () => {
    expect(tabTitle({ kind: 'terminal', path: '/terminal' }, (key) => key)).toBe('titles.terminal');
    expect(tabTitle({ kind: 'terminal', path: '/terminal/' }, (key) => key)).toBe(
      'titles.terminal'
    );
  });
});
