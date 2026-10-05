<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { onLongPress } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import FileIcon from '@/icons/FileIcon.vue';
import { formatBytes, formatDate } from '@/utils';
import { getKindLabel } from '@/utils/fileKinds';
import FolderSizeLabel from '@/components/FolderSizeLabel.vue';
import { useFolderSizeStore } from '@/stores/folderSize';
import { useFeaturesStore } from '@/stores/features';
import { useNavigation } from '@/composables/navigation';
import { useSelection } from '@/composables/itemSelection';
import { useFileStore } from '@/stores/fileStore';
import { useExplorerContextMenu } from '@/composables/contextMenu';
import { isPreviewableImage, isPreviewableVideo } from '@/config/media';
import { useSettingsStore } from '@/stores/settings';
import { DragSelectOption } from '@coleqiu/vue-drag-select';
import MiddleEllipsis from '@/components/MiddleEllipsis.vue';
import ReadOnlyMark from '@/components/ReadOnlyMark.vue';
import { ellipses } from '@/utils/ellipses';
import { useInputMode } from '@/composables/useInputMode';
import { CheckIcon } from '@heroicons/vue/20/solid';
import { ClockIcon, PencilSquareIcon } from '@heroicons/vue/24/outline';
import { useVersionsPanelStore } from '@/stores/versionsPanel';
import { useFileDragDrop } from '@/composables/useFileDragDrop';
import InlineQuickActions from '@/components/InlineQuickActions.vue';
import { useQuickActionsStore } from '@/stores/quickActions';
import { useOpenItemInTab } from '@/composables/itemAddress';
import { useI18n } from 'vue-i18n';
import { useNotificationsStore } from '@/stores/notifications';

const props = defineProps({
  item: { type: Object, required: true },
  view: { type: String, required: true },
});
const settings = useSettingsStore();

const { openItem: navigateTo } = useNavigation();
const { t } = useI18n();
const notificationsStore = useNotificationsStore();

// A link out of the volume is listed so it can be seen, but the server refuses
// to follow it, so opening it says why instead of failing.
const isOutsideLink = computed(() => props.item?.link === 'outside');
const openItem = (item) => {
  if (item?.link === 'outside') {
    notificationsStore.addNotification({
      type: 'info',
      heading: t('links.outside'),
      body: t('links.outsideExplained', { name: item.name }),
    });
    return;
  }
  navigateTo(item);
};
const { handleSelection, isSelected, toggleSelection } = useSelection();
const fileStore = useFileStore();
const { renameState, selectionMode } = storeToRefs(fileStore);
const { canDragDrop, handleDragStart, handleDragEnd } = useFileDragDrop();
const contextMenu = useExplorerContextMenu();
const { isTouchDevice } = useInputMode();
const folderSizeStore = useFolderSizeStore();
const featuresStore = useFeaturesStore();
const quickActionsStore = useQuickActionsStore();

// Null while the icons follow the name, which is where they were before there was
// anywhere else to put them. Otherwise the side of the name column they line up
// at, and the room every row keeps for them.
const quickActionsSlot = computed(() => quickActionsStore.alignedSlot);

const isDirectory = computed(() => props.item?.kind === 'directory');
// item.path is the parent's logical path and item.name the entry name, so the
// folder's own logical path (used to look up its indexed size) combines them.
const folderFullPath = computed(() => {
  const parent = props.item?.path || '';
  const name = props.item?.name || '';
  return parent ? `${parent}/${name}` : name;
});
const showFolderSize = computed(() => isDirectory.value && featuresStore.folderSizeEnabled);
const folderSizeEntry = computed(() =>
  showFolderSize.value ? folderSizeStore.sizeFor(folderFullPath.value) : null
);

const renameInputRef = ref(null);
const rootRef = ref(null);
const baseRenameInputClass =
  'w-full rounded-sm border border-blue-500 bg-white/90 px-1 py-0.5 text-sm text-zinc-900 focus:outline-hidden focus:ring-2 focus:ring-blue-400 dark:bg-zinc-700 dark:text-white dark:border-blue-300 dark:focus:ring-blue-300';

const isRenaming = computed(() => fileStore.isItemBeingRenamed(props.item));

