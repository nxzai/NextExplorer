<script setup>
import { computed, defineAsyncComponent, ref } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { useEventListener, useStorage } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useAccountLanguage } from '@/composables/useAccountLanguage';
import { useConfigErrorGate } from '@/composables/useConfigErrorGate';
import { useTabNavigation, useTabRouteSync } from '@/composables/tabNavigation';
import ConfigErrorScreen from '@/components/ConfigErrorScreen.vue';
import ConfigWarningNotice from '@/components/ConfigWarningNotice.vue';
import TabStrip from '@/components/TabStrip.vue';
import TabPane from '@/components/TabPane.vue';
import WindowSidebar from '@/components/WindowSidebar.vue';
import WindowBar from '@/components/WindowBar.vue';
import ExplorerContextMenu from '@/components/ExplorerContextMenu.vue';
import ClipboardProgress from '@/components/ClipboardProgress.vue';
import InfoPanel from '@/components/InfoPanel.vue';
import VersionsPanel from '@/components/VersionsPanel.vue';
import SpotlightSearch from '@/components/SpotlightSearch.vue';
import FavoriteEditDialog from '@/components/FavoriteEditDialog.vue';
import DestinationPickerDialog from '@/components/DestinationPickerDialog.vue';
import OnlyOfficeTransferConfirm from '@/components/OnlyOfficeTransferConfirm.vue';
import SeparateDownloadConfirm from '@/components/SeparateDownloadConfirm.vue';
import NotificationToastContainer from '@/components/NotificationToastContainer.vue';
import NotificationPanel from '@/components/NotificationPanel.vue';
import PreviewHost from '@/plugins/preview/PreviewHost.vue';
import AskDialog from '@/components/AskDialog.vue';
import { useFeaturesStore } from '@/stores/features';
import { useTerminalStore } from '@/stores/terminal';
import { useTabsStore } from '@/stores/tabs';
import { useAppSettings } from '@/stores/appSettings';
import { useFileStore } from '@/stores/fileStore';
import { useSidebar } from '@/composables/sidebar';
import { useFileUploader } from '@/composables/fileUploader';
import { useKeyboardShortcuts } from '@/composables/keyboardShortcuts';
import { usePageTitle } from '@/composables/usePageTitle';
import { pageTitleFor } from '@/utils/pageTitle';
import { TAB_KINDS_BY_ID, tabKindForPath } from '@/config/tabKinds';
// Carried in only when a shell is asked for: xterm travels with it.
const TerminalHost = defineAsyncComponent(() => import('@/components/TerminalHost.vue'));

const { configError, dismissConfigWarning } = useConfigErrorGate();

// The account's language, applied for as long as the application is on screen.
useAccountLanguage();

// The tab in front says where the router is. Here rather than in the strip: the
// strip is only drawn where a tab can be, and the tabs have to keep up with the
// address wherever it goes.
useTabRouteSync();
/** The same answer the strip draws itself by, asked once. */
const { visible: stripIsOnScreen } = useTabNavigation();

const route = useRoute();
const featuresStore = useFeaturesStore();
const terminalStore = useTerminalStore();
const tabsStore = useTabsStore();
const appSettings = useAppSettings();
const fileStore = useFileStore();

/**
 * Whether this address is a *place* — somewhere a tab can be.
 *
 * Signing in, the setup screen and a share's password prompt are not: they are
 * the application asking who you are, and a sidebar beside the question would
 * offer to leave it unanswered. Those draw their own screen and nothing else.
 */
const isPlace = computed(() => tabKindForPath(route.path) !== null);

/**
 * Whether the window's own chrome is drawn — the store's own answer, because the
 * strip asks it too now that it carries the window's controls.
 */
const showChrome = computed(() => tabsStore.wantsChrome);

/**
 * And whether those controls need a row of their own.
 *
 * They do not when there is a strip: a bell and a magnifying glass on a row to
 * themselves was a strip's worth of height spent on two buttons, above every
 * folder, for the whole life of the window. In the strip they sit at the end of a
 * row that is already there, and the folder starts where the row above it ends.
 */
const showBar = computed(() => showChrome.value && !stripIsOnScreen.value);

