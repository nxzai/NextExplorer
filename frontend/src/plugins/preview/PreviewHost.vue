<template>
  <!--
    Teleported to `body` and positioned against the window, which is why the
    surfaces have to be told about the strip of tabs: a document open in a tab is
    that tab's content and stops where the strip starts, and nesting cannot say so
    to something `fixed`. `--tab-strip-height` is 0px when there is no strip, so
    with tabs off this is the full window exactly as it always was.
  -->
  <teleport to="body">
    <div
      v-for="surface in surfaces"
      :key="surface.key"
      :data-tab="surface.key"
      :data-active="surface.key === activeKey ? 'true' : 'false'"
      :class="surface.key === activeKey ? null : 'invisible pointer-events-none'"
    >
      <PreviewSurface :session="surface.session" />
    </div>
  </teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { usePreviewManager } from '@/plugins/preview/manager';
import { useTabsStore } from '@/stores/tabs';
import PreviewSurface from '@/plugins/preview/PreviewSurface.vue';

/**
 * Every tab's document, and the one in front.
 *
 * Mounted once, by `App.vue`, and that is the point of it. It used to be mounted
 * by whatever page was showing a document, which meant the document was built
 * when that page was and thrown away when it was — so bringing a folder tab
 * forward and going back re-opened an ONLYOFFICE document from nothing, losing
 * the cursor, the undo history and the connection to whoever else was editing it.
 * Here, the surfaces outlive the pages: bringing a tab forward changes which one
 * is visible and nothing else.
 *
 * Hidden with `invisible` rather than `hidden`. `display: none` would take the
 * surface out of the layout, and a third-party editor that comes back to a box of
 * zero by zero has to be told to measure itself again — assuming it notices.
 * `visibility: hidden` keeps every size it had, is not painted and is not
 * clickable; `pointer-events-none` is belt and braces for a descendant that turns
 * its own visibility back on.
 */
const manager = usePreviewManager();
const tabs = useTabsStore();

const surfaces = computed(() => manager.surfaces);
const activeKey = computed(() => tabs.activeId);

/**
 * On the way out of the window, every document that is open in it.
 *
 * Here rather than on the document page, because the page is no longer where a
 * document lives: a spreadsheet being edited in a background tab still has a
 * session on the server, and closing the window has to end that one too. It is
 * also the only hook a preview opened over a folder listing ever had — that one
 * had none at all, and its session was left behind on the server.
 *
 * `pagehide` and not `beforeunload`: it fires for a tab being closed, for a
 * navigation away, and on mobile browsers that never fire the other one.
 * Deliberately not `visibilitychange`, which fires every time somebody merely
 * switches to another browser tab — ending an editing session there would close a
 * document that is still open.
 */
const endForUnload = () => {
  manager.endForUnload();
};

onMounted(() => window.addEventListener('pagehide', endForUnload));
onUnmounted(() => window.removeEventListener('pagehide', endForUnload));
</script>
