<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { offset, flip, shift, useFloating, autoUpdate } from '@floating-ui/vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useItemAddress } from '@/composables/itemAddress';
import { useTabNavigation } from '@/composables/tabNavigation';
import { explorerContextMenuSymbol } from '@/composables/contextMenu';
import { buildMenuSections, quickActionAvailable } from '@/composables/contextMenuSections';
import { useDeleteDialogWording } from '@/composables/deleteDialogWording';
import { useFileStore } from '@/stores/fileStore';
import { useSelection } from '@/composables/itemSelection';
import { useFileActions } from '@/composables/fileActions';
import { useInfoPanelStore } from '@/stores/infoPanel';
import { normalizePath } from '@/api';
import { modKeyLabel, deleteKeyLabel } from '@/utils/keyboard';
import { useDeleteConfirm } from '@/composables/useDeleteConfirm';
import ModalDialog from '@/components/ModalDialog.vue';
import ArchivePasswordDialog from '@/components/ArchivePasswordDialog.vue';
import ShareDialog from '@/components/ShareDialog.vue';
import { useFavoritesStore } from '@/stores/favorites';
import { useVersionsPanelStore } from '@/stores/versionsPanel';
import { useFavoriteEditor } from '@/composables/useFavoriteEditor';
import { useTerminalStore } from '@/stores/terminal';
import { useTabsStore } from '@/stores/tabs';
import { canCompare } from '@/config/compare';
import { compareAddress, compareRoute } from '@/utils/compareRoute';
import { useNotificationsStore } from '@/stores/notifications';
import { useFeaturesStore } from '@/stores/features';
import { isTerminalExtension } from '@/config/terminal';
import { itemExtension, terminalInputFor } from '@/utils/terminalInput';

/**
 * The right-click menu of the explorer, and the dialogs it opens.
 *
 * What it offers is decided in `contextMenuSections.js` and what the delete
 * confirmation says in `deleteDialogWording.js`, both from plain descriptions
 * of the situation. What is left here is opening at the cursor, what each
 * entry does, and the dialogs.
 */

const fileStore = useFileStore();
const infoPanel = useInfoPanelStore();
const versionsPanel = useVersionsPanelStore();
const { clearSelection } = useSelection();
const favoritesStore = useFavoritesStore();
const { openEditorForFavorite } = useFavoriteEditor();
const terminalStore = useTerminalStore();
const featuresStore = useFeaturesStore();
const router = useRouter();

const isOpen = ref(false);
const pointer = ref({ x: 0, y: 0 });
const contextKind = ref('background'); // background | file | directory
const targetItem = ref(null);
const isMutatingFavorite = ref(false);

const referenceRef = ref(null);
const floatingRef = ref(null);

const { x, y, strategy, update } = useFloating(referenceRef, floatingRef, {
  placement: 'right-start',
  strategy: 'fixed',
  middleware: [offset(4), flip(), shift()],
  // Position as soon as the menu mounts (and keep it pinned) so it appears
  // instantly at the cursor instead of flashing at the top-left for a frame.
  whileElementsMounted: autoUpdate,
});

const floatingStyles = computed(() => ({
  position: strategy.value,
  // Until floating-ui computes (x/y null on the very first frame), fall back to
  // the cursor position so the menu paints AT the cursor immediately — no visible
  // delay or top-left flash — then gets refined (offset/flip/shift) in place.
  left: `${Math.max(x.value ?? pointer.value.x, 0)}px`,
  top: `${Math.max(y.value ?? pointer.value.y, 0)}px`,
  zIndex: 1600,
}));

const referenceStyles = computed(() => ({
  position: 'fixed',
  left: `${pointer.value.x}px`,
  top: `${pointer.value.y}px`,
}));

const actions = useFileActions();
const { t } = useI18n();
const notifications = useNotificationsStore();
const hasSelection = actions.hasSelection;
const primaryItem = actions.primaryItem;
const isSingleItemSelected = actions.isSingleItemSelected;
const locationCanWrite = actions.locationCanWrite;
const locationCanDelete = actions.locationCanDelete;
const isShareDialogOpen = ref(false);
const itemToShare = ref(null);
const archivePasswordRequest = ref(null);
const isArchivePasswordBusy = ref(false);

const isVolumesView = computed(() => {
  const p = normalizePath(fileStore.getCurrentPath || '');
  return !p || p.trim() === '';
});

const isShareView = computed(() => {
  const p = normalizePath(fileStore.getCurrentPath || '');
  return p.startsWith('share/');
});

