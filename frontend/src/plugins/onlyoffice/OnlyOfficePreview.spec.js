import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

/**
 * The heartbeat is what keeps a document marked as being edited: it reports
 * the document open every minute, and the marker outlives the last report by
 * two minutes.
 *
 * So an interval that survives the preview never lets the marker go — the file
 * stays listed as open for as long as the tab lives, and nothing in the editor
 * or the file list can explain why.
 */

const fetchOnlyOfficeConfig = vi.fn();
const heartbeatOnlyOfficeSession = vi.fn();
const fetchOnlyOfficeHistory = vi.fn();
const fetchOnlyOfficeHistoryData = vi.fn();
const restoreVersion = vi.fn();
const requestOnlyOfficeForceSave = vi.fn();
const endOnlyOfficeSession = vi.fn();
const renameOnlyOfficeDocument = vi.fn();
const saveOnlyOfficeDocumentAs = vi.fn();
const fetchOnlyOfficeStorageFile = vi.fn();
const fetchOnlyOfficeMentionUsers = vi.fn();
const notifyOnlyOfficeMention = vi.fn();
const features = { versionsEnabled: true };
const panel = vi.hoisted(() => ({ store: null }));
// One instance of each store for the whole file, so that what the preview asked
// of them can be read back.
const fileStore = { currentPath: 'Docs', fetchPathItems: vi.fn(), refresh: vi.fn() };
const notifications = { addNotification: vi.fn() };
/**
 * Closing goes through the session this document was opened in — `api.close` —
 * and not through whatever the window happens to be showing: with tabs there are
 * several documents alive at once, and an editor in a background tab asked to
 * close must not close the one in front.
 */
const closeSession = vi.fn();

vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));
vi.mock('@/stores/versionsPanel', async () => {
  const { reactive } = await import('vue');
  panel.store = reactive({ restored: 0, relativePath: '', markRestored: () => {} });
  return { useVersionsPanelStore: () => panel.store };
});

vi.mock('@/api', () => ({
  fetchOnlyOfficeHistory: (...args) => fetchOnlyOfficeHistory(...args),
  fetchOnlyOfficeHistoryData: (...args) => fetchOnlyOfficeHistoryData(...args),
  restoreVersion: (...args) => restoreVersion(...args),
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
  fetchOnlyOfficeConfig: (...args) => fetchOnlyOfficeConfig(...args),
  fetchOnlyOfficeMentionUsers: (...args) => fetchOnlyOfficeMentionUsers(...args),
  fetchOnlyOfficeStorageFile: (...args) => fetchOnlyOfficeStorageFile(...args),
  heartbeatOnlyOfficeSession: (...args) => heartbeatOnlyOfficeSession(...args),
  notifyOnlyOfficeMention: (...args) => notifyOnlyOfficeMention(...args),
  requestOnlyOfficeForceSave: (...args) => requestOnlyOfficeForceSave(...args),
  endOnlyOfficeSession: (...args) => endOnlyOfficeSession(...args),
  renameOnlyOfficeDocument: (...args) => renameOnlyOfficeDocument(...args),
  saveOnlyOfficeDocumentAs: (...args) => saveOnlyOfficeDocumentAs(...args),
  browse: vi.fn(() => Promise.resolve({ items: [], path: '' })),
}));

vi.mock('@/stores/fileStore', () => ({ useFileStore: () => fileStore }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: () => notifications }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => ({ isDark: false }) }));
vi.mock('@/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

let capturedConfig = null;
vi.mock('@onlyoffice/document-editor-vue', () => ({
  DocumentEditor: defineComponent({
    props: { config: { type: Object, default: null } },
    setup(props) {
      // On every render, not only the first: the editor is rebuilt in place
      // by handing it a new configuration, and a capture taken once would
      // still be showing the one it opened with.
      return () => {
        capturedConfig = props.config;
        return h('div');
      };
    },
  }),
}));

import OnlyOfficePreview from './OnlyOfficePreview.vue';
import { onlyofficePreviewPlugin } from './onlyofficePreview';
import logger from '@/utils/logger';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      onlyoffice: {
        renamedHeading: 'Renamed',
        renamedBody: 'Now called {name}',
        renameFailed: 'Could not rename to {name}',
        savedAsHeading: 'Copy saved',
        savedAsBody: 'Saved as {name}',
        saveAsFailed: 'Could not save {name}',
        pickFailed: 'Could not use that file',
      },
    },
  },
});

const configResponse = (sessionId) => ({
  documentServerUrl: 'https://ds.example.com',
  config: { document: { key: 'k' }, editorConfig: {} },
  forceSaveSessionId: sessionId,
  autoSaveIntervalMs: 0,
});

// Previews mounted by the tests below, unmounted after each one: a preview
// left behind keeps its timers and its watchers, and answers the next test.
/**
 * The editor the preview will find, whatever the element ended up being
 * called.
 *
 * The id carries a generation now — the element is new every time the editor
 * is built, so that a registry entry left behind by a teardown that failed
 * cannot keep the next one from attaching. These tests are about what the
 * preview asks the editor to do, not about what the element is named, so they
 * answer to any id rather than to a spelling they would have to be kept in
 * step with.
 */
const registerEditor = (editor) => {
  window.DocEditor = {
    instances: new Proxy(
      {},
      { get: (_target, key) => (typeof key === 'string' ? editor : undefined) }
    ),
  };
  return editor;
};

let openPreviews = [];

