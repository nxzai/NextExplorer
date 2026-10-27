<script setup>
import { usePaneBoxes } from '@/composables/paneBoxes';
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { XMarkIcon } from '@heroicons/vue/24/outline';
import { useI18n } from 'vue-i18n';
import { HOME, useTabsStore } from '@/stores/tabs';
import { useTerminalStore } from '@/stores/terminal';
import { useTabNavigation } from '@/composables/tabNavigation';
import { tabDragging } from '@/utils/tabDrag';
import TerminalSurface from '@/components/TerminalSurface.vue';

/**
 * Every terminal that is open, drawn where its tab wants it.
 *
 * Mounted once, beside what a tab holds rather than over the window: the sidebar
 * and the strip of tabs stay reachable with a shell open, which is the first
 * thing the drawer got wrong — its backdrop covered the whole window, so opening
 * a terminal meant being unable to leave it.
 *
 * All of them at once, and only one of them on screen. A terminal behind another
 * tab is `invisible`, which hides it without unmounting it and without taking its
 * box away: the shell keeps running, the socket keeps printing, and coming back
 * to it is coming back to what it has been doing. Unmounting is what would end a
 * session, so nothing here unmounts one that its tab still has.
 *
 * Two placements, and the session says which. The drawer is the ordinary one —
 * beside the folder, over it, shut with a click outside. The whole tab is what a
 * terminal opened deliberately into its own tab gets.
 */
const { t } = useI18n();
const tabsStore = useTabsStore();
const terminalStore = useTerminalStore();

/**
 * The sessions to draw, in the order the tabs are in.
 *
 * A session whose tab has gone goes with it — the reader closed the tab, and a
 * shell they cannot see or reach is a process nobody asked to keep.
 */
const surfaces = computed(() => {
  const live = tabsStore.tabs.map((tab) => tab.id);
  // Every session a live tab has, open or shut: a shut drawer is still a running
  // shell, and dropping it here would unmount it, which kills it.
  return live
    .filter((id) => terminalStore.sessionFor(id))
    .map((id) => ({ id, session: terminalStore.sessionFor(id) }));
});

watch(
  () => tabsStore.tabs.map((tab) => tab.id).join('\u0000'),
  (ids) => terminalStore.keepOnly(ids.split('\u0000').filter(Boolean))
);

/**
 * Whether this terminal is the thing to draw.
 *
 * Not simply "its tab is in front". A terminal that *is* the tab covers everything the
 * tab holds, and it was being drawn for as long as that tab was active — so leaving it
 * did nothing: a favourite or a volume pressed in the sidebar took the tab to that
 * folder, the folder was drawn underneath, and the terminal stayed on top of it. The
 * reader had a sidebar that answered nothing.
 *
 * So a terminal that is the tab is drawn while the tab is *at* a terminal, and the tab
 * is free to go somewhere else. The session is not closed by leaving — it belongs to
 * the tab, so stepping back into it finds the shell where it was left.
 *
 * A drawer is the other case and keeps the old rule: it floats over whatever the tab is
 * on, which is what a drawer is for.
 */

const { boxFor } = usePaneBoxes();

/**
 * Where a surface sits before any pane has been measured: the content area, as
 * `absolute inset-0` gave it when there was only ever one pane.
 */
const wholeContentArea = {
  top: 'var(--tab-strip-height)',
  left: '0px',
  right: '0px',
  bottom: '0px',
};

const isShowing = (id) => {
  // On screen, which with a pair of tabs is two of them rather than the one in
  // front: a shell in the pane beside the reader is as much on screen as the
  // one they are in, and keyed on the tab in front that pane showed nothing.
  if (!tabsStore.panes.includes(id)) return false;
  const session = terminalStore.sessionFor(id);
  // A shut drawer is drawn hidden: the shell keeps running behind the folder.
  if (!session?.open) return false;
  if (session.mode !== 'page') return true;
  // Its own tab's address, not the window's. In a pair the window is on the
  // address of whichever pane the reader is in, so a shell beside a folder was
  // asked whether the *folder* was a terminal — and drew nothing at all.
  const tab = tabsStore.tabs.find((one) => one.id === id);
  return String(tab?.path || '').startsWith('/terminal');
};

const router = useRouter();
const tabNavigation = useTabNavigation();

/**
 * Shutting one, which means two different things.
 *
 * A drawer shuts and leaves the tab where it was — that is what it is for. A
 * terminal that *is* the tab has nothing behind it, so shutting it closes the tab,
 * the way the cross of a document does; and when it is the only tab, which cannot
 * be closed, the tab goes back to the volumes rather than to a dark rectangle.
 */
const close = (id) => {
  const mode = terminalStore.sessionFor(id)?.mode;
  terminalStore.closeIn(id);
  if (mode !== 'page') return;
  if (tabsStore.canClose) tabNavigation.close(id);
  else void router.push(HOME);
};
</script>

<template>
  <div
    v-for="surface in surfaces"
    :key="surface.id"
    class="fixed z-[1200]"
    :class="[
      isShowing(surface.id) ? '' : 'invisible pointer-events-none',
      // Out of the way while a tab is being dragged: this sits over the pane it
      // belongs to without being inside it, so a tab dropped on that half landed
      // here and the pane never heard about it.
      tabDragging ? 'pointer-events-none' : '',
    ]"
    :style="boxFor(surface.id) || wholeContentArea"
    :data-tab="surface.id"
    :data-mode="surface.session.mode"
    :data-active="isShowing(surface.id) ? 'true' : 'false'"
    data-test="terminal-surface-host"
  >
    <!-- The drawer's backdrop, over what the tab holds and nothing else. -->
    <Transition appear name="terminal-fade">
      <div
        v-if="surface.session.mode === 'drawer'"
        class="absolute inset-0 bg-black/30 dark:bg-black/50"
        data-test="terminal-backdrop"
        @click="close(surface.id)"
      ></div>
    </Transition>

    <Transition appear name="terminal-slide">
      <aside
        class="absolute inset-y-0 right-0 flex flex-col border-l bg-zinc-900 shadow-2xl dark:border-white/10 dark:bg-zinc-950"
        :class="
          surface.session.mode === 'page'
            ? 'left-0 border-l-0'
            : 'w-full sm:w-[600px] md:w-[700px] lg:w-[800px]'
        "
      >
        <header class="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 class="truncate text-lg font-semibold text-white">
            {{ t('titles.terminal') }}
            <span v-if="surface.session.path" class="text-sm font-normal text-neutral-400">
              — {{ surface.session.path }}
            </span>
          </h2>
          <button
            type="button"
            class="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-white/10 hover:text-white"
            :aria-label="t('common.close')"
            data-test="terminal-close"
            @click="close(surface.id)"
          >
            <XMarkIcon class="h-5 w-5" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-hidden p-4">
          <!-- Built again whenever this tab asks for another folder, which is what
               `key` counts: a shell cannot change its mind about where it started. -->
          <TerminalSurface
            :key="surface.session.key"
            :path="surface.session.path"
            :initial-input="surface.session.input"
            :visible="isShowing(surface.id)"
          />
        </div>
      </aside>
    </Transition>
  </div>
</template>

<style scoped>
.terminal-fade-enter-active,
.terminal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.terminal-fade-enter-from,
.terminal-fade-leave-to {
  opacity: 0;
}

/* The drawer slides in from the edge it is attached to. A terminal filling the
   whole tab was asked for rather than revealed, so it does not slide. */
.terminal-slide-enter-active {
  transition: transform 0.2s ease-out;
}

.terminal-slide-enter-from {
  transform: translateX(100%);
}
</style>