const locationCanShare = computed(() => fileStore.currentPathData?.canShare ?? true);

/** Sharing is offered here at all: not the volumes, not inside a share. */
const canShareHere = computed(
  () => !isVolumesView.value && !isShareView.value && locationCanShare.value
);

const canShare = computed(
  () =>
    canShareHere.value &&
    isSingleItemSelected.value &&
    Boolean(primaryItem.value) &&
    primaryItem.value?.kind !== 'volume'
);

const deleteConfirm = useDeleteConfirm();
const {
  isDeleteConfirmOpen,
  isDeleting,
  isLoadingDeleteImpact,
  deleteImpactError,
  keptItems,
  isKeptConfirmOpen,
  requestDelete,
  confirmDelete,
  confirmKept,
  closeKeptConfirm,
  closeDeleteConfirm,
} = deleteConfirm;

const {
  deleteDialogTitle,
  deleteDialogMessage,
  deletePermanentNotice,
  deleteVersionsNotice,
  goesToTrash,
  keptDialogMessage,
  keptItemReason,
  deleteShareImpactMessage,
  deleteOnlyOfficeActivityMessage,
} = useDeleteDialogWording({ t, featuresStore, confirm: deleteConfirm });

const closeMenu = () => {
  isOpen.value = false;
};

const clearTextSelection = () => {
  window.getSelection?.()?.removeAllRanges?.();
};

const getItemKey = (item) => {
  if (!item || !item.name) return '';
  const parent = normalizePath(item.path || '');
  return `${parent}::${item.name}`;
};

const ensureItemInSelection = (item) => {
  if (!item) return;
  const key = getItemKey(item);
  const alreadySelected = fileStore.selectedItemKeys.has(key);

  if (alreadySelected) {
    return;
  }

  const match = fileStore.getCurrentPathItems.find((candidate) => getItemKey(candidate) === key);

  fileStore.selectedItems = match ? [match] : [item];
};

const openMenuAt = (event, kind, item = null) => {
  if (!event) return;
  clearTextSelection();
  const clientX = event.clientX ?? 0;
  const clientY = event.clientY ?? 0;

  pointer.value = { x: clientX, y: clientY };
  contextKind.value = kind;
  targetItem.value = item;
  isOpen.value = true;
};

const openItemMenu = (event, item) => {
  if (!event || !item) return;
  event.preventDefault?.();
  ensureItemInSelection(item);
  openMenuAt(event, item.kind === 'directory' ? 'directory' : 'file', item);
};

const openBackgroundMenu = (event) => {
  if (!event) return;
  event.preventDefault?.();
  openMenuAt(event, 'background');
};

const resolveItemPath = (item) => {
  if (!item || !item.name) {
    return normalizePath(fileStore.getCurrentPath || '');
  }
  return actions.resolveItemPath(item);
};

const runCut = () => actions.runCut();
const runCopy = () => actions.runCopy();
const runPasteIntoDirectory = async () => {
  if (!actions.canPaste.value) return;
  const destination = resolveItemPath(targetItem.value);
  await actions.runPasteToDestination(destination);
};

const runPasteIntoCurrent = async () => {
  if (!actions.canPaste.value) return;
  await actions.runPasteIntoCurrent();
};

const runRename = () => actions.runRename();

/**
 * This entry, in a tab of this application.
 *
 * Asked here rather than in `fileActions`: knowing where an entry opens means
 * asking the preview plugins, and every screen that offers an action builds
 * `fileActions` — most of them never open anything.
 */
const { addressFor } = useItemAddress();
const tabNavigation = useTabNavigation();

/**
 * Every entry that was chosen, and where each of them opens.
 *
 * All of them rather than the first: somebody who picks four folders and asks for
 * them in tabs is asking for four tabs, and getting one was the kind of answer
 * that makes a reader stop using the menu. Entries with nowhere of their own —
 * a file with neither a preview nor an editor is a download — drop out here, so
 * the entry is offered exactly when it would do something.
 */
const openInTabTargets = computed(() => {
  if (!tabNavigation.tabs.enabled) return [];
  return (actions.selectedItems.value || [])
    .map((item) => (item ? addressFor(item, { currentPath: item.path || '' }) : null))
    .filter((target) => Boolean(target?.path));
});

