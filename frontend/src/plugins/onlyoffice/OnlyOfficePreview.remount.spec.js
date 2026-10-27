import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

/**
 * Opening the document again over the top of itself — coming back from the
 * version history, above all.
 *
 * The editor is not a component that redraws. The Document Server's script
 * takes the element it is given out of the document and puts its own iframe
 * where it stood, so the element Vue holds for that component is no longer in
 * the tree. Ask Vue to swap that branch — which is what rebuilding by
 * clearing the configuration does — and it anchors on a node with no parent:
 * `insertBefore` on null, the component update throws, and nothing renders
 * again. An empty panel, and nothing anywhere saying why.
 *
 * That was measured against a real Document Server before it was written
 * down, and so was the way out: hand the component a new configuration and it
 * rebuilds the editor itself, in place, while Vue renders nothing.
 *
 * The stub below is the library's real contract rather than an empty `<div>`:
 * the asynchronous attach, the registry it refuses to attach twice into,
 * `destroyEditor` on the way out, and the watcher that rebuilds in place when
 * the configuration changes under a mounted editor.
 */

const fetchOnlyOfficeConfig = vi.fn();
const heartbeatOnlyOfficeSession = vi.fn();
const fetchOnlyOfficeHistory = vi.fn();
const fetchOnlyOfficeHistoryData = vi.fn();
const features = { versionsEnabled: true };

vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));
vi.mock('@/stores/versionsPanel', async () => {
  const { reactive: r } = await import('vue');
  const store = r({ restored: 0, relativePath: '', markRestored: () => {} });
  return { useVersionsPanelStore: () => store };
});
vi.mock('@/api', () => ({
  fetchOnlyOfficeConfig: (...args) => fetchOnlyOfficeConfig(...args),
  fetchOnlyOfficeHistory: (...args) => fetchOnlyOfficeHistory(...args),
  fetchOnlyOfficeHistoryData: (...args) => fetchOnlyOfficeHistoryData(...args),
  heartbeatOnlyOfficeSession: (...args) => heartbeatOnlyOfficeSession(...args),
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
  restoreVersion: vi.fn(),
  requestOnlyOfficeForceSave: vi.fn(),
  endOnlyOfficeSession: vi.fn(),
  renameOnlyOfficeDocument: vi.fn(),
  saveOnlyOfficeDocumentAs: vi.fn(),
  fetchOnlyOfficeStorageFile: vi.fn(),
  fetchOnlyOfficeMentionUsers: vi.fn(),
  notifyOnlyOfficeMention: vi.fn(),
  browse: vi.fn(() => Promise.resolve({ items: [], path: '' })),
}));
vi.mock('@/stores/fileStore', () => ({
  useFileStore: () => ({ currentPath: 'Docs', fetchPathItems: vi.fn() }),
}));
vi.mock('@/stores/notifications', () => ({
  useNotificationsStore: () => ({ addNotification: vi.fn() }),
}));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => ({ isDark: false }) }));
vi.mock('@/plugins/preview/manager', () => ({ usePreviewManager: () => ({ close: vi.fn() }) }));
vi.mock('@/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** Every element the stub has ever attached to, in order. */
let attached = [];
/** Ids it refused to attach to because the registry still held one. */
let refused = [];
/** How many times Vue took the editor component down. */
let unmounts = 0;

vi.mock('@onlyoffice/document-editor-vue', () => ({
  DocumentEditor: defineComponent({
    name: 'DocumentEditor',
    props: {
      id: { type: String, default: '' },
      config: { type: Object, default: null },
      documentServerUrl: { type: String, default: '' },
    },
    methods: {
      // `onLoad`, reached from `mounted` through `loadScript(...).then(...)`:
      // never synchronous, even when the script is already in the page.
      attach() {
        const id = this.id;
        if (window.DocEditor?.instances?.[id]) {
          refused.push(id);
          return;
        }
        if (!window.DocEditor?.instances) window.DocEditor = { instances: {} };
        window.DocEditor.instances[id] = {
          destroyEditor: vi.fn(),
          refreshHistory: vi.fn(),
          setHistoryData: vi.fn(),
        };
        attached.push(id);
        this.config?.events?.onDocumentReady?.();
      },
    },
    mounted() {
      void Promise.resolve().then(() => this.attach());
    },
    unmounted() {
      unmounts += 1;
      const id = this.id;
      if (window.DocEditor?.instances?.[id]) {
        window.DocEditor.instances[id].destroyEditor();
        window.DocEditor.instances[id] = undefined;
      }
    },
    watch: {
      // The library's own `onChangeProps`: a new configuration under a mounted
      // editor destroys it and attaches a new one to the same element.
      config: {
        deep: true,
        handler() {
          const id = this.id;
          if (!window.DocEditor?.instances?.[id]) return;
          window.DocEditor.instances[id].destroyEditor();
          window.DocEditor.instances[id] = undefined;
          this.attach();
        },
      },
    },
    render() {
      return h('div');
    },
  }),
}));

let capturedConfig = null;
vi.mock('@/components/ShareDialog.vue', () => ({ default: { render: () => null } }));

import OnlyOfficePreview from './OnlyOfficePreview.vue';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} } });

