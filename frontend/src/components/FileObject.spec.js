import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { useQuickActionsStore } from '@/stores/quickActions';

/**
 * One row of the folder.
 *
 * 150 statements at 5.66%, drawn once per item and holding two things worth
 * being sure of. The first is renaming: the box opens with the name selected up
 * to the extension, so typing replaces "rapport" and leaves ".docx" alone —
 * get that wrong and every rename silently drops or keeps the wrong part of the
 * name. The second is what a click means, which is not the same on a touch
 * screen as under a mouse: a tap opens, a click selects, and a long press that
 * has just opened the menu must not also be treated as a tap.
 */

const navigation = vi.hoisted(() => ({ openItem: vi.fn() }));
const selection = vi.hoisted(() => ({
  handleSelection: vi.fn(),
  toggleSelection: vi.fn(),
  isSelected: vi.fn(() => false),
}));
const contextMenu = vi.hoisted(() => ({ openItemMenu: vi.fn() }));
const dragDrop = vi.hoisted(() => ({
  canDragDrop: vi.fn(() => true),
  handleDragStart: vi.fn(),
  handleDragEnd: vi.fn(),
}));
const inputMode = vi.hoisted(() => ({ touch: false }));
const features = vi.hoisted(() => ({ folderSizeEnabled: true }));
const sizeFor = vi.hoisted(() => vi.fn(() => null));

vi.mock('@/composables/navigation', () => ({ useNavigation: () => navigation }));
// Where an entry opens is the preview manager's business, and mocking it here
// keeps the plugin registry — and the i18n instance it builds — out of a spec
// about one row. The row's own part is that it asks, and that it asks only when
// tabs are on.
const addressFor = vi.hoisted(() => vi.fn(() => ({ path: '/open/Docs/rapport.docx' })));
// What a tab behind means — which entries have somewhere to be, where the tab
// lands, and that there is none at all with tabs off — is the rule's own, held in
// `itemAddress.openInTab.spec.js`. What is asked here is that the row asks it,
// and on which gestures.
const openItemInTab = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/composables/itemAddress', () => ({
  useItemAddress: () => ({ addressFor }),
  useOpenItemInTab: () => ({ openItemInTab }),
}));

vi.mock('@/composables/itemSelection', () => ({ useSelection: () => selection }));
vi.mock('@/composables/contextMenu', () => ({ useExplorerContextMenu: () => contextMenu }));
vi.mock('@/composables/useFileDragDrop', () => ({ useFileDragDrop: () => dragDrop }));
vi.mock('@/composables/useInputMode', () => ({
  useInputMode: () => ({
    isTouchDevice: {
      get value() {
        return inputMode.touch;
      },
    },
  }),
}));
vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));
vi.mock('@/stores/folderSize', () => ({ useFolderSizeStore: () => ({ sizeFor }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ view: 'list', listViewColumnWidths: [0, 200, 100, 100, 160] }),
}));
const notifications = vi.hoisted(() => ({ addNotification: vi.fn() }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: () => notifications }));
// The key and everything handed to it. Echoing only `name` let a label built
// with any other parameter come back as the bare key, which is how a sentence
// written into the component instead of asked of the catalogue passed for one
// that was asked.
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key, params) => {
      const values = params ? Object.values(params).filter((v) => v !== undefined) : [];
      return values.length ? `${key}:${values.join(',')}` : key;
    },
  }),
}));

/**
 * A real Pinia store, because the component reads it through `storeToRefs`,
 * which only works on one.
 */
const store = vi.hoisted(() => ({ instance: null }));
const applyRename = vi.hoisted(() => vi.fn(async () => {}));
const cancelRenameAction = vi.hoisted(() => vi.fn());
const setRenameDraft = vi.hoisted(() => vi.fn());

vi.mock('@/stores/fileStore', async () => {
  const { defineStore: define } = await import('pinia');
  const { ref: r } = await import('vue');
  const useFake = define('fileStoreFake', () => {
    const renameState = r(null);
    const selectionMode = r(false);
    const cutItems = r([]);
    return {
      renameState,
      selectionMode,
      cutItems,
      isItemBeingRenamed: (item) =>
        Boolean(renameState.value) &&
        renameState.value.name === item?.name &&
        (renameState.value.path || '') === (item?.path || ''),
      setRenameDraft,
      applyRename,
      cancelRename: cancelRenameAction,
    };
  });
  return {
    useFileStore: () => {
      store.instance = useFake();
      return store.instance;
    },
  };
});

