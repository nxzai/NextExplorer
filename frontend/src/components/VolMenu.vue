<script setup>
import { ServerIcon, ChevronDownIcon } from '@heroicons/vue/24/outline';
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useNavigation } from '@/composables/navigation';
import { useOpenPlaceInTab } from '@/composables/openPlaceInTab';
import { useFeaturesStore } from '@/stores/features';
import { useVolumeUsageStore } from '@/stores/volumeUsage';
import { FolderIcon } from '@heroicons/vue/24/outline';
import VolumeUsageBar from '@/components/VolumeUsageBar.vue';
import ReadOnlyMark from '@/components/ReadOnlyMark.vue';

const { t } = useI18n();
const { openItem, openBreadcrumb } = useNavigation();
// The middle button opens a place in a tab behind, as it does a folder row.
const { openPlaceInTab } = useOpenPlaceInTab();
const route = useRoute();
const featuresStore = useFeaturesStore();
const volumeUsageStore = useVolumeUsageStore();
const volumes = computed(() => volumeUsageStore.volumes);
const usage = computed(() => volumeUsageStore.usage);
const showVolumeUsage = computed(() => featuresStore.volumeUsageEnabled);

onMounted(async () => {
  try {
    await featuresStore.ensureLoaded();
    await volumeUsageStore.loadVolumes();
  } catch (error) {
    console.error('Failed to load volumes', error);
  }
});

const open = ref(true);
const currentPath = computed(() => {
  const path = route.params.path;
  if (Array.isArray(path)) {
    return path.join('/');
  }
  return typeof path === 'string' ? path : '';
});

const activeVolumeName = computed(() => {
  const path = currentPath.value.trim();
  if (!path) {
    return '';
  }
  const segments = path.split('/').filter(Boolean);
  return segments[0] || '';
});

const isActiveVolume = (volumeName = '') => {
  if (typeof volumeName !== 'string') {
    return false;
  }
  return volumeName === activeVolumeName.value;
};

/**
 * Command, or control, opens it in a tab behind — what a browser does with a
 * link. `metaKey` first, because on a Mac the command key is the one people
 * reach for and control there means something else entirely.
 */
const openPersonal = (event) => {
  if ((event?.metaKey || event?.ctrlKey) && openPlaceInTab('personal')) return;
  openBreadcrumb('personal');
};

const openVolume = (volume, event) => {
  if ((event?.metaKey || event?.ctrlKey) && openPlaceInTab(volume.name)) return;
  openItem(volume);
};
</script>

<template>
  <div>
    <div v-if="featuresStore.personalEnabled">
      <h4 class="pt-2 text-sm text-neutral-400 dark:text-neutral-500 font-medium">
        {{ $t('drives.personal') }}
      </h4>
      <button
        @click="openPersonal($event)"
        @auxclick.middle.prevent="openPlaceInTab('personal')"
        :class="[
          'cursor-pointer flex w-full items-center gap-3 my-3 rounded-lg transition-colors duration-200 text-sm',
          isActiveVolume('personal') ? 'dark:text-white' : 'dark:text-neutral-300/90',
        ]"
      >
        <FolderIcon class="h-[1.38rem]" /> {{ $t('drives.myfiles') }}
      </button>
    </div>

    <h4
      class="group flex items-center justify-between pt-2 text-sm text-neutral-400 dark:text-neutral-500 font-medium"
    >
      {{ $t('titles.locations') }}
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
        enter-active-class="transition-[max-height,opacity] duration-300 ease-out"
        leave-active-class="transition-[max-height,opacity] duration-200 ease-in"
        enter-from-class="max-h-0 opacity-0"
        enter-to-class="max-h-96 opacity-100"
        leave-from-class="max-h-96 opacity-100"
        leave-to-class="max-h-0 opacity-0"
      >
        <div v-if="open" class="overflow-hidden">
          <button
            v-for="volume in volumes"
            :key="volume.name"
            @click="openVolume(volume, $event)"
            @auxclick.middle.prevent="openPlaceInTab(volume.name)"
            :class="[
              'cursor-pointer flex w-full gap-3 my-3 rounded-lg text-left transition-colors duration-200 text-sm',
              showVolumeUsage ? 'items-start' : 'items-center',
              isActiveVolume(volume.name) ? 'dark:text-white' : 'dark:text-neutral-300/90',
            ]"
          >
            <ServerIcon :class="showVolumeUsage ? 'mt-px h-7 shrink-0' : 'h-[1.38rem] shrink-0'" />
            <div
              :class="
                showVolumeUsage
                  ? 'flex h-7 min-w-0 flex-1 flex-col justify-between gap-1'
                  : 'min-w-0 flex-1'
              "
            >
              <span
                :class="
                  showVolumeUsage
                    ? 'flex w-full min-w-0 items-center gap-1.5 !text-left leading-none'
                    : 'flex min-w-0 items-center gap-1.5'
                "
                style="text-align: left"
              >
                <span class="min-w-0 truncate">{{ volume.name }}</span>
                <ReadOnlyMark :reason="volume.readOnly" />
              </span>
              <VolumeUsageBar
                v-if="showVolumeUsage"
                :usage="usage[volume.path]"
                :loading="volumeUsageStore.isLoadingUsage"
                compact
                class="w-full"
              />
            </div>
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>