const runOpenInTab = () => {
  // `target.path` rather than asking the router to resolve it: every address
  // `addressFor` answers with is a path and nothing else, so resolving it would be
  // a round trip through the router to be handed back the string it was given.
  const targets = openInTabTargets.value;
  if (targets.length === 0) return;

  // The first comes forward, as one entry always has; the rest line up behind it,
  // which is where a row of tabs somebody is about to read through belongs.
  let opened = 0;
  for (const [index, target] of targets.entries()) {
    if (!tabNavigation.open(target.path, { behind: index > 0, own: true })) break;
    opened += 1;
  }

  // The row has a limit and it is an administrator's. Somebody who chose twelve
  // and got four should be told why rather than left counting tabs.
  if (opened < targets.length) {
    notifications.addNotification({
      type: 'warning',
      heading: t('tabs.full', { count: tabNavigation.tabs.limit }),
    });
  }
};

/**
 * Two or three files, compared side by side.
 *
 * Offered where it would do something: a selection of two or three files this
 * application can read as text. Which extensions those are is
 * `config/compare.js` — whatever the editor opens, plus whatever the installation
 * adds — because comparing two photographs line by line is an offer that was never
 * worth making.
 */
const comparable = computed(() => canCompare(actions.selectedItems.value || []));

const runCompare = () => {
  const chosen = actions.selectedItems.value || [];
  const sides = chosen.map((item) => resolveItemPath(item));
  // In a tab of its own where there are tabs, so the folder the files came from is
  // still there to go back to — and at its own address either way. Spelled by the
  // router, because that is the spelling the screen will be handed back.
  if (tabNavigation.tabs.enabled) {
    const address = compareAddress(router, sides);
    if (address) tabNavigation.open(address, { own: true });
    return;
  }
  const target = compareRoute(sides);
  if (target) void router.push(target);
};

const runDownload = () => actions.runDownload();
const runDownloadAsZip = () => actions.runDownloadAsZip();
const runDownloadSeparately = () => actions.runDownloadSeparately();

const openArchivePasswordDialog = (result) => {
  if (!result?.requiresPassword) return;
  archivePasswordRequest.value = {
    path: result.path,
    destination: result.destination,
    invalidPassword: result.invalidPassword,
  };
};

const runExtractArchive = async () => {
  openArchivePasswordDialog(await actions.runExtractArchive());
};

const runExtractArchiveIntoCurrentFolder = async () => {
  openArchivePasswordDialog(await actions.runExtractArchiveIntoCurrentFolder());
};

const closeArchivePasswordDialog = () => {
  if (!isArchivePasswordBusy.value) archivePasswordRequest.value = null;
};

const submitArchivePassword = async (password) => {
  const request = archivePasswordRequest.value;
  if (!request) return;

  isArchivePasswordBusy.value = true;
  try {
    const result = await fileStore.extractZipArchive(request.path, {
      destination: request.destination,
      password,
    });
    if (result?.requiresPassword) {
      archivePasswordRequest.value = { ...request, invalidPassword: result.invalidPassword };
    } else {
      archivePasswordRequest.value = null;
    }
  } finally {
    isArchivePasswordBusy.value = false;
  }
};
const runCompressToZip = () => actions.runCompressToZip();

const runShare = () => {
  if (!canShare.value) return;
  itemToShare.value = primaryItem.value;
  isShareDialogOpen.value = true;
};

// requestDelete and confirmDelete are provided by useDeleteConfirm()

const runGetInfo = () => {
  if (!primaryItem.value) return;
  // Open right-side info panel with selected item
  infoPanel.open(primaryItem.value);
};

/**
 * A file's history, where there can be one: a single file, versions switched
 * on, and — through a share — a share whose owner shows it.
 */
const canShowVersions = computed(
  () =>
    featuresStore.versionsEnabled &&
    contextKind.value === 'file' &&
    isSingleItemSelected.value &&
    Boolean(primaryItem.value) &&
    fileStore.currentPathData?.canSeeVersions !== false
);

const runShowVersions = () => {
  if (!canShowVersions.value) return;
  infoPanel.close();
  versionsPanel.open(primaryItem.value);
};

const runOpenWithEditor = () => {
  if (!primaryItem.value) return;
  const item = primaryItem.value;
  const basePath = item.path ? `${item.path}/${item.name}` : item.name;
  const fileToEdit = basePath.replace(/^\/+/, '');
  // Encode each segment for editor path
  const encodedPath = fileToEdit.split('/').map(encodeURIComponent).join('/');
  router.push({ path: `/editor/${encodedPath}` });
};

