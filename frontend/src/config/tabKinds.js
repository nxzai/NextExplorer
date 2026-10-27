import {
  FolderIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ShareIcon,
  Cog6ToothIcon,
  ClockIcon,
  CommandLineIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/vue/24/outline';

/**
 * What a tab can hold.
 *
 * A tab is a **place in the application**, not a folder: the same list that
 * holds `Documents/2026` holds a spreadsheet open in ONLYOFFICE, the trash, or
 * the settings. That is what the Explorer does, and it is what makes the rest
 * cheap — the strip draws a tab from its kind, and a kind is one entry here.
 *
 * Each kind is recognised from the address it is on — the *full* address, query
 * and fragment included, because that is what the router hands over: `/search`
 * arrives as `/search?q=pangolin`, and a pattern that ended at a slash read it as
 * no kind at all.
 *
 * Recognised from the address because the address is what the
 * application already agrees on: every screen has one, and the active tab is
 * whichever of them the router is showing. Adding a kind later is this list plus
 * a route; nothing in the store or the strip has to learn about it.
 *
 * `singleton` is for the screens there is only ever one of — a second trash tab
 * is two views of one thing, and opening the trash while it is already open
 * should go to the tab that has it rather than make another.
 *
 * `restores` says whether a tab of this kind is worth bringing back when the
 * reader returns. A folder is; the settings are not — somebody who closes the
 * browser on a settings page was not in the middle of anything there.
 */
const TAB_KINDS = [
  {
    id: 'folder',
    match: /^\/browse([/?#]|$)/,
    icon: FolderIcon,
    // Nothing to name it from at `/browse/`, which is the list of volumes.
    rootTitleKey: 'breadcrumb.volumes',
    singleton: false,
    restores: true,
  },
  {
    id: 'document',
    match: /^\/open([/?#]|$)/,
    icon: DocumentTextIcon,
    singleton: false,
    restores: true,
  },
  {
    // A shell, in the folder its address names. There can be as many as there are
    // tabs, which is the point: the drawer belongs to the window and can only
    // ever show one.
    id: 'terminal',
    match: /^\/terminal([/?#]|$)/,
    icon: CommandLineIcon,
    titleKey: 'titles.terminal',
    // Named after the folder the shell is in. Three shells open were three tabs all
    // reading "Terminal", which is no more useful than three reading "Compare" — and a
    // shell is always somewhere, so there is always something better to say.
    nameFor: (tab) => folderOfTerminal(tab?.path),
    singleton: false,
    // Not brought back: a shell that was running is not running any more, and a
    // tab that comes back to a dead one is worse than a tab that comes back to
    // the volumes.
    restores: false,
  },
  {
    // Two or three files side by side. Not a singleton: comparing one pair does not
    // stop somebody comparing another, which is the usual way of reviewing a change
    // across several files.
    id: 'compare',
    match: /^\/compare([/?#]|$)/,
    icon: ArrowsRightLeftIcon,
    titleKey: 'compare.title',
    // Named after what it is comparing, because somebody with three comparisons
    // open has three tabs that would otherwise all read "Compare".
    nameFor: (tab) => comparedNames(tab?.path).join(' ↔ '),
    singleton: false,
    restores: true,
  },
  {
    id: 'editor',
    match: /^\/editor([/?#]|$)/,
    icon: CodeBracketIcon,
    singleton: false,
    restores: true,
  },
  {
    id: 'search',
    match: /^\/search([/?#]|$)/,
    icon: MagnifyingGlassIcon,
    titleKey: 'actions.search',
    singleton: true,
    restores: false,
  },
  {
    id: 'trash',
    match: /^\/trash([/?#]|$)/,
    icon: TrashIcon,
    titleKey: 'trash.title',
    singleton: true,
    restores: true,
  },
  {
    id: 'versions',
    match: /^\/versions([/?#]|$)/,
    icon: ClockIcon,
    titleKey: 'settings.fileVersions.title',
    singleton: true,
    restores: false,
  },
  {
    id: 'shares',
    match: /^\/shares([/?#]|$)/,
    icon: ShareIcon,
    titleKey: 'common.shares',
    singleton: true,
    restores: true,
  },
  {
    id: 'settings',
    match: /^\/settings([/?#]|$)/,
    icon: Cog6ToothIcon,
    titleKey: 'common.settings',
    singleton: true,
    restores: false,
  },
];

/**
 * The file names a comparison's address is about.
 *
 * Read from the address rather than from the screen, because the strip names a tab
 * that is not on screen — the page that knows what it is comparing has not been
 * built, and may never be if the reader never goes there.
 */
const comparedNames = (address) => {
  const query = String(address || '').split('?')[1];
  if (!query) return [];
  return new URLSearchParams(query)
    .getAll('paths')
    .map((path) => path.split('/').filter(Boolean).pop() || '')
    .filter(Boolean);
};

/**
 * The folder a terminal address names, as a name.
 *
 * Read from the address rather than from the shell, because the strip names tabs that
 * are not on screen — and the page that knows where its shell is has not been built,
 * and may never be if the reader never goes back to it.
 */
const folderOfTerminal = (address) => {
  const path = String(address || '')
    .replace(/^\/terminal\/?/, '')
    .split(/[?#]/)[0];
  return decodeURIComponent(path).split('/').filter(Boolean).pop() || '';
};

export const TAB_KIND_IDS = TAB_KINDS.map((kind) => kind.id);

export const TAB_KINDS_BY_ID = Object.fromEntries(TAB_KINDS.map((kind) => [kind.id, kind]));

/**
 * The kind of tab an address belongs in, or null for an address that is not one.
 *
 * Signing in, the setup screen and a share's password prompt are deliberately
 * not kinds: they are the application asking who you are, and a strip of tabs
 * over them would offer to leave a question unanswered.
 */
export const tabKindForPath = (path) => {
  const address = String(path || '');
  return TAB_KINDS.find((kind) => kind.match.test(address)) || null;
};

/**
 * What the strip writes on a tab.
 *
 * A named screen says its name, in the words the application already uses for it
 * — `trash.title` is what the sidebar says, so a tab holding the trash says the
 * same rather than a second translation of the same word. Everything else is
 * named after the thing it
 * holds: the last segment of the address, which for a folder is the folder and
 * for a document is the file. Decoded, because the address carries `%20` and a
 * tab should not.
 *
 * @param {{ kind: string, path: string }} tab
 * @param {(key: string) => string} t
 */
/**
 * The folder a tab is on, as the application names folders — or '' for anything
 * that is not a folder.
 *
 * Asked by the strip, which puts a favourite's own icon on a tab while the tab is
 * inside that favourite: to know whether it is, it has to read the folder out of
 * the address, decoded, the way a favourite stores it.
 */
export const tabFolderPath = (tab) => {
  if (tab?.kind !== 'folder') return '';
  const segments = String(tab.path || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean);
  // The kind's own prefix is not part of the folder: `/browse/Docs` is `Docs`.
  const parts = segments.slice(1);
  return parts
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        // A percent sign that decodes to nothing is still part of a name.
        return part;
      }
    })
    .join('/');
};

export const tabTitle = (tab, t) => {
  const kind = TAB_KINDS_BY_ID[tab?.kind];
  if (!kind) return '';
  // A kind that can name itself from its own address does: four tabs all reading
  // "Compare" are four tabs nobody can tell apart, which is the whole reason a tab
  // carries a name at all.
  if (kind.nameFor) {
    const own = kind.nameFor(tab);
    if (own) return own;
  }
  if (kind.titleKey) return t(kind.titleKey);

  const segments = String(tab.path || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean);
  // The kind's own prefix is not part of the name: `/browse/Docs` is `Docs`.
  const last = segments.length > 1 ? segments[segments.length - 1] : '';
  if (!last) return kind.rootTitleKey ? t(kind.rootTitleKey) : '';
  try {
    return decodeURIComponent(last);
  } catch {
    // A percent sign that decodes to nothing is still a name.
    return last;
  }
};