const { isOpen: isSidebarOpen, isDesktop, close: closeSidebar } = useSidebar();

/**
 * Whether the window's panels about an item — its details, its earlier versions
 * — are drawn.
 *
 * They were the browser layout's, so a comparison or the editor never had one
 * over it. With the panels moved up here that stopped being true, and a details
 * panel left open in a folder appeared over the next comparison.
 */
const showsFolderPanels = computed(() =>
  tabsStore.panes.some((id) => {
    const tab = tabsStore.tabs.find((one) => one.id === id);
    return TAB_KINDS_BY_ID[tab?.kind]?.folderPanels === true;
  })
);

// Uppy, bound to the folder in front wherever the reader is.
useFileUploader();
useKeyboardShortcuts();

const { t: translate, te } = useI18n();
// At the top of a share its address holds only the token; the share has a name.
const shareName = computed(() => {
  const info = fileStore.currentPathData?.shareInfo;
  return info?.label || info?.sourceFolderName || '';
});
usePageTitle(computed(() => pageTitleFor(route, translate, { te, shareName: shareName.value })));

/**
 * The two panes, and how they share the width.
 *
 * Half and half to begin with, which is what being asked for two panes means,
 * and then wherever the reader put the divider — the same bargain the sidebar's
 * own width strikes.
 */
const leftPaneTab = computed(() => tabsStore.panes[0]);
const rightPaneTab = computed(() => tabsStore.panes[1] || '');
const splitRatio = useStorage('browser-split-ratio', 0.5);
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.8;
const splittingPanes = ref(false);
let splitRow = null;

const onSplitPointerDown = (event) => {
  splittingPanes.value = true;
  splitRow = event.currentTarget?.parentElement || null;
  document.body.classList.add('select-none');
};

useEventListener(window, 'pointermove', (event) => {
  if (!splittingPanes.value || !splitRow) return;
  const box = splitRow.getBoundingClientRect();
  if (box.width <= 0) return;
  const asked = (event.clientX - box.left) / box.width;
  splitRatio.value = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, asked));
  event.preventDefault();
});

useEventListener(window, 'pointerup', () => {
  if (!splittingPanes.value) return;
  splittingPanes.value = false;
  splitRow = null;
  document.body.classList.remove('select-none');
});

const blockingConfigError = computed(() => configError.value?.mode === 'error');
const configWarning = computed(() =>
  configError.value?.mode === 'mismatch' ? configError.value : null
);
</script>