const renameDraft = computed({
  get: () => {
    if (!isRenaming.value || !renameState.value) {
      return '';
    }
    return renameState.value.draft ?? '';
  },
  set: (value) => {
    if (isRenaming.value) {
      fileStore.setRenameDraft(value);
    }
  },
});

const isCut = computed(() =>
  fileStore.cutItems.some(
    (cutItem) =>
      cutItem.name === props.item.name && (cutItem.path || '') === (props.item.path || '')
  )
);

const selected = computed(() => isSelected(props.item));
const onlyofficeActivity = computed(() => props.item?.onlyofficeActivity || null);
const onlyofficeActivityLabel = computed(() => {
  const activity = onlyofficeActivity.value;
  if (!activity?.active) return '';
  const users = Array.isArray(activity.users) ? activity.users.filter(Boolean) : [];
  // Asked of the catalogue rather than written here: this label is the one place
  // the whole listing tells a reader something in words, and a sentence written
  // into the component is a sentence every other language reads in French.
  return users.length > 0
    ? t('onlyoffice.editingBy', { names: users.join(', ') })
    : t('onlyoffice.editingNow');
});

/**
 * The file has earlier versions, and how many.
 *
 * Sent with the listing when the person asked to see it and may see this
 * file's history at all — a share hands out neither the history nor the fact
 * that there is one unless its owner said so. Nothing is decided here: the
 * mark is there when the count is.
 */
const versionsPanel = useVersionsPanelStore();
const versionCount = computed(() => {
  const count = Number(props.item?.versions?.count);
  return Number.isFinite(count) && count > 0 ? count : 0;
});
// `(key, named, plural)`, as the Versions panel calls it: the third argument
// of the other overload is a bag of options, not a bag of values.
const versionsLabel = computed(() =>
  versionCount.value ? t('versions.mark', { count: versionCount.value }, versionCount.value) : ''
);
/** Straight to the history, rather than the row's own click: it is the one
 *  thing the mark could mean, and the right-click route stays as it was. */
const openVersions = () => {
  if (!versionCount.value) return;
  versionsPanel.open(props.item);
};

const showSelectionControl = computed(() => !isTouchDevice.value || selectionMode.value);

const selectionButtonBaseClass =
  'flex items-center justify-center border ring-1 ring-inset shadow-sm backdrop-blur-sm transition-opacity focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400';

const selectionButtonStateClass = (selected) =>
  selected
    ? 'border-blue-600 bg-blue-600 text-white ring-blue-600 dark:border-blue-500 dark:bg-blue-500 dark:ring-blue-500'
    : 'border-neutral-300 bg-white/80 text-transparent ring-neutral-200 dark:border-neutral-600 dark:bg-zinc-900/60 dark:ring-neutral-700';

const longPressActive = ref(false);

// Drives lazy rendering of the inline quick-actions (only mounted while hovered).
const qaHover = ref(false);

const handleToggleSelection = (event) => {
  if (isRenaming.value) return;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  toggleSelection(props.item);
};

const handleClick = (event) => {
  if (isRenaming.value) return;
  if (!isTouchDevice.value) {
    handleSelection(props.item, event);
    return;
  }

  if (longPressActive.value) {
    longPressActive.value = false;
    return;
  }

  // Mobile behavior:
  // - Normal mode: tap opens.
  // - Selection mode: tap toggles selection (no open).
  if (selectionMode.value) {
    toggleSelection(props.item);
    return;
  }

  openItem(props.item);
};

// The middle button opens this entry in a tab behind, which is what it does on a
// link and what somebody queueing up four things to look at will try. A folder, a
// document, a spreadsheet, a file the editor opens — whatever the entry has an
// address for, which is the same address a plain click would take it to.
//
// A link out of the volume is one the server refuses to follow, and a file with
// neither a preview nor an editor has nowhere of its own, so both are left to the
// ordinary click. With tabs off the store has one tab and would put this there,
// which is a navigation nobody asked for — so it is not offered at all.
// The store rather than the navigation composable: a tab opened *behind* is the
// one case that does not navigate, so nothing here needs a router — and asking for
// the composable put the settings store, the accounts store and the router itself
// into the module graph of every row in the listing.
const { openItemInTab } = useOpenItemInTab();
const handleMiddleClick = () => {
  if (isRenaming.value || isOutsideLink.value) return;
  openItemInTab(props.item, props.item?.path || '');
};

