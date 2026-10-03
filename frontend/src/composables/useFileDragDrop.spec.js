import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const copyItems = vi.fn();
const moveItems = vi.fn();
const fetchPathItems = vi.fn();
const scheduleUsageRefresh = vi.fn();
const scheduleFolderRefresh = vi.fn();
const startOperation = vi.fn(() => 'operation-test');
const updateOperation = vi.fn();
const finishOperation = vi.fn();
const requestConfirmation = vi.fn(() => Promise.resolve(true));

/**
 * The other pane, as a folder with its own listing and its own read.
 *
 * Not a spy on the store: the destination of a drag between panes is a folder
 * that is on screen and is not the one the drag came from, and nothing about
 * that is visible through a surface that follows the tab in front.
 */
const fetchInBeside = vi.fn();
const paneBeside = {
  path: { value: 'Destination' },
  fetchItems: fetchInBeside,
};

const fileStore = {
  currentPath: 'Source',
  currentPathItems: [],
  selectedItems: [],
  fetchPathItems,
  folderFor: (id) =>
    id === 'tab-beside' ? paneBeside : { path: { value: 'Source' }, fetchItems: vi.fn() },
  warnAboutOnlyOfficeActivity: vi.fn(() => false),
};

/** One pane, or two: what is on screen and which of them the reader is in. */
const appTabs = { panes: ['tab-here'], activeId: 'tab-here' };

vi.mock('@/api', () => ({
  copyItems: (...args) => copyItems(...args),
  moveItems: (...args) => moveItems(...args),
  normalizePath: (value = '') => value.replace(/^\/+|\/+$/g, ''),
}));

vi.mock('@/stores/fileStore', () => ({ useFileStore: () => fileStore }));
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => appTabs }));
vi.mock('@/stores/volumeUsage', () => ({
  useVolumeUsageStore: () => ({ scheduleRefresh: scheduleUsageRefresh }),
}));
vi.mock('@/stores/folderSize', () => ({
  useFolderSizeStore: () => ({ scheduleRefresh: scheduleFolderRefresh }),
}));
vi.mock('@/stores/operationTasks', () => ({
  useOperationTasksStore: () => ({ startOperation, updateOperation, finishOperation }),
}));
vi.mock('@/composables/useInputMode', () => ({
  useInputMode: () => ({ isTouchDevice: ref(false) }),
}));
vi.mock('@/composables/useOnlyOfficeTransferConfirm', () => ({
  useOnlyOfficeTransferConfirm: () => ({ requestConfirmation }),
}));

import { useFileDragDrop } from '@/composables/useFileDragDrop';

const item = { name: 'report.txt', path: 'Source', kind: 'file' };
const target = { name: 'Target', path: 'Volume', kind: 'directory' };

const transferEvent = (overrides = {}) => {
  const payload = JSON.stringify([item]);
  const dataTransfer = {
    types: ['application/json', 'text/plain'],
    dropEffect: 'move',
    getData: vi.fn((type) => (type === 'application/json' ? payload : '')),
    ...overrides.dataTransfer,
  };

  return {
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
    ...overrides,
  };
};