vi.mock('@coleqiu/vue-drag-select', () => ({
  DragSelectOption: { name: 'DragSelectOption', template: '<div><slot /></div>' },
}));

const FileObject = (await import('./FileObject.vue')).default;

const FILE = { name: 'rapport.docx', path: 'Docs', kind: 'docx', size: 2048 };
const FOLDER = { name: '2026', path: 'Docs', kind: 'directory' };

let wrapper = null;

const mountRow = (item = FILE, view = 'list') => {
  wrapper = mount(FileObject, {
    props: { item, view },
    global: {
      mocks: { $t: (key) => key },
      stubs: {
        FileIcon: true,
        FolderSizeLabel: true,
        MiddleEllipsis: { template: '<span><slot /></span>' },
        InlineQuickActions: true,
      },
    },
    attachTo: document.body,
  });
  return wrapper;
};

const renaming = async (item = FILE, draft = item.name) => {
  const view = mountRow(item);
  store.instance.renameState = { name: item.name, path: item.path, kind: item.kind, draft };
  await flushPromises();
  return view;
};

const input = () => document.querySelector('input[type=text], input:not([type])');

beforeEach(() => {
  setActivePinia(createPinia());
  inputMode.touch = false;
  features.folderSizeEnabled = true;
  openItemInTab.mockClear();
  openItemInTab.mockReturnValue(true);
  addressFor.mockReset();
  addressFor.mockReturnValue({ path: '/open/Docs/rapport.docx' });
  [
    navigation.openItem,
    selection.handleSelection,
    selection.toggleSelection,
    contextMenu.openItemMenu,
    dragDrop.handleDragStart,
    applyRename,
    cancelRenameAction,
    setRenameDraft,
    sizeFor,
  ].forEach((m) => m.mockClear());
  selection.isSelected.mockReturnValue(false);
  sizeFor.mockReturnValue(null);
  dragDrop.canDragDrop.mockReturnValue(true);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('the rename box', () => {
  /**
   * Typing replaces the name and leaves the extension alone. Selecting the
   * whole thing makes every rename a chance to lose ".docx" without noticing.
   */
  it('selects the name of a file but not its extension', async () => {
    await renaming(FILE);

    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe('rapport'.length);
  });

  it('selects the whole name of a folder, which has no extension', async () => {
    await renaming(FOLDER);

    expect(input().selectionEnd).toBe('2026'.length);
  });

  /** A dot in a folder name is part of the name, not an extension. */
  it('selects the whole name of a folder that has a dot in it', async () => {
    await renaming({ name: 'sauvegardes.2026', path: 'Docs', kind: 'directory' });

    expect(input().selectionEnd).toBe('sauvegardes.2026'.length);
  });

  /** A dotfile is not a file with an empty name and a ".bashrc" extension. */
  it('selects the whole name of a file that begins with a dot', async () => {
    await renaming({ name: '.bashrc', path: 'Docs', kind: 'txt' });

    expect(input().selectionEnd).toBe('.bashrc'.length);
  });

  it('selects the whole of a name with no dot in it', async () => {
    await renaming({ name: 'LISEZMOI', path: 'Docs', kind: 'txt' });

    expect(input().selectionEnd).toBe('LISEZMOI'.length);
  });

  it('takes what is typed into it', async () => {
    await renaming(FILE);

    input().value = 'bilan.docx';
    await wrapper.find('input').trigger('input');

    expect(setRenameDraft).toHaveBeenCalledWith('bilan.docx');
  });

  it('applies the name on Enter', async () => {
    await renaming(FILE);

    await wrapper.find('input').trigger('keydown', { key: 'Enter' });

    expect(applyRename).toHaveBeenCalled();
  });

  it('gives up on Escape', async () => {
    await renaming(FILE);

    await wrapper.find('input').trigger('keydown', { key: 'Escape' });

    expect(cancelRenameAction).toHaveBeenCalled();
    expect(applyRename).not.toHaveBeenCalled();
  });

  /** Clicking away is agreeing to the name, not abandoning it. */
  it('applies the name when the box loses focus', async () => {
    await renaming(FILE);

    await wrapper.find('input').trigger('blur');
    await flushPromises();

    expect(applyRename).toHaveBeenCalled();
  });

  /**
   * Said where this application says things, rather than in the browser's own box.
   *
   * `alert` was headed by the server's address and port, and stopped the page until it
   * was dismissed — for a message. The box is gone; the message is not.
   */
  it('says why a rename was refused, and comes back for another try', async () => {
    notifications.addNotification.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    applyRename.mockRejectedValueOnce(new Error('A file with that name already exists'));
    await renaming(FILE);

    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(notifications.addNotification).toHaveBeenCalledWith({
      type: 'error',
      heading: 'A file with that name already exists',
    });
    expect(document.activeElement).toBe(input());
  });

  it('ignores any other key', async () => {
    await renaming(FILE);

    await wrapper.find('input').trigger('keydown', { key: 'a' });

    expect(applyRename).not.toHaveBeenCalled();
    expect(cancelRenameAction).not.toHaveBeenCalled();
  });
});

describe('a row being renamed', () => {
  /** Every one of these would throw away the name half-typed into the box. */
  it('does not open on a double click', async () => {
    await renaming(FILE);

    await wrapper.find('.group\\/item > div').trigger('dblclick');

    expect(navigation.openItem).not.toHaveBeenCalled();
  });

  it('does not change the selection on a click', async () => {
    await renaming(FILE);

    await wrapper.find('.group\\/item > div').trigger('click');

    expect(selection.handleSelection).not.toHaveBeenCalled();
  });

  it('does not open the menu on a right click', async () => {
    await renaming(FILE);

    await wrapper.find('.group\\/item > div').trigger('contextmenu');

    expect(contextMenu.openItemMenu).not.toHaveBeenCalled();
  });

  it('cannot be dragged away', async () => {
    await renaming(FILE);

    expect(wrapper.find('.group\\/item > div').attributes('draggable')).toBe('false');
  });
});

describe('what a click means under a mouse', () => {
  const row = () => wrapper.find('.group\\/item > div');

  it('selects the row, with whatever modifier was held', async () => {
    mountRow();

    await row().trigger('click');

    expect(selection.handleSelection).toHaveBeenCalledWith(FILE, expect.anything());
    expect(navigation.openItem).not.toHaveBeenCalled();
  });

  it('opens it on a double click', async () => {
    mountRow();

    await row().trigger('dblclick');

    expect(navigation.openItem).toHaveBeenCalledWith(FILE);
  });

  it('opens the menu on a right click', async () => {
    mountRow();

    await row().trigger('contextmenu');

    expect(contextMenu.openItemMenu).toHaveBeenCalledWith(expect.anything(), FILE);
  });
});

describe('what a tap means on a touch screen', () => {
  const row = () => wrapper.find('.group\\/item > div');

  beforeEach(() => {
    inputMode.touch = true;
  });

  /** There is no hover and no double tap: one tap has to open it. */
  it('opens the row', async () => {
    mountRow();

    await row().trigger('click');

    expect(navigation.openItem).toHaveBeenCalledWith(FILE);
    expect(selection.handleSelection).not.toHaveBeenCalled();
  });

  it('ticks the row instead, once selecting has started', async () => {
    mountRow();
    store.instance.selectionMode = true;
    await flushPromises();

    await row().trigger('click');

    expect(selection.toggleSelection).toHaveBeenCalledWith(FILE);
    expect(navigation.openItem).not.toHaveBeenCalled();
  });

  it('does not open it on a double tap while selecting', async () => {
    mountRow();
    store.instance.selectionMode = true;
    await flushPromises();

    await row().trigger('dblclick');

    expect(navigation.openItem).not.toHaveBeenCalled();
  });
});

describe('the tick box', () => {
  const tick = () => wrapper.find('button[aria-label^="Select"]');

  it('adds the row to the selection without opening it', async () => {
    mountRow();

    await tick().trigger('click');

    expect(selection.toggleSelection).toHaveBeenCalledWith(FILE);
    expect(navigation.openItem).not.toHaveBeenCalled();
  });

  it('does nothing while the row is being renamed', async () => {
    await renaming(FILE);

    await tick().trigger('click');

    expect(selection.toggleSelection).not.toHaveBeenCalled();
  });

  /** Under a mouse it appears on hover; on a touch screen there is no hover. */
  it('is hidden on a touch screen until selecting starts', async () => {
    inputMode.touch = true;
    mountRow();

    expect(tick().exists()).toBe(false);

    store.instance.selectionMode = true;
    await flushPromises();

    expect(tick().exists()).toBe(true);
  });
});

describe('a row waiting to be moved', () => {
  it('is dimmed once it has been cut', async () => {
    mountRow();
    store.instance.cutItems = [{ name: 'rapport.docx', path: 'Docs' }];
    await flushPromises();

    expect(wrapper.find('.group\\/item > div').classes()).toContain('opacity-60');
  });

  /** Same name, different folder: not the row that was cut. */
  it('is not dimmed for a namesake somewhere else', async () => {
    mountRow();
    store.instance.cutItems = [{ name: 'rapport.docx', path: 'Archive' }];
    await flushPromises();

    expect(wrapper.find('.group\\/item > div').classes()).not.toContain('opacity-60');
  });
});

describe('the size of a folder', () => {
  it('is asked for by the folder"s own full path', async () => {
    mountRow(FOLDER);

    expect(sizeFor).toHaveBeenCalledWith('Docs/2026');
  });

  it('is not asked for where the feature is off', async () => {
    features.folderSizeEnabled = false;

    mountRow(FOLDER);

    expect(sizeFor).not.toHaveBeenCalled();
  });

  it('is not asked for a file, which carries its own', async () => {
    mountRow(FILE);

    expect(sizeFor).not.toHaveBeenCalled();
  });
});

describe('which rows the photo view shows', () => {
  const shown = (item) => {
    mountRow(item, 'photos');
    const visible = wrapper.find('.photo-cell').exists();
    wrapper.unmount();
    wrapper = null;
    return visible;
  };

  it('shows an image and a video', () => {
    expect(shown({ name: 'a.jpg', path: 'Docs', kind: 'jpg' })).toBe(true);
    expect(shown({ name: 'a.mp4', path: 'Docs', kind: 'mp4' })).toBe(true);
  });

  it('shows neither a document nor a folder', () => {
    expect(shown({ name: 'a.txt', path: 'Docs', kind: 'txt' })).toBe(false);
    expect(shown(FOLDER)).toBe(false);
  });
});

describe('a document somebody else has open', () => {
  const open = (users) => ({ ...FILE, onlyofficeActivity: { active: true, users } });

  it("says who is editing it, in the reader's language", async () => {
    mountRow(open(['alice', 'bob']));

    // The catalogue's key, not a sentence: this label was written into the
    // component in French, so every other language read French.
    expect(wrapper.html()).toContain('onlyoffice.editingBy');
    expect(wrapper.html()).toContain('alice, bob');
  });

  it('says so even without knowing who', async () => {
    mountRow(open([]));

    expect(wrapper.html()).toContain('onlyoffice.editingNow');
  });

  it('says nothing for a document nobody has open', async () => {
    mountRow(FILE);

    expect(wrapper.html()).not.toContain('OnlyOffice');
  });
});

/**
 * A link out of the volume, as the listing marks it. The server refuses to
 * follow it, so opening it used to end in "Resolved path is outside the
 * configured volume root" or "Path not found", on a row that showed the size
 * of a file nobody could reach.
 */
describe('a link out of the volume', () => {
  const LINK = {
    name: 'app-config.json',
    path: 'cache',
    kind: 'json',
    size: null,
    link: 'outside',
  };

  beforeEach(() => {
    notifications.addNotification.mockClear();
  });

  it('says what it is instead of opening, on a double click', async () => {
    mountRow(LINK);

    await wrapper.find('.group\\/item > div').trigger('dblclick');

    expect(navigation.openItem).not.toHaveBeenCalled();
    expect(notifications.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        heading: 'links.outside',
        body: 'links.outsideExplained:app-config.json',
      })
    );
  });

  it('says what it is instead of opening, on a tap', async () => {
    inputMode.touch = true;
    mountRow(LINK);

    await wrapper.find('.group\\/item > div').trigger('click');

    expect(navigation.openItem).not.toHaveBeenCalled();
    expect(notifications.addNotification).toHaveBeenCalledTimes(1);
  });

  it('shows no size, and names itself where the kind goes', () => {
    mountRow(LINK, 'list');

    const text = wrapper.text();
    expect(text).toContain('links.outside');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('JSON');
  });

  it('leaves an ordinary file opening as before', async () => {
    mountRow(FILE);

    await wrapper.find('.group\\/item > div').trigger('dblclick');

    expect(navigation.openItem).toHaveBeenCalledWith(FILE);
    expect(notifications.addNotification).not.toHaveBeenCalled();
  });
});

