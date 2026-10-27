import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

/**
 * Which viewer opens a file, and what happens when it closes.
 *
 * This is the registry the whole preview layer hangs off — image, video, audio,
 * PDF, Markdown, ONLYOFFICE, Collabora — and it sat at 1%. Three things in it
 * are worth more than the rest put together:
 *
 * A plugin that throws while deciding whether it matches must not take the
 * preview down with it; the next one still gets asked.
 *
 * `close()` awaits a hook that plugins use to flush unsaved work, so it is
 * asynchronous, and a *new* preview can be opened while the old one is still
 * closing. Closing must then leave the newer one alone.
 *
 * And priority decides ties. ONLYOFFICE and the built-in PDF viewer both claim
 * a .pdf; whichever sorts first is the one people actually get.
 */

const getPreviewUrl = vi.fn((p) => `https://files.example.com/api/preview?path=${p}`);
const downloadItems = vi.fn();
const fetchFileContent = vi.fn();
const routerPush = vi.fn();
let currentPathItems = [];

vi.mock('@/api', () => ({
  getPreviewUrl: (...a) => getPreviewUrl(...a),
  downloadItems: (...a) => downloadItems(...a),
  fetchFileContent: (...a) => fetchFileContent(...a),
  normalizePath: (p = '') => String(p).replace(/^\/+|\/+$/g, ''),
}));
vi.mock('@/stores/fileStore', () => ({
  useFileStore: () => ({
    get getCurrentPathItems() {
      return currentPathItems;
    },
  }),
}));
vi.mock('@/router', () => ({ default: { push: (...a) => routerPush(...a) } }));

import { usePreviewManager } from './manager';

const plugin = (id, overrides = {}) => ({
  id,
  match: () => true,
  component: () => Promise.resolve({}),
  ...overrides,
});

const IMAGE = { name: 'photo.jpg', path: 'Media', kind: 'jpg' };

beforeEach(() => {
  setActivePinia(createPinia());
  [getPreviewUrl, downloadItems, fetchFileContent, routerPush].forEach((m) => m.mockClear());
  currentPathItems = [];
});

