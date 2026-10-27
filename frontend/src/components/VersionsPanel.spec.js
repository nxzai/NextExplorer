import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

/**
 * A file's history, as a person works with it.
 *
 * What it offers has to follow what the server allows — a version that cannot
 * be downloaded must not be offered as a copy either — and each action must act
 * on the version it was chosen for, of the file the panel is open on: the panel
 * is reused from file to file, and an answer that arrives late for the previous
 * one must not be shown as this one's.
 */

const api = vi.hoisted(() => ({
  getVersions: vi.fn(),
  getVersionDownloadUrl: vi.fn((path, id) => `/api/versions/${id}/content?path=${path}`),
  restoreVersion: vi.fn(async () => ({ status: 'saved' })),
  copyVersionTo: vi.fn(async () => ({ path: 'Archive/notes (v).md' })),
  replaceWithVersion: vi.fn(async () => ({ status: 'saved' })),
  updateVersion: vi.fn(async () => ({})),
  deleteVersions: vi.fn(async () => ({ deleted: 1 })),
}));

vi.mock('@/api', () => ({
  ...Object.fromEntries(Object.keys(api).map((name) => [name, (...args) => api[name](...args)])),
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
}));

const notifications = vi.hoisted(() => ({ addNotification: vi.fn() }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: () => notifications }));

const fileStore = vi.hoisted(() => ({ currentPath: 'Docs', fetchPathItems: vi.fn() }));
vi.mock('@/stores/fileStore', () => ({ useFileStore: () => fileStore }));

const picker = vi.hoisted(() => ({ pick: vi.fn(), isOpen: { value: false } }));
vi.mock('@/composables/useDestinationPicker', () => ({ useDestinationPicker: () => picker }));

// Which preview opens a file is the preview manager's to say. Here a spreadsheet
// goes to an office editor that can show versions, and a .docx to none — the
// deployment with no office editor configured.
const previewManager = vi.hoisted(() => ({
  open: vi.fn(),
  findPlugin: vi.fn((item) =>
    item.kind === 'xlsx' ? { plugin: { id: 'onlyoffice-editor', supportsVersions: true } } : null
  ),
}));
vi.mock('@/plugins/preview/manager', () => ({ usePreviewManager: () => previewManager }));

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => router }));
/**
 * Where a comparison goes. Asked for when the gesture happens rather than at setup,
 * so this panel — which is on every page that can show a version — does not pull the
 * router's own `useRoute` into its module graph.
 */
const tabs = vi.hoisted(() => ({ enabled: true, open: vi.fn(() => ({ id: 'tab-2' })) }));
// Only the store is stood in for: the module also carries what a tab is and how many
// a row may hold, and other stores read those at import time.
vi.mock('@/stores/tabs', async (original) => ({
  ...(await original()),
  useTabsStore: () => tabs,
}));

const translate = (key, params) =>
  params && typeof params === 'object' ? `${key} ${JSON.stringify(params)}` : key;
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({ t: translate }),
}));

const VersionsPanel = (await import('./VersionsPanel.vue')).default;
const { useVersionsPanelStore } = await import('@/stores/versionsPanel');

const NOTES = { name: 'notes.md', path: 'Docs', kind: 'md' };

const version = (id, overrides = {}) => ({
  id,
  modifiedAt: '2026-09-14T09:00:00.000Z',
  size: 15,
  author: { id: 'u1', label: 'Alice' },
  source: 'editor',
  label: null,
  pinned: false,
  aside: false,
  available: true,
  ...overrides,
});

const ALL_RIGHTS = { see: true, download: true, restore: true, remove: true };

const history = (overrides = {}) => ({
  enabled: true,
  file: {
    path: 'Docs/notes.md',
    modifiedAt: '2026-09-14T10:00:00.000Z',
    size: 20,
    author: { id: 'u1', label: 'Alice' },
    source: 'editor',
  },
  versions: [version('v2'), version('v1', { label: 'Sent', pinned: true })],
  totalBytes: 30,
  rights: ALL_RIGHTS,
  ...overrides,
});

let wrapper = null;
let store = null;

const q = (selector) => document.body.querySelector(selector);
const qa = (selector) => Array.from(document.body.querySelectorAll(selector));
const rows = () => qa('[data-test="version-row"]');

const openOn = async (item = NOTES, response = history()) => {
  api.getVersions.mockResolvedValue(response);
  wrapper = mount(VersionsPanel, { attachTo: document.body });
  store = useVersionsPanelStore();
  store.open(item);
  await flushPromises();
};