const mountPreview = ({ filePath = 'report.docx', previewState = {} } = {}) => {
  const wrapper = mount(OnlyOfficePreview, {
    props: {
      item: { name: filePath.split('/').pop(), path: '' },
      extension: 'docx',
      filePath,
      previewUrl: '',
      previewState,
      api: { close: (...args) => closeSession(...args) },
    },
    global: {
      plugins: [i18n],
      stubs: { ShareDialog: true, StoragePickerDialog: true },
    },
  });
  openPreviews.push(wrapper);
  return wrapper;
};

beforeEach(() => {
  vi.useFakeTimers();
  capturedConfig = null;
  fetchOnlyOfficeConfig.mockReset();
  heartbeatOnlyOfficeSession.mockReset();
  heartbeatOnlyOfficeSession.mockResolvedValue({ active: true });
  requestOnlyOfficeForceSave.mockReset();
  requestOnlyOfficeForceSave.mockResolvedValue({ queued: true });
  endOnlyOfficeSession.mockReset();
  endOnlyOfficeSession.mockResolvedValue({ ended: true });
  for (const mock of [
    renameOnlyOfficeDocument,
    saveOnlyOfficeDocumentAs,
    fetchOnlyOfficeStorageFile,
    fetchOnlyOfficeMentionUsers,
    notifyOnlyOfficeMention,
    closeSession,
    notifications.addNotification,
    ...Object.values(logger),
  ]) {
    mock.mockReset();
  }
  fileStore.fetchPathItems.mockReset();
  fileStore.fetchPathItems.mockResolvedValue(undefined);
  fileStore.refresh.mockReset();
  fileStore.refresh.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const wrapper of openPreviews) {
    try {
      wrapper.unmount();
    } catch {
      // Already unmounted by the test itself.
    }
  }
  openPreviews = [];
  vi.useRealTimers();
});

/**
 * The history the editor shows is NextExplorer's versions: the editor asks for
 * the list, then for each version as it is clicked, and restoring goes through
 * the versions like a restore from the panel.
 */