/**
 * The mark that says the file has earlier versions.
 *
 * Drawn in every view, because a folder is browsed in whichever one the
 * person left it in, and a mark that only some views carry is a mark nobody
 * can rely on. It is also a way into the history, which is the one thing it
 * could mean.
 */
describe('the versions mark', () => {
  const versioned = { ...FILE, versions: { count: 3, bytes: 900, newest: '2026-09-01T10:00:00Z' } };

  it.each(['list', 'tab', 'grid'])('shows the count in the %s view', (view) => {
    mountRow(versioned, view);

    const mark = wrapper.find('[data-test="version-mark"]');
    expect(mark.exists()).toBe(true);
    expect(mark.text()).toBe('3');
  });

  it('shows it on a photo cell too, where there is no name to sit beside', () => {
    mountRow({ ...versioned, name: 'holiday.jpg', kind: 'jpg' }, 'photos');

    expect(wrapper.find('[data-test="version-mark"]').exists()).toBe(true);
  });

  it('is absent when the server sent no count', () => {
    mountRow(FILE);

    expect(wrapper.find('[data-test="version-mark"]').exists()).toBe(false);
  });

  it('is absent when the count is zero, rather than reading as a mark of nothing', () => {
    mountRow({ ...FILE, versions: { count: 0 } });

    expect(wrapper.find('[data-test="version-mark"]').exists()).toBe(false);
  });

  it('opens the history, and does not also open the file', async () => {
    const { useVersionsPanelStore } = await import('@/stores/versionsPanel');
    mountRow(versioned);

    await wrapper.find('[data-test="version-mark"]').trigger('click');

    const panel = useVersionsPanelStore();
    expect(panel.isOpen).toBe(true);
    expect(panel.item).toMatchObject({ name: 'rapport.docx', path: 'Docs' });
    expect(navigation.openItem).not.toHaveBeenCalled();
    expect(selection.handleSelection).not.toHaveBeenCalled();
  });
});

