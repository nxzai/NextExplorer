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
const replace = vi.fn();
const fetchPathItems = vi.fn(async () => {});
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
}));
const closeOwn = vi.fn(() => false);
vi.mock('@/composables/tabNavigation', () => ({
  useTabNavigation: () => ({
    get tabs() {
      return appTabs;
    },
    closeOwn: (...args) => closeOwn(...args),
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
      return `/open/${routePath.value}`;
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
  useFileStore: () => ({ fetchPathItems: (...args) => fetchPathItems(...args) }),
}));

vi.mock('@/config/editor', () => ({
  isEditableExtension: (extension) => editableExtensions.includes(extension),
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
  fetchPathItems.mockClear();
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
    expect(fetchPathItems).toHaveBeenCalledWith('Photos/2026', { preserveInteraction: true });
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

    // Still the tab in front, so the address changed underneath it: the document
    // is over, and the plugin gets the time it needs rather than a beacon.
    wrapper.unmount();

    expect(closeIn).toHaveBeenCalledWith('tab-1');
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
    expect(fetchPathItems).toHaveBeenCalledTimes(1);
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
