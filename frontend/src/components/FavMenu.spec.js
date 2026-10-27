import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, reactive, ref } from 'vue';

/**
 * The favourites in the sidebar.
 *
 * Every button in it acts on one favourite, and the favourites look alike: a
 * remove that reaches the neighbour of the one clicked deletes the wrong
 * shortcut, a drop that lands on the parent of the folder shown moves files
 * somewhere nobody chose. Remove and edit stay hidden until edit mode is on, so
 * a stray click while navigating cannot remove anything; edit mode has to end
 * when the pointer goes elsewhere, and a reorder the server refuses must not
 * leave the list showing an order that was never saved.
 */

let favoritesStore;
let dragDrop;
const route = reactive({ params: {} });
const openBreadcrumb = vi.fn();
const openEditorForFavorite = vi.fn();

vi.mock('@/stores/favorites', () => ({ useFavoritesStore: () => favoritesStore }));
vi.mock('vue-router', () => ({ useRoute: () => route }));
vi.mock('@/composables/navigation', () => ({ useNavigation: () => ({ openBreadcrumb }) }));
// What a tab behind means is the rule's own, in `composables/openPlaceInTab.js`
// and its spec. What is asked here is that the gesture reaches it.
const openPlaceInTab = vi.fn(() => true);
vi.mock('@/composables/openPlaceInTab', () => ({
  useOpenPlaceInTab: () => ({ openPlaceInTab }),
}));
vi.mock('@/composables/useFavoriteEditor', () => ({
  useFavoriteEditor: () => ({ openEditorForFavorite }),
}));
vi.mock('@/composables/useFileDragDrop', () => ({ useFileDragDrop: () => dragDrop }));
vi.mock('@/api', () => ({
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
}));
vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({ t: (key) => key }),
}));
/**
 * The drag library, reduced to what the menu relies on: it renders one item per
 * favourite, knows whether dragging is allowed, and reports a new order.
 */
vi.mock('vuedraggable', () => ({
  default: defineComponent({
    name: 'DraggableStub',
    props: { modelValue: Array, disabled: Boolean },
    emits: ['update:modelValue', 'end'],
    setup(props, { slots }) {
      return () =>
        h(
          'div',
          props.modelValue.map((element) => h('div', { key: element.id }, slots.item({ element })))
        );
    },
  }),
}));

import FavMenu from './FavMenu.vue';

const PROJECTS = { id: 'fav-projects', path: 'Docs/2026', label: '', icon: 'outline:FolderIcon' };
const PHOTOS = { id: 'fav-photos', path: 'Media/Photos', label: 'Holiday pictures' };
const ARCHIVE = { id: 'fav-archive', path: 'Backup/Archive', label: '', available: false };

let wrapper = null;

const mountMenu = async (list) => {
  favoritesStore.favorites = list;
  wrapper = mount(FavMenu, { attachTo: document.body });
  await flushPromises();
  return wrapper;
};

const editModeButton = () => wrapper.find('h4 button');
const favourite = (label) =>
  wrapper.findAll('button').find((button) => button.text().trim() === label);
const names = () =>
  wrapper
    .findAll('button')
    .map((button) => button.find('span.truncate'))
    .filter((span) => span.exists())
    .map((span) => span.text());
const editButtons = () => wrapper.findAll('button[aria-label="common.edit"]');
const removeButtons = () => wrapper.findAll('button[aria-label="common.remove"]');
const draggable = () => wrapper.findComponent({ name: 'DraggableStub' });

const enterEditMode = async () => {
  await editModeButton().trigger('click');
  await flushPromises();
};

