<script setup>
import { computed, defineAsyncComponent } from 'vue';
import { RouterView } from 'vue-router';
import { useAccountLanguage } from '@/composables/useAccountLanguage';
import { useConfigErrorGate } from '@/composables/useConfigErrorGate';
import { useTabRouteSync } from '@/composables/tabNavigation';
import ConfigErrorScreen from '@/components/ConfigErrorScreen.vue';
import ConfigWarningNotice from '@/components/ConfigWarningNotice.vue';
import TabStrip from '@/components/TabStrip.vue';
import PreviewHost from '@/plugins/preview/PreviewHost.vue';
import AskDialog from '@/components/AskDialog.vue';
import { useFeaturesStore } from '@/stores/features';
import { useTerminalStore } from '@/stores/terminal';
// Carried in only when a shell is asked for: xterm travels with it.
const TerminalHost = defineAsyncComponent(() => import('@/components/TerminalHost.vue'));

const { configError, dismissConfigWarning } = useConfigErrorGate();

// The account's language, applied for as long as the application is on screen.
useAccountLanguage();

// The tab in front says where the router is. Here rather than in the strip: the
// strip is only drawn where a tab can be, and the tabs have to keep up with the
// address wherever it goes.
useTabRouteSync();

const featuresStore = useFeaturesStore();
const terminalStore = useTerminalStore();

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

       No `overflow-hidden` here on purpose: the layouts that want to be exactly
       the viewport say so themselves, and the sign-in screen is taller than one
       on a small window and has to be able to scroll. -->
  <div v-else class="flex h-dvh flex-col">
    <!-- Drawn only where a tab can be, which the strip decides for itself. -->
    <TabStrip class="shrink-0" />
    <div class="relative min-h-0 flex-1">
      <router-view></router-view>
      <!--
        Every open shell, drawn over what a tab holds and outliving every page.

        It used to live in the browser layout, which is not one thing: `/browse` and
        `/terminal` are two route records, so crossing between them destroys that layout
        and builds another — and it took every shell with it. A terminal that is
        unmounted is a shell that has been killed, so coming back to a terminal tab
        found a new one: the slide from the right played again and what had been typed
        was gone. Here it is mounted once, like the documents beside it.
      -->
      <TerminalHost v-if="featuresStore.terminalEnabled && terminalStore.openIds.length > 0" />
    </div>
    <!-- Every tab's open document, teleported to the body and outliving the
         pages: which one is visible is a tab away, and nothing is rebuilt to
         bring it forward. -->
    <PreviewHost />
    <!-- Whatever the application is asking, drawn once and above everything: the
         screens that ask are usually the ones on their way out, so a dialog belonging
         to the page would leave with the page it is asking about. -->
    <AskDialog />
  </div>
</template>