describe('the register', () => {
  it('opens nothing when no plugin claims the file', () => {
    const manager = usePreviewManager();
    manager.register(plugin('nothing', { match: () => false }));

    expect(manager.open(IMAGE)).toBe(false);
    expect(manager.isOpen).toBe(false);
  });

  it('ignores a plugin with no id, which could never be unregistered', () => {
    const manager = usePreviewManager();

    manager.register({ match: () => true });

    expect(manager.open(IMAGE)).toBe(false);
  });

  /** Registering the same id twice is a reload, not a duplicate. */
  it('replaces a plugin registered under an id already in use', () => {
    const manager = usePreviewManager();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    manager.register(plugin('image', { match: first }));
    manager.register(plugin('image', { match: second }));

    manager.open(IMAGE);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('unregisters by id', () => {
    const manager = usePreviewManager();
    manager.register(plugin('image'));

    manager.unregister('image');

    expect(manager.open(IMAGE)).toBe(false);
  });

  it('gives the higher priority the file when two claim it', () => {
    const manager = usePreviewManager();
    manager.register(plugin('builtin-pdf', { priority: 25 }));
    manager.register(plugin('onlyoffice', { priority: 90 }));

    manager.open(IMAGE);

    expect(manager.activePlugin.id).toBe('onlyoffice');
  });

  it('breaks a tie by id, so the choice is at least the same every time', () => {
    const manager = usePreviewManager();
    manager.register(plugin('zebra', { priority: 10 }));
    manager.register(plugin('alpha', { priority: 10 }));

    manager.open(IMAGE);

    expect(manager.activePlugin.id).toBe('alpha');
  });

  it('treats a plugin with no priority as the lowest', () => {
    const manager = usePreviewManager();
    manager.register(plugin('unranked'));
    manager.register(plugin('ranked', { priority: 1 }));

    manager.open(IMAGE);

    expect(manager.activePlugin.id).toBe('ranked');
  });

  /**
   * A third-party plugin is a third party's bug. One that throws while matching
   * must not stop the file opening in something else.
   */
  it('keeps asking the others when one throws while matching', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = usePreviewManager();
    manager.register(
      plugin('broken', {
        priority: 99,
        match: () => {
          throw new Error('bad plugin');
        },
      })
    );
    manager.register(plugin('image', { priority: 1 }));

    expect(manager.open(IMAGE)).toBe(true);
    expect(manager.activePlugin.id).toBe('image');
    vi.restoreAllMocks();
  });
});

describe('what a plugin is handed', () => {
  const contextFor = (item) => {
    const manager = usePreviewManager();
    let seen = null;
    manager.register(
      plugin('spy', {
        match: (context) => {
          seen = context;
          return true;
        },
      })
    );
    manager.open(item);
    return { manager, context: seen };
  };

  it('the extension, from the kind the listing gave', () => {
    expect(contextFor(IMAGE).context.extension).toBe('jpg');
  });

  it('the extension from the name when the kind is missing', () => {
    expect(contextFor({ name: 'photo.PNG', path: 'Media' }).context.extension).toBe('png');
  });

  /** A folder has a kind of its own; treating it as an extension matches nothing. */
  it('no extension at all for a directory', () => {
    expect(contextFor({ name: 'Media', path: '', kind: 'directory' }).context.extension).toBe('');
  });

  it('an empty extension for a name with no dot', () => {
    expect(contextFor({ name: 'LICENSE', path: 'Docs' }).context.extension).toBe('');
  });

  it('the full path, joined from the parent and the name', () => {
    expect(contextFor(IMAGE).context.filePath).toBe('Media/photo.jpg');
  });

  it('a copy of the item, not the listing’s own object', () => {
    const { context } = contextFor(IMAGE);

    expect(context.item).not.toBe(IMAGE);
    expect(context.item).toEqual(IMAGE);
  });

  it('a place to keep state a lifecycle hook will need later', () => {
    expect(contextFor(IMAGE).context.previewState).toEqual({});
  });
});

describe('the api handed to a plugin', () => {
  const apiFor = (item = IMAGE) => {
    const manager = usePreviewManager();
    let api = null;
    manager.register(
      plugin('spy', {
        match: (context) => {
          api = context.api;
          return true;
        },
      })
    );
    manager.open(item);
    return { manager, api };
  };

  it('builds a preview url for the file', () => {
    apiFor().api.getPreviewUrl();

    expect(getPreviewUrl).toHaveBeenCalledWith('Media/photo.jpg');
  });

  it('builds one for a neighbour when a gallery asks', () => {
    apiFor().api.getPreviewUrl({ name: 'other.jpg', path: 'Media' });

    expect(getPreviewUrl).toHaveBeenLastCalledWith('Media/other.jpg');
  });

  it('hands back the folder’s items so a gallery can step through them', () => {
    currentPathItems = [IMAGE, { name: 'b.jpg', path: 'Media' }];

    expect(apiFor().api.getSiblings()).toHaveLength(2);
  });

  /** `#` in a filename is a fragment unless every segment is encoded. */
  it('encodes each path segment when routing to the editor', () => {
    apiFor({ name: 'notes #1.md', path: 'Docs/My Folder' }).api.openEditor();

    expect(routerPush).toHaveBeenCalledWith({
      path: '/editor/Docs/My%20Folder/notes%20%231.md',
    });
  });

  it('closes the preview through the same door as everything else', async () => {
    const { manager, api } = apiFor();

    await api.close();

    expect(manager.isOpen).toBe(false);
  });
});

describe('opening and closing', () => {
  it('runs the open hook, and survives it throwing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = usePreviewManager();
    manager.register(
      plugin('image', {
        onOpen: () => {
          throw new Error('hook exploded');
        },
      })
    );

    expect(manager.open(IMAGE)).toBe(true);
    expect(manager.isOpen).toBe(true);
    vi.restoreAllMocks();
  });

  it('waits for the hook a plugin uses to flush unsaved work', async () => {
    const manager = usePreviewManager();
    let flushed = false;
    manager.register(
      plugin('office', {
        onBeforeClose: async () => {
          await Promise.resolve();
          flushed = true;
        },
      })
    );
    manager.open(IMAGE);

    await manager.close();

    expect(flushed).toBe(true);
    expect(manager.isOpen).toBe(false);
  });

  /** A preview that cannot be closed is a trapped user. */
  it('closes anyway when that hook rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = usePreviewManager();
    manager.register(plugin('office', { onBeforeClose: () => Promise.reject(new Error('no')) }));
    manager.open(IMAGE);

    await manager.close();

    expect(manager.isOpen).toBe(false);
    vi.restoreAllMocks();
  });

  it('closes anyway when the close hook throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = usePreviewManager();
    manager.register(
      plugin('image', {
        onClose: () => {
          throw new Error('boom');
        },
      })
    );
    manager.open(IMAGE);

    await manager.close();

    expect(manager.isOpen).toBe(false);
    vi.restoreAllMocks();
  });

  /**
   * The race this exists for: somebody closes a document, the flush is still in
   * flight, and they open the next file. When the flush finishes it must not
   * close what they are now looking at.
   */
  it('does not close a preview opened while the previous one was still closing', async () => {
    const manager = usePreviewManager();
    let release;
    manager.register(
      plugin('office', {
        priority: 5,
        match: (c) => c.extension === 'docx',
        onBeforeClose: () => new Promise((resolve) => (release = resolve)),
      })
    );
    manager.register(plugin('image', { priority: 5, match: (c) => c.extension === 'jpg' }));

    manager.open({ name: 'report.docx', path: 'Docs', kind: 'docx' });
    const closing = manager.close();
    manager.open(IMAGE);

    release();
    await closing;

    expect(manager.isOpen).toBe(true);
    expect(manager.activePlugin.id).toBe('image');
  });

  /**
   * Closing twice — a click and the Escape key arriving together — must not run
   * the flush hook twice. Pinia wraps actions, so the two calls do not return
   * the identical promise; what matters is that the work happens once.
   */
  it('runs the close hooks once when close is called twice', async () => {
    const manager = usePreviewManager();
    const beforeClose = vi.fn(() => Promise.resolve());
    const onClose = vi.fn();
    manager.register(plugin('office', { onBeforeClose: beforeClose, onClose }));
    manager.open(IMAGE);

    await Promise.all([manager.close(), manager.close()]);

    expect(beforeClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closing when nothing is open is harmless', () => {
    const manager = usePreviewManager();

    expect(() => manager.close()).not.toThrow();
  });
});