const menuOf = async (index) => {
  rows()[index].querySelector('[data-test="version-menu"]').click();
  await flushPromises();
  return qa('[data-test^="version-action-"]').map((button) =>
    button.getAttribute('data-test').replace('version-action-', '')
  );
};

const act = async (index, action) => {
  await menuOf(index);
  q(`[data-test="version-action-${action}"]`).click();
  await flushPromises();
};

const confirm = async () => {
  q('[data-test="versions-confirm"]').click();
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.innerHTML = '';
  Object.values(api).forEach((fn) => fn.mockClear());
  api.restoreVersion.mockResolvedValue({ status: 'saved' });
  api.deleteVersions.mockResolvedValue({ deleted: 1 });
  notifications.addNotification.mockClear();
  fileStore.currentPath = 'Docs';
  fileStore.fetchPathItems.mockClear();
  picker.pick.mockReset();
  router.push.mockClear();
  tabs.open.mockClear();
  tabs.enabled = true;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('what it shows', () => {
  it('lists the versions of the file it is open on, as the server orders them', async () => {
    await openOn();

    expect(api.getVersions).toHaveBeenCalledWith('Docs/notes.md');
    expect(q('[data-test="versions-file-name"]').textContent.trim()).toBe('notes.md');
    expect(rows()).toHaveLength(2);
    expect(rows()[1].querySelector('[data-test="version-title"]').textContent.trim()).toBe('Sent');
    expect(rows()[1].querySelector('[data-test="version-pinned"]')).not.toBeNull();
    expect(rows()[0].querySelector('[data-test="version-pinned"]')).toBeNull();
    expect(q('[data-test="versions-total"]').textContent).toContain('"count":2');
  });

  it('marks a save set aside after a restore, and a version whose content is gone', async () => {
    await openOn(
      NOTES,
      history({
        versions: [version('v2', { aside: true }), version('v1', { available: false })],
      })
    );

    expect(rows()[0].querySelector('[data-test="version-aside"]')).not.toBeNull();
    expect(rows()[1].textContent).toContain('versions.unavailable');
  });

  it('names a visitor who came through a link, and a writer it does not know', async () => {
    await openOn(
      NOTES,
      history({
        versions: [
          version('v2', { author: { id: null, label: 'share-link' }, source: 'share-editor' }),
          version('v1', { author: null, source: 'onlyoffice' }),
        ],
      })
    );

    expect(rows()[0].textContent).toContain('versions.shareLink');
    expect(rows()[0].textContent).toContain('versions.source.shareEditor');
    expect(rows()[1].textContent).toContain('versions.unknownAuthor');
    expect(rows()[1].textContent).toContain('versions.source.onlyoffice');
  });

  it('says so when there is no earlier version yet', async () => {
    await openOn(NOTES, history({ versions: [], totalBytes: 0 }));

    expect(q('[data-test="versions-empty"]')).not.toBeNull();
    expect(q('[data-test="versions-delete-all"]')).toBeNull();
  });

  it('says versions are switched off, and still shows the ones kept', async () => {
    await openOn(NOTES, history({ enabled: false }));

    expect(q('[data-test="versions-disabled"]')).not.toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('says the history is not shared rather than showing an empty one', async () => {
    api.getVersions.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    wrapper = mount(VersionsPanel, { attachTo: document.body });
    useVersionsPanelStore().open(NOTES);
    await flushPromises();

    expect(q('[data-test="versions-error"]').textContent.trim()).toBe('versions.notShared');
    expect(rows()).toHaveLength(0);
  });

  it('shows the file it is open on now, not one whose answer arrived late', async () => {
    let answerFirst;
    api.getVersions.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)));
    wrapper = mount(VersionsPanel, { attachTo: document.body });
    store = useVersionsPanelStore();
    store.open(NOTES);
    await flushPromises();

    api.getVersions.mockResolvedValueOnce(history({ versions: [version('other')] }));
    store.open({ name: 'plan.md', path: 'Docs', kind: 'md' });
    await flushPromises();
    answerFirst(history());
    await flushPromises();

    expect(api.getVersions).toHaveBeenLastCalledWith('Docs/plan.md');
    expect(rows()).toHaveLength(1);
  });
});