describe('the document history in the editor', () => {
  const HISTORY = {
    currentVersion: 2,
    history: [
      {
        version: 1,
        versionId: 'v-older-0000000001',
        key: 'version-v-older-0000000001',
        created: '2026-09-14T09:00:00.000Z',
        user: { id: 'u1', name: 'Alice' },
      },
      {
        version: 2,
        versionId: null,
        key: 'k',
        created: '2026-09-14T10:00:00.000Z',
        user: { id: 'u1', name: 'Alice' },
      },
    ],
    canRestore: true,
  };

  const editable = (sessionId = 'session-1') => ({
    ...configResponse(sessionId),
    config: { document: { key: 'k', permissions: { edit: true } }, editorConfig: {} },
  });

  let editor;

  let mounted = [];

  const mountOn = (item = { name: 'report.docx', path: '' }) => {
    const wrapper = mount(OnlyOfficePreview, {
      props: {
        item,
        extension: 'docx',
        filePath: 'report.docx',
        previewUrl: '',
        previewState: {},
        api: {},
      },
      global: { plugins: [i18n], stubs: { ShareDialog: true, StoragePickerDialog: true } },
    });
    mounted.push(wrapper);
    return wrapper;
  };

  beforeEach(() => {
    features.versionsEnabled = true;
    fetchOnlyOfficeHistory.mockReset();
    fetchOnlyOfficeHistoryData.mockReset();
    restoreVersion.mockReset();
    editor = { refreshHistory: vi.fn(), setHistoryData: vi.fn(), refreshFile: vi.fn() };
    registerEditor(editor);
    if (panel.store) Object.assign(panel.store, { restored: 0, relativePath: '' });
  });

  // A preview left mounted — by a test that failed before unmounting it — keeps
  // watching the Versions panel, and answers the next test's restores too.
  afterEach(() => {
    for (const wrapper of mounted) {
      try {
        wrapper.unmount();
      } catch {
        // Already unmounted by the test itself.
      }
    }
    mounted = [];
  });

  it('is offered where versions are kept, and not where they are not', async () => {
    // A configuration of its own for each opening, as the server sends: the
    // preview adds its events to the one it is given.
    fetchOnlyOfficeConfig.mockImplementation(async () => editable());
    mountOn();
    await flushPromises();
    expect(typeof capturedConfig.events.onRequestHistory).toBe('function');

    features.versionsEnabled = false;
    mountOn();
    await flushPromises();
    expect(capturedConfig.events.onRequestHistory).toBeUndefined();
    expect(capturedConfig.events.onRequestRestore).toBeUndefined();
  });

  it("lists NextExplorer's versions as the editor's history, the current state last", async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(editable());
    fetchOnlyOfficeHistory.mockResolvedValue(HISTORY);
    const wrapper = mountOn();
    await flushPromises();

    capturedConfig.events.onRequestHistory();
    await flushPromises();

    expect(fetchOnlyOfficeHistory).toHaveBeenCalledWith('report.docx');
    const shown = editor.refreshHistory.mock.calls.at(-1)[0];
    expect(shown.currentVersion).toBe(2);
    expect(shown.history.map((entry) => [entry.version, entry.key, entry.user.name])).toEqual([
      [1, 'version-v-older-0000000001', 'Alice'],
      [2, 'k', 'Alice'],
    ]);
    expect(typeof shown.history[0].created).toBe('string');
    wrapper.unmount();
  });

  it('asks for the version clicked by its id, and for the current state without one', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(editable());
    fetchOnlyOfficeHistory.mockResolvedValue(HISTORY);
    fetchOnlyOfficeHistoryData.mockResolvedValue({ version: 1, url: 'https://x', token: 't' });
    const wrapper = mountOn();
    await flushPromises();
    capturedConfig.events.onRequestHistory();
    await flushPromises();

    capturedConfig.events.onRequestHistoryData({ data: 1 });
    await flushPromises();
    expect(fetchOnlyOfficeHistoryData).toHaveBeenLastCalledWith('report.docx', {
      version: 1,
      versionId: 'v-older-0000000001',
    });
    expect(editor.setHistoryData).toHaveBeenLastCalledWith({
      version: 1,
      url: 'https://x',
      token: 't',
    });

    capturedConfig.events.onRequestHistoryData({ data: 2 });
    await flushPromises();
    expect(fetchOnlyOfficeHistoryData).toHaveBeenLastCalledWith('report.docx', {
      version: 2,
      versionId: undefined,
    });
    wrapper.unmount();
  });

  it('tells the editor why the history or a version would not come', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(editable());
    fetchOnlyOfficeHistory.mockRejectedValue(new Error('The history of this file is not shared.'));
    fetchOnlyOfficeHistoryData.mockRejectedValue(new Error('This version does not exist.'));
    const wrapper = mountOn();
    await flushPromises();

    capturedConfig.events.onRequestHistory();
    capturedConfig.events.onRequestHistoryData({ data: 1 });
    await flushPromises();

    expect(editor.refreshHistory).toHaveBeenCalledWith({
      error: 'The history of this file is not shared.',
    });
    expect(editor.setHistoryData).toHaveBeenCalledWith({
      version: 1,
      error: 'This version does not exist.',
    });
    wrapper.unmount();
  });

  it('restores through the versions, then opens the document again', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(editable());
    fetchOnlyOfficeHistory.mockResolvedValue(HISTORY);
    restoreVersion.mockResolvedValue({ status: 'saved' });
    const wrapper = mountOn();
    await flushPromises();
    capturedConfig.events.onRequestHistory();
    await flushPromises();
    fetchOnlyOfficeConfig.mockClear();

    capturedConfig.events.onRequestRestore({ data: { version: 1 } });
    await flushPromises();

    expect(restoreVersion).toHaveBeenCalledWith('report.docx', 'v-older-0000000001');
    expect(fetchOnlyOfficeConfig).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('restores nothing for the current state, which already is the document', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(editable());
    fetchOnlyOfficeHistory.mockResolvedValue(HISTORY);
    const wrapper = mountOn();
    await flushPromises();
    capturedConfig.events.onRequestHistory();
    await flushPromises();

    capturedConfig.events.onRequestRestore({ data: { version: 2 } });
    await flushPromises();

    expect(restoreVersion).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('offers no restore to someone who may not change the document', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse(null));
    const wrapper = mountOn();
    await flushPromises();

    expect(typeof capturedConfig.events.onRequestHistory).toBe('function');
    expect(capturedConfig.events.onRequestRestore).toBeUndefined();
    wrapper.unmount();
  });

  it('opens an earlier version to be read, with no history of its own', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse(null));
    const wrapper = mountOn({ name: 'report.docx', path: '', versionId: 'v-older-0000000001' });
    await flushPromises();

    expect(fetchOnlyOfficeConfig).toHaveBeenCalledWith('report.docx', 'view', {
      theme: 'light',
      versionId: 'v-older-0000000001',
    });
    expect(capturedConfig.events.onRequestHistory).toBeUndefined();
    wrapper.unmount();
  });

  it('points the editor at the document once the Versions panel restored it', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(editable());
    const wrapper = mountOn();
    await flushPromises();
    fetchOnlyOfficeConfig.mockClear();

    panel.store.relativePath = 'other.docx';
    panel.store.restored += 1;
    await flushPromises();
    expect(fetchOnlyOfficeConfig).not.toHaveBeenCalled();

    panel.store.relativePath = 'report.docx';
    panel.store.restored += 1;
    await flushPromises();
    expect(fetchOnlyOfficeConfig).toHaveBeenCalledTimes(1);
    expect(editor.refreshFile).toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('OnlyOffice preview presence', () => {
  it('stops reporting the document open once the preview is gone', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));

    const wrapper = mountPreview();
    await flushPromises();

    capturedConfig.events.onDocumentReady();
    await flushPromises();
    expect(heartbeatOnlyOfficeSession).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    heartbeatOnlyOfficeSession.mockClear();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(heartbeatOnlyOfficeSession).not.toHaveBeenCalled();
  });

  it('does not revive the heartbeat with a refresh that outlived the preview', async () => {
    // The editor reports an outdated document as it saves on the way out, so
    // this refresh is in flight exactly when the preview is being closed.
    let resolveRefresh;
    fetchOnlyOfficeConfig.mockResolvedValueOnce(configResponse('session-1')).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = () => resolve(configResponse('session-2'));
        })
    );

    // The refresh hands the new document to the running editor, so the editor
    // has to be there: without it the code takes its fallback path and never
    // reaches the heartbeat this test is about.
    const refreshFile = vi.fn();
    registerEditor({ refreshFile });

    const wrapper = mountPreview();
    await flushPromises();

    capturedConfig.events.onDocumentReady();
    await flushPromises();

    capturedConfig.events.onOutdatedVersion();
    wrapper.unmount();
    heartbeatOnlyOfficeSession.mockClear();

    resolveRefresh();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(heartbeatOnlyOfficeSession).not.toHaveBeenCalled();
  });
});

