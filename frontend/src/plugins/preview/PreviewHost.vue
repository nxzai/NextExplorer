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
      :data-active="shownKeys.has(surface.key) ? 'true' : 'false'"
      :class="[
        shownKeys.has(surface.key) ? null : 'invisible pointer-events-none',
        // Out of the way while a tab is being dragged: the surface covers the
        // pane it belongs to without being inside it, so a tab dropped on that
        // half landed on the document and the pane never heard about it.
        tabDragging ? 'pointer-events-none' : '',
      ]"
      :style="paneVars(surface.key)"
    >
      <PreviewSurface :session="surface.session" />
    </div>
  </teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue';
import { usePreviewManager } from '@/plugins/preview/manager';
import { usePaneBoxes } from '@/composables/paneBoxes';
import { useTabsStore } from '@/stores/tabs';
import { tabDragging } from '@/utils/tabDrag';
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
/**
 * Which tabs are on screen, rather than which one is in front.
 *
 * A pair of tabs is drawn side by side, and a document in the pane beside the
 * reader is as much on screen as the one they are in — keyed on the tab in
 * front, that pane showed nothing at all.
 */
const shownKeys = computed(() => new Set(tabs.panes));

const { boxFor } = usePaneBoxes();

/**
 * Where its pane is, handed down as four custom properties.
 *
 * Not as positioning on this element: a wrapper with a box of its own covers the
 * content area whether or not the surface inside it is drawing anything, and a
 * transparent sheet over the whole application swallows every click. It was
 * nothing before panes existed — the surface positioned itself — so it stays
 * nothing, and the surface is told where to go.
 *
 * The window below the strip until a pane has been measured, which is what every
 * one of these was positioned against until now: the first paint is what it
 * always was, and a measurement only ever moves it into a smaller box.
 */
const paneVars = (key) => {
  const box = boxFor(key);
  return {
    '--pane-top': box ? box.top : 'var(--tab-strip-height)',
    '--pane-left': box ? box.left : '0px',
    '--pane-width': box ? box.width : '100vw',
    '--pane-height': box ? box.height : 'calc(100vh - var(--tab-strip-height))',
  };
};

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
