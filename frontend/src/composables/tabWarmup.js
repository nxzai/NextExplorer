import { TAB_KINDS_BY_ID, tabFolderPath } from '@/config/tabKinds';
import { documentItemFromAddress } from '@/utils/documentRoute';

/**
 * Getting a tab ready before the reader arrives at it.
 *
 * A tab opened behind is an address and nothing else: the router draws one page,
 * the one in front, so everything a background tab needs happens at the moment it
 * is brought forward. For a folder that is a listing to fetch; for a document in
 * ONLYOFFICE it is an iframe, a document server to reach and an editing session to
 * open, which is seconds of watching a blank panel — after deliberately opening
 * that tab in advance precisely so as not to wait.
 *
 * So each kind of tab is asked to do its own waiting early. Nothing here draws
 * anything or navigates anywhere; it fills the places that already outlive a page,
 * which is why it is possible at all:
 *
 * - a **document** gets its session in the preview manager, and the host — mounted
 *   once, for every tab at once — builds the viewer hidden. Arriving at the tab
 *   finds it already showing, and the page's own first question ("is this already
 *   here?") answers yes.
 * - a **folder** gets its listing read into its own tab's folder, which every tab
 *   has had since tabs existed.
 * - a **terminal** gets its session, and the terminal host starts the shell.
 * - an **editor** gets the file read and *kept for its tab*, which is what makes it
 *   ready rather than merely quicker. Warming the browser's cache was not enough:
 *   the page still had to mount and ask, so the first arrival still showed a
 *   spinner and then the text. What a tab keeps is what the page reads before it
 *   asks anything, so the file is put there.
 *
 * The screens there is only one of — the trash, the settings, a search — are left
 * alone: they are cheap, and a second copy of one is not a thing.
 */

/**
 * How many tabs may be got ready.
 *
 * A number rather than "all of them", because what a warm document tab holds is
 * not a cache: it is an iframe, a connection to the document server and an editing
 * session on it. Ten of those opened by one gesture would be ten editors nobody
 * asked to open. Three is enough to cover the gesture this exists for — opening a
 * handful of places to read through — and small enough to be honest about.
 */
export const WARM_TAB_LIMIT = 3;

/**
 * What getting one ready costs, in the only unit that matters here: whether it
 * takes a session on a server. A listing does not; an editor does.
 */
const holdsASession = (kind) => kind === 'document' || kind === 'terminal';

/**
 * Prepare one tab, and say whether there was anything to prepare.
 *
 * Told everything it needs rather than reaching for it: the stores come from the
 * caller, which is what lets this be tested without a router, a document server or
 * fifteen stores around it — and what keeps it out of the module graph of every
 * screen that opens a tab.
 *
 * @param {{ id: string, kind: string, path: string }} tab
 * @param {object} tools
 * @param {object} tools.fileStore
 * @param {object} tools.previewManager
 * @param {object} tools.terminalStore
 * @param {(path: string) => Promise<unknown>} tools.readFile
 * @param {(id: string) => () => void} [tools.beginLoading]  says the tab is busy,
 *   and answers with the way to say it is not
 * @param {(id: string, address: string, source: string) => void} [tools.keepSource]
 *   holds the file for that tab, where the editor page reads it on the way in
 * @param {(id: string, address: string) => boolean} [tools.alreadyKept]  whether
 *   that tab is already holding something for that address
 */