/**
 * What is typed reaches the file only when the document is force-saved: until
 * then the file on disk is still the one that was opened, and a browser that
 * crashes takes the edits with it.
 *
 * So the preview saves on its own, at the cadence the server set — but only
 * once the editor has reported a change, since each save has the Document
 * Server assemble the whole document, and never two at a time. A save that
 * failed must not stop the next one, and closing must not leave an automatic
 * save to fire after the close save it replaces.
 */
describe('the automatic save', () => {
  const INTERVAL = 30_000;

  const openWithAutoSave = async (autoSaveIntervalMs = INTERVAL) => {
    fetchOnlyOfficeConfig.mockResolvedValue({
      ...configResponse('session-1'),
      autoSaveIntervalMs,
    });
    const previewState = {};
    mountPreview({ previewState });
    await flushPromises();
    return { previewState, events: capturedConfig.events };
  };

  // What the editor reports as someone types: changes pending, then delivered
  // to the Document Server.
  const type = (events) => {
    events.onDocumentStateChange({ data: true });
    events.onDocumentStateChange({ data: false });
  };

  it('saves nothing until the editor has reported a change, then saves shortly after', async () => {
    const { events } = await openWithAutoSave();

    // A document opened and left alone still reports its state as delivered.
    events.onDocumentStateChange({ data: false });
    await vi.advanceTimersByTimeAsync(5 * INTERVAL);
    expect(requestOnlyOfficeForceSave).not.toHaveBeenCalled();

    type(events);
    await vi.advanceTimersByTimeAsync(1_199);
    expect(requestOnlyOfficeForceSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledWith('report.docx', {
      sessionId: 'session-1',
      reason: 'auto',
    });
  });

  /**
   * An automatic save on its way used to be handed back to a close as if it
   * were the close's own. The server queues a last save on close and keeps it
   * as a version; answered with the automatic one, that save was never asked for.
   */
  it('still asks for the save on close when an automatic one is on its way', async () => {
    const { previewState } = await openWithAutoSave(0);
    let release;
    requestOnlyOfficeForceSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ queued: true });
        })
    );

    const automatic = previewState.requestForceSave({ reason: 'auto' });
    const closing = previewState.requestForceSave({ reason: 'close' });
    release();
    await automatic;
    await closing;

    expect(requestOnlyOfficeForceSave.mock.calls.map(([, options]) => options.reason)).toEqual([
      'auto',
      'close',
    ]);
  });

  it('saves nothing on its own when the server set no interval', async () => {
    const { events, previewState } = await openWithAutoSave(0);

    type(events);
    await vi.advanceTimersByTimeAsync(10 * INTERVAL);

    expect(requestOnlyOfficeForceSave).not.toHaveBeenCalled();
    // The save on close is still there to be asked for.
    await previewState.requestForceSave({ reason: 'close' });
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);
  });

  it('keeps to the configured interval, counted from the last save', async () => {
    const { events } = await openWithAutoSave();
    type(events);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);

    // Typing goes on a few seconds after that save.
    await vi.advanceTimersByTimeAsync(5_000);
    type(events);

    await vi.advanceTimersByTimeAsync(INTERVAL - 5_000 - 1);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(2);
  });

  it('never sends a save while the previous one is still on its way, and sends the next once it is back', async () => {
    const { events } = await openWithAutoSave();
    let accept;
    requestOnlyOfficeForceSave.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );

    type(events);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);

    // The server is slow to accept it, and the editor goes on reporting
    // changes: the timer fires again, twice.
    type(events);
    await vi.advanceTimersByTimeAsync(1_200);
    type(events);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);

    accept({ queued: true });
    await flushPromises();
    type(events);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(2);
  });

  it('goes on saving after a save that failed', async () => {
    const { events } = await openWithAutoSave();
    requestOnlyOfficeForceSave.mockRejectedValueOnce(new Error('Document Server unreachable'));

    type(events);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'ONLYOFFICE force-save request failed',
      expect.any(Error)
    );

    type(events);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(2);
  });

  it('drops the pending automatic save when asked to save for closing, and sends the close save', async () => {
    const { events, previewState } = await openWithAutoSave();
    type(events);
    // The automatic save is due in 200 ms.
    await vi.advanceTimersByTimeAsync(1_000);

    await previewState.requestForceSave({ reason: 'close' });
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledWith('report.docx', {
      sessionId: 'session-1',
      reason: 'close',
    });

    await vi.advanceTimersByTimeAsync(5 * INTERVAL);
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledTimes(1);
  });
});

/**
 * The editor's own close button has to go through the session this document was
 * opened in: closing the frame directly would skip the plugin's close hook, and
 * with it the save of whatever was typed since the last automatic one.
 */
describe("the editor's close button", () => {
  it('closes its own document, once the editor has drawn its own button', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));
    const previewState = {};
    mountPreview({ previewState });
    await flushPromises();

    // Until the document opens, the floating close button is the only way out.
    expect(previewState.hasNativeClose).toBe(false);
    capturedConfig.events.onDocumentReady();
    expect(previewState.hasNativeClose).toBe(true);

    capturedConfig.events.onRequestClose();
    expect(closeSession).toHaveBeenCalledTimes(1);
  });
});

/**
 * The Document Server reports the open copy as outdated once the file has been
 * replaced under it. Left alone, the stale copy stays on screen and its next
 * save writes over whatever replaced it.
 */
