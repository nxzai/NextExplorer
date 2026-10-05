import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Opening a document in a browser tab of its own.
 *
 * The request behind it is "let me keep documents open while I browse
 * elsewhere, several at a time" (nxzai/NextExplorer#303), and the answer is an
 * address rather than a tab bar inside the application: the browser already
 * has tabs, and a document with a URL can be opened in one, kept, linked to
 * and bookmarked.
 *
 * What is held here is that the preference decides for *every* kind of file
 * the same way. A preference that moved spreadsheets and not photographs would
 * be one nobody could predict, and it is the reason this is one decision in
 * one function rather than one per plugin.
 */

const push = vi.fn();
const resolve = vi.fn((target) => ({ href: `#${target.path}` }));
const previewOpen = vi.fn(() => true);
const findPlugin = vi.fn(() => ({ plugin: { id: 'image' }, context: {} }));
let userSettings = {};

vi.mock('vue-router', () => ({
  useRouter: () => ({ push, resolve, back: vi.fn(), forward: vi.fn() }),
  useRoute: () => ({ params: { path: 'Notes' } }),
}));

vi.mock('@/utils', () => ({ withViewTransition: (fn) => fn }));

vi.mock('@/plugins/preview/manager', () => ({
  usePreviewManager: () => ({
    open: (...args) => previewOpen(...args),
    findPlugin: (...args) => findPlugin(...args),
  }),
}));

vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({
    get userSettings() {
      return userSettings;
    },
  }),
}));

vi.mock('@/config/editor', () => ({
  isEditableExtension: (ext) => ['md', 'markdown', 'txt', 'js'].includes(ext),
}));

// This application's own tabs, which the preference means once they are on.
const tabsOpen = vi.fn(() => ({ id: 't2', path: '/open/Notes/notes.md' }));
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => ({ open: tabsOpen }) }));

import { useNavigation } from './navigation';

const opened = () => window.open.mock.calls.at(-1);

beforeEach(() => {
  push.mockClear();
  resolve.mockClear();
  previewOpen.mockClear();
  previewOpen.mockReturnValue(true);
  findPlugin.mockClear();
  findPlugin.mockReturnValue({ plugin: { id: 'image' }, context: {} });
  userSettings = { documentsOpenInNewTab: true };
  tabsOpen.mockClear();
  tabsOpen.mockReturnValue({ id: 't2', path: '/open/Notes/notes.md' });
  vi.stubGlobal('open', vi.fn());
});

