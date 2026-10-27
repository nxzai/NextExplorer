import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, ref } from 'vue';

/**
 * A document at an address of its own.
 *
 * The page itself shows nothing — the preview does that, exactly as it does
 * over a folder. What this page owns is everything around it: which document
 * is opened, what happens when it closes, and what the server is told when the
 * tab is shut. That last one is the whole reason it is not simply a route with
 * a component behind it: a document closed by closing its tab has to stop
 * being reported as open, or the lock somebody else sees never clears.
 */

const routePath = ref('Docs/report.docx');
/**
 * Where the *window* is, which is not always where this page is.
 *
 * The pane beside the reader draws an address the address bar says nothing about,
 * and the two part company in the one case that matters here: a page taken off
 * screen while its tab is still on its document. Left null it follows the page,
 * which is the ordinary single-pane window.
 */
const windowPath = ref(null);
/** What kind of address the pane is on, which is how a screen knows it is still its own. */
const routeKind = ref('document');
const replace = vi.fn();
/**
 * The folder behind the document, read into a named tab.
 *
 * Named, because this is the one listing a document page writes and it writes it
 * after an await: into whichever tab was in front, it landed on the reader's own
 * listing — the folder they were looking at, replaced by this document's parent.
 */
const fetchIn = vi.fn(async () => {});
const pluginsReady = vi.fn(async () => {});
let editableExtensions = ['txt', 'md'];

/**
 * The manager, as a document belonging to a tab rather than to this page.
 *
 * One session per tab, which is what the real one keeps: what the page asks is
 * always about *its* tab, and a stand-in that answered about whichever tab was
 * in front would hide exactly the mistakes this page can make.
 */
const sessions = reactive({});
const openIn = vi.fn((key, item) => {
  sessions[key] = { open: true, item };
  return true;
});
const shows = vi.fn(
  (key, item) =>
    sessions[key]?.open === true &&
    sessions[key].item?.name === item.name &&
    sessions[key].item?.path === item.path
);
const closeIn = vi.fn((key) => {
  if (sessions[key]) sessions[key].open = false;
});

// This application's own tabs. A document opened in one is closed by closing that
// tab, and the rule for *which* tab may be closed is `tabNavigation`'s own, with
// its own spec: what belongs here is that this page asks it first.
const appTabs = vi.hoisted(() => ({
  enabled: false,
  activeId: 'tab-1',
  tabs: [{ id: 'tab-1', own: false }],
  // The tab of the pane this page is drawn in. Null is the ordinary case — one
  // pane, which is the tab in front. Set by the tests about a pair.
  pane: null,
}));
const closeOwn = vi.fn(() => false);
/**
 * The navigation, as faithful as it needs to be: where a screen goes when it has
 * finished is the *window* only while its tab is the one in front. In the half
 * beside the reader it is that tab that is taken somewhere, and the address bar is
 * not touched — which is the difference between a pane going back to its folder and
 * the reader's own half being taken there instead.
 */
const retargeted = vi.hoisted(() => []);
const leaveFrom = vi.hoisted(() => vi.fn());
vi.mock('@/composables/tabNavigation', () => ({
  useTabNavigation: () => ({
    get tabs() {
      return appTabs;
    },
    closeOwn: (...args) => closeOwn(...args),
    leaveFrom: (id, location, options) => {
      leaveFrom(id, location, options);
      if (!id || id === appTabs.activeId) {
        replace(location);
        return;
      }
      retargeted.push({ id, location });
    },
  }),
}));

/**
 * The pane's own address, which is where a screen reads its place from now: in a
 * pair only one pane is the route, and a screen that read the window's address
 * drew somebody else's place. The same route this spec already states.
 */
vi.mock('@/composables/paneTab', () => ({
  // The tab of the pane this page is drawn in, which with one pane is the tab in
  // front — and in a pair is this page's own half, whoever has focus.
  usePaneTabId: () => ({
    get value() {
      return appTabs.pane || appTabs.activeId;
    },
  }),
  usePaneRoute: () => ({
    get params() {
      return { path: routePath.value };
    },
    get fullPath() {
      return `/open/${routePath.value}`;
    },
  }),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    get params() {
      return { path: routePath.value };
    },
    // The address, which is what says this page has changed hands: two tabs can
    // hold the same document, and crossing between them changes nothing else.
    get fullPath() {
      return `/open/${windowPath.value ?? routePath.value}`;
    },
  }),
  useRouter: () => ({ replace }),
}));

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({
    t: (key, values) =>
      values && typeof values === 'object' ? `${key}:${Object.values(values).join(',')}` : key,
  }),
}));

