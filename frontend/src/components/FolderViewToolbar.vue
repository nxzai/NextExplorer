<script setup>
/**
 * One folder's own toolbar: where it is, how it is sorted, how it is shown, and
 * what can be made in it.
 *
 * Drawn per pane, because all of it is about a folder — two panes on two folders
 * are two breadcrumbs and two view switchers, which is the point of having them
 * side by side. Searching and what the application has to tell you went to
 * `WindowBar.vue`: those belong to the window, and two of each was absurd.
 */
import { computed, ref } from 'vue';
import NavButtons from '@/components/NavButtons.vue';
import BreadCrumb from '@/components/BreadCrumb.vue';
import MenuItemInfo from '@/components/MenuItemInfo.vue';
import MenuSortBy from '@/components/MenuSortBy.vue';
import ViewMode from '@/components/ViewMode.vue';
import PhotoSizeControl from '@/components/PhotoSizeControl.vue';
import MenuShare from '@/components/MenuShare.vue';
import CreateNew from '@/components/CreateNew.vue';
import { useFileActions } from '@/composables/fileActions';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import { useFileStore } from '@/stores/fileStore';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDownTrayIcon, ArrowPathIcon, HomeIcon } from '@heroicons/vue/24/outline';
import { useInputMode } from '@/composables/useInputMode';
import InlineQuickActions from '@/components/InlineQuickActions.vue';

const settings = useSettingsStore();
const auth = useAuthStore();
const fileStore = useFileStore();
const route = useRoute();
const router = useRouter();
const { isTouchDevice } = useInputMode();
const actions = useFileActions();

// Check if we're at the volumes home view (no path selected)
const isVolumesView = computed(() => {
  const p = route.params.path;
  const s = Array.isArray(p) ? p.join('/') : p || '';
  return !s || s.trim() === '';
});

// Check if user can upload/create (based on backend permissions)
const canCreate = computed(() => {
  // Always hide on volumes view
  if (isVolumesView.value) return false;

  const currentPathData = fileStore.currentPathData;

  // If access metadata is available, honor it for everyone (including authenticated users on shares).
  if (currentPathData && typeof currentPathData === 'object') {
    const canCreateFolder = currentPathData?.canCreateFolder ?? true;
    const canCreateFile = currentPathData?.canCreateFile ?? true;
    const canUpload = currentPathData?.canUpload ?? true;
    return Boolean(canCreateFolder || canCreateFile || canUpload);
  }

  // Backward compat: if backend doesn't send access metadata, fail open for authenticated users.
  if (auth.isAuthenticated && !auth.isGuest) return true;

  // Guests should only see create/upload actions when explicitly allowed.
  return false;
});

const goHome = async () => {
  await router.push('/browse/');
};

// Drives lazy rendering of the folder quick-actions (only while hovered).
const crumbHover = ref(false);

// Refresh: re-fetch the current folder listing (spins the icon while loading).
const refreshing = ref(false);
const refreshFolder = async () => {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await fileStore.refresh();
  } finally {
    refreshing.value = false;
  }
};

const toggleSelectionMode = () => {
  fileStore.toggleSelectionMode({ clearOnDisable: true });
};

const downloadCurrentFolder = () => {
  actions.runDownloadCurrentFolder();
};
</script>

<template>
  <div class="sticky top-0 z-40 bg-white/90 p-3 backdrop-blur dark:bg-default/90">
    <div class="flex flex-wrap items-center shrink-0">
      <CreateNew v-if="canCreate" class="mr-3" />

      <div
        class="flex items-center max-sm:order-2 max-sm:basis-full max-sm:bg-zinc-100 max-sm:dark:bg-zinc-800 max-sm:p-1 max-sm:my-1 max-sm:rounded-xl"
      >
        <button
          v-if="!isVolumesView"
          type="button"
          class="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 md:hidden"
          :aria-label="$t('nav.home')"
          :title="$t('nav.home')"
          @click="goHome"
        >
          <HomeIcon class="h-5 w-5" />
        </button>
        <button
          v-if="!isVolumesView"
          type="button"
          class="shrink-0 mr-1 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 dark:active:bg-neutral-600"
          :title="$t('nav.refresh')"
          :aria-label="$t('nav.refresh')"
          @click="refreshFolder"
        >
          <ArrowPathIcon class="h-5 w-5" :class="{ 'animate-spin': refreshing }" />
        </button>
        <NavButtons />
        <div
          class="group/crumb flex min-w-0 items-center mr-auto"
          @mouseenter="crumbHover = true"
          @mouseleave="crumbHover = false"
        >
          <BreadCrumb class="ml-2" />
          <InlineQuickActions v-if="!isVolumesView" folder :active="crumbHover" class="ml-1" />
        </div>
        <button
          v-if="isTouchDevice && !isVolumesView"
          type="button"
          class="ml-2 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          :class="
            fileStore.selectionMode
              ? 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
              : 'bg-white text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-900/40 dark:text-neutral-200 dark:hover:bg-neutral-800'
          "
          @click="toggleSelectionMode"
        >
          {{ fileStore.selectionMode ? $t('common.done') : $t('common.select') }}
        </button>
      </div>

      <div class="flex items-center ml-auto">
        <template v-if="!isVolumesView">
          <button
            v-if="actions.canDownloadCurrentFolder.value"
            type="button"
            class="p-[6px] rounded-md transition-colors hover:bg-[rgb(239,239,240)] active:bg-zinc-200 dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
            :title="$t('actions.downloadFolder')"
            :aria-label="$t('actions.downloadFolder')"
            @click="downloadCurrentFolder"
          >
            <ArrowDownTrayIcon class="w-6" />
          </button>
          <MenuItemInfo class="ml-auto" />
          <MenuShare />
          <div class="h-8 w-px mx-1 md:mx-3 bg-neutral-200 dark:bg-neutral-700"></div>
          <MenuSortBy />
          <div class="h-8 w-px mx-1 md:mx-3 bg-neutral-200 dark:bg-neutral-700"></div>
          <ViewMode />
          <PhotoSizeControl v-if="settings.view === 'photos'" />
          <div class="max-md:hidden h-8 w-px mx-1 md:mx-3 bg-neutral-200 dark:bg-neutral-700"></div>
        </template>
      </div>
    </div>
  </div>
</template>