describe('useFileDragDrop', () => {
  beforeEach(() => {
    copyItems.mockReset();
    moveItems.mockReset();
    fetchPathItems.mockReset();
    fetchInBeside.mockReset();
    appTabs.panes = ['tab-here'];
    appTabs.activeId = 'tab-here';
    paneBeside.path.value = 'Destination';
    scheduleUsageRefresh.mockReset();
    scheduleFolderRefresh.mockReset();
    startOperation.mockClear();
    updateOperation.mockReset();
    finishOperation.mockReset();
    requestConfirmation.mockReset();
    requestConfirmation.mockResolvedValue(true);
    fileStore.currentPathItems = [];
    copyItems.mockResolvedValue({});
    moveItems.mockResolvedValue({});
  });

  it('uses copy for an Option/Alt drop and exposes the copy target state', async () => {
    const dragDrop = useFileDragDrop();
    const event = transferEvent({ altKey: true });

    dragDrop.handleDragOver(event, target);
    expect(event.dataTransfer.dropEffect).toBe('copy');
    expect(dragDrop.isCopyDragTarget(target)).toBe(true);

    await dragDrop.handleDrop(event, target);

    expect(copyItems).toHaveBeenCalledWith(
      [{ name: 'report.txt', path: 'Source', kind: 'file' }],
      'Volume/Target',
      expect.objectContaining({ onEvent: expect.any(Function), signal: expect.any(AbortSignal) })
    );
    expect(moveItems).not.toHaveBeenCalled();
    expect(startOperation).toHaveBeenCalledWith(expect.objectContaining({ type: 'copy' }));
    expect(finishOperation).toHaveBeenCalledWith('operation-test');
  });

  it('moves by default', async () => {
    const dragDrop = useFileDragDrop();
    const event = transferEvent();

    await dragDrop.handleDrop(event, target);

    expect(moveItems).toHaveBeenCalledWith(
      [{ name: 'report.txt', path: 'Source', kind: 'file' }],
      'Volume/Target',
      expect.objectContaining({ onEvent: expect.any(Function), signal: expect.any(AbortSignal) })
    );
    expect(copyItems).not.toHaveBeenCalled();
    expect(startOperation).toHaveBeenCalledWith(expect.objectContaining({ type: 'move' }));
  });

  /**
   * The folder the files arrived in, read again.
   *
   * With one pane this never mattered: the destination was somewhere else — a
   * tab behind, a favourite, a folder in the listing — and the reader walked
   * there afterwards, which read it. With two panes the destination is usually
   * the other half of the window, and nothing was telling it anything had
   * happened: the files left one side and appeared on neither.
   */
  it('reads the other pane again when that is where the files went', async () => {
    appTabs.panes = ['tab-here', 'tab-beside'];
    paneBeside.path.value = 'Volume/Target';
    const dragDrop = useFileDragDrop();

    await dragDrop.handleDrop(transferEvent(), target);

    expect(fetchInBeside).toHaveBeenCalledWith('Volume/Target', { preserveInteraction: true });
  });

  /** And not when it is showing something else: that pane did not change. */
  it('leaves a pane alone when the files went somewhere it is not', async () => {
    appTabs.panes = ['tab-here', 'tab-beside'];
    paneBeside.path.value = 'Somewhere/Else';
    const dragDrop = useFileDragDrop();

    await dragDrop.handleDrop(transferEvent(), target);

    expect(fetchInBeside).not.toHaveBeenCalled();
  });

  it('warns before moving a document currently edited in OnlyOffice', async () => {
    fileStore.currentPathItems = [
      {
        ...item,
        onlyofficeActivity: { active: true, users: ['Admin'], count: 1 },
      },
    ];
    const dragDrop = useFileDragDrop();
    const event = transferEvent();

    await dragDrop.handleDrop(event, target);

    expect(requestConfirmation).toHaveBeenCalledWith([
      expect.objectContaining({ onlyofficeActivity: expect.objectContaining({ active: true }) }),
    ]);
    expect(moveItems).toHaveBeenCalled();
  });

  it('does not move an edited document when its warning is cancelled', async () => {
    fileStore.currentPathItems = [
      {
        ...item,
        onlyofficeActivity: { active: true, users: ['Admin'], count: 1 },
      },
    ];
    requestConfirmation.mockResolvedValue(false);

    const dragDrop = useFileDragDrop();
    await dragDrop.handleDrop(transferEvent(), target);

    expect(moveItems).not.toHaveBeenCalled();
    expect(startOperation).not.toHaveBeenCalled();
  });

  it('uses a favorite destination path instead of its display label', async () => {
    const dragDrop = useFileDragDrop();
    const event = transferEvent();
    const favoriteTarget = {
      name: 'Inbox',
      path: 'Volume',
      destinationPath: 'Volume/Incoming',
    };

    await dragDrop.handleDrop(event, favoriteTarget);

    expect(moveItems).toHaveBeenCalledWith(
      [{ name: 'report.txt', path: 'Source', kind: 'file' }],
      'Volume/Incoming',
      expect.any(Object)
    );
  });

  it('uses a native copy operation while keeping the native drag preview', () => {
    vi.useFakeTimers();
    const dragDrop = useFileDragDrop();
    const source = document.createElement('div');
    source.innerHTML = '<span class="block aspect-square"><svg></svg></span>';
    document.body.appendChild(source);
    const dataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
      types: ['application/json'],
      dropEffect: 'move',
    };

    dragDrop.handleDragStart(
      { altKey: false, clientX: 100, clientY: 200, currentTarget: source, dataTransfer },
      item
    );
    dragDrop.handleDragOver(
      {
        altKey: true,
        clientX: 140,
        clientY: 260,
        preventDefault: vi.fn(),
        dataTransfer,
      },
      target
    );

    expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
    expect(dataTransfer.effectAllowed).toBe('copyMove');
    expect(dataTransfer.dropEffect).toBe('copy');

    dragDrop.handleDragEnd();
    vi.advanceTimersByTime(100);
    expect(document.querySelector('.file-drag-image')).toBeNull();
    vi.useRealTimers();
    source.remove();
  });

  it('copies into the current folder when Option/Alt is held', async () => {
    const dragDrop = useFileDragDrop();
    const event = transferEvent({ altKey: true });

    await dragDrop.handleDrop(event, { destinationPath: 'Source', kind: 'directory' });

    expect(copyItems).toHaveBeenCalledWith(
      [{ name: 'report.txt', path: 'Source', kind: 'file' }],
      'Source',
      expect.any(Object)
    );
    expect(moveItems).not.toHaveBeenCalled();
  });

  it('keeps the copy operation when the terminal drop event omits Option/Alt', async () => {
    const dragDrop = useFileDragDrop();
    const source = document.createElement('div');
    const dataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
      effectAllowed: '',
      types: ['application/json', 'text/plain'],
      dropEffect: 'move',
      getData: vi.fn((type) => (type === 'application/json' ? JSON.stringify([item]) : '')),
    };

    document.body.appendChild(source);
    dragDrop.handleDragStart({ altKey: false, currentTarget: source, dataTransfer }, item);
    dragDrop.handleDragOver({ altKey: true, preventDefault: vi.fn(), dataTransfer }, target);

    await dragDrop.handleDrop(
      { altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer },
      target
    );

    expect(copyItems).toHaveBeenCalledWith(
      [{ name: 'report.txt', path: 'Source', kind: 'file' }],
      'Volume/Target',
      expect.any(Object)
    );
    expect(moveItems).not.toHaveBeenCalled();
    source.remove();
  });
});