vi.mock('@/api', () => ({
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
}));

vi.mock('@/plugins/preview/manager', () => ({
  usePreviewManager: () => ({
    shows: (...args) => shows(...args),
    openIn: (...args) => openIn(...args),
    closeIn: (...args) => closeIn(...args),
    isOpenIn: (key) => sessions[key]?.open === true,
  }),
}));

vi.mock('@/plugins', () => ({ whenPreviewPluginsReady: () => pluginsReady() }));

// The instance's name, for the tab's title, as Settings → Branding set it.
vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({ state: { branding: { appName: 'Chez Benjy' } } }),
}));

vi.mock('@/stores/fileStore', () => ({
  useFileStore: () => ({ fetchIn: (...args) => fetchIn(...args) }),
}));

vi.mock('@/config/editor', () => ({
  isEditableExtension: (extension) => editableExtensions.includes(extension),
}));

// Which kind of place an address names — the catalogue's own answer, held to it in
// `config/tabKinds.spec.js`. What is asked here is that this page looks.
vi.mock('@/config/tabKinds', () => ({
  tabKindForPath: () => ({ id: routeKind.value }),
}));

const DocumentView = (await import('./DocumentView.vue')).default;

/**
 * One page at a time.
 *
 * Every mounted page listens for `pagehide` on the window, so a page left
 * mounted by an earlier test answers this one's events too — which reads as
 * "the handler fired six times" and sends whoever looks at it hunting for a
 * loop that is not there.
 */
let wrapper = null;

const show = async (path = 'Docs/report.docx') => {
  routePath.value = path;
  wrapper = mount(DocumentView);
  await flushPromises();
  return wrapper;
};

/** The cross in the document's own header, or Escape: its session ends. */
const documentClosesItself = async () => {
  const session = sessions[appTabs.activeId];
  if (session) session.open = false;
  await flushPromises();
};

/**
 * Whether the browser honoured the close. A tab that really closed is gone, so
 * `window.closed` is the only thing the page can ask afterwards — and it is
 * what decides whether the fallback runs.
 */