/**
 * A page that is going away gives a handler one synchronous moment.
 *
 * Nothing chained after a request will run, and nothing this store clears will
 * matter — the store is about to stop existing. So closing on the way out is a
 * different call from closing in a browser that is staying, and the difference
 * is exactly what the plugin is told, so it can send what it has to send in
 * one breath.
 */
describe('the page going away', () => {
  it('tells the plugin it is unloading, and leaves the state alone', () => {
    const manager = usePreviewManager();
    const beforeClose = vi.fn();
    manager.register(plugin('office', { onBeforeClose: beforeClose }));
    manager.open(IMAGE);

    expect(manager.endForUnload()).toBe(true);

    expect(beforeClose).toHaveBeenCalledTimes(1);
    expect(beforeClose.mock.calls[0][1]).toEqual({ unloading: true });
    // Untouched: clearing it here would risk cancelling the very request the
    // plugin has just handed to the browser.
    expect(manager.isOpen).toBe(true);
  });

  it('says so when the closing panel is the ordinary one', async () => {
    const manager = usePreviewManager();
    const beforeClose = vi.fn();
    manager.register(plugin('office', { onBeforeClose: beforeClose }));
    manager.open(IMAGE);

    await manager.close();

    // The same hook, told it has time. A plugin that could not tell the two
    // apart would have to assume the worst on every close.
    expect(beforeClose.mock.calls[0][1]).toEqual({ unloading: false });
  });

  it('is harmless with nothing open, and survives a plugin that throws', () => {
    const manager = usePreviewManager();

    expect(manager.endForUnload()).toBe(false);

    manager.register(
      plugin('office', {
        onBeforeClose: () => {
          throw new Error('no');
        },
      })
    );
    manager.open(IMAGE);

    expect(() => manager.endForUnload()).not.toThrow();
  });
});