describe('a document replaced on disk while it is open', () => {
  const fresh = () => ({
    ...configResponse('session-2'),
    config: { document: { key: 'k2' }, editorConfig: {} },
  });

  it('hands the running editor the document as it now is, and moves every call to the new session', async () => {
    const editor = { refreshFile: vi.fn() };
    registerEditor(editor);
    const next = fresh();
    fetchOnlyOfficeConfig
      .mockResolvedValueOnce(configResponse('session-1'))
      .mockResolvedValueOnce(next);
    const previewState = {};
    mountPreview({ previewState });
    await flushPromises();
    capturedConfig.events.onDocumentReady();
    await flushPromises();
    heartbeatOnlyOfficeSession.mockClear();

    capturedConfig.events.onOutdatedVersion();
    await flushPromises();

    expect(fetchOnlyOfficeConfig).toHaveBeenLastCalledWith('report.docx', 'edit', {
      theme: 'light',
    });
    expect(editor.refreshFile).toHaveBeenCalledWith(next.config);
    // Swapped in place, not rebuilt: the cursor and the co-authors stay.
    expect(fetchOnlyOfficeConfig).toHaveBeenCalledTimes(2);
    expect(previewState.forceSaveSessionId).toBe('session-2');
    expect(heartbeatOnlyOfficeSession).toHaveBeenCalledWith('report.docx', {
      sessionId: 'session-2',
    });

    await previewState.requestForceSave({ reason: 'close' });
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledWith('report.docx', {
      sessionId: 'session-2',
      reason: 'close',
    });
  });

  it('rebuilds the editor when the Document Server cannot swap the document in place', async () => {
    // An older Document Server: the editor has no refreshFile.
    registerEditor({});
    fetchOnlyOfficeConfig
      .mockResolvedValueOnce(configResponse('session-1'))
      .mockImplementation(async () => fresh());
    const previewState = {};
    mountPreview({ previewState });
    await flushPromises();
    capturedConfig.events.onDocumentReady();
    expect(previewState.hasNativeClose).toBe(true);

    capturedConfig.events.onOutdatedVersion();
    await flushPromises();

    // Once for the new document key, once more to open the editor on it.
    expect(fetchOnlyOfficeConfig).toHaveBeenCalledTimes(3);
    expect(previewState.forceSaveSessionId).toBe('session-2');
    expect(capturedConfig.document.key).toBe('k2');
    // The editor is rebuilt where it stands rather than taken down and put
    // up again — see `load` — so its own chrome never leaves the screen and
    // the floating way out is not needed for a moment in the middle.
    expect(previewState.hasNativeClose).toBe(true);
  });

  it('records why the document could not be refreshed, and keeps the session it had', async () => {
    registerEditor({ refreshFile: vi.fn() });
    const failure = new Error('The file no longer exists.');
    fetchOnlyOfficeConfig
      .mockResolvedValueOnce(configResponse('session-1'))
      .mockRejectedValueOnce(failure);
    const previewState = {};
    mountPreview({ previewState });
    await flushPromises();

    capturedConfig.events.onOutdatedVersion();
    await flushPromises();

    expect(logger.error).toHaveBeenCalledWith('ONLYOFFICE refresh failed', {
      path: 'report.docx',
      err: failure,
    });
    expect(previewState.forceSaveSessionId).toBe('session-1');
  });
});

/**
 * Renaming from the editor's title bar moves the file under the open session.
 *
 * ONLYOFFICE sends the title without its extension, and a document renamed to
 * "Report" that lost its `.docx` no longer opens. Once moved, every later call —
 * heartbeat, automatic save, the close hook's save — has to name the new path:
 * the preview manager still holds the old one, and a save to a name that no
 * longer exists is a save lost.
 */