describe('what it offers', () => {
  it('offers everything on a text file to someone who may do everything', async () => {
    await openOn();

    expect(await menuOf(0)).toEqual([
      'preview',
      'download',
      'restore',
      'restoreCopy',
      'replaceOther',
      'rename',
      'pin',
      'delete',
    ]);
  });

  it('offers no reading in the editor for a document it cannot show', async () => {
    await openOn({ name: 'report.docx', path: 'Docs', kind: 'docx' });

    expect(await menuOf(0)).not.toContain('preview');
  });

  it('offers neither download nor copy nor replace where versions may not be downloaded', async () => {
    await openOn(NOTES, history({ rights: { ...ALL_RIGHTS, download: false } }));

    const offered = await menuOf(0);
    expect(offered).not.toContain('download');
    expect(offered).not.toContain('restoreCopy');
    expect(offered).not.toContain('replaceOther');
    expect(offered).toContain('restore');
  });

  it('offers only looking to someone who may only read', async () => {
    await openOn(
      NOTES,
      history({ rights: { see: true, download: true, restore: false, remove: false } })
    );

    expect(await menuOf(0)).toEqual(['preview', 'download', 'restoreCopy', 'replaceOther']);
    expect(q('[data-test="version-select"]')).toBeNull();
    expect(q('[data-test="versions-delete-all"]')).toBeNull();
  });

  it('offers only deleting a version whose content is gone', async () => {
    await openOn(NOTES, history({ versions: [version('v1', { available: false })] }));

    expect(await menuOf(0)).toEqual(['rename', 'pin', 'delete']);
  });

  it('says unpin for a pinned version', async () => {
    await openOn();

    expect(await menuOf(1)).toContain('pin');
    expect(q('[data-test="version-action-pin"]').textContent.trim()).toBe('versions.actions.unpin');
  });
});

describe('restoring', () => {
  it('asks first, then puts the version back and tells what depends on it', async () => {
    await openOn();

    await act(0, 'restore');
    expect(api.restoreVersion).not.toHaveBeenCalled();
    expect(q('[data-test="versions-confirm-message"]').textContent).toContain('notes.md');

    await confirm();

    expect(api.restoreVersion).toHaveBeenCalledWith('Docs/notes.md', 'v2');
    expect(store.restored).toBe(1);
    expect(notifications.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', heading: 'versions.results.restored' })
    );
    expect(fileStore.fetchPathItems).toHaveBeenCalledWith('Docs');
    expect(api.getVersions).toHaveBeenCalledTimes(2);
  });

  it('says nothing changed when the file already had that content', async () => {
    api.restoreVersion.mockResolvedValue({ status: 'unchanged' });
    await openOn();

    await act(0, 'restore');
    await confirm();

    expect(notifications.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', heading: 'versions.results.unchanged' })
    );
  });

  it('leaves the listing of another folder alone', async () => {
    fileStore.currentPath = 'Elsewhere';
    await openOn();

    await act(0, 'restore');
    await confirm();

    expect(fileStore.fetchPathItems).not.toHaveBeenCalled();
  });

  it('says why it failed, and shows the history as it now is', async () => {
    api.restoreVersion.mockRejectedValue(new Error('This file cannot be changed.'));
    await openOn();

    await act(0, 'restore');
    await confirm();

    expect(notifications.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', body: 'This file cannot be changed.' })
    );
    expect(store.restored).toBe(0);
    expect(api.getVersions).toHaveBeenCalledTimes(2);
  });

  it('puts a copy in the folder chosen', async () => {
    picker.pick.mockResolvedValue('Archive');
    await openOn();

    await act(0, 'restoreCopy');

    expect(picker.pick).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'version-copy', from: 'Docs' })
    );
    expect(api.copyVersionTo).toHaveBeenCalledWith('Docs/notes.md', 'v2', 'Archive');
  });

  it('puts nothing anywhere when no folder was chosen', async () => {
    picker.pick.mockResolvedValue(null);
    await openOn();

    await act(0, 'restoreCopy');

    expect(api.copyVersionTo).not.toHaveBeenCalled();
  });

  it('puts the version over the file chosen, once confirmed', async () => {
    picker.pick.mockResolvedValue('Other/draft.md');
    await openOn();

    await act(1, 'replaceOther');
    expect(picker.pick).toHaveBeenCalledWith(expect.objectContaining({ mode: 'file' }));
    expect(api.replaceWithVersion).not.toHaveBeenCalled();

    await confirm();

    expect(api.replaceWithVersion).toHaveBeenCalledWith('Docs/notes.md', 'v1', 'Other/draft.md');
  });
});