const handleDblClick = (event) => {
  if (isRenaming.value) return;
  if (isTouchDevice.value && selectionMode.value) return;
  // One rule everywhere: command, or control, turns *opening* into opening in a
  // tab behind. On a row the gesture that opens is the double click — the single
  // one selects, and with this modifier it adds to the selection, which is worth
  // more than a tab. On a favourite or a volume there is no selection to make, so
  // there it is the single click. The middle button says the same thing on both.
  if ((event?.metaKey || event?.ctrlKey) && openItemInTab(props.item, props.item?.path || '')) {
    return;
  }
  openItem(props.item);
};

const handleContextMenu = (event) => {
  if (isRenaming.value) return;
  contextMenu?.openItemMenu(event, props.item);
};

const selectRenameText = (input) => {
  if (!input) return;
  const value = input.value;
  const kind = renameState.value?.kind || props.item.kind;

  if (!value) {
    input.select();
    return;
  }

  if (kind === 'directory') {
    input.select();
    return;
  }

  const lastDot = value.lastIndexOf('.');
  if (lastDot > 0) {
    input.setSelectionRange(0, lastDot);
  } else {
    input.select();
  }
};

const focusRenameInput = async () => {
  await nextTick();
  const input = renameInputRef.value;
  if (!input) return;
  input.focus();
  selectRenameText(input);
};

watch(isRenaming, (value) => {
  if (value) {
    focusRenameInput();
  }
});

const commitRename = async () => {
  if (!isRenaming.value) return;
  try {
    await fileStore.applyRename();
  } catch (error) {
    console.error('Rename operation failed', error);
    if (error && error.message) {
      notificationsStore.addNotification({ type: 'error', heading: error.message });
    }
    focusRenameInput();
  }
};

const cancelRename = () => {
  if (!isRenaming.value) return;
  fileStore.cancelRename();
};

const handleRenameKeydown = async (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    await commitRename();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelRename();
  }
};

const handleRenameBlur = async () => {
  await commitRename();
};

// Kind label logic moved to '@/utils/fileKinds'

// Photos view helpers
const isPhotoItem = computed(() => {
  const kind = (props.item?.kind || '').toLowerCase();
  return isPreviewableImage(kind) || isPreviewableVideo(kind);
});

if (isTouchDevice.value) {
  onLongPress(
    rootRef,
    (ev) => {
      if (!ev || isRenaming.value) return;
      longPressActive.value = true;
      handleContextMenu(ev);
    },
    {
      delay: 500,
      distanceThreshold: 10,
    }
  );
}
</script>

