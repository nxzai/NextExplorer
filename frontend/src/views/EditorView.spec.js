import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The text editor.
 *
 * 174 statements at five per cent, and what they hold is somebody's unsaved
 * work: whether the save button is live, whether leaving asks first, and
 * whether a listing that arrives late overwrites the file now on screen. It
 * serves two quite different situations from the same screen — a file of your
 * own, and a file reached through a share, which may be read-only — and telling
 * them apart wrongly either refuses a save that was allowed or offers one that
 * was not.
 */

const shared = vi.hoisted(() => ({ objects: {}, guards: [] }));

const api = vi.hoisted(() => ({
  fetchFileContent: vi.fn(async () => ({ content: 'hello' })),
  fetchSharedFileContent: vi.fn(async () => ({
    content: 'shared hello',
    name: 'notes.md',
    path: 'notes.md',
    canWrite: true,
    canDownload: true,
  })),
  saveFileContent: vi.fn(async () => ({})),
  saveSharedFileContent: vi.fn(async () => ({})),
  getRawFileUrl: vi.fn((path) => `/api/raw/${path}`),
  getDirectShareFileUrl: vi.fn((token, path, mode) => `/d/${token}/${path}?mode=${mode}`),
  getTrashFileText: vi.fn(async () => ({ name: 'run.sh', content: '#!/bin/sh\necho hi\n' })),
  getVersionText: vi.fn(async () => ({ name: 'notes.md', content: '# as it was\n' })),
}));

vi.mock('@/api', () => ({
  ...api,
  fetchFileContent: (...args) => api.fetchFileContent(...args),
  fetchSharedFileContent: (...args) => api.fetchSharedFileContent(...args),
  saveFileContent: (...args) => api.saveFileContent(...args),
  saveSharedFileContent: (...args) => api.saveSharedFileContent(...args),
  getRawFileUrl: (...args) => api.getRawFileUrl(...args),
  getDirectShareFileUrl: (...args) => api.getDirectShareFileUrl(...args),
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
}));

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

/**
 * The pane's own address, which is where a screen reads its place from now.
 *
 * In a pair only one pane is the route, so a screen that read the window's
 * address drew somebody else's place. Standing in for it with the same route
 * this spec already states: what the pane decides is held in
 * `composables/paneTab.spec.js`; what is exercised here is this screen.
 */
vi.mock('@/composables/paneTab', () => ({
  usePaneRoute: () => shared.objects.route,
  usePaneTabId: () => ({
    get value() {
      return appTabs.pane || appTabs.activeId;
    },
  }),
}));

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue');
  shared.objects.route = reactive({
    name: 'Editor',
    fullPath: '/editor/Docs/notes.md',
    params: { path: 'Docs/notes.md' },
  });
  return {
    useRoute: () => shared.objects.route,
    useRouter: () => router,
    onBeforeRouteLeave: (guard) => shared.guards.push(guard),
  };
});

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

// This application's own tabs. A `.txt` or a `.md` opened in one is closed by
// closing that tab, exactly as an office document is — the rule for *which* tab
// may be closed is `tabNavigation`'s, with its own spec, so what is asked here is
// that this view asks it, and asks it before offering the window to the browser.
const closeOwn = vi.fn(() => false);
// `pane` is the tab of the pane this page is drawn in: null for the ordinary case
// of one pane, which is the tab in front.
const appTabs = vi.hoisted(() => ({ activeId: 'tab-1', tabs: [{ id: 'tab-1' }], pane: null }));
/**
 * What the application asks, in its own dialog rather than the browser's box. Answers
 * with a promise, as the real one does: it is part of the page, so it cannot answer
 * before it has been read.
 */
const asked = vi.hoisted(() => ({ ask: vi.fn(async () => false), askFor: vi.fn() }));
vi.mock('@/composables/useAsk', () => ({ useAsk: () => asked }));

const retargeted = vi.hoisted(() => []);
vi.mock('@/composables/tabNavigation', () => ({
  useTabNavigation: () => ({
    get tabs() {
      return appTabs;
    },
    closeOwn: (...args) => closeOwn(...args),
    // The window only while this page's tab is the one in front; otherwise that
    // tab alone is taken somewhere, and the address bar is left where it is.
    leaveFrom: (id, location) => {
      if (!id || id === appTabs.activeId) {
        router.replace(location);
        return;
      }
      retargeted.push({ id, location });
    },
  }),
}));

// What a tab holds on to between two glances. A faithful stand-in rather than the
// store itself: the rule about *which* address a draft belongs to is the store's,
// and `stores/editorDrafts.spec.js` holds it to that.
const drafts = vi.hoisted(() => new Map());
// Which tabs are still working, so the strip can say so. A stand-in: whether the
// work is a listing or a file is this screen's business, drawing it is the strip's.
vi.mock('@/stores/tabLoading', () => ({
  useTabLoadingStore: () => ({ begin: () => () => {}, isLoading: () => false }),
}));
vi.mock('@/stores/editorDrafts', () => ({
  useEditorDraftsStore: () => ({
    keep: (key, address, where) => drafts.set(key, { address, ...where }),
    forget: (key) => drafts.delete(key),
    placeFor: (key, address) => {
      const draft = drafts.get(key);
      return draft && draft.address === address ? draft : null;
    },
  }),
}));

const folderScroll = vi.hoisted(() => ({ permitExplicitRestore: vi.fn() }));
// The instance's name, for the tab's title, as Settings → Branding set it.
vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({ state: { branding: { appName: 'Chez Benjy' } } }),
}));

vi.mock('@/stores/folderScroll', () => ({ useFolderScrollStore: () => folderScroll }));

const versionsPanel = vi.hoisted(() => ({ openPath: vi.fn() }));
vi.mock('@/stores/versionsPanel', () => ({ useVersionsPanelStore: () => versionsPanel }));

/**
 * CodeMirror is a text area with a parser in it; nothing here is about that.
 * `CodeSurface.spec.js` holds it to what it owes this screen. The stand-in keeps
 * the same promise: a document, a way to type into it, and whether it differs
 * from what was last read or saved.
 */