export const warmTab = (
  tab,
  { fileStore, previewManager, terminalStore, readFile, beginLoading, keepSource, alreadyKept } = {}
) => {
  if (!tab?.id || !TAB_KINDS_BY_ID[tab.kind]) return false;
  // A tab prepared in the background is working while the reader is looking at
  // something else, so it has to be able to say so — otherwise there is nothing to
  // tell "not there yet" from "there, and empty". Ended by whoever finishes the
  // work, which for a document is the viewer once it has really loaded.
  const done = beginLoading?.(tab.id) ?? (() => {});

  if (tab.kind === 'folder') {
    const folder = tabFolderPath(tab);
    // A tab that has already been there holds its listing, its selection and
    // possibly a rename half typed. Reading the folder again would be a head start
    // on nothing, at the cost of disturbing all of it.
    if (fileStore?.holdsFolder?.(tab.id, folder)) {
      done();
      return false;
    }
    // Quietly, and without touching what is on screen: this is a tab nobody is
    // looking at, and a failure here costs the head start, not the tab.
    const reading = fileStore?.fetchIn?.(tab.id, folder);
    if (reading?.then) reading.then(done, done);
    else done();
    return true;
  }

  if (tab.kind === 'document') {
    const item = documentItemFromAddress(tab.path);
    if (!item) {
      done();
      return false;
    }
    // The manager says this tab is working, and stops saying it when the viewer is
    // really there — which is its business, not this one's: only the viewer knows
    // when a document server has answered. Opening a document normally goes the
    // same way, so the tab says the same thing either way.
    done();
    return Boolean(previewManager?.openIn?.(tab.id, item));
  }

  if (tab.kind === 'terminal') {
    // The shell starts as soon as the session exists, so there is nothing to wait
    // for that this could report.
    done();
    const folder = String(tab.path || '').replace(/^\/terminal\/?/, '');
    let decoded = folder;
    try {
      decoded = folder
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/');
    } catch {
      // A percent sign that decodes to nothing is still part of a folder's name.
    }
    return Boolean(terminalStore?.openIn?.(tab.id, decoded, { mode: 'page' }));
  }

  if (tab.kind === 'editor') {
    const path = String(tab.path || '').replace(/^\/editor\/?/, '');
    if (!path) {
      done();
      return false;
    }
    let decoded = path;
    try {
      decoded = path
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/');
    } catch {
      // As above.
    }
    // Nothing over a tab that is already holding something for this address: that
    // would be unsaved work, and a head start is not worth it.
    if (alreadyKept?.(tab.id, tab.path)) {
      done();
      return false;
    }

    const reading = readFile?.(decoded);
    if (!reading?.then) {
      done();
      return true;
    }
    reading.then((response) => {
      // Kept for the tab, which is where the page looks before it asks anything.
      // Warming the network alone left the first arrival showing a spinner and then
      // the text, because a page that has not been built yet has read nothing.
      keepSource?.(tab.id, tab.path, typeof response?.content === 'string' ? response.content : '');
      done();
    }, done);
    return true;
  }

  done();
  return false;
};

/**
 * Prepare several, newest first, up to the number allowed.
 *
 * Newest first because the tab somebody has just opened is the one they are about
 * to look at. Tabs that hold a session on a server are counted against the limit
 * and the rest are not: a listing is a listing.
 */
export const warmTabs = (tabs, tools = {}, { limit = WARM_TAB_LIMIT } = {}) => {
  const warmed = [];
  let sessions = 0;

  for (const tab of [...(tabs || [])].reverse()) {
    if (holdsASession(tab?.kind) && sessions >= limit) continue;
    if (!warmTab(tab, tools)) continue;
    if (holdsASession(tab.kind)) sessions += 1;
    warmed.push(tab.id);
  }

  return warmed;
};

/**
 * Get tabs ready, asking first whether this account wants that.
 *
 * The one door every gesture goes through, because they do not share a road: the
 * middle button on a row, the modifier on a favourite and the entry in the menu all
 * open a tab behind, and two of them go straight to the store rather than through
 * `tabNavigation`. That is why the first version of this prepared nothing for the
 * two gestures people actually use — it was wired into the one road that happened
 * to be in front of me.
 *
 * Everything heavy is fetched when it is needed rather than imported, so that a
 * row in a listing does not pull the preview manager, the file store and the
 * terminal into its module graph for a gesture nobody has made yet.
 *
 * On unless the account has turned it off, and only once the settings have
 * arrived: before that the answer is not "no", it is *unknown*, and acting on the
 * wrong one would open editing sessions nobody asked for.
 */
export const warmInBackground = async (toWarm) => {
  const candidates = (Array.isArray(toWarm) ? toWarm : [toWarm]).filter(Boolean);
  if (candidates.length === 0) return [];

  const [{ useAppSettings }, { useFileStore }, { usePreviewManager }, { useTerminalStore }, api] =
    await Promise.all([
      import('@/stores/appSettings'),
      import('@/stores/fileStore'),
      import('@/plugins/preview/manager'),
      import('@/stores/terminal'),
      import('@/api'),
    ]);

  const settings = useAppSettings();
  if (!settings.loaded || settings.userSettings?.preloadBackgroundTabs === false) return [];

  const [{ useTabLoadingStore }, { useEditorDraftsStore }] = await Promise.all([
    import('@/stores/tabLoading'),
    import('@/stores/editorDrafts'),
  ]);
  const busy = useTabLoadingStore();
  const drafts = useEditorDraftsStore();

  return warmTabs(candidates, {
    fileStore: useFileStore(),
    previewManager: usePreviewManager(),
    terminalStore: useTerminalStore(),
    readFile: api.fetchFileContent,
    beginLoading: busy.begin,
    keepSource: (id, address, source) =>
      drafts.keep(id, address, {
        text: null,
        source,
        selection: null,
        scrollTop: 0,
        topLine: null,
      }),
    alreadyKept: (id, address) => Boolean(drafts.placeFor(id, address)),
  });
};
