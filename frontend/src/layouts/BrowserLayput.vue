<script setup>
import { computed, watch } from 'vue';
import HeaderLogo from '@/components/HeaderLogo.vue';
import FavMenu from '@/components/FavMenu.vue';
import VolMenu from '@/components/VolMenu.vue';
import CreateNew from '@/components/CreateNew.vue';
import ViewMode from '@/components/ViewMode.vue';
import BreadCrumb from '@/components/BreadCrumb.vue';
import NavButtons from '@/components/NavButtons.vue';
import MenuClipboard from '@/components/MenuClipboard.vue';
import UploadProgress from '@/components/UploadProgress.vue';
import SettingsBar from '@/components/SettingsBar.vue';
import MenuItemInfo from '@/components/MenuItemInfo.vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useTitle } from '@vueuse/core';
import MenuSortBy from '@/components/MenuSortBy.vue';
import ImagePreview from '@/components/ImagePreview.vue';
import { useTabStore } from '@/stores/tabStore';

const route = useRoute();
const router = useRouter();
const tabStore = useTabStore();

const tabs = computed(() => tabStore.tabList);
const activeTabId = computed(() => tabStore.activeTabId);
const canCloseTabs = computed(() => tabs.value.length > 1);

const resolveParamsPath = (paramsPath) => {
  if (Array.isArray(paramsPath)) {
    return paramsPath.join('/');
  }
  return paramsPath || '';
};

const isBrowseRoute = computed(() => route.path.startsWith('/browse'));

watch(
  () => [route.fullPath, route.state?.tabId],
  () => {
    if (!isBrowseRoute.value) {
      return;
    }

    const path = resolveParamsPath(route.params.path);
    const tabId = route.state?.tabId;

    if (tabId) {
      const existingById = tabStore.findTabById(tabId);
      if (existingById) {
        tabStore.setActiveTab(tabId);
        tabStore.updateTabPath(tabId, path);
      } else {
        tabStore.openTab(path, { id: tabId, allowDuplicate: true });
      }
      return;
    }

    const existingByPath = tabStore.findTabByPath(path);
    if (existingByPath) {
      tabStore.setActiveTab(existingByPath.id);
      return;
    }

    tabStore.ensureActiveTabPath(path);
  },
  { immediate: true },
);

const browseDestinationForTab = (tab) => {
  if (!tab) {
    return '/browse/';
  }
  const normalized = tab.path ? tab.path : '';
  return normalized ? `/browse/${normalized}` : '/browse/';
};

const navigateToTab = (tab) => {
  if (!tab) return;
  tabStore.setActiveTab(tab.id);

  const destination = browseDestinationForTab(tab);
  const navState = { tabId: tab.id };
  const samePath = route.path === destination;
  const sameTab = route.state?.tabId === tab.id;

  if (samePath && sameTab) {
    return;
  }

  if (samePath) {
    router.replace({ path: destination, state: navState });
  } else {
    router.push({ path: destination, state: navState });
  }
};

const handleSelectTab = (tabId) => {
  const target = tabStore.findTabById(tabId);
  if (!target) return;
  navigateToTab(target);
};

const handleAddTab = () => {
  const basePath = tabStore.activeTab?.path || '';
  const newTab = tabStore.openTab(basePath, { allowDuplicate: true });
  navigateToTab(newTab);
};

const handleCloseTab = (tabId) => {
  const wasActive = tabId === tabStore.activeTabId;
  const { nextTab } = tabStore.closeTab(tabId);

  if (tabStore.tabs.length === 0) {
    const fallback = tabStore.openTab('', { allowDuplicate: true });
    navigateToTab(fallback);
    return;
  }

  if (wasActive && nextTab) {
    navigateToTab(nextTab);
  }
};

const currentPathName = computed(() => {
  const activeTab = tabStore.activeTab;
  if (activeTab?.label) {
    return activeTab.label;
  }
  const rawPath = resolveParamsPath(route.params.path);
  if (rawPath) {
    const segments = rawPath.split('/');
    const last = segments.pop();
    return last || 'Volumes';
  }
  return 'Volumes';
});

useTitle(currentPathName);
</script>

<template>
  <div class="relative flex h-full w-full">
    <aside class="w-[230px] shrink-0 bg-nextgray-100 p-6 px-5 dark:bg-zinc-800 dark:bg-opacity-70">
      <HeaderLogo />
      <CreateNew />
      <FavMenu />
      <VolMenu />
    </aside>

    <main class="flex grow flex-col shadow-lg dark:bg-zinc-800 dark:bg-opacity-95">
      <div class="flex items-center justify-between gap-2 border-b border-neutral-200 px-6 pt-4 pb-2 dark:border-neutral-700">
        <div class="flex min-w-0 gap-2 overflow-x-auto pr-2">
          <template v-if="tabs.length">
            <div
              v-for="tab in tabs"
              :key="tab.id"
              class="group flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors"
              :class="tab.id === activeTabId
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white'
                : 'bg-white/60 text-neutral-600 hover:bg-white dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'"
              :title="tab.path || 'Volumes'"
              role="tab"
              tabindex="0"
              @click="handleSelectTab(tab.id)"
              @keydown.enter.prevent="handleSelectTab(tab.id)"
              @keydown.space.prevent="handleSelectTab(tab.id)"
            >
              <span class="max-w-[10rem] truncate">{{ tab.label || 'Volumes' }}</span>
              <span
                v-if="canCloseTabs"
                class="ml-1 text-xs opacity-0 transition-opacity group-hover:opacity-80 hover:opacity-100"
                role="button"
                tabindex="0"
                aria-label="Close tab"
                @click.stop="handleCloseTab(tab.id)"
                @keydown.enter.prevent.stop="handleCloseTab(tab.id)"
                @keydown.space.prevent.stop="handleCloseTab(tab.id)"
              >
                ×
              </span>
            </div>
          </template>
          <p v-else class="text-xs text-neutral-500 dark:text-neutral-400">Loading tabs…</p>
        </div>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-lg leading-none text-neutral-500 transition hover:bg-white hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-700"
          aria-label="New tab"
          @click="handleAddTab"
        >
          +
        </button>
      </div>

      <div class="flex items-center gap-3 px-6 py-4 text-sm shadow-md dark:bg-nextgray-700 dark:bg-opacity-50">
        <NavButtons />
        <BreadCrumb class="mr-auto" />
        <MenuClipboard />
        <div class="mx-3 h-8 w-[1px] bg-neutral-200 dark:bg-neutral-700"></div>
        <MenuItemInfo />
        <div class="mx-3 h-8 w-[1px] bg-neutral-200 dark:bg-neutral-700"></div>
        <MenuSortBy />
        <div class="mx-3 h-8 w-[1px] bg-neutral-200 dark:bg-neutral-700"></div>
        <ViewMode />
        <div class="mx-3 h-8 w-[1px] bg-neutral-200 dark:bg-neutral-700"></div>
        <SettingsBar />
      </div>

      <div class="grow overflow-y-auto px-6 pb-6 pt-4">
        <router-view :key="route.fullPath"></router-view>
      </div>
    </main>
    <UploadProgress />
    <ImagePreview />
  </div>
</template>