const surface = vi.hoisted(() => ({
  view: null,
  current: null,
  restored: [],
  settlingWhenRestored: null,
}));

vi.mock('@/components/editor/CodeSurface.vue', async () => {
  const {
    defineComponent: define,
    onMounted,
    onBeforeUnmount,
    getCurrentInstance,
    watch,
    h,
  } = await import('vue');
  return {
    default: define({
      name: 'CodeSurfaceStub',
      props: ['content', 'extensions', 'autofocus'],
      emits: ['ready', 'edit', 'dirty-change'],
      setup(props, { emit, expose }) {
        // A different content is a different document, as the real surface has it:
        // replaced, and not an unsaved change. Without this the stand-in ignored the
        // file being handed to it again, which is what the quiet check after a tab
        // comes back does when somebody else has written to it.
        watch(
          () => props.content,
          (next) => {
            if (next === text) return;
            text = next;
            saved = next;
            emit('dirty-change', false);
          }
        );
        // This stand-in's own element, so what the page puts on the editor can be
        // read without attaching the whole wrapper to the document.
        const instance = getCurrentInstance();
        let text = props.content;
        let saved = props.content;
        // Where the cursor is and how far down the editor was, which is the rest
        // of what a tab holds on to.
        let selection = { anchor: 0, head: 0 };
        const scrollDOM = { scrollTop: 0 };
        // The line at the top of the screen, which is what the real surface
        // answers with and what a pixel cannot stand in for — see `place()` in
        // `components/editor/CodeSurface.vue`.
        let topLine = 0;
        const handle = {
          typeText: (value) => {
            text = value;
            emit('edit');
            emit('dirty-change', value !== saved);
          },
          snapshot: () => text,
          markSaved: (doc) => {
            saved = doc;
            emit('dirty-change', text !== saved);
          },
          // Where the reader is, which the real surface answers from CodeMirror
          // and this one answers from the two values it keeps. `topLine` is null
          // because nothing here has a layout — which is exactly the case the
          // real one has to survive, and why it keeps a line as well as a pixel.
          place: () => ({
            selection: { ...selection },
            scrollTop: scrollDOM.scrollTop,
            topLine,
          }),
          restorePlace: (kept) => {
            if (!kept) return;
            // What the page was showing at the instant the place went back in: the
            // editor is meant to be out of sight until then, so that the file does
            // not appear at the top and jump to the line somebody was reading.
            surface.settlingWhenRestored = instance?.vnode?.el?.getAttribute?.('data-settling');
            surface.restored.push(kept);
            if (kept.selection) selection = { ...kept.selection };
            if (kept.scrollTop > 0) scrollDOM.scrollTop = kept.scrollTop;
            if (Number.isFinite(kept.topLine)) topLine = kept.topLine;
          },
          // What the screen reaches for when it puts a kept place back: an
          // ordinary edit for the text — which is how "unsaved" stays the
          // editor's own comparison with the file rather than something the page
          // decides — and a selection and a scroll that change no document at
          // all, so neither of them can make a file look edited.
          view: {
            get state() {
              return {
                doc: { toString: () => text, length: text.length },
                selection: { main: selection },
              };
            },
            scrollDOM,
            dispatch: ({ changes, selection: to }) => {
              if (changes) {
                text = changes.insert;
                emit('edit');
                emit('dirty-change', text !== saved);
              }
              if (to) selection = { ...to };
            },
          },
        };
        // What the screen reaches through its template ref, and what the tests
        // type through.
        expose(handle);
        surface.current = handle;
        onMounted(() => emit('ready', { view: surface.view }));
        onBeforeUnmount(() => {
          if (surface.current === handle) surface.current = null;
        });
        // A real element, so what the page puts on the editor — the class that
        // holds it back while the reader is being put back where they were — lands
        // somewhere a test can read it.
        return () => h('div');
      },
    }),
  };
});

const languageData = vi.hoisted(() => ({
  markdown: { name: 'Markdown', extensions: ['md', 'markdown'], load: vi.fn(async () => []) },
  json: { name: 'JSON', extensions: ['json'], load: vi.fn(async () => []) },
}));

vi.mock('@codemirror/language-data', () => ({
  languages: [languageData.markdown, languageData.json],
}));

const EditorViewComponent = (await import('./EditorView.vue')).default;

const route = () => shared.objects.route;

let wrapper = null;

const mountEditor = async () => {
  wrapper = mount(EditorViewComponent, {
    global: { mocks: { $t: (key) => key } },
  });
  await flushPromises();
  return wrapper.vm;
};

const asShare = () => {
  Object.assign(route(), {
    name: 'SharedEditor',
    // The address the application really gives a share's file, which this screen
    // now looks at: a pane can be handed a tab that holds something else entirely,
    // and a screen only speaks for addresses it is the screen for.
    fullPath: '/editor/share/tok/notes.md',
    params: { token: 'tok', sharedPath: 'notes.md' },
  });
};

/** Typed into the editor, when there is an editor on screen to type into. */
const type = async (view, text) => {
  surface.current?.typeText(text);
  await flushPromises();
};

/**
 * How many entries this tab's history holds.
 *
 * One means the tab was opened for this file and nothing else, which is when
 * closing it is the right way out. Everything below reaches the editor from
 * somewhere else in the application, so the default here is a tab that has
 * been around.
 */
let historyLength = 3;

