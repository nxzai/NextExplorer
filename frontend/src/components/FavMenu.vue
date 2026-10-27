<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import * as OutlineIcons from '@heroicons/vue/24/outline';
import { ExclamationTriangleIcon } from '@heroicons/vue/24/outline';
import { storeToRefs } from 'pinia';
import draggable from 'vuedraggable';
import { useFavoritesStore } from '@/stores/favorites';
import { useNavigation } from '@/composables/navigation';
import { useOpenPlaceInTab } from '@/composables/openPlaceInTab';
import { normalizePath } from '@/api';
import { useI18n } from 'vue-i18n';
import { useFavoriteEditor } from '@/composables/useFavoriteEditor';
import { resolveFavoriteIcon } from '@/utils/favoriteIcons';
import { useFileDragDrop } from '@/composables/useFileDragDrop';

const {
  ChevronDownIcon,
  StarIcon: StarIconOutline,
  PencilSquareIcon,
  XMarkIcon,
  Bars3Icon,
} = OutlineIcons;

const rootEl = ref(null);
const open = ref(true);
const isEditMode = ref(false);
const favoritesStore = useFavoritesStore();
const { favorites } = storeToRefs(favoritesStore);
const route = useRoute();
const { openBreadcrumb } = useNavigation();
// The middle button opens a place in a tab behind, as it does a folder row.
const { openPlaceInTab } = useOpenPlaceInTab();
const { openEditorForFavorite } = useFavoriteEditor();
const { handleDragOver, handleDragLeave, handleDrop, isDragTarget, isCopyDragTarget } =
  useFileDragDrop();

const resolveIconComponent = resolveFavoriteIcon;
const getFavoriteLabel = (favorite = {}) => {
  const path = favorite.path || '';
  const autoLabel = path.split('/').pop() || path;
  return favorite.label || autoLabel;
};

const { t } = useI18n();

const currentPath = computed(() => {
  const rawPath = route.params?.path;
  if (Array.isArray(rawPath)) {
    return normalizePath(rawPath.join('/'));
  }
  if (typeof rawPath === 'string') {
    return normalizePath(rawPath);
  }
  return '';
});

const isActiveFav = (favoritePath = '') => {
  const normalizedFavorite = normalizePath(favoritePath || '');
  return normalizedFavorite === currentPath.value;
};

/**
 * Command, or control, opens it in a tab behind — what a browser does with a
 * link. `metaKey` first, because on a Mac the command key is the one people
 * reach for and control there means something else entirely.
 */
const handleOpenFavorite = (favorite, event) => {
  if (!favorite?.path) {
    return;
  }
  if ((event?.metaKey || event?.ctrlKey) && openPlaceInTab(favorite.path)) return;
  openBreadcrumb(favorite.path);
};

const favoriteDropTarget = (favorite = {}) => {
  const destinationPath = normalizePath(favorite.path || '');
  const segments = destinationPath.split('/').filter(Boolean);
  return {
    name: segments.at(-1) || '',
    path: segments.slice(0, -1).join('/'),
    destinationPath,
  };
};

const isFavoriteDragTarget = (favorite) => isDragTarget(favoriteDropTarget(favorite));
const isFavoriteCopyTarget = (favorite) => isCopyDragTarget(favoriteDropTarget(favorite));

const toggleEditMode = () => {
  if (!favorites.value.length) return;
  isEditMode.value = !isEditMode.value;
};

const handleEditFavorite = (favorite) => {
  if (!favorite) return;
  openEditorForFavorite(favorite);
};

const handleRemoveFavorite = async (favorite) => {
  try {
    await favoritesStore.removeFavorite(favorite.path);
  } catch (error) {
    console.error('Failed to remove favorite from sidebar menu', error);
  }
};

const handleGlobalPointerDown = (event) => {
  if (!isEditMode.value) return;
  const el = rootEl.value;
  if (!el) return;
  if (el === event.target || el.contains(event.target)) return;
  isEditMode.value = false;
};

const handleReorderEnd = async () => {
  if (!favorites.value.length) return;

  try {
    const orderedIds = favorites.value.map((favorite) => favorite.id);
    await favoritesStore.reorderFavorites(orderedIds);
  } catch (error) {
    console.error('Failed to reorder favorites', error);
    // Reload from server to ensure a consistent state if the reorder fails
    try {
      await favoritesStore.loadFavorites();
    } catch (reloadError) {
      console.error('Failed to reload favorites after reorder error', reloadError);
    }
  }
};

onMounted(async () => {
  await favoritesStore.ensureLoaded();
  window.addEventListener('pointerdown', handleGlobalPointerDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown);
});
</script>