<template>
  <ConfigWarningNotice
    v-if="configWarning"
    :expected-origin="configWarning.expectedOrigin"
    :request-origin="configWarning.requestOrigin"
    @dismiss="dismissConfigWarning"
  />
  <ConfigErrorScreen
    v-if="blockingConfigError"
    :mode="configError.mode"
    :expected-origin="configError.expectedOrigin"
    :request-origin="configError.requestOrigin"
  />
  <!-- One viewport tall, as a column: the strip takes the height it needs and
       what a tab holds takes the rest. Before this the strip was simply added
       above a layout that was already `h-dvh`, so every screen was the viewport
       *plus* the strip — the page grew a scrollbar and the bottom of every folder
       was below the fold. `min-h-0` is what lets the row below actually shrink.

       No `overflow-hidden` here on purpose: the screens that want to be exactly
       the viewport say so themselves, and the sign-in screen is taller than one
       on a small window and has to be able to scroll. -->
  <div v-else class="flex h-dvh flex-col">
    <!-- Drawn only where a tab can be, which the strip decides for itself. -->
    <TabStrip class="shrink-0" />
    <div class="relative flex min-h-0 flex-1">
      <!--
        The window's own chrome, above every layout rather than inside one.

        It used to be the browser layout's, and so did the panes — which meant a
        pane could only ever hold something that layout drew. A document and a
        shell are outside it on purpose, each being the whole of what its tab
        holds, and the editor and a comparison are in another layout again; none
        of the three could be a pane. Here the sidebar, the bar and the panes
        outlive every page *and* every layout, and what a pane draws is simply the
        screen for its tab's address.
      -->
      <RouterView v-slot="{ Component, route: viewRoute }">
        <template v-if="isPlace">
          <WindowSidebar v-if="showChrome" />
          <main
            class="relative flex min-h-0 min-w-0 grow flex-col overflow-hidden bg-default shadow-lg"
          >
            <WindowBar v-if="showBar" />
            <ExplorerContextMenu>
              <div class="flex min-h-0 flex-1 overflow-hidden">
                <!-- Both panes are handed the router's screen; each draws it only
                     while it is the pane the reader is in, and resolves its own
                     otherwise. -->
                <TabPane
                  :tab-id="leftPaneTab"
                  :routed-component="Component"
                  :routed-key="viewRoute.fullPath"
                  side="left"
                  :split="tabsStore.isSplit"
                  :style="tabsStore.isSplit ? { flex: `0 0 ${splitRatio * 100}%` } : undefined"
                />
                <div
                  v-if="tabsStore.isSplit"
                  data-test="pane-divider"
                  class="group relative z-30 -mx-1 w-2 shrink-0 cursor-col-resize select-none bg-transparent"
                  :aria-label="$t('tabs.resizeSplit')"
                  @pointerdown="onSplitPointerDown"
                >
                  <div
                    class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-300 group-hover:bg-neutral-500 dark:bg-neutral-700"
                  ></div>
                </div>
                <TabPane
                  v-if="tabsStore.isSplit"
                  :tab-id="rightPaneTab"
                  :routed-component="Component"
                  :routed-key="viewRoute.fullPath"
                  side="right"
                  :split="true"
                />
              </div>
            </ExplorerContextMenu>
          </main>
        </template>
        <!-- The application asking who you are: its own screen and nothing else. -->
        <component :is="Component" v-else :key="viewRoute.fullPath" class="min-h-0 flex-1" />
      </RouterView>

      <!--
        Every open shell, drawn over the pane it belongs to and outliving every page.

        It used to live in the browser layout, which is not one thing: `/browse` and
        `/terminal` are two route records, so crossing between them destroys that layout
        and builds another — and it took every shell with it. A terminal that is
        unmounted is a shell that has been killed, so coming back to a terminal tab
        found a new one: the slide from the right played again and what had been typed
        was gone.
      -->
      <TerminalHost v-if="featuresStore.terminalEnabled && terminalStore.openIds.length > 0" />
    </div>

    <!-- Closes the sidebar on a screen too narrow to keep it open. -->
    <button
      v-if="isPlace && isSidebarOpen && !isDesktop"
      type="button"
      class="fixed inset-0 z-40 bg-black/20 lg:hidden"
      :aria-label="$t('browser.closeSidebar')"
      @click="closeSidebar"
    ></button>

    <!-- Drawn once and above everything. Each of these belongs to the window
         rather than to a page: the screens that open them are usually the ones on
         their way out, so one belonging to a page would leave with it. -->
    <ClipboardProgress class="z-560" />
    <InfoPanel v-if="showsFolderPanels" />
    <VersionsPanel v-if="showsFolderPanels" />
    <SpotlightSearch />
    <FavoriteEditDialog />
    <DestinationPickerDialog />
    <OnlyOfficeTransferConfirm />
    <SeparateDownloadConfirm />
    <NotificationToastContainer />
    <NotificationPanel />
    <!-- Every tab's open document, teleported to the body and outliving the
         pages: which one is visible is a tab away, and nothing is rebuilt to
         bring it forward. -->
    <PreviewHost />
    <!-- Whatever the application is asking, drawn once and above everything. -->
    <AskDialog />

    <footer
      v-if="isPlace && appSettings.state.branding.showPoweredBy"
      class="fixed bottom-0 right-0 p-2 text-xs text-neutral-500 sm:p-4 dark:text-neutral-400"
    >
      <a
        href="https://explorer.nxz.ai"
        target="_blank"
        rel="noopener noreferrer"
        class="text-neutral-600 underline-offset-2 hover:text-neutral-800 hover:underline dark:text-neutral-300 dark:hover:text-neutral-100"
      >
        Powered by nextExplorer
      </a>
    </footer>
  </div>
</template>
