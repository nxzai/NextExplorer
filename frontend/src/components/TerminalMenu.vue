<script setup>
import { computed, ref } from 'vue';
import { CommandLineIcon, ChevronDownIcon } from '@heroicons/vue/24/outline';
import { useI18n } from 'vue-i18n';
import { useTerminalStore } from '@/stores/terminal';
import { useTabNavigation } from '@/composables/tabNavigation';
import { terminalRoute } from '@/utils/terminalRoute';
import { useAuthStore } from '@/stores/auth';
import { useFileStore } from '@/stores/fileStore';
import { useRoute } from 'vue-router';

const terminalStore = useTerminalStore();
const tabNavigation = useTabNavigation();
const fileStore = useFileStore();
const route = useRoute();

const auth = useAuthStore();
const isAdmin = computed(
  () => Array.isArray(auth.currentUser?.roles) && auth.currentUser.roles.includes('admin')
);

const { t } = useI18n();

const open = ref(true);
const terminalPath = computed(() => (route.name === 'HomeView' ? '' : fileStore.currentPath || ''));
const isOpen = computed(() => terminalStore.isOpenIn(tabNavigation.tabs.activeId));

/**
 * A terminal, in the tab it was asked for from.
 *
 * Beside the folder, as it has always been — and now one per tab, so four folders
 * can each have a shell open in them and bringing one forward shows its own.
 * Nothing about this gesture takes the reader anywhere: they asked for a shell,
 * not for somewhere else to be.
 *
 * A tab of its own is a separate decision, and it is said the way every other
 * "open this somewhere else" is said here — command, or control, or the middle
 * button, which opens it behind. One rule, whatever is being opened.
 */
const openHere = () => terminalStore.toggleIn(tabNavigation.tabs.activeId, terminalPath.value);

const openInTab = ({ behind = false } = {}) => {
  if (!tabNavigation.tabs.enabled) return false;
  return Boolean(tabNavigation.open(terminalRoute(terminalPath.value).path, { behind, own: true }));
};

const handleClick = (event) => {
  // `metaKey` first: on a Mac the command key is the one people reach for, and
  // control there means something else entirely.
  if ((event?.metaKey || event?.ctrlKey) && openInTab({ behind: true })) return;
  openHere();
};
</script>

<template>
  <div v-if="isAdmin">
    <h4
      class="group flex items-center justify-between pt-2 text-sm text-neutral-400 dark:text-neutral-500 font-medium"
    >
      {{ t('terminal.menuHeading') }}
      <button
        :aria-label="t('common.toggleSection')"
        @click="open = !open"
        class="hidden group-hover:block active:text-black dark:active:text-white text-neutral-500"
      >
        <ChevronDownIcon
          class="h-4 transition-transform duration-300 ease-in-out"
          :class="{ 'rotate-0': open, '-rotate-90': !open }"
        />
      </button>
    </h4>
    <div class="overflow-hidden">
      <transition
        enter-active-class="transition-all duration-500"
        leave-active-class="transition-all duration-500"
        enter-from-class="-mt-[100%]"
        enter-to-class="mt-0"
        leave-from-class="mt-0"
        leave-to-class="-mt-[100%]"
      >
        <div v-if="open" class="overflow-hidden">
          <button
            @click="handleClick"
            @auxclick.middle.prevent="openInTab({ behind: true })"
            :class="[
              'cursor-pointer flex w-full items-center gap-3 my-3 rounded-lg transition-colors duration-200 text-sm',
              isOpen ? 'dark:text-white' : 'dark:text-neutral-300/90',
            ]"
          >
            <CommandLineIcon class="h-[1.38rem]" /> {{ t('terminal.menuOpen') }}
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>