describe('looking at a version of a document', () => {
  const SHEET = { name: 'budget.xlsx', path: 'Docs', kind: 'xlsx' };

  it('opens it read-only in the office editor, rather than in the text editor', async () => {
    await openOn(SHEET);

    await act(0, 'preview');

    expect(previewManager.open).toHaveBeenCalledWith({
      name: 'budget.xlsx',
      path: 'Docs',
      kind: 'xlsx',
      versionId: 'v2',
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(store.isOpen).toBe(false);
  });

  it('offers no reading through a preview that cannot show an earlier version', async () => {
    const usual = previewManager.findPlugin.getMockImplementation();
    previewManager.findPlugin.mockImplementation(() => ({ plugin: { id: 'image-viewer' } }));
    try {
      await openOn({ name: 'photo.png', path: 'Docs', kind: 'png' });

      expect(await menuOf(0)).not.toContain('preview');
    } finally {
      previewManager.findPlugin.mockImplementation(usual);
    }
  });

  it('offers no reading where no editor can show one', async () => {
    await openOn({ name: 'archive.zip', path: 'Docs', kind: 'zip' });

    expect(await menuOf(0)).not.toContain('preview');
  });
});

describe('looking at a version', () => {
  it('opens it read-only in the editor, and gets out of the way', async () => {
    await openOn();

    await act(0, 'preview');

    expect(router.push).toHaveBeenCalledWith({
      name: 'VersionFileViewer',
      params: { versionId: 'v2', path: 'Docs/notes.md' },
    });
    expect(store.isOpen).toBe(false);
  });

  it('downloads it from its own link', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openOn();

    await act(1, 'download');

    expect(api.getVersionDownloadUrl).toHaveBeenCalledWith('Docs/notes.md', 'v1');
    expect(click).toHaveBeenCalled();
    expect(click.mock.contexts.at(-1).getAttribute('href')).toBe(
      '/api/versions/v1/content?path=Docs/notes.md'
    );
    click.mockRestore();
  });
});

describe('naming and pinning', () => {
  it('names a version', async () => {
    await openOn();

    await act(0, 'rename');
    const field = q('[data-test="versions-name-input"]');
    field.value = '  Sent to the client ';
    field.dispatchEvent(new Event('input'));
    q('[data-test="versions-name-save"]').click();
    await flushPromises();

    expect(api.updateVersion).toHaveBeenCalledWith('Docs/notes.md', 'v2', {
      label: 'Sent to the client',
    });
  });

  it('pins a version, and unpins a pinned one', async () => {
    await openOn();

    await act(0, 'pin');
    expect(api.updateVersion).toHaveBeenLastCalledWith('Docs/notes.md', 'v2', { pinned: true });

    await act(1, 'pin');
    expect(api.updateVersion).toHaveBeenLastCalledWith('Docs/notes.md', 'v1', { pinned: false });
  });
});

describe('deleting', () => {
  it('deletes one version once confirmed', async () => {
    await openOn();

    await act(1, 'delete');
    expect(api.deleteVersions).not.toHaveBeenCalled();
    await confirm();

    expect(api.deleteVersions).toHaveBeenCalledWith('Docs/notes.md', { ids: ['v1'] });
  });

  it('deletes the versions selected', async () => {
    api.deleteVersions.mockResolvedValue({ deleted: 2 });
    await openOn();

    expect(q('[data-test="versions-delete-selected"]').disabled).toBe(true);
    for (const box of qa('[data-test="version-select"]')) box.click();
    await flushPromises();
    q('[data-test="versions-delete-selected"]').click();
    await flushPromises();
    await confirm();

    expect(api.deleteVersions).toHaveBeenCalledWith('Docs/notes.md', { ids: ['v2', 'v1'] });
    expect(notifications.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ heading: 'versions.results.deleted {"count":2}' })
    );
  });

  it('deletes them all, by asking the server for all rather than naming them', async () => {
    await openOn();

    q('[data-test="versions-delete-all"]').click();
    await flushPromises();
    await confirm();

    expect(api.deleteVersions).toHaveBeenCalledWith('Docs/notes.md', { all: true });
  });

  it('deletes nothing when the confirmation is cancelled', async () => {
    await openOn();

    q('[data-test="versions-delete-all"]').click();
    await flushPromises();
    qa('button')
      .find((button) => button.textContent.trim() === 'common.cancel')
      .click();
    await flushPromises();

    expect(api.deleteVersions).not.toHaveBeenCalled();
  });
});

describe('closing it', () => {
  it('closes an open menu first on Escape, then the panel', async () => {
    await openOn();
    await menuOf(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(q('[data-test^="version-action-"]')).toBeNull();
    expect(store.isOpen).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(store.isOpen).toBe(false);
  });

  it('leaves the panel open while one of its dialogs answers Escape', async () => {
    await openOn();
    await act(0, 'restore');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(store.isOpen).toBe(true);
  });
});