describe('renaming from the title bar', () => {
  const openInDocs = async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));
    const previewState = {};
    const wrapper = mountPreview({ filePath: 'Docs/report.docx', previewState });
    await flushPromises();
    return { wrapper, previewState, events: capturedConfig.events };
  };

  /**
   * The prop still names the file the preview was opened on. Reopening the
   * document from it — after the history closes, after a restore, or when the
   * server has no `refreshFile` — brought the old name back, and the close hook
   * then saved and closed a session under a file that no longer existed.
   */
  it('opens the new name again when the editor is reloaded after a rename', async () => {
    features.versionsEnabled = true;
    renameOnlyOfficeDocument.mockResolvedValue({ path: 'Docs/Report.docx', name: 'Report.docx' });
    const { previewState, events } = await openInDocs();

    events.onRequestRename({ data: 'Report' });
    await flushPromises();
    fetchOnlyOfficeConfig.mockClear();

    events.onRequestHistoryClose();
    await flushPromises();

    expect(fetchOnlyOfficeConfig).toHaveBeenCalledTimes(1);
    expect(fetchOnlyOfficeConfig.mock.calls[0][0]).toBe('Docs/Report.docx');
    expect(previewState.documentPath).toBe('Docs/Report.docx');
  });

  it('keeps the extension the editor leaves out of the new title', async () => {
    renameOnlyOfficeDocument.mockImplementation(async (path, { newName }) => ({
      path: `Docs/${newName}`,
      name: newName,
    }));
    const { events } = await openInDocs();

    events.onRequestRename({ data: 'Report' });
    await flushPromises();
    expect(renameOnlyOfficeDocument).toHaveBeenLastCalledWith('Docs/report.docx', {
      sessionId: 'session-1',
      newName: 'Report.docx',
    });

    // Wrapped, padded, and already ending with the extension in another case.
    events.onRequestRename({ data: { title: '  Q3 summary.DOCX  ' } });
    await flushPromises();
    expect(renameOnlyOfficeDocument).toHaveBeenLastCalledWith('Docs/Report.docx', {
      sessionId: 'session-1',
      newName: 'Q3 summary.DOCX',
    });

    // A dot in the title is not an extension of the document's kind.
    events.onRequestRename({ data: 'Report v2.final' });
    await flushPromises();
    expect(renameOnlyOfficeDocument).toHaveBeenLastCalledWith('Docs/Q3 summary.DOCX', {
      sessionId: 'session-1',
      newName: 'Report v2.final.DOCX',
    });
  });

  it('follows the file: the heartbeat, the saves, the close hook and the share dialog name the new path', async () => {
    renameOnlyOfficeDocument.mockResolvedValue({ path: 'Docs/Report.docx', name: 'Report.docx' });
    const { wrapper, previewState, events } = await openInDocs();
    events.onDocumentReady();
    await flushPromises();

    events.onRequestRename({ data: 'Report' });
    await flushPromises();

    expect(previewState.documentPath).toBe('Docs/Report.docx');
    expect(notifications.addNotification).toHaveBeenCalledWith({
      type: 'success',
      heading: 'Renamed',
      body: 'Now called Report.docx',
    });
    // Read again rather than navigated to: the listing must keep what is chosen.
    expect(fileStore.refresh).toHaveBeenCalled();
    expect(fileStore.fetchPathItems).not.toHaveBeenCalled();

    heartbeatOnlyOfficeSession.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeatOnlyOfficeSession).toHaveBeenCalledWith('Docs/Report.docx', {
      sessionId: 'session-1',
    });

    await previewState.requestForceSave({ reason: 'auto' });
    expect(requestOnlyOfficeForceSave).toHaveBeenLastCalledWith('Docs/Report.docx', {
      sessionId: 'session-1',
      reason: 'auto',
    });

    // The plugin's close hook is handed the context the preview was opened
    // with, which still names the old file.
    await onlyofficePreviewPlugin().onBeforeClose({ filePath: 'Docs/report.docx', previewState });
    expect(requestOnlyOfficeForceSave).toHaveBeenLastCalledWith('Docs/Report.docx', {
      sessionId: 'session-1',
      reason: 'close',
    });
    expect(endOnlyOfficeSession).toHaveBeenCalledWith('Docs/Report.docx', {
      sessionId: 'session-1',
    });

    events.onRequestSharingSettings();
    await flushPromises();
    const share = wrapper.findComponent({ name: 'ShareDialog' });
    expect(share.props('modelValue')).toBe(true);
    expect(share.props('item')).toEqual({ name: 'Report.docx', path: 'Docs', kind: 'docx' });
  });

  it('reports a rename that failed, and stays on the file it had', async () => {
    const failure = new Error('A file with that name already exists.');
    renameOnlyOfficeDocument.mockRejectedValue(failure);
    const { previewState, events } = await openInDocs();

    events.onRequestRename({ data: 'Report' });
    await flushPromises();

    expect(renameOnlyOfficeDocument).toHaveBeenCalledTimes(1);
    expect(notifications.addNotification).toHaveBeenCalledWith({
      type: 'error',
      heading: 'Could not rename to Report.docx',
      body: 'A file with that name already exists.',
    });
    expect(logger.error).toHaveBeenCalledWith('ONLYOFFICE rename failed', {
      path: 'Docs/report.docx',
      err: failure,
    });
    expect(previewState.documentPath).toBe('Docs/report.docx');
    expect(fileStore.refresh).not.toHaveBeenCalled();

    await previewState.requestForceSave({ reason: 'auto' });
    expect(requestOnlyOfficeForceSave).toHaveBeenCalledWith('Docs/report.docx', {
      sessionId: 'session-1',
      reason: 'auto',
    });
  });

  it('asks nothing for an empty title, or from an editor with no session to rename under', async () => {
    const { events } = await openInDocs();
    events.onRequestRename({ data: '   ' });
    events.onRequestRename({ data: {} });
    await flushPromises();

    fetchOnlyOfficeConfig.mockResolvedValue(configResponse(null));
    mountPreview({ filePath: 'Docs/other.docx' });
    await flushPromises();
    capturedConfig.events.onRequestRename({ data: 'Other' });
    await flushPromises();

    expect(renameOnlyOfficeDocument).not.toHaveBeenCalled();
  });
});

/**
 * Save as: the Document Server converts the document and hands over a URL, and
 * the backend writes the copy beside the original. The editor stays on the
 * document it had. The copy has to show up in the listing, and a failure has to
 * be said — the editor itself shows nothing either way.
 */