const canOpenWithTerminal = computed(() => {
  if (!featuresStore.terminalEnabled || contextKind.value !== 'file' || !primaryItem.value) {
    return false;
  }

  return isTerminalExtension(itemExtension(primaryItem.value));
});

const runOpenWithTerminal = () => {
  if (!canOpenWithTerminal.value || !primaryItem.value) return;
  const item = primaryItem.value;
  const parentPath = normalizePath(item.path || fileStore.getCurrentPath || '');
  // In this tab's terminal, which is where this reader's terminals are.
  terminalStore.openIn(useTabsStore().activeId, parentPath, { input: terminalInputFor(item) });
};

// Favorites: the folder right-clicked, or from the background the folder on
// screen — and from the quick actions, the folder they were opened on.
const selectedDirectoryPath = computed(() => {
  if (contextKind.value !== 'directory') return null;
  const item = targetItem.value;
  if (!item || item.kind !== 'directory') return null;
  return normalizePath(actions.resolveItemPath(item));
});

const currentDirectoryPath = computed(() => normalizePath(fileStore.getCurrentPath || ''));

/** The folder the favourite entry of the open menu is about. */
const menuFavoritePath = computed(() =>
  contextKind.value === 'background' ? currentDirectoryPath.value : selectedDirectoryPath.value
);

/** Add a folder to the favourites, or take it off: one at a time. */
const toggleFavoriteAt = async (path) => {
  if (!path || isMutatingFavorite.value) return;
  isMutatingFavorite.value = true;
  try {
    if (favoritesStore.isFavorite(path)) {
      await favoritesStore.removeFavorite(path);
    } else {
      const favorite = await favoritesStore.addFavorite({ path });
      if (favorite) openEditorForFavorite(favorite);
    }
  } finally {
    isMutatingFavorite.value = false;
  }
};

const runToggleFavoriteForDirectory = () => toggleFavoriteAt(selectedDirectoryPath.value);
const runToggleFavoriteForCurrent = () => toggleFavoriteAt(currentDirectoryPath.value);

// Inline quick-actions menu: run a single action against a specific item without
// opening the full right-click menu. Reuses this component's action machinery
// (share/delete dialogs, favorites) so there is a single implementation. The item
// is selected first so the selection-based run functions target it.
const copyTextToClipboard = async (text) => {
  try {
    await navigator.clipboard?.writeText?.(String(text || ''));
  } catch {
    // Clipboard unavailable (insecure context / denied) — ignore.
  }
};

const isQuickActionAvailable = (item, id) =>
  quickActionAvailable(item, id, {
    locationCanWrite: locationCanWrite.value,
    locationCanDelete: locationCanDelete.value,
    canShareHere: canShareHere.value,
  });

const runQuickAction = async (item, id) => {
  if (!item) return;
  ensureItemInSelection(item);
  switch (id) {
    case 'info':
      runGetInfo();
      break;
    case 'download':
      runDownload();
      break;
    case 'copyName':
      await copyTextToClipboard(item.name || '');
      break;
    case 'copyPath':
      await copyTextToClipboard(actions.resolveItemPath(item));
      break;
    case 'copy':
      runCopy();
      break;
    case 'cut':
      runCut();
      break;
    case 'rename':
      runRename();
      break;
    case 'share':
      runShare();
      break;
    case 'compress':
      runCompressToZip();
      break;
    case 'favorite':
      if (item.kind === 'directory')
        await toggleFavoriteAt(normalizePath(actions.resolveItemPath(item)));
      break;
    case 'delete':
      requestDelete();
      break;
    default:
      break;
  }
};