beforeEach(() => {
  asked.ask.mockClear();
  asked.ask.mockResolvedValue(false);
  Object.defineProperty(window.history, 'length', {
    configurable: true,
    get: () => historyLength,
  });
  historyLength = 3;
  closeOwn.mockClear();
  closeOwn.mockReturnValue(false);
  appTabs.activeId = 'tab-1';
  appTabs.pane = null;
  appTabs.tabs = [{ id: 'tab-1' }];
  drafts.clear();
  vi.spyOn(window, 'close').mockImplementation(() => {});
  localStorage.clear();
  surface.view = { dispatch: vi.fn() };
  surface.current = null;
  surface.restored.length = 0;
  surface.settlingWhenRestored = null;
  languageData.markdown.load.mockClear();
  languageData.json.load.mockClear();
  shared.guards.length = 0;
  Object.values(api).forEach((fn) => fn.mockClear());
  api.fetchFileContent.mockResolvedValue({ content: 'hello' });
  // Re-armed, not merely cleared: `mockClear` leaves an implementation in place,
  // and the test that holds a write open forever left every later test awaiting
  // a promise that never settles.
  api.saveFileContent.mockResolvedValue({});
  api.fetchSharedFileContent.mockResolvedValue({
    content: 'shared hello',
    name: 'notes.md',
    path: 'notes.md',
    canWrite: true,
    canDownload: true,
  });
  router.replace.mockClear();
  folderScroll.permitExplicitRestore.mockClear();
  Object.assign(route(), {
    name: 'Editor',
    fullPath: '/editor/Docs/notes.md',
    params: { path: 'Docs/notes.md', token: undefined, sharedPath: undefined },
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  // Without this the spy on `window.close` wraps the previous one and keeps
  // its calls, so a test that must not close sees the call of the one before.
  vi.restoreAllMocks();
});

describe('opening a file', () => {
  it('reads the one the route names', async () => {
    await mountEditor();

    expect(api.fetchFileContent).toHaveBeenCalledWith('Docs/notes.md');
  });

  it('shows what came back', async () => {
    const view = await mountEditor();

    expect(view.loadedContent).toBe('hello');
    expect(view.hasUnsavedChanges).toBe(false);
  });

  // It had no title of its own: opened directly the tab read "Explorer", and
  // opened from a folder it kept that folder's name.
  it('names the browser tab after the file, and the instance', async () => {
    await mountEditor();

    expect(window.document.title).toBe('notes.md | Chez Benjy');
  });

  it('says why it could not', async () => {
    api.fetchFileContent.mockRejectedValue(new Error('File not found'));

    const view = await mountEditor();

    expect(view.loadError).toBe('File not found');
  });

  it('reads nothing at all when the route names no file', async () => {
    route().params = { path: '' };

    await mountEditor();

    expect(api.fetchFileContent).not.toHaveBeenCalled();
  });

  /**
   * Two files opened in quick succession answer in whatever order the network
   * feels like. The slower one arriving second must not replace the file the
   * reader is now looking at — and must not report its own failure either.
   */
  it('ignores an answer for a file no longer being edited', async () => {
    let answerFirst;
    api.fetchFileContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerFirst = resolve;
        })
    );
    const view = await mountEditor();

    route().params = { path: 'Docs/other.md' };
    route().fullPath = '/editor/Docs/other.md';
    await flushPromises();
    answerFirst({ content: 'the old file' });
    await flushPromises();

    expect(view.loadedContent).toBe('hello');
  });

  it('ignores a failure for a file no longer being edited', async () => {
    let failFirst;
    api.fetchFileContent.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failFirst = reject;
        })
    );
    const view = await mountEditor();

    route().params = { path: 'Docs/other.md' };
    route().fullPath = '/editor/Docs/other.md';
    await flushPromises();
    failFirst(new Error('too late'));
    await flushPromises();

    expect(view.loadError).toBe('');
  });
});

describe('opening a file through a share', () => {
  beforeEach(asShare);

  it('reads it through the share, with its token', async () => {
    await mountEditor();

    expect(api.fetchSharedFileContent).toHaveBeenCalledWith('tok', 'notes.md');
    expect(api.fetchFileContent).not.toHaveBeenCalled();
  });

  it('shows the name the share gave it', async () => {
    const view = await mountEditor();

    expect(view.displayPath).toBe('notes.md');
  });

  it('names the browser tab after the shared file', async () => {
    await mountEditor();

    expect(window.document.title).toBe('notes.md | Chez Benjy');
  });

  /** What the share allows is the share"s to say, not the editor"s to assume. */
  it('takes the share"s word for what may be done with it', async () => {
    api.fetchSharedFileContent.mockResolvedValue({
      content: 'x',
      name: 'notes.md',
      canWrite: false,
      canDownload: false,
    });

    const view = await mountEditor();

    expect(view.isSharedReadOnly).toBe(true);
    expect(view.sharedCanDownload).toBe(false);
  });

  it('never treats an own file as writable by a share', async () => {
    Object.assign(route(), { name: 'Editor', params: { path: 'Docs/notes.md' } });
    api.fetchFileContent.mockResolvedValue({ content: 'x', canWrite: true, canDownload: true });

    const view = await mountEditor();

    expect(view.sharedCanWrite).toBe(false);
    expect(view.sharedCanDownload).toBe(false);
  });
});

describe('whether saving is offered', () => {
  it('is not, until something is changed', async () => {
    const view = await mountEditor();

    expect(view.canSave).toBe(false);
  });

  it('is, once something is', async () => {
    const view = await mountEditor();

    await type(view, 'hello, world');

    expect(view.canSave).toBe(true);
    expect(view.hasUnsavedChanges).toBe(true);
  });

  it('is not while the file is still being read', async () => {
    api.fetchFileContent.mockImplementation(() => new Promise(() => {}));
    wrapper = mount(EditorViewComponent, {
      global: { mocks: { $t: (key) => key } },
    });
    await flushPromises();

    await type(wrapper.vm, 'anything');

    expect(wrapper.vm.canSave).toBe(false);
  });

  it('is not on a file that could not be read', async () => {
    api.fetchFileContent.mockRejectedValue(new Error('gone'));
    const view = await mountEditor();

    await type(view, 'anything');

    expect(view.canSave).toBe(false);
  });

  /** A read-only share is read-only however much is typed into it. */
  it('is not on a share that only allows reading', async () => {
    asShare();
    api.fetchSharedFileContent.mockResolvedValue({ content: 'x', name: 'n.md', canWrite: false });
    const view = await mountEditor();

    await type(view, 'anything');

    expect(view.canSave).toBe(false);
  });
});

