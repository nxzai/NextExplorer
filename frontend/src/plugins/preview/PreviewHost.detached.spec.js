import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, onMounted, ref, nextTick, Teleport } from 'vue';

/**
 * Two documents whose viewers take their own elements out of the page.
 *
 * ONLYOFFICE does this: the Document Server's script is handed an element and
 * replaces it with an `iframe`, so the node Vue believes it owns is no longer in
 * the document. With one document on screen at a time this never showed —
 * everything around it was built and thrown away in one piece. With a surface per
 * tab, the host re-renders whenever another tab comes forward, and Vue walked into
 * a subtree whose elements had been taken away: "Cannot set properties of null".
 *
 * So the elements a plugin is given are never patched by anything above them
 * again: each surface is drawn once, and what changes around it — which one is in
 * front — changes nothing inside it.
 */

vi.mock('@/api', () => ({
  getPreviewUrl: (p) => `https://files.example.com/preview?path=${p}`,
  downloadItems: vi.fn(),
  fetchFileContent: vi.fn(),
  fetchMediaTracks: vi.fn(),
  getSubtitleUrl: vi.fn(),
  normalizePath: (p = '') => String(p).replace(/^\/+|\/+$/g, ''),
}));
vi.mock('@/stores/fileStore', () => ({ useFileStore: () => ({ getCurrentPathItems: [] }) }));
vi.mock('@/router', () => ({ default: { push: vi.fn() } }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

import PreviewHost from './PreviewHost.vue';
import { usePreviewManager } from './manager';
import { useTabsStore } from '@/stores/tabs';

/**
 * The shape ONLYOFFICE really has.
 *
 * The element the Document Server's script replaces is the root of a component
 * of its own — `<DocumentEditor>` — and it only appears once the configuration
 * has been fetched, so the viewer draws a loading line first and swaps it for the
 * editor after. Both matter: Vue updates a component by patching into
 * `parentNode` of what it rendered last time, and the last thing this one
 * rendered is a node the page no longer holds — so the parent is null and
 * anything mounted during that patch throws.
 */
const DocumentEditor = defineComponent({
  name: 'DocumentEditor',
  props: { config: { type: Object, required: true } },
  setup(props) {
    const host = ref(null);
    onMounted(() => {
      const frame = document.createElement('iframe');
      frame.dataset.document = props.config.document;
      host.value?.replaceWith(frame);
    });
    return () => h('div', { ref: host }, 'the editor');
  },
});

/** Set by the viewer as it mounts, so a test can make it rebuild in place. */
let reload = async () => {};

const DetachingViewer = defineComponent({
  name: 'DetachingViewer',
  props: {
    item: { type: Object, required: true },
    extension: { type: String, default: '' },
    filePath: { type: String, default: '' },
    previewUrl: { type: String, default: '' },
    previewState: { type: Object, default: () => ({}) },
    api: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const { previewState } = props;
    const config = ref(null);
    onMounted(async () => {
      // The configuration is fetched, so the editor is a tick late.
      await Promise.resolve();
      config.value = { document: props.filePath };
      await nextTick();
      // And once it has opened, it draws its own close button, which takes the
      // page's fallback one away — a change above an element that is already gone.
      Object.assign(previewState, { hasNativeClose: true });
    });
    // What `load({ inPlace: false })` does: the configuration is cleared, the
    // editor on screen is taken off by that very render, and a new one is built
    // once the answer comes back. A rename from the title bar does it, and so
    // does a document the server reports as outdated.
    reload = async () => {
      config.value = null;
      await nextTick();
      config.value = { document: `${props.filePath}#again` };
      await nextTick();
    };

    return () =>
      h('div', { class: 'h-full w-full' }, [
        config.value
          ? h(DocumentEditor, { key: props.filePath, config: config.value })
          : h('div', 'Loading ONLYOFFICE…'),
        // The dialogs the editor opens — sharing, and the picker it asks for a
        // file with — which teleport to the body and are siblings of the element
        // the editor took away. Patching that row of children is where Vue has to
        // find its place again, and the element it would look at is gone.
        h(Teleport, { to: 'body' }, [h('div', { class: 'share-dialog' })]),
        h(Teleport, { to: 'body' }, [h('div', { class: 'picker-dialog' })]),
      ]);
  },
});

const officePlugin = {
  id: 'office',
  minimalHeader: true,
  match: () => true,
  component: () => Promise.resolve({ default: DetachingViewer }),
};

const REPORT = { name: 'report.docx', path: 'Docs', kind: 'docx' };
const SHEET = { name: 'budget.xlsx', path: 'Docs', kind: 'xlsx' };

let wrapper = null;
let errors = [];

/** Two tabs, a document open in each, and the host drawing both. */
const twoDocuments = async () => {
  const tabs = useTabsStore();
  tabs.setEnabled(true);
  const manager = usePreviewManager();
  manager.register(officePlugin);
  const first = tabs.activeId;
  const second = tabs.open('/browse/Media').id;

  wrapper = mount(PreviewHost, {
    global: {
      mocks: { $t: (key) => key },
      config: { errorHandler: (error) => errors.push(error?.message || String(error)) },
    },
  });
  manager.openIn(first, REPORT);
  manager.openIn(second, SHEET);
  await flushPromises();
  await nextTick();
  return { tabs, manager, first, second };
};

beforeEach(() => {
  setActivePinia(createPinia());
  errors = [];
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('viewers that take their own element out of the page', () => {
  /**
   * One is enough, which says where this came from: the arrangement is older
   * than these tabs — it was the preview host's, when there was one document at a
   * time — and it fails the moment a viewer replaces its element. What tabs
   * changed is how often anyone meets it: two editors alive at once, each
   * redrawing while the other is on screen.
   */
  it('draws one alone, without the patch losing its place', async () => {
    const tabs = useTabsStore();
    const manager = usePreviewManager();
    manager.register(officePlugin);
    wrapper = mount(PreviewHost, {
      global: {
        mocks: { $t: (key) => key },
        config: { errorHandler: (error) => errors.push(error?.message || String(error)) },
      },
    });
    manager.openIn(tabs.activeId, REPORT);
    await flushPromises();
    await nextTick();

    expect(errors).toEqual([]);
    expect(document.body.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('both draw, each in its own tab', () => {
    return twoDocuments().then(() => {
      expect(document.body.querySelectorAll('iframe')).toHaveLength(2);
      expect(errors).toEqual([]);
    });
  });

  it('survive another tab coming forward, and going back', async () => {
    const { tabs, first, second } = await twoDocuments();

    tabs.activate(second);
    await nextTick();
    tabs.activate(first);
    await nextTick();

    expect(errors).toEqual([]);
    // Still the same two frames: nothing was rebuilt, and nothing was lost.
    expect(document.body.querySelectorAll('iframe')).toHaveLength(2);
  });

  it('survive one of them being closed', async () => {
    const { manager, first, second } = await twoDocuments();

    await manager.closeIn(second);
    await nextTick();

    expect(errors).toEqual([]);
    expect(manager.shows(first, REPORT)).toBe(true);
  });

  /**
   * The one the crash came from: a tab already holding an editor is handed
   * another document. Vue then has to take the first editor away — and what it
   * rendered last is a node the page no longer holds.
   */
  it('survive a second document opening in the same tab', async () => {
    const { manager, first } = await twoDocuments();

    manager.openIn(first, { name: 'other.docx', path: 'Docs', kind: 'docx' });
    await flushPromises();
    await nextTick();

    expect(errors).toEqual([]);
    expect(manager.shows(first, { name: 'other.docx', path: 'Docs', kind: 'docx' })).toBe(true);
  });

  it('survive a document closed and opened again in the same tab', async () => {
    const { manager, first } = await twoDocuments();

    await manager.closeIn(first);
    await nextTick();
    manager.openIn(first, REPORT);
    await flushPromises();
    await nextTick();

    expect(errors).toEqual([]);
  });

  /**
   * The editor rebuilt where it stands: the configuration is cleared and asked
   * for again, so the element on screen is taken off by that render and another
   * one takes its place. A rename from the title bar does this, and so does a
   * document the server reports as outdated.
   */
  it('survive the editor being rebuilt in place', async () => {
    await twoDocuments();

    await reload();
    await flushPromises();
    await nextTick();

    expect(errors).toEqual([]);
  });

  it('survive their tab being closed', async () => {
    const { tabs, second } = await twoDocuments();

    tabs.close(second);
    await nextTick();
    await flushPromises();

    expect(errors).toEqual([]);
  });
});