beforeEach(() => {
  // A `ref` inside a reactive object is what `storeToRefs` finds in a real store.
  favoritesStore = reactive({
    favorites: ref([]),
    ensureLoaded: vi.fn(async () => {}),
    loadFavorites: vi.fn(async () => {}),
    removeFavorite: vi.fn(async () => {}),
    reorderFavorites: vi.fn(async () => {}),
  });
  dragDrop = {
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    isDragTarget: vi.fn(() => false),
    isCopyDragTarget: vi.fn(() => false),
  };
  route.params = {};
  [openBreadcrumb, openEditorForFavorite].forEach((fn) => fn.mockClear());
  openPlaceInTab.mockClear();
  openPlaceInTab.mockReturnValue(true);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('with no favourites', () => {
  it('loads them when it appears', async () => {
    await mountMenu([]);

    expect(favoritesStore.ensureLoaded).toHaveBeenCalledTimes(1);
  });

  it('says there are none, and offers nothing to edit', async () => {
    await mountMenu([]);

    expect(wrapper.text()).toContain('favorites.emptyTitle');
    expect(names()).toEqual([]);
    expect(editModeButton().attributes('disabled')).toBeDefined();
    expect(editButtons()).toHaveLength(0);
    expect(removeButtons()).toHaveLength(0);
  });
});

describe('the list', () => {
  it('names each favourite by its label, or by the last part of its path', async () => {
    await mountMenu([PROJECTS, PHOTOS]);

    expect(names()).toEqual(['2026', 'Holiday pictures']);
    expect(wrapper.text()).not.toContain('favorites.emptyTitle');
  });

  it('opens the folder of the favourite clicked', async () => {
    await mountMenu([PROJECTS, PHOTOS]);

    await favourite('Holiday pictures').trigger('click');

    expect(openBreadcrumb).toHaveBeenCalledTimes(1);
    expect(openBreadcrumb).toHaveBeenCalledWith('Media/Photos');
  });

  /**
   * One rule everywhere: command, or control, turns *opening* into opening in a
   * tab behind. Here the gesture that opens is the single click — a favourite is
   * not something there is a selection of.
   */
  it('opens it in a tab behind when command is held', async () => {
    await mountMenu([PROJECTS, PHOTOS]);

    await favourite('Holiday pictures').trigger('click', { metaKey: true });

    expect(openPlaceInTab).toHaveBeenCalledWith('Media/Photos');
    expect(openBreadcrumb).not.toHaveBeenCalled();
  });

  it('does the same on control, for everyone else', async () => {
    await mountMenu([PROJECTS, PHOTOS]);

    await favourite('Holiday pictures').trigger('click', { ctrlKey: true });

    expect(openPlaceInTab).toHaveBeenCalledWith('Media/Photos');
  });

  /** Tabs off: the modifier changes nothing, and the folder opens as it always did. */
  it('opens the folder itself when there is no tab to open it in', async () => {
    openPlaceInTab.mockReturnValue(false);
    await mountMenu([PROJECTS, PHOTOS]);

    await favourite('Holiday pictures').trigger('click', { metaKey: true });

    expect(openBreadcrumb).toHaveBeenCalledWith('Media/Photos');
  });

  it('goes nowhere for a favourite that has no path', async () => {
    await mountMenu([{ id: 'broken', path: '', label: 'Broken' }]);

    await favourite('Broken').trigger('click');

    expect(openBreadcrumb).not.toHaveBeenCalled();
  });

  it('warns about a favourite whose volume is not mounted, and only that one', async () => {
    await mountMenu([PROJECTS, ARCHIVE]);

    expect(favourite('Archive').attributes('title')).toBe('favorites.volumeUnavailable');
    expect(favourite('2026').attributes('title')).toBeUndefined();
  });
});

describe('edit mode', () => {
  it('offers no edit or remove until it is switched on', async () => {
    await mountMenu([PROJECTS, PHOTOS]);
    expect(editButtons()).toHaveLength(0);
    expect(removeButtons()).toHaveLength(0);

    await enterEditMode();

    expect(editButtons()).toHaveLength(2);
    expect(removeButtons()).toHaveLength(2);
  });

  it('removes the favourite whose remove button was clicked', async () => {
    await mountMenu([PROJECTS, PHOTOS]);
    await enterEditMode();

    await removeButtons()[1].trigger('click');
    await flushPromises();

    expect(favoritesStore.removeFavorite).toHaveBeenCalledTimes(1);
    expect(favoritesStore.removeFavorite).toHaveBeenCalledWith('Media/Photos');
    expect(openBreadcrumb).not.toHaveBeenCalled();
  });

  it('opens the editor on the favourite whose edit button was clicked', async () => {
    await mountMenu([PROJECTS, PHOTOS]);
    await enterEditMode();

    await editButtons()[0].trigger('click');

    expect(openEditorForFavorite).toHaveBeenCalledTimes(1);
    expect(openEditorForFavorite).toHaveBeenCalledWith(PROJECTS);
  });

  it('survives a removal the server refuses', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    favoritesStore.removeFavorite.mockRejectedValue(new Error('Forbidden'));
    await mountMenu([PROJECTS]);
    await enterEditMode();

    await removeButtons()[0].trigger('click');
    await flushPromises();

    expect(consoleError).toHaveBeenCalled();
    expect(removeButtons()).toHaveLength(1);
  });

  it('ends when the pointer goes down elsewhere on the page', async () => {
    await mountMenu([PROJECTS, PHOTOS]);
    await enterEditMode();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();

    expect(removeButtons()).toHaveLength(0);
  });

  it('carries on when the pointer goes down inside the list', async () => {
    await mountMenu([PROJECTS, PHOTOS]);
    await enterEditMode();

    favourite('2026').element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();

    expect(removeButtons()).toHaveLength(2);
  });
});

describe('reordering', () => {
  it('is only possible in edit mode', async () => {
    await mountMenu([PROJECTS, PHOTOS]);
    expect(draggable().props('disabled')).toBe(true);

    await enterEditMode();

    expect(draggable().props('disabled')).toBe(false);
  });

  it('is not possible with a single favourite', async () => {
    await mountMenu([PROJECTS]);
    await enterEditMode();

    expect(draggable().props('disabled')).toBe(true);
  });

  it('saves the order the favourites were dropped in', async () => {
    await mountMenu([PROJECTS, PHOTOS]);
    await enterEditMode();

    draggable().vm.$emit('update:modelValue', [PHOTOS, PROJECTS]);
    draggable().vm.$emit('end');
    await flushPromises();

    expect(favoritesStore.reorderFavorites).toHaveBeenCalledWith(['fav-photos', 'fav-projects']);
    expect(favoritesStore.loadFavorites).not.toHaveBeenCalled();
  });

  it('reloads the saved order when the new one is refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    favoritesStore.reorderFavorites.mockRejectedValue(new Error('Conflict'));
    await mountMenu([PROJECTS, PHOTOS]);
    await enterEditMode();

    draggable().vm.$emit('update:modelValue', [PHOTOS, PROJECTS]);
    draggable().vm.$emit('end');
    await flushPromises();

    expect(favoritesStore.loadFavorites).toHaveBeenCalledTimes(1);
  });
});

describe('dropping files onto a favourite', () => {
  it('targets the favourite folder itself, not its parent', async () => {
    await mountMenu([PROJECTS, PHOTOS]);

    await favourite('Holiday pictures').trigger('dragover');
    await favourite('Holiday pictures').trigger('drop');

    const target = { name: 'Photos', path: 'Media', destinationPath: 'Media/Photos' };
    expect(dragDrop.handleDragOver).toHaveBeenCalledWith(expect.any(Event), target);
    expect(dragDrop.handleDrop).toHaveBeenCalledWith(expect.any(Event), target);
  });
});