describe('saving', () => {
  it('writes the file back', async () => {
    const view = await mountEditor();
    await type(view, 'hello, world');

    await view.saveFile();

    expect(api.saveFileContent).toHaveBeenCalledWith('Docs/notes.md', 'hello, world');
  });

  it('writes it back through the share it was opened from', async () => {
    asShare();
    const view = await mountEditor();
    await type(view, 'edited');

    await view.saveFile();

    expect(api.saveSharedFileContent).toHaveBeenCalledWith('tok', 'notes.md', 'edited');
  });

  it('stops calling it unsaved once it is saved', async () => {
    const view = await mountEditor();
    await type(view, 'hello, world');

    await view.saveFile();

    expect(view.hasUnsavedChanges).toBe(false);
  });

  /** Still unsaved: the marker is the only sign the work is still at risk. */
  it('keeps calling it unsaved when the write failed, and says why', async () => {
    api.saveFileContent.mockRejectedValue(new Error('Disk full'));
    const view = await mountEditor();
    await type(view, 'hello, world');

    await view.saveFile();

    expect(view.saveError).toBe('Disk full');
    expect(view.hasUnsavedChanges).toBe(true);
  });

  it('clears a stale complaint as soon as typing resumes', async () => {
    api.saveFileContent.mockRejectedValue(new Error('Disk full'));
    const view = await mountEditor();
    await type(view, 'hello, world');
    await view.saveFile();

    await type(view, 'hello again');

    expect(view.saveError).toBe('');
  });

  it('writes nothing when there is nothing to write', async () => {
    const view = await mountEditor();

    await view.saveFile();

    expect(api.saveFileContent).not.toHaveBeenCalled();
  });
});