<template>
  <DragSelectOption
    class="group/item"
    v-if="(view === 'photos' && isPhotoItem) || view != 'photos'"
    :value="props.item"
  >
    <div
      v-if="view === 'photos' && isPhotoItem"
      :title="item.name"
      ref="rootRef"
      @click="handleClick"
      @auxclick.middle.prevent="handleMiddleClick"
      :data-selected="selected ? 'true' : 'false'"
      @dblclick="handleDblClick"
      @contextmenu.prevent.stop="handleContextMenu"
      @dragstart="(e) => handleDragStart(e, item)"
      @dragend="handleDragEnd"
      :draggable="canDragDrop() && !isRenaming"
      class="photo-cell relative w-full rounded-md overflow-hidden cursor-pointer select-none bg-neutral-100 dark:bg-zinc-800/60 hover:brightness-105"
      :class="{
        'ring-2 ring-blue-500 dark:ring-blue-400': selected,
        'opacity-60': isCut,
        'cursor-move': canDragDrop() && !isRenaming,
      }"
    >
      <button
        v-if="showSelectionControl"
        type="button"
        :class="[
          selectionButtonBaseClass,
          selectionButtonStateClass(selected),
          selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100',
          'absolute right-2 top-2 z-10 h-5 w-5 rounded-md',
        ]"
        :aria-label="`Select ${item.name}`"
        @click="handleToggleSelection"
        @dblclick.stop.prevent
      >
        <CheckIcon class="h-4 w-4" />
      </button>
      <span
        v-if="onlyofficeActivity?.active"
        :title="onlyofficeActivityLabel"
        class="absolute left-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100/95 text-amber-700 shadow-sm dark:bg-amber-400/20 dark:text-amber-300"
      >
        <PencilSquareIcon class="h-3.5 w-3.5" />
      </span>
      <button
        v-if="versionCount"
        type="button"
        :title="versionsLabel"
        :aria-label="versionsLabel"
        data-test="version-mark"
        class="absolute bottom-2 left-2 z-10 inline-flex items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[0.65rem] font-medium leading-4 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-white"
        @click.stop.prevent="openVersions"
        @dblclick.stop.prevent
      >
        <ClockIcon class="h-3 w-3" />
        <span>{{ versionCount }}</span>
      </button>
      <FileIcon :item="item" class="w-full h-full" />
    </div>

    <div
      :title="item.name"
      v-if="view === 'grid'"
      ref="rootRef"
      @click="handleClick"
      @auxclick.middle.prevent="handleMiddleClick"
      :data-selected="selected ? 'true' : 'false'"
      @dblclick="handleDblClick"
      @contextmenu.prevent.stop="handleContextMenu"
      @dragstart="(e) => handleDragStart(e, item)"
      @dragend="handleDragEnd"
      :draggable="canDragDrop() && !isRenaming"
      class="relative flex flex-col items-center gap-2 p-2 rounded-xl cursor-pointer select-none"
      :class="[
        { 'opacity-60': isCut },
        selected ? 'bg-zinc-200/70 dark:bg-zinc-700/60' : '',
        canDragDrop() && !isRenaming ? 'cursor-move' : '',
      ]"
    >
      <button
        v-if="showSelectionControl"
        type="button"
        :class="[
          selectionButtonBaseClass,
          selectionButtonStateClass(selected),
          selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100',
          'absolute right-2 top-2 z-10 h-5 w-5 rounded-md',
        ]"
        :aria-label="`Select ${item.name}`"
        @click="handleToggleSelection"
        @dblclick.stop.prevent
      >
        <CheckIcon class="h-4 w-4" />
      </button>
      <span
        v-if="onlyofficeActivity?.active"
        :title="onlyofficeActivityLabel"
        class="absolute left-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100/95 text-amber-700 shadow-sm dark:bg-amber-400/20 dark:text-amber-300"
      >
        <PencilSquareIcon class="h-3.5 w-3.5" />
      </span>
      <FileIcon :item="item" class="h-16 shrink-0" />
      <div
        class="text-sm text-center break-all line-clamp-2 rounded-md"
        :class="{
          'bg-blue-500 text-white dark:bg-blue-600': selected && !isRenaming,
        }"
      >
        <template v-if="isRenaming">
          <input
            ref="renameInputRef"
            v-model="renameDraft"
            type="text"
            :class="[baseRenameInputClass, 'text-center select-text']"
            @keydown.stop="handleRenameKeydown"
            @blur="handleRenameBlur"
            @click.stop
            @mousedown.stop
            autocomplete="off"
          />
        </template>
        <template v-else>
          {{ ellipses(item.name, (maxl = 15))
          }}<ReadOnlyMark
            v-if="item.readOnly"
            :reason="item.readOnly"
            class="ml-1 align-middle"
          /><button
            v-if="versionCount"
            type="button"
            :title="versionsLabel"
            :aria-label="versionsLabel"
            data-test="version-mark"
            class="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 align-middle text-[0.65rem] font-medium leading-4 text-current opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500"
            @click.stop.prevent="openVersions"
            @dblclick.stop.prevent
          >
            <ClockIcon class="h-3.5 w-3.5" />
            <span>{{ versionCount }}</span>
          </button>
        </template>
      </div>
    </div>

    <div
      :title="item.name"
      v-if="view === 'tab'"
      ref="rootRef"
      @click="handleClick"
      @auxclick.middle.prevent="handleMiddleClick"
      :data-selected="selected ? 'true' : 'false'"
      @dblclick="handleDblClick"
      @contextmenu.prevent.stop="handleContextMenu"
      @dragstart="(e) => handleDragStart(e, item)"
      @dragend="handleDragEnd"
      :draggable="canDragDrop() && !isRenaming"
      class="relative flex items-center gap-2 p-4 rounded-md cursor-pointer select-none"
      :class="[
        { 'opacity-60': isCut },
        selected ? 'bg-zinc-200/70 dark:bg-zinc-700/60' : '',
        canDragDrop() && !isRenaming ? 'cursor-move' : '',
      ]"
    >
      <button
        v-if="showSelectionControl"
        type="button"
        :class="[
          selectionButtonBaseClass,
          selectionButtonStateClass(selected),
          selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100',
          'absolute right-2 top-2 z-10 h-5 w-5 rounded-md',
        ]"
        :aria-label="`Select ${item.name}`"
        @click="handleToggleSelection"
        @dblclick.stop.prevent
      >
        <CheckIcon class="h-4 w-4" />
      </button>
      <FileIcon :item="item" class="w-16 shrink-0" />
      <div
        class="grow rounded-md px-2 -mx-2"
        :class="{
          'bg-blue-500 text-white dark:bg-blue-600': selected && !isRenaming,
        }"
      >
        <div class="flex items-center gap-1.5 break-all line-clamp-2">
          <template v-if="isRenaming">
            <input
              ref="renameInputRef"
              v-model="renameDraft"
              type="text"
              :class="[baseRenameInputClass, 'select-text']"
              @keydown.stop="handleRenameKeydown"
              @blur="handleRenameBlur"
              @click.stop
              @mousedown.stop
              autocomplete="off"
            />
          </template>
          <template v-else>
            {{ ellipses(item.name, (maxl = 50)) }}
            <ReadOnlyMark v-if="item.readOnly" :reason="item.readOnly" />
            <span
              v-if="onlyofficeActivity?.active"
              :title="onlyofficeActivityLabel"
              class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400"
            >
              <PencilSquareIcon class="h-3.5 w-3.5" />
            </span>
            <button
              v-if="versionCount"
              type="button"
              :title="versionsLabel"
              :aria-label="versionsLabel"
              data-test="version-mark"
              class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 align-middle text-[0.65rem] font-medium leading-4 text-current opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500"
              @click.stop.prevent="openVersions"
              @dblclick.stop.prevent
            >
              <ClockIcon class="h-3.5 w-3.5" />
              <span>{{ versionCount }}</span>
            </button>
          </template>
        </div>
        <p class="text-xs text-stone-400">
          <FolderSizeLabel v-if="showFolderSize" :entry="folderSizeEntry" />
          <template v-else>{{
            isOutsideLink ? t('links.outside') : formatBytes(item.size)
          }}</template>
        </p>
      </div>
    </div>

    <div
      v-if="view === 'list'"
      ref="rootRef"
      @click="handleClick"
      @auxclick.middle.prevent="handleMiddleClick"
      :data-selected="selected ? 'true' : 'false'"
      @dblclick="handleDblClick"
      @contextmenu.prevent.stop="handleContextMenu"
      @dragstart="(e) => handleDragStart(e, item)"
      @dragend="handleDragEnd"
      @mouseenter="qaHover = true"
      @mouseleave="qaHover = false"
      :draggable="canDragDrop() && !isRenaming"
      :class="[
        'grid select-none items-center',
        'cursor-pointer auto-cols-fr p-1 px-4 rounded-md',
        'min-w-max',
        'group-even/item:bg-zinc-100 dark:group-even/item:bg-neutral-700/30',
        {
          'text-white dark:text-white bg-blue-600 dark:bg-blue-600/80 group-even/item:bg-blue-600! dark:group-even/item:bg-blue-600/80!':
            selected,
          'opacity-60': isCut && !selected,
          'cursor-move': canDragDrop() && !isRenaming,
        },
      ]"
      :style="{ gridTemplateColumns: settings.listViewGridTemplateColumns }"
    >
      <div class="relative flex items-center justify-center">
        <FileIcon :item="item" class="w-6 shrink-0" />
        <button
          v-if="showSelectionControl"
          type="button"
          :class="[
            'absolute -top-1 -bottom-1 left-1/2 z-20 flex w-7 -translate-x-1/2 items-center justify-center',
            selectionMode || selected ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100',
          ]"
          :aria-label="`Select ${item.name}`"
          @pointerdown.stop
          @mousedown.stop
          @mouseup.stop
          @click="handleToggleSelection"
          @dblclick.stop.prevent
        >
          <span
            :class="[
              selectionButtonBaseClass,
              selectionButtonStateClass(selected),
              'flex h-5 w-5 items-center justify-center rounded-md',
            ]"
          >
            <CheckIcon class="h-4 w-4" />
          </span>
        </button>
      </div>
      <div :title="item.name" class="min-w-0 overflow-hidden text-sm">
        <template v-if="isRenaming">
          <input
            ref="renameInputRef"
            v-model="renameDraft"
            type="text"
            :class="[baseRenameInputClass, 'py-1 select-text']"
            @keydown.stop="handleRenameKeydown"
            @blur="handleRenameBlur"
            @click.stop
            @mousedown.stop
            autocomplete="off"
          />
        </template>
        <template v-else>
          <!-- Name stays anchored on the left; the hover icons sit to its right in
               the free space, and wrap onto the line below when the name is too
               long to leave room. The name never shifts, so browsing isn't jumpy.

               Asked to align them instead, the icons leave the wrap and take a
               slot of their own at one edge of the column — the same width on
               every row, and held whether the row is hovered or not, which is
               what keeps both the icons and the names where they were. -->
          <div class="flex items-center gap-x-1.5 min-w-0">
            <div
              v-if="quickActionsSlot?.side === 'start'"
              data-test="quick-actions-slot"
              :data-side="quickActionsSlot.side"
              class="shrink-0"
              :style="{ width: quickActionsSlot.width }"
            >
              <InlineQuickActions :item="item" :active="qaHover" />
            </div>
            <div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
              <MiddleEllipsis :text="item.name" :end-chars="10" />
              <!-- A rule holds this entry to reading: the same lock a volume held
                 to reading carries, drawn where the restriction begins. -->
              <ReadOnlyMark v-if="item.readOnly" :reason="item.readOnly" />
              <span
                v-if="onlyofficeActivity?.active"
                :title="onlyofficeActivityLabel"
                class="inline-flex h-4 w-4 shrink-0 items-center justify-center text-amber-600 dark:text-amber-400"
              >
                <PencilSquareIcon class="h-3.5 w-3.5" />
              </span>
              <button
                v-if="versionCount"
                type="button"
                :title="versionsLabel"
                :aria-label="versionsLabel"
                data-test="version-mark"
                class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 align-middle text-[0.65rem] font-medium leading-4 text-current opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500"
                @click.stop.prevent="openVersions"
                @dblclick.stop.prevent
              >
                <ClockIcon class="h-3.5 w-3.5" />
                <span>{{ versionCount }}</span>
              </button>
              <InlineQuickActions v-if="!quickActionsSlot" :item="item" :active="qaHover" />
            </div>
            <div
              v-if="quickActionsSlot?.side === 'end'"
              data-test="quick-actions-slot"
              :data-side="quickActionsSlot.side"
              class="ml-auto shrink-0"
              :style="{ width: quickActionsSlot.width }"
            >
              <InlineQuickActions :item="item" :active="qaHover" />
            </div>
          </div>
        </template>
      </div>
      <div class="text-sm">
        <FolderSizeLabel v-if="showFolderSize" :entry="folderSizeEntry" />
        <template v-else>{{
          item.kind === 'directory' || isOutsideLink ? '&mdash;' : formatBytes(item.size)
        }}</template>
      </div>
      <div class="text-sm">
        {{ isOutsideLink ? t('links.outside') : getKindLabel(item) }}
      </div>
      <div class="text-sm">
        {{ formatDate(item.dateModified) }}
      </div>
    </div>
  </DragSelectOption>
</template>

<style scoped>
.photo-cell {
  aspect-ratio: 1 / 1;
}

.photo-cell :deep(img) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