<template>
  <div ref="rootEl">
    <h4
      class="group flex items-center justify-between py-2 pt-2 text-sm text-neutral-400 dark:text-neutral-500 font-medium"
    >
      {{ t('titles.favorites') }}
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="hidden group-hover:flex items-center justify-center rounded-full border border-zinc-400 dark:border-zinc-500 px-3 text-xs text-neutral-500 dark:text-neutral-400"
          @click.stop="toggleEditMode"
          :disabled="!favorites.length"
        >
          {{ t('common.edit') }}
        </button>
        <button
          :aria-label="t('common.toggleSection')"
          @click="open = !open"
          class="hidden group-hover:block active:text-black dark:active:text-white text-neutral-500"
          type="button"
        >
          <ChevronDownIcon
            class="h-4 transition-transform duration-300 ease-in-out"
            :class="{ 'rotate-0': open, '-rotate-90': !open }"
          />
        </button>
      </div>
    </h4>
    <div class="overflow-hidden">
      <transition
        enter-active-class="transition-all duration-500"
        leave-active-class="transition-all duration-500"
        enter-from-class="-mt-[100%]"
        enter-to-class="mt-0"
        leave-from-class="mt-0"
        leave-to-class="-mt-[100%]"
      >
        <div v-if="open" class="overflow-hidden">
          <template v-if="favorites.length">
            <draggable
              v-model="favorites"
              item-key="id"
              handle=".favorite-drag-handle"
              :disabled="!isEditMode || favorites.length < 2"
              :animation="250"
              easing="cubic-bezier(0.25, 0.46, 0.45, 0.94)"
              ghost-class="favorite-ghost"
              chosen-class="favorite-chosen"
              drag-class="favorite-drag"
              :force-fallback="true"
              @end="handleReorderEnd"
            >
              <template #item="{ element: favorite }">
                <div class="group/item relative mb-3 flex items-center gap-2 favorite-drag-handle">
                  <Bars3Icon
                    v-if="isEditMode"
                    class="h-4 w-4 shrink-0 cursor-grab text-neutral-400 group-hover/item:text-white dark:text-neutral-500 dark:group-hover/item:text-neutral-100 transition-colors duration-150"
                  />
                  <button
                    type="button"
                    @click="handleOpenFavorite(favorite, $event)"
                    @auxclick.middle.prevent="openPlaceInTab(favorite.path)"
                    @dragover="handleDragOver($event, favoriteDropTarget(favorite))"
                    @dragleave="handleDragLeave($event, favoriteDropTarget(favorite))"
                    @drop="handleDrop($event, favoriteDropTarget(favorite))"
                    class="truncate"
                    :title="
                      favorite.available === false ? t('favorites.volumeUnavailable') : undefined
                    "
                    :class="[
                      'cursor-pointer flex w-full items-center gap-3 rounded-lg text-sm transition-colors',
                      favorite.available === false ? 'opacity-50' : '',
                      isActiveFav(favorite.path)
                        ? 'text-neutral-950 dark:text-white'
                        : 'text-neutral-950 dark:text-neutral-300/90',
                      isFavoriteCopyTarget(favorite)
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-inset ring-emerald-500 dark:ring-emerald-400'
                        : isFavoriteDragTarget(favorite)
                          ? 'bg-blue-50 dark:bg-blue-950/40 ring-2 ring-inset ring-blue-500 dark:ring-blue-400'
                          : '',
                    ]"
                  >
                    <component
                      :is="resolveIconComponent(favorite.icon)"
                      class="h-5 shrink-0"
                      :style="{ color: favorite.color || 'currentColor' }"
                    />
                    <span class="truncate">{{ getFavoriteLabel(favorite) }}</span>
                    <ExclamationTriangleIcon
                      v-if="favorite.available === false"
                      class="h-4 w-4 shrink-0 text-amber-500"
                      :aria-label="t('favorites.volumeUnavailable')"
                    />
                  </button>
                  <template v-if="isEditMode">
                    <button
                      :aria-label="t('common.edit')"
                      type="button"
                      class="shrink-0 rounded-md text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-700 transition-colors duration-150"
                      @click.stop="handleEditFavorite(favorite)"
                    >
                      <PencilSquareIcon class="h-4 w-4" />
                    </button>
                    <button
                      :aria-label="t('common.remove')"
                      type="button"
                      class="shrink-0 rounded-md text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors duration-150"
                      @click.stop="handleRemoveFavorite(favorite)"
                    >
                      <XMarkIcon class="h-4 w-4" />
                    </button>
                  </template>
                </div>
              </template>
            </draggable>
          </template>
          <div
            v-else
            class="my-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-xs text-neutral-500 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-neutral-400"
          >
            <div class="flex items-center gap-2 text-neutral-500 dark:text-neutral-300">
              <StarIconOutline class="h-4 w-4" />
              <span class="text-sm font-medium text-neutral-600 dark:text-neutral-100">
                {{ t('favorites.emptyTitle') }}
              </span>
            </div>
            <p class="mt-2 leading-relaxed">
              {{ t('favorites.emptyDescription') }}
            </p>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
/* Ghost: the placeholder showing where the item will drop */
.favorite-ghost {
  opacity: 0.4 !important;
}

/* Chosen: the item being picked up - keep it visible initially */
.favorite-chosen {
  opacity: 0.7 !important;
  cursor: grabbing !important;
}

/* Drag: the element that follows the cursor - hide it */
.favorite-drag {
  cursor: grabbing !important;
  opacity: 0 !important;
}
</style>