describe('with the preference on', () => {
  it('gives every kind of document a tab of its own, at its own address', () => {
    const documents = [
      { kind: 'png', name: 'photo.png', path: 'Notes' },
      { kind: 'mp4', name: 'clip.mp4', path: 'Notes' },
      { kind: 'pdf', name: 'contract.pdf', path: 'Notes' },
      { kind: 'docx', name: 'report.docx', path: 'Notes' },
      { kind: 'xlsx', name: 'budget.xlsx', path: 'Notes' },
      { kind: 'zip', name: 'backup.zip', path: 'Notes' },
    ];

    for (const document of documents) {
      useNavigation().openItem(document);
      expect(opened()[0], `${document.name} did not open at its own address`).toBe(
        `#/open/Notes/${encodeURIComponent(document.name)}`
      );
      expect(opened()[1]).toBe('_blank');
      // Nothing may reach back into the page it was opened from.
      expect(opened()[2]).toBe('noopener');
    }

    // Nothing was opened over the folder, and nothing navigated away from it.
    expect(previewOpen).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('sends a file only the editor opens to the editor, in a tab as well', () => {
    findPlugin.mockReturnValue(null);

    useNavigation().openItem({ kind: 'js', name: 'build.js', path: 'Notes' });

    expect(opened()[0]).toBe('#/editor/Notes/build.js');
    expect(push).not.toHaveBeenCalled();
  });

  it('honours the markdown preference inside the new tab', () => {
    userSettings = { documentsOpenInNewTab: true, markdownOpensInEditor: true };

    useNavigation().openItem({ kind: 'md', name: 'notes.md', path: 'Notes' });

    // The editor rather than the preview, because that is what the other
    // preference says — and in a tab, because that is what this one says.
    expect(opened()[0]).toBe('#/editor/Notes/notes.md');
  });

  it('opens a document nothing can show over the folder, as it always did', () => {
    findPlugin.mockReturnValue(null);
    previewOpen.mockReturnValue(false);

    useNavigation().openItem({ kind: 'bin', name: 'firmware.bin', path: 'Notes' });

    // No preview, no editor: there is nothing to open in a tab, and opening an
    // empty one would be worse than the nothing that happens today.
    expect(window.open).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('leaves folders, volumes and personal folders alone', () => {
    const navigation = useNavigation();

    navigation.openItem({ kind: 'directory', name: 'Archive', path: 'Notes' });
    navigation.openItem({ kind: 'volume', name: 'Projects' });
    navigation.openItem({ kind: 'personal', name: 'mine' });

    // Browsing is not a document, and a tab per folder would be a browser full
    // of tabs before anybody opened anything.
    expect(window.open).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(3);
    expect(push).toHaveBeenNthCalledWith(1, { path: '/browse/Notes/Archive' });
  });

  it('escapes a name that would otherwise change the address', () => {
    useNavigation().openItem({ kind: 'png', name: 'a b#c?d.png', path: 'Notes' });

    expect(opened()[0]).toBe('#/open/Notes/a%20b%23c%3Fd.png');
  });
});

describe('with the preference off', () => {
  beforeEach(() => {
    userSettings = {};
  });

  it('opens over the folder, exactly as before', () => {
    const image = { kind: 'png', name: 'photo.png', path: 'Notes' };

    useNavigation().openItem(image);

    expect(previewOpen).toHaveBeenCalledWith(image);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('still falls through to the editor when nothing previews the file', () => {
    previewOpen.mockReturnValue(false);

    useNavigation().openItem({ kind: 'txt', name: 'notes.txt', path: 'Notes' });

    expect(push).toHaveBeenCalledWith({ path: '/editor/Notes/notes.txt' });
    expect(window.open).not.toHaveBeenCalled();
  });
});

/**
 * With this application's own tabs on, a document goes to its address.
 *
 * Never over the folder: the panel a preview opens in is `fixed` and lives in the
 * body, so it would stay on screen while somebody moved to another tab — a
 * document sitting over a folder it has nothing to do with. At an address it is
 * the tab's content, and leaving the tab closes it because leaving the route does.
 */
describe('with this application own tabs on', () => {
  it('becomes the tab it was opened from', () => {
    userSettings = { browseInTabs: true };

    useNavigation().openItem({ kind: 'md', name: 'notes.md', path: 'Notes' });

    expect(push).toHaveBeenCalledWith({ path: '/open/Notes/notes.md' });
    expect(tabsOpen).not.toHaveBeenCalled();
    expect(previewOpen).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('takes a tab of its own when that is what the account asked for', () => {
    userSettings = { browseInTabs: true, documentsOpenInNewTab: true };

    useNavigation().openItem({ kind: 'md', name: 'notes.md', path: 'Notes' });

    expect(tabsOpen).toHaveBeenCalledWith('/open/Notes/notes.md', { own: true });
    expect(push).toHaveBeenCalledWith({ path: '/open/Notes/notes.md' });
    expect(window.open).not.toHaveBeenCalled();
  });

  it('leaves a folder to the folder', () => {
    userSettings = { browseInTabs: true };

    useNavigation().openItem({ kind: 'directory', name: '2026', path: 'Notes' });

    expect(tabsOpen).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ path: '/browse/Notes/2026' });
  });

  /** A file with no preview and no editor has nowhere of its own to be taken to. */
  it('leaves a file nothing opens exactly where it was', () => {
    userSettings = { browseInTabs: true };
    findPlugin.mockReturnValue(null);

    useNavigation().openItem({ kind: 'bin', name: 'firmware.bin', path: 'Notes' });

    expect(tabsOpen).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
