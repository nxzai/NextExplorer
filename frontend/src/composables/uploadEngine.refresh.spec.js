import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What an upload does to the folder it landed in.
 *
 * It has to show the new file: the reader dropped it here and expects to see it.
 * What it must not do is take away what they were holding. A listing fetched
 * afresh clears the selection — that is what walking into a folder means — and
 * the upload's refresh is not a walk anywhere, it is this folder read again.
 *
 * The distance is what makes it bite: the refresh is deliberately deferred so a
 * folder of two hundred files produces one read rather than two hundred, and by
 * the time it fires the reader has had the better part of a second to choose
 * something. The browser suite found it the hard way — a file chosen, a share
 * button that went dead under the click, and thirty seconds of a test waiting
 * for a selection that had been thrown away by an upload from the test before.
 */

const handlers = new Map();
const uppyCalls = [];

// Everything a fake Uppy is asked for answers with a function, so this test does
// not have to keep a list of the engine's calls up to date; what it does keep is
// `on`, which is the one thing it has to be able to fire.
const makeUppy = () =>
  new Proxy(
    {
      on: (event, handler) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(handler);
      },
    },
    {
      get: (target, property) => {
        if (property in target) return target[property];
        return (...args) => {
          uppyCalls.push([String(property), ...args]);
          return undefined;
        };
      },
    }
  );

vi.mock('@uppy/core', () => ({
  default: class {
    constructor() {
      return makeUppy();
    }
  },
}));
vi.mock('@uppy/xhr-upload', () => ({ default: { name: 'XHRUpload' } }));
vi.mock('@uppy/tus', () => ({ default: { name: 'Tus' } }));

const fileStore = vi.hoisted(() => ({
  currentPath: 'Docs/2026',
  currentPathData: { canUpload: true },
  refresh: vi.fn(() => Promise.resolve()),
  fetchPathItems: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/stores/fileStore', () => ({ useFileStore: () => fileStore }));

vi.mock('@/stores/uppyStore', () => ({ useUppyStore: () => ({ uppy: null }) }));
vi.mock('@/stores/notifications', () => ({
  useNotificationsStore: () => ({ addNotification: vi.fn() }),
}));
vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({ state: { uploads: {} }, ensureLoaded: () => Promise.resolve() }),
}));
vi.mock('@/stores/volumeUsage', () => ({
  useVolumeUsageStore: () => ({ scheduleRefresh: vi.fn() }),
}));
vi.mock('@/stores/folderSize', () => ({
  useFolderSizeStore: () => ({ scheduleRefresh: vi.fn() }),
}));
vi.mock('@/stores/operationTasks', () => ({
  useOperationTasksStore: () => ({ start: vi.fn(), finish: vi.fn(), update: vi.fn() }),
}));

vi.mock('@/api', () => ({
  apiBase: '',
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
  reserveFolderUploadTarget: vi.fn(),
}));

import { createUploadEngine } from './uploadEngine';

const fire = async (event, ...args) => {
  for (const handler of handlers.get(event) || []) await handler(...args);
};

beforeEach(async () => {
  vi.useFakeTimers();
  handlers.clear();
  uppyCalls.length = 0;
  fileStore.refresh.mockClear();
  fileStore.fetchPathItems.mockClear();
  await createUploadEngine();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the listing an upload landed in', () => {
  it('is read again without clearing what the reader has selected', async () => {
    await fire('upload-success', { id: 'f1', name: 'dropped.txt' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fileStore.refresh).toHaveBeenCalled();
    // The other door is the one that clears it, and it is not this one.
    expect(fileStore.fetchPathItems).not.toHaveBeenCalled();
  });

  it('is read again the same way when a whole batch finishes', async () => {
    await fire('complete', { successful: [], failed: [] });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fileStore.refresh).toHaveBeenCalled();
    expect(fileStore.fetchPathItems).not.toHaveBeenCalled();
  });

  /**
   * One read for a folder of many files, which is why the refresh waits at all —
   * and why it lands late enough to matter.
   */
  it('is read once for a run of files arriving together', async () => {
    await fire('upload-success', { id: 'f1', name: 'a.txt' });
    await fire('upload-success', { id: 'f2', name: 'b.txt' });
    await fire('upload-success', { id: 'f3', name: 'c.txt' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fileStore.refresh).toHaveBeenCalledTimes(1);
  });
});
