<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { watch } from 'vue';
import { ArrowRightOnRectangleIcon, InformationCircleIcon } from '@heroicons/vue/24/outline';
import HeaderLogo from '@/components/HeaderLogo.vue';
import FavMenu from '@/components/FavMenu.vue';
import SharesMenu from '@/components/SharesMenu.vue';
import VolMenu from '@/components/VolMenu.vue';
import TrashMenu from '@/components/TrashMenu.vue';
import TerminalMenu from '@/components/TerminalMenu.vue';
import UserMenu from '@/components/UserMenu.vue';
import { useAuthStore } from '@/stores/auth';
import { useAppSettings } from '@/stores/appSettings';
import { useFeaturesStore } from '@/stores/features';
import { useSidebar } from '@/composables/sidebar';

/**
 * The window's own sidebar: where you can go, rather than what you are looking
 * at.
 *
 * One of these for the window, which is what makes two tabs side by side read
 * as one window rather than two. It used to be part of the browser layout and
 * went with it — so a document tab, a shell, or anything else outside that
 * layout had no sidebar at all, and a pane could only ever hold something that
 * layout drew.
 */
const auth = useAuthStore();
const appSettings = useAppSettings();
const featuresStore = useFeaturesStore();
const route = useRoute();
const router = useRouter();
const { width, isOpen, close, onResizeStart } = useSidebar();

// Going somewhere is what it is for, so arriving closes it on a narrow screen.
watch(() => route.fullPath, close);

const showFavorites = computed(() => appSettings.userSettings?.showSidebarFavorites !== false);
const showShares = computed(() => appSettings.userSettings?.showSidebarShares !== false);
const showTools = computed(() => appSettings.userSettings?.showSidebarTools !== false);

const handleGuestLogin = () => {
  router.push({ name: 'auth-login', query: { redirect: route.fullPath } });
};
</script>

<template>
  <aside
    data-test="browser-aside"
    class="flex flex-col bg-default-muted dark:bg-default-muted pt-4 pb-2 px-6 shrink-0 fixed inset-y-0 left-0 transition-transform duration-200 ease-in-out z-50 lg:sticky lg:top-0 lg:h-full lg:translate-x-0"
    :class="isOpen ? 'translate-x-0' : '-translate-x-full'"
    :style="{ width: width + 'px' }"
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
        class="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition"
        @click="handleGuestLogin"
      >
        <ArrowRightOnRectangleIcon class="w-4 h-4" />
        Sign In
      </button>
    </div>

    <div class="overflow-y-auto -mx-6 px-6 mt-6 scroll-on-hover">
      <FavMenu v-if="!auth.isGuest && showFavorites" />
      <SharesMenu v-if="!auth.isGuest && showShares" />
      <VolMenu v-if="!auth.isGuest" />
      <TrashMenu v-if="!auth.isGuest && featuresStore.trashEnabled" />
      <TerminalMenu v-if="featuresStore.terminalEnabled && showTools" />
    </div>
    <UserMenu v-if="!auth.isGuest" class="mt-auto -mx-4" />
  </aside>

  <!-- The edge, draggable. -->
  <div
    class="relative w-px cursor-col-resize bg-transparent group select-none hidden lg:block"
    :aria-label="$t('browser.resizeSidebar')"
    @pointerdown="onResizeStart"
  >
    <div
      class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-neutral-200 dark:bg-neutral-900 group-hover:bg-neutral-500"
    ></div>
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