/**
 * The lock beside an entry a rule holds to reading.
 *
 * A rule was invisible until somebody tried to write in the folder it covers
 * (nxzai/NextExplorer#407). The server says which entries it holds, and the row
 * carries the same lock a volume held to reading already carries.
 */
describe('a folder a rule holds to reading', () => {
  const lock = () => wrapper.find('[data-testid="volume-read-only"]');

  // Four views list a folder by name, and the grid is the one people open on:
  // a lock drawn in the list alone would be missing where it is most looked at.
  it.each(['list', 'grid', 'tab'])('carries the lock in the %s view', (view) => {
    mountRow({ ...FOLDER, readOnly: 'access' }, view);

    expect(lock().exists()).toBe(true);
    expect(lock().attributes('data-reason')).toBe('access');
  });

  it('carries none when the server did not mark it', () => {
    mountRow(FOLDER);

    expect(lock().exists()).toBe(false);
  });
});

/**
 * Where the quick actions sit in the name column.
 *
 * Following the name, their place on screen follows its length and no two rows
 * agree. Aligned, they take a slot at one edge — and the slot is held whether
 * the row is hovered or not, because the reason for asking was that things stop
 * moving, and a slot that appeared on hover would move the name instead.
 */
describe('where the quick actions sit in the row', () => {
  const nameCell = () => wrapper.findAll('.grid > div')[1];
  const slot = () => nameCell().find('[data-test="quick-actions-slot"]');
  const actions = () => nameCell().findAll('inline-quick-actions-stub');

  const configured = (position) => {
    const store = useQuickActionsStore();
    store.reset();
    store.setEnabled(true);
    store.setPosition(position);
    return store;
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('follows the name until asked otherwise, with no slot kept', () => {
    configured('after');
    mountRow();

    expect(actions()).toHaveLength(1);
    expect(slot().exists()).toBe(false);
  });

  it.each([
    ['start', true],
    ['end', false],
  ])('takes a slot at the %s of the column', (position, beforeTheName) => {
    const store = configured(position);
    mountRow();

    // One set of icons, and it is the one in the slot.
    expect(actions()).toHaveLength(1);
    expect(slot().exists()).toBe(true);
    expect(slot().attributes('style')).toContain(store.alignedSlot.width);

    expect(slot().attributes('data-side')).toBe(position);

    // Which end of the row it sits at, read from the row rather than from the
    // class names that put it there.
    const siblings = [...slot().element.parentElement.children];
    const expected = beforeTheName ? 0 : siblings.length - 1;
    expect(siblings.indexOf(slot().element)).toBe(expected);
  });

  /** Held at rest, or the name would move the moment the pointer arrived. */
  it('keeps the slot on a row nobody is pointing at', () => {
    configured('start');
    mountRow();

    expect(slot().exists()).toBe(true);
    expect(slot().attributes('style')).toMatch(/width:\s*\d+px/);
  });

  it('keeps no slot while the menu is off', () => {
    const store = useQuickActionsStore();
    store.reset();
    store.setPosition('start');
    mountRow();

    expect(slot().exists()).toBe(false);
  });
});

/**
 * The middle button opens an entry in a tab behind.
 *
 * Anything with an address of its own — a folder, a document, a spreadsheet, a
 * file the editor opens — because that is what somebody queueing up four things
 * to look at expects, and because the address is the one a plain click would take
 * them to. With tabs off it does nothing rather than navigating: the store would
 * put it in the one tab there is, which is a move nobody asked for.
 */
/**
 * One rule everywhere: command, or control, turns *opening* into opening in a tab
 * behind. On a row the gesture that opens is the double click — the single one
 * selects, and with that modifier it adds to the selection, which is worth more
 * than a tab. The middle button says the same thing without a modifier.
 */
describe('opening a row in a tab behind', () => {
  const openRow = async (item = FILE, options = {}) => {
    mountRow(item);
    await wrapper.find('[title]').trigger('dblclick', options);
  };

  it('is what command with a double click means', async () => {
    await openRow(FILE, { metaKey: true });

    expect(openItemInTab).toHaveBeenCalledWith(FILE, 'Docs');
    expect(navigation.openItem).not.toHaveBeenCalled();
  });

  it('is what control with a double click means, for everyone else', async () => {
    await openRow(FILE, { ctrlKey: true });

    expect(openItemInTab).toHaveBeenCalledWith(FILE, 'Docs');
    expect(navigation.openItem).not.toHaveBeenCalled();
  });

  /** Nowhere of its own, or tabs off: the modifier changes nothing. */
  it('opens the ordinary way when there is no tab to open it in', async () => {
    openItemInTab.mockReturnValue(false);

    await openRow(FILE, { metaKey: true });

    expect(navigation.openItem).toHaveBeenCalledWith(FILE);
  });

  it('leaves a plain double click alone', async () => {
    await openRow();

    expect(openItemInTab).not.toHaveBeenCalled();
    expect(navigation.openItem).toHaveBeenCalledWith(FILE);
  });

  it('is also what the middle button means, with no modifier at all', async () => {
    mountRow(FILE);

    await wrapper.find('[title]').trigger('auxclick', { button: 1 });

    expect(openItemInTab).toHaveBeenCalledWith(FILE, 'Docs');
  });

  it('is not offered on a row being renamed', async () => {
    await renaming(FILE);

    await wrapper.find('[title]').trigger('auxclick', { button: 1 });

    expect(openItemInTab).not.toHaveBeenCalled();
  });
});