let closed = true;
/** How many entries this tab's history holds; one means it is dedicated. */
let historyLength = 1;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'close').mockImplementation(() => {});
  Object.defineProperty(window, 'closed', { configurable: true, get: () => closed });
  Object.defineProperty(window.history, 'length', {
    configurable: true,
    get: () => historyLength,
  });
  closed = true;
  historyLength = 1;
  appTabs.enabled = false;
  appTabs.activeId = 'tab-1';
  appTabs.tabs = [{ id: 'tab-1', own: false }];
  appTabs.pane = null;
  windowPath.value = null;
  routeKind.value = 'document';
  retargeted.length = 0;
  leaveFrom.mockClear();
  for (const key of Object.keys(sessions)) delete sessions[key];
  closeOwn.mockClear();
  closeOwn.mockReturnValue(false);
  replace.mockClear();
  openIn.mockClear();
  openIn.mockImplementation((key, item) => {
    sessions[key] = { open: true, item };
    return true;
  });
  shows.mockClear();
  closeIn.mockClear();
  fetchIn.mockClear();
  pluginsReady.mockClear();
  pluginsReady.mockResolvedValue(undefined);
  editableExtensions = ['txt', 'md'];
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('opening a document at its own address', () => {
  it('opens the document the address names', async () => {
    await show('Docs/Reports/report.docx');

    expect(openIn).toHaveBeenCalledWith('tab-1', { name: 'report.docx', path: 'Docs/Reports' });
  });

  /**
   * And it opens it in the tab of the pane it is drawn in, which is not always
   * the tab in front.
   *
   * A document beside a folder is this page drawn in the half the reader is *not*
   * in. Asking which tab is in front answered the neighbour: the document was
   * opened into the folder tab's session, and the viewer — which is placed from
   * the box of the tab it belongs to — drew it over the folder.
   */
  it('opens it in its own pane tab, not in the tab in front', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-1';
    appTabs.tabs = [
      { id: 'tab-1', own: false },
      { id: 'tab-2', own: false },
    ];
    appTabs.pane = 'tab-2';

    await show('Docs/Reports/report.docx');

    expect(openIn).toHaveBeenCalledWith('tab-2', { name: 'report.docx', path: 'Docs/Reports' });
    expect(sessions['tab-1']).toBeUndefined();
  });

  it('names its browser tab after the document, and the instance', async () => {
    await show('Docs/Reports/report.docx');

    // Several of these are open at once by design; tabs that all read
    // "Explorer" are tabs nobody can tell apart.
    expect(window.document.title).toBe('report.docx | Chez Benjy');
  });

  it('loads the folder behind it, so the arrows still move between files', async () => {
    await show('Photos/2026/first.jpg');

    // The plugins read the siblings from the file store, which on this page has
    // never been to that folder — without this, "next photograph" would be the
    // one thing that works over a listing and not here.
    // Quietly: the folder behind a document is read for the arrows, and reading
    // it must not take away what the reader had chosen in it.
    expect(fetchIn).toHaveBeenCalledWith('tab-1', 'Photos/2026', { preserveInteraction: true });
  });

  it('waits for the editors to register before deciding nothing opens it', async () => {
    const order = [];
    pluginsReady.mockImplementation(async () => {
      order.push('plugins');
    });
    openIn.mockImplementation(() => {
      order.push('open');
      return true;
    });

    await show();

    // ONLYOFFICE and Collabora register once the server has said they are
    // configured. Asking first would answer "nothing opens this" about a
    // document one of them was a moment from claiming.
    expect(order).toEqual(['plugins', 'open']);
  });

  it('shows a way out when nothing can open it', async () => {
    openIn.mockReturnValue(false);
    const wrapper = await show('Docs/firmware.bin');

    expect(wrapper.find('[data-test="document-unopenable"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('preview.nothingOpensIt:firmware.bin');

    await wrapper.find('[data-test="document-back"]').trigger('click');
    expect(replace).toHaveBeenCalledWith({
      path: '/browse/Docs',
      query: { select: 'firmware.bin' },
    });
  });

  it('hands a file only the editor opens to the editor', async () => {
    openIn.mockReturnValue(false);
    const wrapper = await show('Docs/notes.txt');

    expect(replace).toHaveBeenCalledWith({ path: '/editor/Docs/notes.txt' });
    expect(wrapper.find('[data-test="document-unopenable"]').exists()).toBe(false);
  });

  /**
   * The close button belongs to the document, and a document with a tab to
   * itself is closed by closing the tab. It used to send the tab to the folder
   * listing instead, which left two identical explorer tabs open and nothing
   * to tell them apart (nxzai#303).
   */
  it('closes the tab when the document is closed', async () => {
    const wrapper = await show('Docs/Reports/report.docx');

    await documentClosesItself();

    expect(window.close).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // Where the browser refuses — an address pasted into a tab that has already
  // been somewhere — closing must still land the reader somewhere rather than
  // leaving them in front of a document they have just shut.
  it('falls back to the folder when the browser refuses to close', async () => {
    closed = false;
    const wrapper = await show('Docs/Reports/report.docx');

    await documentClosesItself();
    await vi.advanceTimersByTimeAsync(200);

    expect(replace).toHaveBeenCalledWith({
      path: '/browse/Docs/Reports',
      query: { select: 'report.docx' },
    });
    wrapper.unmount();
  });

  it('does not go to the folder when the tab really closed', async () => {
    closed = true;
    const wrapper = await show('Docs/Reports/report.docx');

    await documentClosesItself();
    await vi.advanceTimersByTimeAsync(200);

    expect(replace).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  // The tab somebody opened the whole application in is also "created by web
  // content". Closing it because they shut a document would take the rest of
  // their session with it, so a tab that has been anywhere else is navigated
  // rather than closed.
  it('goes to the folder when the tab has been somewhere else', async () => {
    historyLength = 4;
    const wrapper = await show('Docs/Reports/report.docx');

    await documentClosesItself();

    expect(window.close).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith({
      path: '/browse/Docs/Reports',
      query: { select: 'report.docx' },
    });
    wrapper.unmount();
  });

  /**
   * Crossing from one document tab to another does not mount a new page: both
   * addresses match the same route, so vue-router keeps this component and hands
   * it new parameters. A tab read once at setup went on speaking for the tab the
   * reader had left — the document they opened went into that tab's session, and
   * the tab they were on stayed empty.
   */
  it('changes hands when another tab comes forward with a document', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: true },
    ];
    await show('Docs/first.docx');
    expect(openIn).toHaveBeenCalledWith('tab-2', { name: 'first.docx', path: 'Docs' });

    // What the strip does: the other tab is in front, and its address follows.
    appTabs.activeId = 'tab-9';
    routePath.value = 'Docs/second.docx';
    await flushPromises();

    expect(openIn).toHaveBeenLastCalledWith('tab-9', { name: 'second.docx', path: 'Docs' });
    // And the tab that was left keeps what it was holding.
    expect(closeIn).not.toHaveBeenCalled();
    // Nor is any of this read as "the document I was showing has gone", which
    // sent the reader to a folder — or closed the window — on every crossing.
    expect(replace).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  /** A document already on screen in the tab that comes forward is left alone. */
  it('opens nothing again when the tab coming forward already has it', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: true },
    ];
    await show('Docs/first.docx');
    sessions['tab-9'] = { open: true, item: { name: 'second.docx', path: 'Docs' } };
    openIn.mockClear();

    appTabs.activeId = 'tab-9';
    routePath.value = 'Docs/second.docx';
    await flushPromises();

    expect(openIn).not.toHaveBeenCalled();
  });

  /**
   * And it says nothing at all for an address that is not a document's.
   *
   * A pane can be handed another tab, and that tab need not hold a document: the
   * pair this page was drawn in is given a folder, and for the tick before the
   * folder's own screen replaces this one, this page's address *is* that folder's.
   * Speaking for it then opened the folder as though it were a document — and read
   * the folder behind it, its parent, into the reader's own tab, over the listing
   * they were in, with their selection and their place in it.
   */
  it('says nothing for an address that is not a document', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.pane = 'tab-2';
    appTabs.tabs = [
      { id: 'tab-2', own: false },
      { id: 'tab-9', own: false },
    ];
    await show('Docs/first.docx');
    openIn.mockClear();
    fetchIn.mockClear();

    // The pane is given the folder tab beside it.
    appTabs.pane = 'tab-9';
    routeKind.value = 'folder';
    routePath.value = 'Docs/Reports';
    await flushPromises();

    expect(openIn).not.toHaveBeenCalled();
    expect(fetchIn).not.toHaveBeenCalled();
  });

  it('opens the next document when the address changes under it', async () => {
    const wrapper = await show('Docs/first.docx');
    expect(openIn).toHaveBeenCalledWith('tab-1', { name: 'first.docx', path: 'Docs' });

    routePath.value = 'Docs/second.docx';
    await flushPromises();

    expect(openIn).toHaveBeenLastCalledWith('tab-1', { name: 'second.docx', path: 'Docs' });
    wrapper.unmount();
  });
});