const configResponse = () => ({
  documentServerUrl: 'https://ds.example.com',
  config: { document: { key: 'k', permissions: { edit: true } }, editorConfig: {} },
  forceSaveSessionId: 'session-1',
  autoSaveIntervalMs: 0,
});

let wrapper = null;
let previewState = null;
/** What Vue was told about, rather than what it threw at the test runner. */
let reported = [];

const open = async () => {
  previewState = reactive({});
  wrapper = mount(OnlyOfficePreview, {
    props: {
      item: { name: 'report.docx', path: 'Docs' },
      extension: 'docx',
      filePath: 'Docs/report.docx',
      previewUrl: '',
      previewState,
      api: {},
    },
    global: {
      plugins: [i18n],
      stubs: { ShareDialog: true, StoragePickerDialog: true },
      // A lifecycle hook that throws is reported and the render carries on —
      // which is what the built application does. Without a handler the
      // development build rethrows into the runner instead, and the test
      // would be measuring that rather than the editor.
      config: { errorHandler: (error) => reported.push(error) },
    },
  });
  await flushPromises();
  capturedConfig = wrapper.findComponent({ name: 'DocumentEditor' }).props('config');
  return wrapper;
};

beforeEach(() => {
  attached = [];
  refused = [];
  reported = [];
  unmounts = 0;
  window.DocEditor = { instances: {} };
  capturedConfig = null;
  // A fresh object per call, as a server answers: the library rebuilds on a
  // configuration that changed, and the same object twice has not changed.
  fetchOnlyOfficeConfig.mockReset().mockImplementation(async () => configResponse());
  heartbeatOnlyOfficeSession.mockReset().mockResolvedValue({ active: true });
  fetchOnlyOfficeHistory.mockReset().mockResolvedValue({ currentVersion: 1, history: [] });
});

afterEach(() => {
  try {
    wrapper?.unmount();
  } catch {
    // already gone
  }
  wrapper = null;
});

describe('leaving the version history', () => {
  it('rebuilds the editor where it stands, without Vue taking it down', async () => {
    await open();
    expect(attached).toEqual(['onlyoffice-Docs-report-docx-1']);
    // The editor has drawn its own chrome, so the floating way out stands down.
    expect(previewState.hasNativeClose).toBe(true);

    capturedConfig.events.onRequestHistory();
    await flushPromises();
    capturedConfig.events.onRequestHistoryClose();
    await flushPromises();

    // A second editor, on the same element, and Vue never unmounted anything:
    // it is the swap through Vue that walks into the detached node.
    expect(attached).toEqual(['onlyoffice-Docs-report-docx-1', 'onlyoffice-Docs-report-docx-1']);
    expect(unmounts).toBe(0);
    expect(refused).toEqual([]);
    expect(reported).toEqual([]);
    expect(previewState.hasNativeClose).toBe(true);
  });

  it('never leaves the editor on screen when the rebuild could not be had', async () => {
    // The configuration is what the rebuild is made of. Without it there is
    // nothing to put in place of the editor, and an error with no way to be
    // read is the blank panel again by another route.
    await open();
    fetchOnlyOfficeConfig.mockRejectedValueOnce(new Error('the document server is down'));

    capturedConfig.events.onRequestHistoryClose();
    await flushPromises();

    expect(wrapper.text()).toContain('the document server is down');
    expect(wrapper.findComponent({ name: 'DocumentEditor' }).exists()).toBe(false);
    // And the floating way out is back, since no editor is drawing one.
    expect(previewState.hasNativeClose).toBe(false);
  });

  it('still builds from nothing when there is no editor to rebuild', async () => {
    // A first open, another document, a version opened read-only: the
    // in-place path has no editor to hand a configuration to, so the ordinary
    // one runs and the element is a new one.
    await open();
    await wrapper.setProps({ filePath: 'Docs/other.docx' });
    await flushPromises();

    expect(unmounts).toBe(1);
    expect(attached).toEqual(['onlyoffice-Docs-report-docx-1', 'onlyoffice-Docs-other-docx-2']);
    expect(refused).toEqual([]);
  });
});