describe('saving a copy from the editor', () => {
  const REQUEST = {
    title: 'report.pdf',
    url: 'https://ds.example.com/cache/files/report.pdf',
    fileType: 'pdf',
  };

  const openInDocs = async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));
    const previewState = {};
    mountPreview({ filePath: 'Docs/report.docx', previewState });
    await flushPromises();
    return { previewState, events: capturedConfig.events };
  };

  it('writes the copy beside the document, says so under the name it got, and shows it in the listing', async () => {
    saveOnlyOfficeDocumentAs.mockResolvedValue({
      name: 'report (1).pdf',
      path: 'Docs/report (1).pdf',
    });
    const { events, previewState } = await openInDocs();

    events.onRequestSaveAs({ data: REQUEST });
    await flushPromises();

    expect(saveOnlyOfficeDocumentAs).toHaveBeenCalledWith('Docs/report.docx', {
      url: REQUEST.url,
      title: 'report.pdf',
    });
    expect(notifications.addNotification).toHaveBeenCalledWith({
      type: 'success',
      heading: 'Copy saved',
      body: 'Saved as report (1).pdf',
    });
    // Read again rather than navigated to: the listing must keep what is chosen.
    expect(fileStore.refresh).toHaveBeenCalled();
    expect(fileStore.fetchPathItems).not.toHaveBeenCalled();
    // Still editing the original.
    expect(previewState.documentPath).toBe('Docs/report.docx');
  });

  it('does not report a written copy as failed because the listing would not refresh', async () => {
    saveOnlyOfficeDocumentAs.mockResolvedValue({ name: 'report.pdf' });
    fileStore.refresh.mockRejectedValue(new Error('offline'));
    const { events } = await openInDocs();

    events.onRequestSaveAs({ data: REQUEST });
    await flushPromises();

    expect(fileStore.refresh).toHaveBeenCalledTimes(1);
    expect(notifications.addNotification).toHaveBeenCalledTimes(1);
    expect(notifications.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' })
    );
  });

  it('reports a copy that could not be written, and leaves the listing alone', async () => {
    const failure = new Error('Not enough space on the volume.');
    saveOnlyOfficeDocumentAs.mockRejectedValue(failure);
    const { events } = await openInDocs();

    events.onRequestSaveAs({ data: REQUEST });
    await flushPromises();

    expect(notifications.addNotification).toHaveBeenCalledWith({
      type: 'error',
      heading: 'Could not save report.pdf',
      body: 'Not enough space on the volume.',
    });
    expect(logger.error).toHaveBeenCalledWith('ONLYOFFICE save-as failed', {
      path: 'Docs/report.docx',
      err: failure,
    });
    expect(fileStore.refresh).not.toHaveBeenCalled();
  });

  it('sends nothing for a request that names no file or no source, and records it', async () => {
    const { events } = await openInDocs();

    events.onRequestSaveAs({ data: { title: 'report.pdf' } });
    events.onRequestSaveAs({});
    await flushPromises();

    expect(saveOnlyOfficeDocumentAs).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('ONLYOFFICE save-as request was incomplete', {
      title: 'report.pdf',
    });
    expect(logger.warn).toHaveBeenCalledWith('ONLYOFFICE save-as request was incomplete', {
      title: null,
    });
  });
});

/**
 * Inserting an image, merging from a spreadsheet, comparing with another
 * document: the editor asks, NextExplorer's picker answers. Each request has its
 * own editor method, and carries a `c` value the editor matches the answer to —
 * the backend signs it with the URL, so it has to travel with the chosen file.
 * The wrong method, or the wrong `c`, and the file is silently not used.
 */
describe('files picked for the editor', () => {
  const METHODS = [
    'insertImage',
    'setRequestedDocument',
    'setRequestedSpreadsheet',
    'setRevisedFile',
  ];
  const TEXT_DOCUMENTS = ['docx', 'doc', 'odt', 'rtf', 'txt'];

  let editor;

  beforeEach(() => {
    editor = Object.fromEntries(METHODS.map((method) => [method, vi.fn()]));
    registerEditor(editor);
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));
  });

  it.each([
    [
      'onRequestInsertImage',
      'insertImage',
      'onlyoffice.pickImage',
      ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'],
    ],
    ['onRequestSelectDocument', 'setRequestedDocument', 'onlyoffice.pickDocument', TEXT_DOCUMENTS],
    [
      'onRequestSelectSpreadsheet',
      'setRequestedSpreadsheet',
      'onlyoffice.pickSpreadsheet',
      ['xlsx', 'xls', 'ods', 'csv'],
    ],
    ['onRequestCompareFile', 'setRevisedFile', 'onlyoffice.pickCompare', TEXT_DOCUMENTS],
  ])(
    '%s offers the files it can use, and hands the one chosen to %s',
    async (event, method, title, extensions) => {
      const payload = {
        fileType: 'x',
        url: 'https://nextexplorer.example.com/signed',
        token: 'jwt',
      };
      fetchOnlyOfficeStorageFile.mockResolvedValue(payload);
      const wrapper = mountPreview();
      await flushPromises();

      capturedConfig.events[event]({ data: { c: 'request-7' } });
      await flushPromises();

      const picker = wrapper.findComponent({ name: 'StoragePickerDialog' });
      expect(picker.props('modelValue')).toBe(true);
      expect(picker.props('title')).toBe(title);
      expect(picker.props('extensions')).toEqual(extensions);

      picker.vm.$emit('select', 'Pictures/chosen');
      await flushPromises();

      expect(fetchOnlyOfficeStorageFile).toHaveBeenCalledWith('Pictures/chosen', {
        c: 'request-7',
      });
      for (const other of METHODS) {
        if (other === method) expect(editor[other]).toHaveBeenCalledWith(payload);
        else expect(editor[other]).not.toHaveBeenCalled();
      }
    }
  );

  it('tells the user when the chosen file could not be handed over', async () => {
    const failure = new Error('You cannot read this file.');
    fetchOnlyOfficeStorageFile.mockRejectedValue(failure);
    const wrapper = mountPreview();
    await flushPromises();

    capturedConfig.events.onRequestInsertImage({ data: { c: 'add' } });
    await flushPromises();
    wrapper.findComponent({ name: 'StoragePickerDialog' }).vm.$emit('select', 'Private/logo.png');
    await flushPromises();

    expect(fetchOnlyOfficeStorageFile).toHaveBeenCalledTimes(1);
    expect(editor.insertImage).not.toHaveBeenCalled();
    expect(notifications.addNotification).toHaveBeenCalledWith({
      type: 'error',
      heading: 'Could not use that file',
      body: 'You cannot read this file.',
    });
    expect(logger.error).toHaveBeenCalledWith('ONLYOFFICE could not hand over the selected file', {
      path: 'Private/logo.png',
      err: failure,
    });
  });
});