/**
 * Leaving this page is not always leaving the document.
 *
 * The distinction tabs introduced, and the one worth holding: another tab coming
 * forward takes this page off screen while the tab is still on its document, and
 * ending the session there would mean an ONLYOFFICE editor rebuilt from nothing —
 * a new connection, no cursor, no undo — every time somebody looked at a folder.
 */
describe('leaving the page, and leaving the document', () => {
  it('lets go of the document when its tab is taken somewhere else', async () => {
    const wrapper = await show('Docs/Reports/report.docx');

    // Still the tab in front, and the window has gone to the folder: the address
    // changed underneath this page, so the document is over — and the plugin gets
    // the time it needs rather than a beacon.
    windowPath.value = 'Docs/Reports';
    wrapper.unmount();

    expect(closeIn).toHaveBeenCalledWith('tab-1');
  });

  /**
   * A half taken off the window is not a document closed.
   *
   * The pair is drawn while the reader is in one of its two tabs; going to any
   * other tab takes both halves off the window, and the right-hand one is
   * *destroyed* — its props go with it, so on the way out it still names its own
   * tab. Asking "is this page's tab the one I am speaking for" therefore always
   * answered yes, and the half ended the document it was holding. Coming back,
   * ONLYOFFICE was built again from nothing: a new connection, the cursor gone,
   * the undo history gone — "the document on the right reloads every time",
   * exactly, and the left-hand one did not because its pane is reused and had
   * already been told it holds another tab.
   */
  it('keeps its document when the pane it is drawn in goes off screen', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.pane = 'tab-9';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: true },
    ];
    const wrapper = await show('Docs/Reports/report.docx');

    // The reader is in another tab entirely, and this half is taken away.
    windowPath.value = 'Media';
    wrapper.unmount();

    expect(closeIn).not.toHaveBeenCalled();
  });

  /**
   * Nor is crossing into this half. The pane the reader is in draws the router's
   * own screen and the one beside it resolves its own, so moving from one half to
   * the other unmounts both pages — on the very document each tab is still on.
   */
  it('keeps its document when the reader crosses into its pane', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.pane = 'tab-9';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: true },
    ];
    const wrapper = await show('Docs/Reports/report.docx');

    // This half comes forward: its tab is in front now, and the window's address
    // followed to this very document.
    appTabs.activeId = 'tab-9';
    wrapper.unmount();

    expect(closeIn).not.toHaveBeenCalled();
  });

  /** And the document does end when the reader takes that half somewhere else. */
  it('lets go of the document when its own pane is taken somewhere else', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-9';
    appTabs.pane = 'tab-9';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: true },
    ];
    const wrapper = await show('Docs/Reports/report.docx');

    windowPath.value = 'Docs/Reports';
    wrapper.unmount();

    expect(closeIn).toHaveBeenCalledWith('tab-9');
  });

  it('keeps the document when another tab comes forward', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: false },
    ];
    const wrapper = await show('Docs/Reports/report.docx');

    appTabs.activeId = 'tab-9';
    wrapper.unmount();

    expect(closeIn).not.toHaveBeenCalled();
  });

  /** The manager ends a session with its tab, beacon and all. Not twice. */
  it('leaves a tab that has gone to the manager', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.tabs = [{ id: 'tab-2', own: true }];
    const wrapper = await show('Docs/Reports/report.docx');

    appTabs.tabs = [];
    wrapper.unmount();

    expect(closeIn).not.toHaveBeenCalled();
  });

  it('does not open the document again when its tab comes back', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: false },
    ];
    const first = await show('Docs/Reports/report.docx');
    expect(openIn).toHaveBeenCalledTimes(1);

    appTabs.activeId = 'tab-9';
    first.unmount();
    appTabs.activeId = 'tab-2';
    await show('Docs/Reports/report.docx');

    // The same document, in the same tab, still on screen. Opening it again
    // builds a second editor over a live one — and the folder behind it is not
    // fetched a second time either, since this page never left it.
    expect(openIn).toHaveBeenCalledTimes(1);
    expect(fetchIn).toHaveBeenCalledTimes(1);
  });
});

