<script setup>
import { computed, ref, watch } from 'vue';
import HeaderLogo from '@/components/HeaderLogo.vue';
import FavMenu from '@/components/FavMenu.vue';
import VolMenu from '@/components/VolMenu.vue';
import TerminalMenu from '@/components/TerminalMenu.vue';
import SharesMenu from '@/components/SharesMenu.vue';
import TrashMenu from '@/components/TrashMenu.vue';
import ClipboardProgress from '@/components/ClipboardProgress.vue';
import UserMenu from '@/components/UserMenu.vue';
import NotificationToastContainer from '@/components/NotificationToastContainer.vue';
import NotificationPanel from '@/components/NotificationPanel.vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useStorage, useEventListener, useMediaQuery } from '@vueuse/core';

import ExplorerContextMenu from '@/components/ExplorerContextMenu.vue';
// The terminal carries xterm with it, which is a large library for something
// most sessions never open and only an administrator can. Loaded when the first
// terminal is asked for rather than on every page — which is why the host below
// is not merely hidden when there are none, it is not there.
import { useAuthStore } from '@/stores/auth';
import { useAppSettings } from '@/stores/appSettings';
import { useFeaturesStore } from '@/stores/features';
import { useI18n } from 'vue-i18n';
import { pageTitleFor } from '@/utils/pageTitle';
import { usePageTitle } from '@/composables/usePageTitle';
import { useFileStore } from '@/stores/fileStore';
import InfoPanel from '@/components/InfoPanel.vue';
import VersionsPanel from '@/components/VersionsPanel.vue';
import { useFileUploader } from '@/composables/fileUploader';
import { useKeyboardShortcuts } from '@/composables/keyboardShortcuts';
import SpotlightSearch from '@/components/SpotlightSearch.vue';
import FavoriteEditDialog from '@/components/FavoriteEditDialog.vue';
import DestinationPickerDialog from '@/components/DestinationPickerDialog.vue';
import OnlyOfficeTransferConfirm from '@/components/OnlyOfficeTransferConfirm.vue';
import SeparateDownloadConfirm from '@/components/SeparateDownloadConfirm.vue';
import {
  Bars3Icon,
  ArrowRightOnRectangleIcon,
  InformationCircleIcon,
} from '@heroicons/vue/24/outline';
import FolderViewToolbar from '@/components/FolderViewToolbar.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const appSettings = useAppSettings();
const featuresStore = useFeaturesStore();

// Resizable aside state
const asideWidth = useStorage('browser-aside-width', 230);

const isDragging = ref(false);
const minAsideWidth = 200;
const maxAsideWidth = 460;
let startX = 0;
let startWidth = 0;

function onPointerDown(e) {
  isDragging.value = true;
  startX = e.clientX;
  startWidth = asideWidth.value;
  // Prevent selecting text while dragging
  document.body.classList.add('select-none');
}

useEventListener(window, 'pointermove', (e) => {
  if (!isDragging.value) return;
  const delta = e.clientX - startX;
  const next = Math.min(maxAsideWidth, Math.max(minAsideWidth, startWidth + delta));
  asideWidth.value = next;
  e.preventDefault();
});

useEventListener(window, 'pointerup', () => {
  if (!isDragging.value) return;
  isDragging.value = false;
  document.body.classList.remove('select-none');
});

const isDesktop = useMediaQuery('(min-width: 1024px)');
const isSidebarOpen = ref(false);

function openSidebar() {
  isSidebarOpen.value = true;
}

function closeSidebar() {
  isSidebarOpen.value = false;
}

function toggleSidebar() {
  isSidebarOpen.value = !isSidebarOpen.value;
}

watch(isDesktop, (desktop) => {
  if (desktop) closeSidebar();
});

watch(
  () => route.fullPath,
  () => {
    closeSidebar();
  }
);

watch(isSidebarOpen, (open) => {
  document.body.classList.toggle('overflow-hidden', open && !isDesktop.value);
});

useEventListener(window, 'keydown', (e) => {
  if (e.key === 'Escape' && isSidebarOpen.value) {
    closeSidebar();
  }
});

const { t: translate, te } = useI18n();
const fileStore = useFileStore();
// At the top of a share its address holds only the token; the share has a name.
const shareName = computed(() => {
  const info = fileStore.currentPathData?.shareInfo;
  return info?.label || info?.sourceFolderName || '';
});
usePageTitle(computed(() => pageTitleFor(route, translate, { te, shareName: shareName.value })));

const showBrowseToolbar = computed(() => String(route.path || '').startsWith('/browse'));
const showSidebarFavorites = computed(
  () => appSettings.userSettings?.showSidebarFavorites !== false
);
const showSidebarShares = computed(() => appSettings.userSettings?.showSidebarShares !== false);
const showSidebarTools = computed(() => appSettings.userSettings?.showSidebarTools !== false);

// Ensure Uppy is initialized app-wide and bound to current path
useFileUploader();

// Global keyboard shortcuts for the browser layout
useKeyboardShortcuts();

const handleGuestLogin = () => {
  // Redirect to login with current path as redirect
  router.push({
    name: 'auth-login',
    query: { redirect: route.fullPath },
  });
};
</script>