const menuSections = computed(() => {
  if (!isOpen.value) return [];

  const favoritePath = menuFavoritePath.value;
  return buildMenuSections(
    {
      kind: contextKind.value,
      hasPrimary: Boolean(primaryItem.value),
      hasSelection: hasSelection.value,
      isVolumesView: isVolumesView.value,
      isShareView: isShareView.value,
      locationCanShare: locationCanShare.value,
      locationCanWrite: locationCanWrite.value,
      locationCanDelete: locationCanDelete.value,
      locationCanCreateFolder: actions.locationCanCreateFolder.value,
      locationCanCreateFile: actions.locationCanCreateFile.value,
      canShare: canShare.value,
      canCut: actions.canCut.value,
      canCopy: actions.canCopy.value,
      canPaste: actions.canPaste.value,
      canRename: actions.canRename.value,
      canDelete: actions.canDelete.value,
      canCompare: comparable.value,
      comparedCount: (actions.selectedItems.value || []).length,
      canOpenInTab: openInTabTargets.value.length > 0,
      openInTabCount: openInTabTargets.value.length,
      canDownloadSeparately: actions.canDownloadSeparately.value,
      downloadMode: actions.downloadMode.value,
      canShowVersions: canShowVersions.value,
      canOpenWithTerminal: canOpenWithTerminal.value,
      isArchiveSelected: actions.isArchiveSelected.value,
      canExtractArchive: actions.canExtractArchive.value,
      canCompressToZip: actions.canCompressToZip.value,
      isFavorite: Boolean(favoritePath) && favoritesStore.isFavorite(favoritePath),
      hasFavoritePath: Boolean(favoritePath),
      isMutatingFavorite: isMutatingFavorite.value,
    },
    {
      getInfo: runGetInfo,
      showVersions: runShowVersions,
      openWithEditor: runOpenWithEditor,
      openWithTerminal: runOpenWithTerminal,
      openInTab: runOpenInTab,
      compare: runCompare,
      download: runDownload,
      downloadAsZip: runDownloadAsZip,
      downloadSeparately: runDownloadSeparately,
      extract: runExtractArchive,
      extractHere: runExtractArchiveIntoCurrentFolder,
      compress: runCompressToZip,
      share: runShare,
      cut: runCut,
      copy: runCopy,
      moveTo: () => actions.runMoveTo(),
      copyTo: () => actions.runCopyTo(),
      pasteIntoDirectory: runPasteIntoDirectory,
      pasteIntoCurrent: runPasteIntoCurrent,
      rename: runRename,
      toggleFavorite:
        contextKind.value === 'background'
          ? runToggleFavoriteForCurrent
          : runToggleFavoriteForDirectory,
      delete: requestDelete,
      newFolder: () => fileStore.createFolder(),
      newFile: () => fileStore.createFile(),
    },
    { t, modKeyLabel, deleteKeyLabel }
  );
});

const runAction = async (action) => {
  if (!action || action.disabled) return;
  closeMenu();
  try {
    await action.run();
  } catch (error) {
    console.error(`Context menu action "${action.id}" failed`, error);
  }
};

const handleGlobalPointerDown = (event) => {
  if (!isOpen.value) return;
  const menu = floatingRef.value;
  if (menu && (menu === event.target || menu.contains(event.target))) {
    return;
  }
  closeMenu();
};

const handleGlobalKeydown = (event) => {
  if (event.key === 'Escape') {
    closeMenu();
  }
};

// `whileElementsMounted: autoUpdate` positions the menu the moment it opens, so no
// explicit reposition-on-open is needed. Reopening at a new cursor position while
// the menu is already mounted still needs a nudge.
watch(
  pointer,
  async () => {
    if (!isOpen.value) return;
    await nextTick();
    update();
  },
  { deep: true }
);

onMounted(() => {
  window.addEventListener('pointerdown', handleGlobalPointerDown);
  window.addEventListener('keydown', handleGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown);
  window.removeEventListener('keydown', handleGlobalKeydown);
});

provide(explorerContextMenuSymbol, {
  openItemMenu,
  openBackgroundMenu,
  closeMenu,
  clearSelection,
  runQuickAction,
  quickActionAvailable: isQuickActionAvailable,
});
</script>

