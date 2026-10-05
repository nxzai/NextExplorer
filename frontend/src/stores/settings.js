import { ref, computed, reactive, watch } from 'vue';
import { defineStore } from 'pinia';
import { useColorMode, useStorage } from '@vueuse/core';
import { useAuthStore } from '@/stores/auth';
import { useAppSettings } from '@/stores/appSettings';
import { createFolderPreference } from '@/stores/folderPreference';

const VIEW_MODES = ['grid', 'list', 'tab', 'photos'];

const DEFAULT_SORT_OPTIONS = [
  { key: 1, name: 'Name A to Z', by: 'name', order: 'asc' },
  { key: 2, name: 'Name Z to A', by: 'name', order: 'desc' },
  { key: 3, name: 'Small to large', by: 'size', order: 'asc' },
  { key: 4, name: 'Large to small', by: 'size', order: 'desc' },
  { key: 7, name: 'Kind A to Z', by: 'kind', order: 'asc' },
  { key: 8, name: 'Kind Z to A', by: 'kind', order: 'desc' },
  { key: 5, name: 'Old to new', by: 'dateModified', order: 'asc' },
  { key: 6, name: 'New to old', by: 'dateModified', order: 'desc' },
];

export const useSettingsStore = defineStore('settings', () => {
  const appSettings = useAppSettings();
  const authStore = useAuthStore();

  /**
   * The view a folder gets when it has no remembered one of its own.
   *
   * Requested in #360. It lives with the user rather than in the browser, so it
   * follows them between machines and does not leak to whoever signs in next on
   * a shared one.
   */
  const defaultView = computed(() => {
    const preferred = appSettings.userSettings?.defaultView;
    return VIEW_MODES.includes(preferred) ? preferred : 'grid';
  });

  const view = ref('grid');

  /** The list is one mixed ordering or folders first, per the person (#495). */
  const foldersFirst = computed(() => appSettings.userSettings?.foldersFirst !== false);

  const setView = (mode) => {
    if (!VIEW_MODES.includes(mode)) return undefined;
    view.value = mode;
    // Remembered against the folder being looked at, so coming back to it looks
    // the way it was left.
    return folderViewPreference.set(activeFolderPath.value, { mode });
  };

  const gridView = () => setView('grid');
  const listView = () => setView('list');
  const tabView = () => setView('tab');
  const photosView = () => setView('photos');

  // Photos mode item size (in px)
  const photoSize = useStorage('settings:photos:size', 160);

  // Office editor preference when multiple office integrations are enabled.
  // Values: 'onlyoffice' | 'collabora'
  const officeEditorPreference = useStorage('settings:officeEditor', 'onlyoffice');

  const terminalHeight = ref(10);

  const themeMode = useColorMode({
    selector: 'html',
    attribute: 'class',
    storageKey: 'settings:theme',
    initialValue: 'auto', // 'auto' | 'light' | 'dark'
    emitAuto: true,
    modes: { dark: 'dark', light: '' }, // only toggle .dark
  });

  const isDark = computed(() => themeMode.state.value === 'dark');

  const cycleTheme = () => {
    themeMode.value =
      themeMode.value === 'auto' ? 'light' : themeMode.value === 'light' ? 'dark' : 'auto';
  };

  const sortOptions = reactive(DEFAULT_SORT_OPTIONS.map((option) => ({ ...option })));
  const sortBy = ref(sortOptions[0]);
  const activeFolderPath = ref('');

  const MAX_SORT_FIELD_LENGTH = 128;

  const getSortOption = (by, order) => sortOptions.find((o) => o.by === by && o.order === order);

  const isValidSort = (sort) =>
    sort &&
    typeof sort === 'object' &&
    typeof sort.by === 'string' &&
    sort.by.trim().length > 0 &&
    sort.by.length <= MAX_SORT_FIELD_LENGTH &&
    (sort.order === 'asc' || sort.order === 'desc');

  const folderSortPreference = createFolderPreference({
    key: 'folderSorts',
    saveKey: 'folderSort',
    entryKey: 'sort',
    sanitizeEntry: (entry) =>
      isValidSort(entry) ? { by: entry.by.trim(), order: entry.order } : null,
    appSettings,
    authStore,
  });

  const folderViewPreference = createFolderPreference({
    key: 'folderViews',
    saveKey: 'folderView',
    entryKey: 'view',
    sanitizeEntry: (entry) => {
      const mode = typeof entry === 'string' ? entry : entry?.mode;
      return VIEW_MODES.includes(mode) ? { mode } : null;
    },
    appSettings,
    authStore,
  });

  const folderSorts = folderSortPreference.entries;
  const folderViews = folderViewPreference.entries;

  // A sort on a column outside the built-in list is still a sort worth
  // restoring, so the option is rebuilt rather than falling back to the
  // default.
  const getOrCreateSortOption = (by, order) => {
    const existing = getSortOption(by, order);
    if (existing) return existing;
    if (!isValidSort({ by, order })) return null;

    const nextKey = Math.max(0, ...sortOptions.map((o) => Number(o.key) || 0)) + 1;
    const created = { key: nextKey, name: `${by} ${order}`, by, order };
    sortOptions.push(created);
    return created;
  };

  watch(
    () => authStore.currentUser?.id ?? null,
    () => {
      activeFolderPath.value = '';
      sortOptions.splice(
        0,
        sortOptions.length,
        ...DEFAULT_SORT_OPTIONS.map((option) => ({ ...option }))
      );
      sortBy.value = sortOptions[0];
      view.value = defaultView.value;
    },
    { flush: 'sync' }
  );

  const saveSortForActiveFolder = (sort) =>
    folderSortPreference.set(activeFolderPath.value, { by: sort.by, order: sort.order });

  const applySort = (sort) => {
    if (!sort) return;
    sortBy.value = sort;
    return saveSortForActiveFolder(sort);
  };

  const setSortBy = (key) => {
    applySort(sortOptions.find((o) => o.key === key));
  };

  const setSort = (by, order) => {
    const sort = getOrCreateSortOption(by, order);
    if (!sort) return;
    return applySort(sort);
  };

  /**
   * Put a folder back the way it was left: its sort, and its view.
   *
   * A folder with no remembered view falls back to the default rather than
   * keeping whatever the previous folder was showing — a photo folder set to
   * the photo grid should not turn a folder of documents into one.
   */
  const restoreFolderPreferences = (path) => {
    activeFolderPath.value = typeof path === 'string' ? path : '';
    const savedSort = folderSorts.value?.[activeFolderPath.value];
    sortBy.value = getOrCreateSortOption(savedSort?.by, savedSort?.order) || sortOptions[0];

    const savedView = folderViews.value?.[activeFolderPath.value];
    view.value = VIEW_MODES.includes(savedView?.mode) ? savedView.mode : defaultView.value;
  };

  // Widths are sized to their content (icon, name, size, kind, modified date) so
  // the grid doesn't reserve empty space that would trigger a horizontal
  // scrollbar over nothing. Non-last columns keep a small surplus over their
  // content as an inter-column margin; the trailing date column hugs its value.
  // Key is versioned (:v2) so the tighter defaults replace any stored widths.
  const DEFAULT_LIST_VIEW_COLUMN_WIDTHS = [30, 340, 96, 136, 150];
  const LIST_VIEW_MIN_WIDTHS = [30, 160, 70, 96, 140];

  const listViewColumnWidths = useStorage(
    'settings:listView:columns:v2',
    DEFAULT_LIST_VIEW_COLUMN_WIDTHS
  );

  const coerceListViewColumnWidths = (value) => {
    const existing = Array.isArray(value) ? value : [];
    return DEFAULT_LIST_VIEW_COLUMN_WIDTHS.map((defaultWidth, index) => {
      const proposed = Number(existing[index] ?? defaultWidth);
      const minWidth = LIST_VIEW_MIN_WIDTHS[index] ?? 30;
      return Number.isFinite(proposed) ? Math.max(minWidth, proposed) : defaultWidth;
    });
  };

  const ensureListViewColumnWidths = () => {
    const next = coerceListViewColumnWidths(listViewColumnWidths.value);
    const current = Array.isArray(listViewColumnWidths.value) ? listViewColumnWidths.value : [];
    const same = next.length === current.length && next.every((w, i) => w === current[i]);
    if (!same) {
      listViewColumnWidths.value = next;
    }
  };

  ensureListViewColumnWidths();

  const listViewGridTemplateColumns = computed(() => {
    const next = coerceListViewColumnWidths(listViewColumnWidths.value);
    return next.map((w) => `${w}px`).join(' ');
  });

  const setListViewColumnWidth = (index, widthPx) => {
    if (!Number.isFinite(index)) return;
    if (!Number.isFinite(widthPx)) return;

    ensureListViewColumnWidths();

    const minWidth = LIST_VIEW_MIN_WIDTHS[index] ?? 30;
    const next = [...listViewColumnWidths.value];
    next[index] = Math.max(minWidth, Math.round(widthPx));
    listViewColumnWidths.value = next;
  };

  const resetListViewColumnWidths = () => {
    listViewColumnWidths.value = [...DEFAULT_LIST_VIEW_COLUMN_WIDTHS];
  };

  return {
    view,
    setView,
    gridView,
    listView,
    tabView,
    photosView,
    photoSize,
    officeEditorPreference,
    themeMode,
    isDark,
    cycleTheme,
    sortBy,
    setSortBy,
    setSort,
    restoreFolderPreferences,
    folderViews,
    defaultView,
    foldersFirst,
    sortOptions,
    terminalHeight,
    listViewColumnWidths,
    listViewGridTemplateColumns,
    setListViewColumnWidth,
    resetListViewColumnWidths,
  };
});
