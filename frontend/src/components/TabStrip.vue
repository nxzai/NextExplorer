<script setup>
import { beginTabDrag, endTabDrag, TAB_DRAG_TYPE } from '@/utils/tabDrag';
import { computed, onUnmounted, ref, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { onClickOutside, useElementSize } from '@vueuse/core';
import { ChevronDownIcon, PlusIcon, XMarkIcon } from '@heroicons/vue/20/solid';
import { Bars3Icon } from '@heroicons/vue/24/outline';
import { TAB_KINDS_BY_ID, tabFolderPath, tabTitle } from '@/config/tabKinds';
import { useFavoritesStore } from '@/stores/favorites';
import { resolveFavoriteIcon } from '@/utils/favoriteIcons';
import { useTabNavigation } from '@/composables/tabNavigation';
import { useAppSettings } from '@/stores/appSettings';
import { useFileDragDrop } from '@/composables/useFileDragDrop';
import { useTabLoadingStore } from '@/stores/tabLoading';
import { useSidebar } from '@/composables/sidebar';
import NotificationBell from '@/components/NotificationBell.vue';
import SearchBar from '@/components/SearchBar.vue';
import SpinnerIcon from '@/icons/SpinnerIcon.vue';
import { normalizePath } from '@/api';

/**
 * The strip of tabs, above everything a tab can hold.
 *
 * Drawn only where there is something to draw: the account asked for tabs, and
 * the address is one a tab can be on. Signing in is not, so the strip is not
 * there offering to leave the question unanswered.
 *
 * A tab is the button; the cross beside it is a second button rather than one
 * inside the other, which is not something a browser will lay out and not
 * something a screen reader can read.
 */
const { tabs, visible, activate, openHome, close, closeOthers, closeAll } = useTabNavigation();

/**
 * The window's own controls, at the end of the row.
 *
 * They had a row to themselves — a bell and a magnifying glass, the height of a
 * strip, above every folder for the whole life of the window. Here they cost
 * nothing: the row is already drawn, and the end of it was empty.
 *
 * Drawn only where the window's chrome is drawn at all, which is the store's
 * answer: beside a lone document or shell there is no sidebar to open and nothing
 * for them to sit above.
 */
const { toggle: toggleSidebar } = useSidebar();
const { t } = useI18n();

/**
 * Whether a double click on a tab closes it, which is an account's answer.
 *
 * Off by default, because a double click is also how somebody with a trackpad
 * ends up clicking twice: offered rather than assumed, like everything else about
 * tabs.
 */
const appSettings = useAppSettings();
const closesOnDoubleClick = computed(
  () => appSettings.userSettings?.closeTabsOnDoubleClick === true
);
const handleDoubleClick = (id) => {
  if (closesOnDoubleClick.value) close(id);
};

/**
 * How tall the strip is, said out loud.
 *
 * Two surfaces cover the whole window from `body` — the preview host and the media
 * viewer — and a document open in a tab is the tab's content, so it has to stop
 * where the strip starts. Teleported and `fixed`, they cannot be told by being
 * nested inside anything, so they are told by a custom property instead. Measured
 * rather than written down: the strip's height is a consequence of its padding and
 * its type, and a number repeated in a stylesheet would be a number to forget.
 */
const stripElement = ref(null);
const { height } = useElementSize(stripElement);
const publishHeight = (value) => {
  document.documentElement.style.setProperty('--tab-strip-height', `${Math.round(value)}px`);
};
watchEffect(() => {
  publishHeight(visible.value ? height.value : 0);
});
onUnmounted(() => {
  publishHeight(0);
});

/**
 * A tab inside a favourite wears that favourite's icon.
 *
 * Somebody who keeps four folders as favourites picked those icons to tell them
 * apart at a glance, and a row of identical folder icons throws that away. It
 * lasts as long as the tab is in that folder — walk out of it and the tab is an
 * ordinary folder again, because the icon was never the tab's, it was the
 * favourite's.
 *
 * The deepest one wins: a favourite inside another favourite is the more precise
 * answer to "where is this tab".
 */
const favorites = useFavoritesStore();
const favouriteFor = (tab) => {
  const folder = tabFolderPath(tab);
  if (!folder) return null;
  let best = null;
  for (const favorite of favorites.favorites || []) {
    const path = String(favorite?.path || '').replace(/^\/+|\/+$/g, '');
    if (!path) continue;
    if (folder !== path && !folder.startsWith(`${path}/`)) continue;
    if (!best || path.length > best.path.length) best = { path, favorite };
  }
  return best?.favorite || null;
};

const iconFor = (tab) => {
  const favorite = favouriteFor(tab);
  if (favorite) return resolveFavoriteIcon(favorite.icon);
  return TAB_KINDS_BY_ID[tab.kind]?.icon;
};

/**
 * A tab still working says so, in the place its icon will be.
 *
 * What a browser does, and it matters more here: a tab got ready in the background
 * is working while the reader is looking at something else, so without a word from
 * it there is nothing to tell "not there yet" from "there, and empty". The spinner
 * takes the icon's place rather than sitting beside it, so nothing moves when the
 * work ends — a tab that shifted its name sideways for a second would be worse than
 * saying nothing.
 */
const loading = useTabLoadingStore();
const isLoading = (tab) => loading.isLoading(tab.id);

/** And its colour, since an icon and its colour are one choice, not two. */
const iconColourFor = (tab) => favouriteFor(tab)?.color || undefined;
const titleFor = (tab) => tabTitle(tab, t) || t('tabs.newTab');

// The menu belongs to one tab at a time, named by its id rather than held as the
// tab itself: the tab it was opened on can close while the menu is open.
const menuFor = ref('');
const menu = ref(null);
onClickOutside(menu, () => {
  menuFor.value = '';
});

/**
 * Where the menu is drawn, in window coordinates.
 *
 * Drawn outside the strip, at the pointer, the way this application's other context
 * menu is. It used to sit inside the tab it belonged to and hang below it — and the
 * strip is `overflow-hidden`, because that is what makes tabs share the room and narrow
 * instead of spilling out of the row. So the menu opened and was cut away entirely:
 * there was no pinning a tab and no duplicating one, because there was nothing on
 * screen to press. No `z-index` reaches out of an ancestor that clips.
 */
const menuAt = ref({ x: 0, y: 0 });
const MENU_SIZE = { width: 224, height: 240 };

const openMenu = (id, event) => {
  if (menuFor.value === id) {
    menuFor.value = '';
    return;
  }
  // Kept inside the window: a tab at the right-hand end would otherwise put its menu
  // off the edge, which is the same defect in a different direction.
  const room = {
    width: window.innerWidth || MENU_SIZE.width,
    height: window.innerHeight || MENU_SIZE.height,
  };
  menuAt.value = {
    x: Math.max(4, Math.min(event?.clientX ?? 0, room.width - MENU_SIZE.width - 4)),
    y: Math.max(4, Math.min(event?.clientY ?? 0, room.height - MENU_SIZE.height - 4)),
  };
  menuFor.value = id;
};

/** The tab the menu is open on, or null — the menu is drawn once, not once per tab. */
const menuTab = computed(() => tabs.tabs.find((tab) => tab.id === menuFor.value) || null);

const runAndShut = (action, id) => {
  menuFor.value = '';
  action(id);
};

/**
 * Dragging a tab along the row.
 *
 * The order of the tabs is the reader's: two folders being compared belong side
 * by side, whichever order they happened to be opened in. Dragging is how every
 * browser says this, so it is how this says it too — and the same move is in the
 * tab's own menu, for a touch screen, a trackpad somebody cannot drag with, and
 * anyone reaching the strip from the keyboard.
 *
 * `held` is an id rather than a tab: the tab could close while it is being
 * dragged, and a stale object would be dropped somewhere.
 */
const held = ref('');
const over = ref('');

/**
 * Grouped with the tab it belongs beside, from the menu.
 *
 * The partner is the tab in front, or this tab's neighbour when this *is* the
 * tab in front — so the entry works on the tab somebody right-clicks first
 * instead of being greyed out on it, which is what the version before this did
 * and what taught nobody anything.
 */
/**
 * What the strip draws: one entry per lone tab, and one per pair.
 *
 * A pair is two tabs, and drawing both of them would fill the row twice as fast
 * for something the reader thinks of as one place. So the pair's left member
 * carries the entry and the right one is not drawn on its own — it is reachable
 * through the chevron, which is the only thing the entry adds.
 */
const entries = computed(() => {
  const inside = new Set(tabs.pairs.map((one) => one.right));
  return tabs.tabs
    .filter((tab) => !inside.has(tab.id))
    .map((tab) => {
      const pair = tabs.pairOf(tab.id);
      const partner = pair ? tabs.tabs.find((one) => one.id === pair.right) : null;
      return { tab, partner: partner || null };
    });
});

/** Both names when there are two, which is what the comparison tab already does. */
const labelFor = (tab, partner) =>
  partner ? `${titleFor(tab)} ↔ ${titleFor(partner)}` : titleFor(tab);

/** Which pair is unfolded, so the reader can go straight into one of its halves. */
const openedPair = ref('');
const pairAt = ref({ x: 0, y: 0 });

const togglePair = (id, event) => {
  if (openedPair.value === id) {
    openedPair.value = '';
    return;
  }
  const box = event.currentTarget?.getBoundingClientRect();
  pairAt.value = {
    x: Math.min(Math.max(8, (box?.left ?? 0) - 40), window.innerWidth - 232),
    y: Math.min((box?.bottom ?? 0) + 4, window.innerHeight - 96),
  };
  openedPair.value = id;
};

const goToMember = (id) => {
  openedPair.value = '';
  activate(id);
};

/**
 * The cross on an entry closes what the entry shows.
 *
 * Which for a pair is both of its tabs: it is one entry, and closing it leaving
 * half of itself behind in the row is not what a cross means anywhere else.
 * Ungrouping is in the menu, for whoever wants the two back.
 */
const closeEntry = (tab, partner) => {
  openedPair.value = '';
  if (partner) tabs.unpair(tab.id);
  if (partner) close(partner.id);
  close(tab.id);
};

const canShowBeside = (tab) => Boolean(tab) && tabs.canPair(tab.id);
const showBeside = (id) => {
  menuFor.value = '';
  tabs.pair(id);
};

/** Ungrouped from the tab's own menu, with neither of them closed. */
const canUngroup = (tab) => Boolean(tab) && tabs.isPaired(tab.id);
const ungroup = (id) => {
  menuFor.value = '';
  tabs.unpair(id);
};

const startDrag = (id, event) => {
  held.value = id;
  // Said to the window, so that a document or a shell drawn over a pane stops
  // taking pointers and the pane underneath can be dropped on.
  beginTabDrag();
  // Firefox starts no drag at all without something on the transfer, and `move`
  // is what this is — no copy of a tab exists.
  event.dataTransfer?.setData('text/plain', id);
  // Named as well as written in plain text: a pane takes drops of files *and* of
  // tabs, and "some text that happens to be an id" is not something to act on.
  event.dataTransfer?.setData(TAB_DRAG_TYPE, id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
};

const dragOver = (id, event) => {
  if (!held.value || id === held.value) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  over.value = id;
};

const endDrag = () => {
  held.value = '';
  over.value = '';
  endTabDrag();
};

/** Dropped on a tab: take the place of the one underneath. */
const dropOn = (id) => {
  const moved = held.value;
  endDrag();
  if (!moved || moved === id) return;
  const to = tabs.tabs.findIndex((tab) => tab.id === id);
  if (to >= 0) tabs.move(moved, to);
};

const nudge = (id, step) => {
  menuFor.value = '';
  tabs.nudge(id, step);
};

/**
 * Dropping files onto a tab.
 *
 * A tab is a folder that is already open, which makes it the cheapest target
 * there is for a move: no walking there, no window beside this one, no losing the
 * listing the files came from. The favourites in the sidebar have taken drops for
 * exactly this reason, and this is the same gesture with the same rules — move by
 * default, copy with the modifier, and the same confirmation when a document is
 * open in what is being moved.
 *
 * Which drag it is, is not a guess: the strip knows, because the strip is what
 * started the other one. `held` is set from the moment a tab is picked up, so
 * anything arriving without it came from outside the strip.
 */
const fileDrag = useFileDragDrop();

/** A folder tab as a destination, in the shape the drop handler reads. */
const dropTargetFor = (tab) => {
  const folder = tabFolderPath(tab);
  if (!folder) return null;
  const segments = normalizePath(folder).split('/').filter(Boolean);
  return {
    name: segments.at(-1) || '',
    path: segments.slice(0, -1).join('/'),
    destinationPath: normalizePath(folder),
  };
};

const isFileTarget = (tab) => {
  const target = dropTargetFor(tab);
  return Boolean(target) && fileDrag.isDragTarget(target);
};

const isCopyTarget = (tab) => {
  const target = dropTargetFor(tab);
  return Boolean(target) && fileDrag.isCopyDragTarget(target);
};

const onDragOver = (tab, event) => {
  if (held.value) {
    event.preventDefault();
    dragOver(tab.id, event);
    return;
  }
  const target = dropTargetFor(tab);
  if (target) fileDrag.handleDragOver(event, target);
};

const onDragLeave = (tab, event) => {
  if (held.value) {
    if (over.value === tab.id) over.value = '';
    return;
  }
  const target = dropTargetFor(tab);
  if (target) fileDrag.handleDragLeave(event, target);
};

const onDrop = (tab, event) => {
  if (held.value) {
    event.preventDefault();
    dropOn(tab.id);
    return;
  }
  const target = dropTargetFor(tab);
  if (target) void fileDrag.handleDrop(event, target);
};

/** Kept on purpose: at the front, narrow, and without a cross to lose it by. */
const togglePinned = (id) => {
  menuFor.value = '';
  tabs.togglePinned(id);
};

const duplicate = (id) => {
  menuFor.value = '';
  const copy = tabs.duplicate(id);
  if (copy) activate(copy.id);
};
</script>

<template>
  <div
    v-if="visible"
    ref="stripElement"
    class="flex items-end gap-1 overflow-hidden border-b border-neutral-200 bg-zinc-100 px-2 pt-1 dark:border-neutral-700 dark:bg-neutral-800"
    role="tablist"
    :aria-label="t('tabs.strip')"
    data-test="tab-strip"
  >
    <div
      v-for="{ tab, partner } in entries"
      :key="tab.id"
      class="group relative flex min-w-0 items-center rounded-t-md border border-b-0 text-sm"
      :class="[
        tab.pinned ? 'w-11 shrink-0 justify-center' : 'max-w-44 flex-1 basis-0',
        tabs.paneOf(tab.id)
          ? 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-default'
          : 'border-transparent bg-transparent hover:bg-zinc-200/70 dark:hover:bg-neutral-700/70',
        // Both panes are on screen; which of them the reader is in is said by the
        // underline rather than by the tab looking unselected, because a pane
        // that is drawn and looks closed is a tab nobody believes.
        tabs.isSplit && tabs.paneOf(tab.id) && tab.id !== tabs.activeId ? 'opacity-80' : '',
        isCopyTarget(tab)
          ? 'ring-2 ring-emerald-500'
          : isFileTarget(tab)
            ? 'ring-2 ring-accent'
            : '',
      ]"
      data-test="tab"
      :data-id="tab.id"
      :data-kind="tab.kind"
      :data-active="tab.id === tabs.activeId ? 'true' : 'false'"
      :data-pane="tabs.paneOf(tab.id) || 'none'"
      :data-paired="partner ? 'true' : 'false'"
      :data-pinned="tab.pinned ? 'true' : 'false'"
      :data-loading="isLoading(tab) ? 'true' : 'false'"
      :data-over="over === tab.id ? 'true' : 'false'"
      :data-drop="isCopyTarget(tab) ? 'copy' : isFileTarget(tab) ? 'move' : 'none'"
      draggable="true"
      @dragstart="startDrag(tab.id, $event)"
      @dragover="onDragOver(tab, $event)"
      @dragleave="onDragLeave(tab, $event)"
      @drop="onDrop(tab, $event)"
      @dragend="endDrag"
    >
      <!-- Where it would land, drawn on the tab being passed over rather than
           between two tabs: a strip that scrolls sideways has no gaps to draw in. -->
      <div
        v-if="over === tab.id"
        class="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent"
        aria-hidden="true"
      ></div>
      <button
        type="button"
        role="tab"
        draggable="true"
        :aria-selected="tab.id === tabs.activeId"
        :title="labelFor(tab, partner)"
        class="flex min-w-0 flex-1 items-center gap-1.5 py-1.5"
        :class="tab.pinned ? 'justify-center px-0' : 'px-2'"
        @click="activate(tab.id)"
        @dblclick="handleDoubleClick(tab.id)"
        @auxclick.middle.prevent="close(tab.id)"
        @contextmenu.prevent="openMenu(tab.id, $event)"
      >
        <SpinnerIcon
          v-if="isLoading(tab)"
          class="h-4 w-4 shrink-0 animate-spin text-neutral-500 dark:text-neutral-400"
          data-test="tab-loading"
        />
        <component
          :is="iconFor(tab)"
          v-else-if="iconFor(tab)"
          class="h-4 w-4 shrink-0"
          :style="iconColourFor(tab) ? { color: iconColourFor(tab) } : undefined"
        />
        <!-- A kept tab is its icon: it is there to be recognised, not read, and
             the room it gives back is room for the tabs that are being read. -->
        <span v-if="!tab.pinned" class="truncate">{{ labelFor(tab, partner) }}</span>
      </button>
      <!-- A pair unfolds, so either half is one press away rather than something
           to be found by guessing which side of the screen it is on. -->
      <button
        v-if="partner && !tab.pinned"
        type="button"
        class="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/15"
        :title="t('tabs.unfoldPair')"
        :aria-label="t('tabs.unfoldPair')"
        :aria-expanded="openedPair === tab.id"
        data-test="tab-unfold"
        @click.stop="togglePair(tab.id, $event)"
      >
        <ChevronDownIcon class="h-3.5 w-3.5" />
      </button>
      <button
        v-if="tabs.canClose && !tab.pinned"
        type="button"
        class="mr-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/15"
        :title="t('tabs.closeTab')"
        :aria-label="t('tabs.closeTab')"
        data-test="tab-close"
        @click.stop="closeEntry(tab, partner)"
      >
        <XMarkIcon class="h-4 w-4" />
      </button>
    </div>

    <button
      type="button"
      class="mb-1 shrink-0 rounded p-1.5 hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-700"
      :title="tabs.atLimit ? t('tabs.full', { count: tabs.limit }) : t('tabs.newTab')"
      :aria-label="t('tabs.newTab')"
      :disabled="tabs.atLimit"
      data-test="tab-new"
      @click="openHome"
    >
      <PlusIcon class="h-4 w-4" />
    </button>

    <!--
      The tab's own menu, drawn on the body rather than inside the tab it belongs to.

      The strip is `overflow-hidden` — that is what makes tabs share the room and narrow
      instead of spilling out of the row — so a menu hanging below a tab was cut away
      entirely, and there was no pinning a tab and no duplicating one because there was
      nothing on screen to press.
    -->
    <!-- Unfolded beside the strip rather than inside it, and for the same reason
         the menu is: the strip is `overflow-hidden` so that tabs share the room,
         and anything drawn inside it is clipped away entirely.

         At the menu's own level, which is above the surfaces a tab can hold. Below
         them it was there and unreachable: a document is drawn over the window from
         outside the page, so the one control that crosses from one half of a pair to
         the other was covered by the very documents it is for. -->
    <Teleport to="body">
      <div
        v-if="openedPair"
        data-test="tab-pair-list"
        class="fixed z-2200 w-56 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
        :style="{ left: pairAt.x + 'px', top: pairAt.y + 'px' }"
      >
        <button
          v-for="member in tabs.pairOf(openedPair)
            ? [tabs.pairOf(openedPair).left, tabs.pairOf(openedPair).right]
            : []"
          :key="member"
          type="button"
          class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 dark:hover:bg-neutral-600"
          :data-member="member"
          data-test="tab-pair-member"
          @click="goToMember(member)"
        >
          <span class="truncate">{{ titleFor(tabs.tabs.find((one) => one.id === member)) }}</span>
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="menuTab"
        ref="menu"
        class="fixed z-2200 w-56 rounded-md border border-neutral-200 bg-zinc-100 p-1 shadow-md dark:border-neutral-600 dark:bg-neutral-700"
        :style="{ left: `${menuAt.x}px`, top: `${menuAt.y}px` }"
        data-test="tab-menu"
      >
        <button
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-neutral-600"
          :disabled="!tabs.canMove(menuTab.id, -1)"
          data-test="tab-move-left"
          @click="nudge(menuTab.id, -1)"
        >
          {{ t('tabs.moveLeft') }}
        </button>
        <button
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-neutral-600"
          :disabled="!tabs.canMove(menuTab.id, 1)"
          data-test="tab-move-right"
          @click="nudge(menuTab.id, 1)"
        >
          {{ t('tabs.moveRight') }}
        </button>
        <button
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-neutral-600"
          :disabled="tabs.atLimit"
          data-test="tab-duplicate"
          @click="duplicate(menuTab.id)"
        >
          {{ t('tabs.duplicate') }}
        </button>
        <button
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-neutral-600"
          :disabled="!canShowBeside(menuTab)"
          data-test="tab-show-right"
          @click="showBeside(menuTab.id)"
        >
          {{ t('tabs.showOnRight') }}
        </button>
        <button
          v-if="canUngroup(menuTab)"
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 dark:hover:bg-neutral-600"
          data-test="tab-ungroup"
          @click="ungroup(menuTab.id)"
        >
          {{ t('tabs.ungroup') }}
        </button>
        <button
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 dark:hover:bg-neutral-600"
          data-test="tab-pin"
          @click="togglePinned(menuTab.id)"
        >
          {{ menuTab.pinned ? t('tabs.unpin') : t('tabs.pin') }}
        </button>
        <button
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-neutral-600"
          :disabled="!tabs.canClose"
          data-test="tab-close-one"
          @click="runAndShut(close, menuTab.id)"
        >
          {{ t('tabs.closeTab') }}
        </button>
        <button
          type="button"
          class="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-neutral-600"
          :disabled="!tabs.canClose"
          data-test="tab-close-others"
          @click="runAndShut(closeOthers, menuTab.id)"
        >
          {{ t('tabs.closeOthers') }}
        </button>
      </div>
    </Teleport>

    <!-- Everything closed and one new tab at the volumes: a window with no tabs
         has nowhere to be, so "close them all" means "start again". -->
    <button
      v-if="tabs.canClose"
      type="button"
      class="mb-1 shrink-0 rounded p-1.5 hover:bg-zinc-200 dark:hover:bg-neutral-700"
      :title="t('tabs.closeAll')"
      :aria-label="t('tabs.closeAll')"
      data-test="tab-close-all"
      @click="closeAll"
    >
      <XMarkIcon class="h-4 w-4" />
    </button>

    <!--
      The window's own controls: what it has to tell you, and searching.

      At the end of the strip rather than on a row below it. `ml-auto` pushes them
      to the far edge, and the tabs themselves still share whatever is left.
    -->
    <div
      v-if="tabs.wantsChrome"
      data-test="window-controls"
      class="mb-0.5 ml-auto flex shrink-0 items-center"
    >
      <button
        type="button"
        class="rounded-md p-1.5 hover:bg-zinc-200 dark:hover:bg-neutral-700 lg:hidden"
        :aria-label="t('browser.openSidebar')"
        data-test="strip-sidebar"
        @click="toggleSidebar"
      >
        <Bars3Icon class="h-5 w-5" />
      </button>
      <NotificationBell />
      <SearchBar />
    </div>
  </div>
</template>