describe('leaving the editor', () => {
  /**
   * The preference that opens documents in their own tab sends editable files
   * here too, and leaving used to turn that tab into a second explorer — two
   * identical tabs and nothing to tell them apart (nxzai#303).
   */
  it('closes a tab that was opened for this file alone', async () => {
    historyLength = 1;
    const view = await mountEditor();

    await view.requestClose();

    expect(window.close).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  /**
   * The same cross, in one of this application's tabs.
   *
   * A `.txt` and a `.md` come here rather than to the preview, so without this
   * the cross of half the documents somebody opens in a tab left that tab sitting
   * on a folder listing — and the office documents beside it closed theirs.
   */
  it('closes the tab of this application it was opened in', async () => {
    closeOwn.mockReturnValue(true);
    historyLength = 1;
    const view = await mountEditor();

    await view.requestClose();

    expect(closeOwn).toHaveBeenCalled();
    // Asked first, or shutting a file would take the browser window with it.
    expect(window.close).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  /** Unsaved work is asked about before anything is closed, tab or window. */
  it('asks before closing its tab when there is unsaved work', async () => {
    closeOwn.mockReturnValue(true);
    asked.ask.mockResolvedValue(false);
    const view = await mountEditor();
    await type(view, 'unsaved');

    await view.requestClose();

    expect(asked.ask).toHaveBeenCalled();
    expect(closeOwn).not.toHaveBeenCalled();
  });

  // The tab somebody opened the whole application in is also "created by web
  // content"; closing it because they shut one file would take their session
  // with it.
  it('does not close a tab that has been somewhere else', async () => {
    const view = await mountEditor();

    await view.requestClose();

    expect(window.close).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/browse/Docs');
  });

  it('goes back to the folder the file lives in', async () => {
    const view = await mountEditor();

    await view.requestClose();

    expect(router.replace).toHaveBeenCalledWith('/browse/Docs');
  });

  it('goes back to the root for a file that lives there', async () => {
    route().params = { path: 'notes.md' };
    const view = await mountEditor();

    await view.requestClose();

    expect(router.replace).toHaveBeenCalledWith('/browse');
  });

  it('goes back to the share for a file opened through one', async () => {
    asShare();
    const view = await mountEditor();

    await view.requestClose();

    expect(router.replace).toHaveBeenCalledWith('/share/tok');
  });

  /** Leaving with unsaved work is a decision, not a side effect of a click. */
  it('asks first when there is unsaved work', async () => {
    asked.ask.mockResolvedValue(false);
    const view = await mountEditor();
    await type(view, 'unsaved');

    await view.requestClose();

    expect(asked.ask).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('leaves when the answer is yes', async () => {
    asked.ask.mockResolvedValue(true);
    const view = await mountEditor();
    await type(view, 'unsaved');

    await view.requestClose();

    expect(router.replace).toHaveBeenCalled();
  });

  it('does not ask when there is nothing unsaved', async () => {
    asked.ask.mockResolvedValue(true);
    const view = await mountEditor();

    await view.requestClose();

    expect(asked.ask).not.toHaveBeenCalled();
  });

  /**
   * Half a write is the one moment when leaving is genuinely unsafe — and the
   * one moment when saying yes to the question must not be enough.
   */
  it('refuses to leave in the middle of a write', async () => {
    asked.ask.mockResolvedValue(true);
    const view = await mountEditor();
    await type(view, 'unsaved');
    api.saveFileContent.mockImplementation(() => new Promise(() => {}));
    view.saveFile();
    await flushPromises();

    await view.requestClose();

    expect(router.replace).not.toHaveBeenCalled();
  });

  /**
   * The folder view is unmounted while a file is being edited, so it cannot
   * work out on its own that this was a return journey.
   */
  it('tells the folder it is coming back to that it may restore its place', async () => {
    await mountEditor();

    shared.guards.forEach((guard) => guard({ name: 'FolderView', params: { path: 'Docs' } }));

    // For this tab alone: the folder's own memory is shared by every tab on it, so
    // a permission left under the folder's name is one another tab consumes — and
    // that tab then jumps to where this one had been.
    expect(folderScroll.permitExplicitRestore).toHaveBeenCalledWith('Docs', 'tab-1');
  });

  it('says nothing to a folder it was not editing inside', async () => {
    await mountEditor();

    shared.guards.forEach((guard) => guard({ name: 'FolderView', params: { path: 'Elsewhere' } }));

    expect(folderScroll.permitExplicitRestore).not.toHaveBeenCalled();
  });

  it('says nothing when leaving for anywhere else', async () => {
    await mountEditor();

    shared.guards.forEach((guard) => guard({ name: 'Settings', params: {} }));

    expect(folderScroll.permitExplicitRestore).not.toHaveBeenCalled();
  });
});

/**
 * A file in the trash, opened to be read before deciding what to do with it.
 * The editor shows it, and nothing more: no save, no raw link, no question on
 * leaving, since nothing typed there could ever be written back.
 */
describe('reading a file from the trash', () => {
  const asTrash = (entryPath = ['drafts', 'run.sh']) => {
    Object.assign(route(), {
      name: 'TrashFileViewer',
      fullPath: `/trash/view/id-1/${entryPath.join('/')}`,
      params: { itemId: 'id-1', entryPath },
    });
  };

  it('reads it from the trash, by the item and the path inside it', async () => {
    asTrash();

    const view = await mountEditor();

    expect(api.getTrashFileText).toHaveBeenCalledWith('id-1', 'drafts/run.sh');
    expect(api.fetchFileContent).not.toHaveBeenCalled();
    expect(view.loadedContent).toBe('#!/bin/sh\necho hi\n');
    expect(view.displayPath).toBe('run.sh');
  });

  it('says it is in the trash and read only, and offers neither save nor raw file', async () => {
    asTrash();

    await mountEditor();

    expect(wrapper.text()).toContain('editor.trashReadOnly');
    expect(wrapper.find('[aria-label="common.save"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('editor.raw');
  });

  it('never writes anything, whatever is typed or pressed', async () => {
    asTrash();
    const view = await mountEditor();

    await type(view, 'changed anyway');
    expect(view.canSave).toBe(false);
    await view.saveFile();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await flushPromises();

    expect(api.saveFileContent).not.toHaveBeenCalled();
    expect(api.saveSharedFileContent).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('editor.unsavedChanges');
  });

  it('goes back to the deleted folder it was read from, without asking', async () => {
    asTrash(['drafts', 'run.sh']);
    const view = await mountEditor();
    await type(view, 'changed anyway');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await view.requestClose();

    expect(confirm).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({
      name: 'Trash',
      query: { item: 'id-1', path: 'drafts' },
    });
    confirm.mockRestore();
  });

  it('goes back to the top of the deleted folder for a file at its top', async () => {
    asTrash(['run.sh']);
    const view = await mountEditor();

    await view.requestClose();

    expect(router.replace).toHaveBeenCalledWith({ name: 'Trash', query: { item: 'id-1' } });
  });

  it('goes back to the trash itself for a deleted file', async () => {
    asTrash([]);
    const view = await mountEditor();

    await view.requestClose();

    expect(api.getTrashFileText).toHaveBeenCalledWith('id-1', '');
    expect(router.replace).toHaveBeenCalledWith({ name: 'Trash', query: {} });
  });

  it('says why when the file cannot be shown', async () => {
    api.getTrashFileText.mockRejectedValueOnce(new Error('This file appears to be binary.'));
    asTrash();

    await mountEditor();

    expect(wrapper.text()).toContain('This file appears to be binary.');
  });
});

describe('reading an earlier version of a file', () => {
  const asVersion = (path = 'Docs/notes.md', versionId = 'v-1') => {
    Object.assign(route(), {
      name: 'VersionFileViewer',
      fullPath: `/versions/view/${versionId}/${path}`,
      params: { versionId, path },
    });
  };

  beforeEach(() => {
    versionsPanel.openPath.mockClear();
  });

  it('reads that version, by the file and the version', async () => {
    asVersion();

    const view = await mountEditor();

    expect(api.getVersionText).toHaveBeenCalledWith('Docs/notes.md', 'v-1');
    expect(api.fetchFileContent).not.toHaveBeenCalled();
    expect(view.loadedContent).toBe('# as it was\n');
    expect(view.displayPath).toBe('notes.md');
  });

  it('reads the other version when the address changes to it', async () => {
    asVersion('Docs/notes.md', 'v-1');
    await mountEditor();

    asVersion('Docs/notes.md', 'v-2');
    await flushPromises();

    expect(api.getVersionText).toHaveBeenLastCalledWith('Docs/notes.md', 'v-2');
  });

  it('says it is an earlier version and read only, and offers neither save nor raw file', async () => {
    asVersion();

    await mountEditor();

    expect(wrapper.text()).toContain('editor.versionReadOnly');
    expect(wrapper.find('[aria-label="common.save"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('editor.raw');
  });

  it('never writes the file, whatever is typed or pressed', async () => {
    asVersion();
    const view = await mountEditor();

    await type(view, 'changed anyway');
    expect(view.canSave).toBe(false);
    await view.saveFile();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await flushPromises();

    expect(api.saveFileContent).not.toHaveBeenCalled();
    expect(api.saveSharedFileContent).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('editor.unsavedChanges');
  });

  it('goes back to the folder with the history open again, without asking', async () => {
    asVersion('Docs/notes.md');
    const view = await mountEditor();
    await type(view, 'changed anyway');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await view.requestClose();

    expect(confirm).not.toHaveBeenCalled();
    expect(versionsPanel.openPath).toHaveBeenCalledWith('Docs/notes.md');
    expect(router.replace).toHaveBeenCalledWith('/browse/Docs');
    confirm.mockRestore();
  });

  it('says why when the version cannot be shown', async () => {
    api.getVersionText.mockRejectedValueOnce(new Error('This file appears to be binary.'));
    asVersion();

    await mountEditor();

    expect(wrapper.text()).toContain('This file appears to be binary.');
  });
});

describe('looking at the file as it really is', () => {
  const opened = () => window.open.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the raw file', async () => {
    const view = await mountEditor();

    view.openRaw();

    expect(opened()).toBe('/api/raw/Docs/notes.md');
  });

  it('opens it through the share when that is how it was reached', async () => {
    asShare();
    const view = await mountEditor();

    view.openRaw();

    expect(opened()).toBe('/d/tok/notes.md?mode=raw');
  });

  it('opens nothing when there is no file', async () => {
    route().params = { path: '' };
    const view = await mountEditor();

    view.openRaw();

    expect(window.open).not.toHaveBeenCalled();
  });

  it('downloads it when the share allows that', async () => {
    asShare();
    const view = await mountEditor();

    view.openDownload();

    expect(opened()).toBe('/d/tok/notes.md?mode=download');
  });

  it('downloads nothing when the share does not', async () => {
    asShare();
    api.fetchSharedFileContent.mockResolvedValue({
      content: 'x',
      name: 'n.md',
      canWrite: true,
      canDownload: false,
    });
    const view = await mountEditor();

    view.openDownload();

    expect(window.open).not.toHaveBeenCalled();
  });

  it('offers no download for a file of one"s own, which is not a share', async () => {
    const view = await mountEditor();

    view.openDownload();

    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('choosing a theme', () => {
  it('remembers it for next time', async () => {
    const view = await mountEditor();

    view.updateTheme('githubLight');
    await flushPromises();

    expect(view.themeId).toBe('githubLight');
    expect(localStorage.getItem('editor:theme')).toContain('githubLight');
  });

  it('closes the menu once one is chosen', async () => {
    const view = await mountEditor();
    view.isThemeMenuOpen = true;

    view.updateTheme('githubLight');

    expect(view.isThemeMenuOpen).toBe(false);
  });

  it('offers no half of a merge view, which is not a theme', async () => {
    const view = await mountEditor();

    expect(view.themeOptions.some((option) => option.id.includes('Merge'))).toBe(false);
  });

  it('names the one in use, in words', async () => {
    const view = await mountEditor();

    view.updateTheme('githubLight');

    expect(view.currentThemeLabel).toBe('Github Light');
  });
});

/**
 * Colouring a Markdown file means parsing it, and the parser reads a paragraph
 * whole once it ends. A large file that never leaves a blank line is one
 * paragraph, and reading it held the page for seconds right after the editor
 * opened. Such a file opens as plain text, and says why it has no colours.
 */
describe('colouring a Markdown file', () => {
  const settleLanguage = async () => {
    await vi.dynamicImportSettled();
    await flushPromises();
  };

  it('colours an ordinary one', async () => {
    api.fetchFileContent.mockResolvedValue({ content: '# Title\n\nSome text.\n' });

    await mountEditor();
    await settleLanguage();

    expect(languageData.markdown.load).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="editor-highlighting-off"]').exists()).toBe(false);
  });

  it('opens one with a block too long to parse as plain text, and says so', async () => {
    const oneBlock = 'a line of an export\n'.repeat(16000);
    api.fetchFileContent.mockResolvedValue({ content: oneBlock });

    await mountEditor();
    await settleLanguage();

    expect(languageData.markdown.load).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="editor-highlighting-off"]').text()).toBe(
      'editor.highlightingOffTooLarge'
    );
  });

  it('colours a long one made of ordinary paragraphs', async () => {
    const paragraphs = 'a paragraph of prose\n\n'.repeat(16000);
    api.fetchFileContent.mockResolvedValue({ content: paragraphs });

    await mountEditor();
    await settleLanguage();

    expect(languageData.markdown.load).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="editor-highlighting-off"]').exists()).toBe(false);
  });
});

/**
 * The other parsers divide a document by lines, and cannot divide one line. A
 * large JSON file written on a single line held the page in jolts for seconds.
 */
describe('colouring a file in another language', () => {
  const openJson = async (content) => {
    Object.assign(route(), {
      fullPath: '/editor/Docs/data.json',
      params: { path: 'Docs/data.json' },
    });
    api.fetchFileContent.mockResolvedValue({ content });
    await mountEditor();
    await vi.dynamicImportSettled();
    await flushPromises();
  };

  it('colours one written over ordinary lines, however long the file', async () => {
    await openJson(`[\n${'  {"id": 1, "name": "an item"},\n'.repeat(20000)}]`);

    expect(languageData.json.load).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="editor-highlighting-off"]').exists()).toBe(false);
  });

  it('opens one with a line too long to parse as plain text, and says so', async () => {
    await openJson(`[${'{"id":1,"name":"an item"},'.repeat(4000)}{}]`);

    expect(languageData.json.load).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="editor-highlighting-off"]').exists()).toBe(true);
  });
});

describe('typing while a save is being written', () => {
  /** What was written is saved; what was typed after it was taken is not. */
  it('saves the text as it was when the save began, and keeps the rest unsaved', async () => {
    let finish;
    api.saveFileContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = await mountEditor();
    await type(view, 'hello, world');

    const saving = view.saveFile();
    await type(view, 'hello, world, and more');
    finish({});
    await saving;
    await flushPromises();

    expect(api.saveFileContent).toHaveBeenCalledWith('Docs/notes.md', 'hello, world');
    expect(view.hasUnsavedChanges).toBe(true);
  });
});

describe('wrapping lines', () => {
  /** The menu said the option was on while no line was wrapped. */
  it('starts off, as the editor does, and turns on at the first press', async () => {
    const view = await mountEditor();
    expect(view.isLineWrapping).toBe(false);

    view.toggleLineWrapping();

    expect(view.isLineWrapping).toBe(true);
    expect(surface.view.dispatch).toHaveBeenCalled();
  });
});

/**
 * What was typed and never saved, when another tab comes forward.
 *
 * This page is unmounted the moment a tab is brought forward, so everything typed
 * since the last save went with it — silently, for a click that never said
 * "discard". A document open in the preview does not have this problem: its
 * session lives in the manager and outlives the page. This is the same promise
 * for the one kind of document that is not a preview.
 */
describe('what a tab holds on to', () => {
  /** A second tab, brought forward: the page goes, the tab stays on the file. */
  const anotherTabComesForward = async () => {
    appTabs.tabs = [{ id: 'tab-1' }, { id: 'tab-9' }];
    appTabs.activeId = 'tab-9';
    wrapper.unmount();
  };

  it('keeps what was typed', async () => {
    const view = await mountEditor();
    await type(view, 'half a sentence');

    await anotherTabComesForward();

    expect(drafts.get('tab-1')).toMatchObject({
      address: '/editor/Docs/notes.md',
      text: 'half a sentence',
    });
  });

  /**
   * And keeps it for the tab of the pane it was drawn in, not for the tab in front.
   *
   * A file open beside a folder is this page drawn in the half the reader is *not*
   * in. "The tab in front" is then the neighbour — so half a sentence typed in the
   * editor pane was kept for the folder tab, and the editor's own tab came back to
   * nothing.
   */
  it('keeps it for its own pane tab, not for the tab in front', async () => {
    appTabs.tabs = [{ id: 'tab-1' }, { id: 'tab-9' }];
    appTabs.activeId = 'tab-9';
    appTabs.pane = 'tab-1';

    const view = await mountEditor();
    await type(view, 'half a sentence');

    // The pane is given another tab: this page is not speaking for tab-1 any more,
    // so what was typed is kept for it.
    appTabs.pane = 'tab-9';
    wrapper.unmount();

    expect(drafts.get('tab-1')).toMatchObject({
      address: '/editor/Docs/notes.md',
      text: 'half a sentence',
    });
    expect(drafts.get('tab-9')).toBeFalsy();
  });

  /**
   * And keeps it when the half it is drawn in is taken off the window.
   *
   * A pair is drawn while the reader is in one of its two tabs; going to any other
   * tab takes both halves away, and the right-hand one is *destroyed* — its props
   * go with it, so on the way out it still names its own tab. Asking "am I still
   * the tab of this pane" therefore answered yes, which this page read as "the
   * address changed under me" — and threw away what that tab was holding. Coming
   * back to the pair, the editor on the right was at the top of its file, every
   * time, while the one on the left was where it had been left.
   */
  it('keeps what it was holding when its half is taken off the window', async () => {
    appTabs.tabs = [{ id: 'tab-1' }, { id: 'tab-9' }];
    appTabs.activeId = 'tab-1';
    appTabs.pane = 'tab-1';

    const view = await mountEditor();
    await type(view, 'half a sentence');

    // The reader goes to a tab that is not in the pair: this half is destroyed,
    // naming its own tab on the way out, and its tab is not the one in front.
    appTabs.activeId = 'tab-9';
    wrapper.unmount();

    expect(drafts.get('tab-1')).toMatchObject({
      address: '/editor/Docs/notes.md',
      text: 'half a sentence',
    });
  });

  /**
   * And the place, with nothing typed at all — which was the complaint: scrolled
   * two hundred lines down, a paragraph selected, and back to the top of the file
   * with nothing selected.
   */
  it('keeps where the reader was, in a file nothing was typed into', async () => {
    await mountEditor();
    surface.current.view.dispatch({ selection: { anchor: 40, head: 96 } });
    surface.current.view.scrollDOM.scrollTop = 720;

    await anotherTabComesForward();

    expect(drafts.get('tab-1')).toMatchObject({
      text: null,
      selection: { anchor: 40, head: 96 },
      scrollTop: 720,
    });
  });

  it('hands the place back when its tab comes back', async () => {
    drafts.set('tab-1', {
      address: '/editor/Docs/notes.md',
      text: null,
      selection: { anchor: 3, head: 5 },
      scrollTop: 480,
    });

    await mountEditor();
    await flushPromises();

    expect(surface.current.view.state.selection.main).toEqual({ anchor: 3, head: 5 });
    expect(surface.current.view.scrollDOM.scrollTop).toBe(480);
  });

  // A cursor past the end of a file somebody else shortened is clamped by the
  // editor itself, where the document is — see `CodeSurface.spec.js`.

  /**
   * Handed back whole, `topLine` and all.
   *
   * Where the reader is in a long file is the line at the top of the screen
   * rather than a number of pixels, because a scroll position written into the
   * editor before it has measured is clamped to whatever fits. The editor
   * answered with that line, and it was dropped between here and the store, so
   * the fix was in the file and the reader still came back to the top — with the
   * cursor intact beside them, which made it look as though the editor were at
   * fault. This is the seam it fell through.
   */
  it('gives the editor back every part of the place it answered with', async () => {
    await mountEditor();
    await flushPromises();
    surface.current.restorePlace({
      selection: { anchor: 12, head: 20 },
      scrollTop: 640,
      topLine: 1840,
    });
    surface.restored.length = 0;
    surface.settlingWhenRestored = null;

    // Another tab in front, and back again.
    await anotherTabComesForward();
    appTabs.activeId = 'tab-1';
    await mountEditor();
    await flushPromises();

    expect(surface.restored.at(-1)).toMatchObject({ scrollTop: 640, topLine: 1840 });
  });

  /**
   * Shown once the reader is back where they were, not before.
   *
   * The place can only be applied after the file has reached the editor, so the
   * file appeared at the top and then jumped to the line somebody was reading.
   * A frame or two of nothing costs nothing — they are the same frames — and it is
   * cleared whatever happens, because an editor that never appears is worse than
   * a jump.
   */
  it('keeps the editor out of sight until the place is back', async () => {
    drafts.set('tab-1', {
      address: '/editor/Docs/notes.md',
      text: null,
      selection: { anchor: 3, head: 5 },
      scrollTop: 480,
      topLine: 1840,
    });

    await mountEditor();
    await flushPromises();

    // Out of sight while it was put back, and shown once it was.
    expect(surface.settlingWhenRestored).toBe('true');
    expect(wrapper.get('[data-test="editor-surface"]').attributes('data-settling')).toBe('false');
  });

  it('shows the editor even when there was no place to put back', async () => {
    await mountEditor();
    await flushPromises();

    expect(wrapper.get('[data-test="editor-surface"]').attributes('data-settling')).toBe('false');
  });

  /**
   * A tab coming back does not read the file again.
   *
   * The page is unmounted the moment another tab comes forward, so it used to read
   * the file from the server on the way back: every glance at another tab cost a
   * "Loading file…" and a redraw of everything. What it kept is on screen before
   * anything is asked of the network, and the file is checked quietly afterwards.
   */
  it('shows what it read before, without a spinner', async () => {
    await mountEditor();
    await flushPromises();
    await anotherTabComesForward();
    appTabs.activeId = 'tab-1';
    // Never answers, so anything that waits for the network waits for ever: the
    // point is that this does not wait for it at all.
    api.fetchFileContent.mockImplementation(() => new Promise(() => {}));

    wrapper = mount(EditorViewComponent, { global: { mocks: { $t: (key) => key } } });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isLoading).toBe(false);
    expect(surface.current.snapshot()).toBe('hello');
  });

  /** A file this tab has never read is read, spinner and all. */
  it('reads the file when the tab has nothing in hand', async () => {
    api.fetchFileContent.mockImplementation(() => new Promise(() => {}));

    wrapper = mount(EditorViewComponent, { global: { mocks: { $t: (key) => key } } });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.isLoading).toBe(true);
  });

  it('checks the file afterwards, and takes what somebody else wrote', async () => {
    await mountEditor();
    await flushPromises();
    await anotherTabComesForward();
    appTabs.activeId = 'tab-1';
    api.fetchFileContent.mockResolvedValue({ content: 'somebody else wrote this' });

    await mountEditor();
    await flushPromises();

    expect(api.fetchFileContent).toHaveBeenCalled();
    expect(surface.current.snapshot()).toBe('somebody else wrote this');
  });

  /** The reader's own work outranks anything found on the disk. */
  it('leaves unsaved text alone, whatever the file now says', async () => {
    const view = await mountEditor();
    await type(view, 'half a sentence');
    await anotherTabComesForward();
    appTabs.activeId = 'tab-1';
    api.fetchFileContent.mockResolvedValue({ content: 'somebody else wrote this' });

    await mountEditor();
    await flushPromises();

    expect(surface.current.snapshot()).toBe('half a sentence');
  });

  it('hands it back, still unsaved, when its tab comes back', async () => {
    drafts.set('tab-1', { address: '/editor/Docs/notes.md', text: 'half a sentence' });

    const view = await mountEditor();
    await flushPromises();

    expect(surface.current.snapshot()).toBe('half a sentence');
    // Unsaved, because it is: the file on disk is what was read, and a grey save
    // button over text that exists nowhere else is how that work gets lost.
    expect(view.canSave).toBe(true);
  });

  it('keeps no text for a file that is only being read', async () => {
    Object.assign(route(), {
      name: 'TrashFileViewer',
      fullPath: '/trash/view/id-1/drafts/run.sh',
      params: { itemId: 'id-1', entryPath: ['drafts', 'run.sh'] },
    });
    const view = await mountEditor();
    await type(view, 'not that it could be written');

    await anotherTabComesForward();

    // Its place, yes — nothing about reading a deleted file says where in it the
    // reader was. Its text, no: there is nothing to write back.
    expect(drafts.get('tab-1').text).toBeNull();
  });

  it('keeps no text when there was nothing unsaved', async () => {
    await mountEditor();

    await anotherTabComesForward();

    expect(drafts.get('tab-1').text).toBeNull();
  });

  /** The tab stayed in front, so the address changed under it: another file now. */
  /**
   * Crossing from one text tab to another does not mount a new page: both
   * addresses match the same route, so vue-router keeps this component and hands
   * it new parameters. A tab read once at setup kept the place for the tab the
   * reader had left, and gave the tab they were on nothing back.
   */
  it('changes hands when another tab comes forward with a file', async () => {
    appTabs.tabs = [{ id: 'tab-1' }, { id: 'tab-9' }];
    const view = await mountEditor();
    await type(view, 'half a sentence');

    // What the strip does: the other tab is in front, and its address follows.
    appTabs.activeId = 'tab-9';
    route().fullPath = '/editor/Docs/other.md';
    await flushPromises();

    // The tab that was left keeps what was in it…
    expect(drafts.get('tab-1')).toMatchObject({
      address: '/editor/Docs/notes.md',
      text: 'half a sentence',
    });
    // …and nothing was kept for the tab that came forward, which has its own.
    expect(drafts.has('tab-9')).toBe(false);
  });

  /**
   * The other half of changing hands: what the tab coming forward had kept is
   * what is put back. Kept for the tab that was left, it would be handed to
   * nobody — and the reader would land at the top of a file they had scrolled.
   */
  it('takes back what the tab coming forward had kept', async () => {
    appTabs.tabs = [{ id: 'tab-1' }, { id: 'tab-9' }];
    drafts.set('tab-9', {
      address: '/editor/Docs/other.md',
      text: null,
      selection: { anchor: 2, head: 4 },
      scrollTop: 360,
    });
    await mountEditor();

    appTabs.activeId = 'tab-9';
    Object.assign(route(), {
      fullPath: '/editor/Docs/other.md',
      params: { path: 'Docs/other.md' },
    });
    await flushPromises();

    expect(surface.current.view.state.selection.main).toEqual({ anchor: 2, head: 4 });
    expect(surface.current.view.scrollDOM.scrollTop).toBe(360);
  });

  it('lets go when the tab itself is taken somewhere else', async () => {
    const view = await mountEditor();
    await type(view, 'half a sentence');

    // Said out loud, because it is the whole of the difference: the window has
    // gone to the folder, and this tab is the one in front — so the file is not
    // what the tab is on any more. A page merely taken off screen keeps what its
    // tab was holding.
    route().fullPath = '/browse/Docs';
    wrapper.unmount();

    expect(drafts.has('tab-1')).toBe(false);
  });

  it('lets go once the file is saved', async () => {
    const view = await mountEditor();
    await type(view, 'half a sentence');
    drafts.set('tab-1', { address: '/editor/Docs/notes.md', text: 'half a sentence' });

    await view.saveFile();

    expect(drafts.has('tab-1')).toBe(false);
  });

  it('lets go when leaving without saving is said out loud', async () => {
    asked.ask.mockResolvedValue(true);
    const view = await mountEditor();
    await type(view, 'half a sentence');
    drafts.set('tab-1', { address: '/editor/Docs/notes.md', text: 'half a sentence' });

    await view.requestClose();

    expect(drafts.has('tab-1')).toBe(false);
  });
});