/**
 * A comment started with @ opens the editor's mention list, which waits for an
 * answer: without one — even an empty one — the popup never closes.
 */
describe('mentions in comments', () => {
  it('answers the editor every time, with the people found or with nobody', async () => {
    const editor = { setUsers: vi.fn() };
    registerEditor(editor);
    const alice = { email: 'alice@example.com', name: 'Alice Martin', id: 'u1' };
    fetchOnlyOfficeMentionUsers
      .mockResolvedValueOnce({ users: [alice] })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Forbidden'));
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));
    mountPreview();
    await flushPromises();
    const { events } = capturedConfig;

    events.onRequestUsers({ data: { c: 'mention' } });
    await flushPromises();
    expect(editor.setUsers).toHaveBeenLastCalledWith({ c: 'mention', users: [alice] });

    events.onRequestUsers({ data: { c: 'protect' } });
    await flushPromises();
    expect(editor.setUsers).toHaveBeenLastCalledWith({ c: 'protect', users: [] });

    events.onRequestUsers({ data: { c: 'mention' } });
    await flushPromises();
    expect(editor.setUsers).toHaveBeenLastCalledWith({ c: 'mention', users: [] });
    expect(editor.setUsers).toHaveBeenCalledTimes(3);
    expect(fetchOnlyOfficeMentionUsers).toHaveBeenCalledTimes(3);
  });

  it('records the mention against the document, and lets a failure pass quietly', async () => {
    notifyOnlyOfficeMention.mockRejectedValue(new Error('offline'));
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));
    mountPreview();
    await flushPromises();

    const actionLink = { action: { type: 'comment', data: 'c-1' } };
    capturedConfig.events.onRequestSendNotify({
      data: { emails: ['bob@example.com'], actionLink, message: 'Can you check this?' },
    });
    await flushPromises();

    expect(notifyOnlyOfficeMention).toHaveBeenCalledWith('report.docx', {
      emails: ['bob@example.com'],
      actionLink,
      comment: 'Can you check this?',
    });
    expect(logger.debug).toHaveBeenCalledWith(
      'ONLYOFFICE mention could not be recorded',
      expect.any(Error)
    );
  });
});

/**
 * A document that does not open leaves no trace in NextExplorer unless the
 * preview writes one down, and one that never configures leaves a spinner
 * unless the reason is shown.
 */
describe('what goes wrong in the editor', () => {
  it('records the errors and warnings the editor reports, codes of zero included', async () => {
    fetchOnlyOfficeConfig.mockResolvedValue(configResponse('session-1'));
    mountPreview();
    await flushPromises();

    capturedConfig.events.onError({
      data: { errorCode: -4, errorDescription: 'Download failed.' },
    });
    capturedConfig.events.onWarning({
      data: { warningCode: 0, warningDescription: 'Connection is slow.' },
    });
    capturedConfig.events.onError({});

    expect(logger.error).toHaveBeenCalledWith('ONLYOFFICE editor error', {
      path: 'report.docx',
      code: -4,
      description: 'Download failed.',
    });
    expect(logger.warn).toHaveBeenCalledWith('ONLYOFFICE editor warning', {
      path: 'report.docx',
      code: 0,
      description: 'Connection is slow.',
    });
    expect(logger.error).toHaveBeenCalledWith('ONLYOFFICE editor error', {
      path: 'report.docx',
      code: null,
      description: null,
    });
  });

  it('shows why the editor could not be configured, instead of loading forever', async () => {
    fetchOnlyOfficeConfig.mockRejectedValue(
      new Error('ONLYOFFICE_URL is not configured on the server.')
    );
    const previewState = {};
    const wrapper = mountPreview({ previewState });
    await flushPromises();

    expect(fetchOnlyOfficeConfig).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toBe('ONLYOFFICE_URL is not configured on the server.');
    expect(capturedConfig).toBeNull();
    // No editor chrome, so the floating close button stays.
    expect(previewState.hasNativeClose).toBe(false);
  });

  it('shows a reason even when the failure gives none', async () => {
    fetchOnlyOfficeConfig.mockRejectedValue({});
    const wrapper = mountPreview();
    await flushPromises();

    expect(wrapper.text()).toBe('Failed to initialize ONLYOFFICE.');
  });
});

describe('another document in the same preview', () => {
  it('opens the new path, and binds the session to it', async () => {
    fetchOnlyOfficeConfig
      .mockResolvedValueOnce(configResponse('session-1'))
      .mockResolvedValueOnce(configResponse('session-2'));
    const previewState = {};
    const wrapper = mountPreview({ filePath: 'Docs/report.docx', previewState });
    await flushPromises();

    await wrapper.setProps({ filePath: 'Docs/budget.xlsx' });
    await flushPromises();

    expect(fetchOnlyOfficeConfig).toHaveBeenLastCalledWith('Docs/budget.xlsx', 'edit', {
      theme: 'light',
    });
    expect(previewState).toMatchObject({
      documentPath: 'Docs/budget.xlsx',
      forceSaveSessionId: 'session-2',
    });
  });
});