/**
 * Closing a document that is in one of this application's tabs.
 *
 * The cross belongs to the document, and in a tab of its own the thing it should
 * close is that tab — not send it back to a folder listing, which leaves somebody
 * looking at two identical explorer tabs wondering which was which. *Which* tab
 * may be closed is `tabNavigation`'s rule, with its own spec; what is here is that
 * this page asks it, and asks it first.
 */
describe('the close button, with this application own tabs', () => {
  const closeDocument = async () => {
    const wrapper = await show('Docs/Reports/report.docx');
    await documentClosesItself();
    return wrapper;
  };

  it('closes the tab the document was opened in', async () => {
    closeOwn.mockReturnValue(true);

    await closeDocument();

    expect(closeOwn).toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * Asked before the browser's own tab, or a document shut in a tab of this
   * application would take the whole window with it.
   */
  it('asks its own tabs before offering the window to the browser', async () => {
    closeOwn.mockReturnValue(true);
    historyLength = 1;

    await closeDocument();

    expect(window.close).not.toHaveBeenCalled();
  });

  it('goes to the folder when it is not a tab opened for this', async () => {
    closeOwn.mockReturnValue(false);
    historyLength = 3;

    await closeDocument();

    expect(replace).toHaveBeenCalled();
  });

  /**
   * A tab closed from the strip ends its session too, and that arrives here as
   * the same event. Acted on, it would close whichever tab had just come
   * forward — somebody else's tab, taken away by a document they never touched.
   */
  /**
   * A document closed in the half beside the reader goes back to its folder *in
   * that half*.
   *
   * It used to send the window: the reader's own half was taken to the folder the
   * document was in, and the half the cross was pressed in stayed on an address
   * nothing draws any more — a black panel with its tab still in the strip.
   */
  it('takes its own half back to the folder, not the window', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.pane = 'tab-9';
    appTabs.tabs = [
      { id: 'tab-2', own: false },
      { id: 'tab-9', own: false },
    ];
    await show('Docs/Reports/report.docx');

    // The cross in the document's own header: its session ends.
    sessions['tab-9'].open = false;
    await flushPromises();

    expect(retargeted).toHaveLength(1);
    expect(retargeted[0].id).toBe('tab-9');
    expect(retargeted[0].location).toMatchObject({ query: { select: 'report.docx' } });
    // And the reader's own half was not taken anywhere.
    expect(replace).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it('does nothing when a session ends behind whatever is in front', async () => {
    appTabs.enabled = true;
    appTabs.activeId = 'tab-2';
    appTabs.tabs = [
      { id: 'tab-2', own: true },
      { id: 'tab-9', own: false },
    ];
    await show('Docs/Reports/report.docx');

    appTabs.activeId = 'tab-9';
    sessions['tab-2'].open = false;
    await flushPromises();

    expect(closeOwn).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