<template>
  <slot />

  <div
    v-if="isOpen"
    ref="referenceRef"
    class="pointer-events-none h-0 w-0"
    :style="referenceStyles"
  />

  <teleport to="body">
    <div
      v-if="isOpen"
      ref="floatingRef"
      :style="floatingStyles"
      class="min-w-[220px] rounded-xl border border-zinc-200 bg-white p-1.5 text-sm text-zinc-800 shadow-2xl dark:border-white/10 dark:bg-neutral-800 dark:text-zinc-200"
      @contextmenu.prevent
      @click.stop
    >
      <div v-for="(section, sIdx) in menuSections" :key="`section-${sIdx}`" class="flex flex-col">
        <button
          v-for="action in section"
          :key="action.id"
          type="button"
          class="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50"
          :class="[
            action.danger
              ? 'text-red-600 hover:bg-red-500/20 dark:text-red-500 dark:hover:bg-red-500/20'
              : 'hover:bg-zinc-500/20 dark:hover:bg-zinc-400/20',
          ]"
          :disabled="action.disabled"
          @click.stop="runAction(action)"
        >
          <component :is="action.icon" class="w-4 h-4 opacity-80" />
          <p class="flex-1 font-medium">{{ action.label }}</p>
          <span v-if="action.shortcut" class="ml-auto text-xs text-zinc-500 dark:text-zinc-400">{{
            action.shortcut
          }}</span>
          <span v-if="action.disabled" class="sr-only">{{ $t('common.disabled') }}</span>
        </button>

        <div
          v-if="sIdx < menuSections.length - 1"
          class="my-1 h-px bg-zinc-300/50 dark:bg-zinc-700/50"
        />
      </div>
    </div>
  </teleport>

  <ModalDialog :model-value="isDeleteConfirmOpen" @update:model-value="closeDeleteConfirm">
    <template #title>{{ deleteDialogTitle }}</template>
    <p class="mb-6 text-base text-zinc-700 dark:text-zinc-200">
      {{ deleteDialogMessage }}
    </p>
    <p v-if="isLoadingDeleteImpact" class="-mt-3 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
      {{ $t('context.checkingDeleteImpact') }}
    </p>
    <p
      v-if="deleteOnlyOfficeActivityMessage"
      class="-mt-3 mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100"
    >
      {{ deleteOnlyOfficeActivityMessage }}
    </p>
    <p
      v-if="!isLoadingDeleteImpact && deleteShareImpactMessage"
      class="-mt-3 mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100"
    >
      {{ deleteShareImpactMessage }}
    </p>
    <p v-else-if="deleteImpactError" class="-mt-3 mb-6 text-sm text-amber-700 dark:text-amber-300">
      {{ $t('context.deleteImpactUnavailable') }}
    </p>
    <p
      v-if="!isLoadingDeleteImpact && deletePermanentNotice"
      data-test="delete-permanent-notice"
      class="-mt-3 mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-700/60 dark:bg-red-900/20 dark:text-red-100"
    >
      {{ deletePermanentNotice }}
    </p>
    <p
      v-if="!isLoadingDeleteImpact && deleteVersionsNotice"
      data-test="delete-versions-notice"
      class="-mt-3 mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-100"
    >
      {{ deleteVersionsNotice }}
    </p>
    <div class="flex justify-end gap-3">
      <button
        type="button"
        class="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
        @click="closeDeleteConfirm"
        :disabled="isDeleting"
      >
        {{ $t('common.cancel') }}
      </button>
      <button
        v-if="goesToTrash"
        type="button"
        data-test="delete-permanently"
        class="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/50 dark:text-red-300 dark:hover:bg-red-500/10"
        @click="confirmDelete({ permanent: true })"
        :disabled="isDeleting"
      >
        {{ $t('context.deletePermanently') }}
      </button>
      <button
        type="button"
        data-test="delete-confirm"
        class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 active:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
        @click="confirmDelete()"
        :disabled="isDeleting"
      >
        <span v-if="isDeleting">{{ $t('common.deleting') }}</span>
        <span v-else-if="goesToTrash">{{ $t('context.moveToTrash') }}</span>
        <span v-else>{{ $t('common.delete') }}</span>
      </button>
    </div>
  </ModalDialog>

  <ModalDialog :model-value="isKeptConfirmOpen" @update:model-value="closeKeptConfirm">
    <template #title>{{ $t('context.keptTitle') }}</template>
    <p class="mb-3 text-base text-zinc-700 dark:text-zinc-200">{{ keptDialogMessage }}</p>
    <ul
      data-test="kept-items"
      class="mb-6 max-h-48 space-y-1 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-300"
    >
      <li v-for="item in keptItems" :key="`${item.path}/${item.name}`">
        <span class="font-medium text-zinc-900 dark:text-zinc-100">{{ item.name }}</span>
        — {{ keptItemReason(item) }}
      </li>
    </ul>
    <div class="flex justify-end gap-3">
      <button
        type="button"
        class="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
        @click="closeKeptConfirm"
      >
        {{ $t('common.cancel') }}
      </button>
      <button
        type="button"
        data-test="kept-delete-permanently"
        class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
        @click="confirmKept"
        :disabled="isDeleting"
      >
        {{ $t('context.deletePermanently') }}
      </button>
    </div>
  </ModalDialog>

  <ArchivePasswordDialog
    :model-value="Boolean(archivePasswordRequest)"
    :busy="isArchivePasswordBusy"
    :invalid-password="archivePasswordRequest?.invalidPassword"
    @update:model-value="closeArchivePasswordDialog"
    @submit="submitArchivePassword"
  />

  <ShareDialog v-model="isShareDialogOpen" :item="itemToShare" />
</template>