<template>
  <div class="relative flex h-full w-full overflow-hidden">
    <aside
      data-test="browser-aside"
      class="flex flex-col bg-default-muted dark:bg-default-muted pt-4 pb-2 px-6 shrink-0 fixed inset-y-0 left-0 transition-transform duration-200 ease-in-out z-50 lg:sticky lg:top-0 lg:h-full lg:translate-x-0"
      :class="isSidebarOpen ? 'translate-x-0' : '-translate-x-full'"
      :style="{ width: asideWidth + 'px' }"
    >
      <HeaderLogo
        :appname="appSettings.state.branding.appName"
        :logoUrl="appSettings.state.branding.appLogoUrl"
      />

      <!-- Guest Info Card -->
      <div
        v-if="auth.isGuest"
        class="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800"
      >
        <div class="flex items-start gap-3 mb-3">
          <InformationCircleIcon class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <h3 class="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">Guest Access</h3>
            <p class="text-xs text-blue-700 dark:text-blue-300">
              You're viewing a shared item. Sign in to access your files and all features.
            </p>
          </div>
        </div>
        <button
          @click="handleGuestLogin"
          class="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition"
        >
          <ArrowRightOnRectangleIcon class="w-4 h-4" />
          Sign In
        </button>
      </div>

      <div class="overflow-y-auto -mx-6 px-6 mt-6 scroll-on-hover">
        <FavMenu v-if="!auth.isGuest && showSidebarFavorites" />
        <SharesMenu v-if="!auth.isGuest && showSidebarShares" />
        <VolMenu v-if="!auth.isGuest" />
        <TrashMenu v-if="!auth.isGuest && featuresStore.trashEnabled" />
        <TerminalMenu v-if="featuresStore.terminalEnabled && showSidebarTools" />
      </div>
      <UserMenu v-if="!auth.isGuest" class="mt-auto -mx-4" />
    </aside>

    <!-- Resizer handle -->
    <div
      class="relative w-px cursor-col-resize bg-transparent group select-none hidden lg:block"
      @pointerdown="onPointerDown"
      :aria-label="$t('browser.resizeSidebar')"
    >
      <!-- Visual guide line -->
      <div
        class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-neutral-200 dark:bg-neutral-900 group-hover:bg-neutral-500"
      ></div>
    </div>

    <main class="relative flex min-h-0 min-w-0 grow flex-col overflow-hidden bg-default shadow-lg">
      <FolderViewToolbar v-if="showBrowseToolbar" @toggle-sidebar="toggleSidebar" />

      <!-- Mobile-only toggle for non-browse views (keeps existing view layouts unchanged) -->
      <button
        v-else-if="!isDesktop && !isSidebarOpen"
        type="button"
        class="fixed left-2 top-2 z-40 rounded-md p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700"
        :aria-label="$t('browser.openSidebar')"
        @click="openSidebar"
      >
        <Bars3Icon class="h-6 w-6" />
      </button>

      <ExplorerContextMenu>
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <RouterView v-slot="{ Component, route: viewRoute }">
            <component :is="Component" :key="viewRoute.fullPath" class="min-h-0 flex-1" />
          </RouterView>
        </div>
      </ExplorerContextMenu>

      <!-- Beside what a tab holds rather than over the window: the sidebar and
           the strip of tabs stay reachable while a shell is open, which is the
           whole point of a terminal that belongs to one tab. -->
    </main>

    <!-- Backdrop to close sidebar on small screens -->
    <button
      v-if="isSidebarOpen && !isDesktop"
      type="button"
      class="fixed inset-0 bg-black/20 z-40 lg:hidden"
      :aria-label="$t('browser.closeSidebar')"
      @click="closeSidebar"
    ></button>
    <ClipboardProgress class="z-560" />
    <InfoPanel />
    <VersionsPanel />
    <SpotlightSearch />
    <FavoriteEditDialog />
    <DestinationPickerDialog />
    <OnlyOfficeTransferConfirm />
    <SeparateDownloadConfirm />
    <NotificationToastContainer />
    <NotificationPanel />

    <!-- Footer with powered by link -->
    <footer
      v-if="appSettings.state.branding.showPoweredBy"
      class="fixed bottom-0 right-0 p-2 sm:p-4 text-xs text-neutral-500 dark:text-neutral-400"
    >
      <a
        href="https://explorer.nxz.ai"
        target="_blank"
        rel="noopener noreferrer"
        class="text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 underline-offset-2 hover:underline"
      >
        Powered by nextExplorer
      </a>
    </footer>
  </div>
</template>

<style scoped>
/*
 * The scrollbar appears on hover; the scrolling never goes away.
 *
 * This used to be `overflow-y: hidden` until `:hover`, which hides the
 * scrollbar by making the panel unscrollable — so on a touch screen, where
 * nothing hovers, whatever was below the fold could not be reached at all.
 * Measured with 31 volumes in the sidebar: 897 px of it.
 */
.scroll-on-hover {
  overflow-y: auto;
  scrollbar-width: none;
}
.scroll-on-hover::-webkit-scrollbar {
  width: 0;
  height: 0;
}
.scroll-on-hover:hover {
  scrollbar-width: thin;
}
.scroll-on-hover:hover::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
</style>
