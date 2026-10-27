<script setup>
import { Bars3Icon } from '@heroicons/vue/24/outline';
import NotificationBell from '@/components/NotificationBell.vue';
import SearchBar from '@/components/SearchBar.vue';
import { useSidebar } from '@/composables/sidebar';

/**
 * The window's own bar: the few things that belong to the window rather than to
 * whatever is being looked at.
 *
 * Searching, what the application has to tell you, and the way to the sidebar on
 * a screen too narrow to keep it open. All three used to sit on the right of the
 * folder's toolbar, which was fine while there was one folder on screen — and
 * became two search fields and two bells the moment there were two panes.
 *
 * What is left in the folder's own toolbar is everything about a folder: where it
 * is, how it is sorted, how it is shown, what can be made in it. That one is
 * drawn per pane, because that is what it is about.
 */
const { toggle } = useSidebar();
</script>

<template>
  <div
    data-test="window-bar"
    class="flex shrink-0 items-center gap-1 border-b border-neutral-200 bg-white/90 px-3 py-1.5 backdrop-blur dark:border-neutral-800 dark:bg-default/90"
  >
    <button
      type="button"
      class="-ml-1 rounded-md p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 lg:hidden"
      :aria-label="$t('browser.openSidebar')"
      @click="toggle"
    >
      <Bars3Icon class="h-6 w-6" />
    </button>
    <div class="ml-auto flex items-center">
      <NotificationBell />
      <SearchBar />
    </div>
  </div>
</template>
