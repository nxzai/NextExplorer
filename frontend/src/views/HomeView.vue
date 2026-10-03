<script setup>
import { onMounted, computed } from 'vue';
import { useFavoritesStore } from '@/stores/favorites';
import { useFeaturesStore } from '@/stores/features';
import { useVolumeUsageStore } from '@/stores/volumeUsage';
import { useNavigation } from '@/composables/navigation';
import { useOpenPlaceInTab } from '@/composables/openPlaceInTab';
import * as OutlineIcons from '@heroicons/vue/24/outline';
import * as SolidIcons from '@heroicons/vue/24/solid';
import { resolveFavoriteIcon } from '@/utils/favoriteIcons';
import VolumeUsageBar from '@/components/VolumeUsageBar.vue';
import ReadOnlyMark from '@/components/ReadOnlyMark.vue';
import IconDrive from '@/icons/IconDrive.vue';

const favoritesStore = useFavoritesStore();
const featuresStore = useFeaturesStore();
const volumeUsageStore = useVolumeUsageStore();
const { openItem, openBreadcrumb } = useNavigation();
// The middle button opens a place in a tab behind, as it does a folder row.
const { openPlaceInTab } = useOpenPlaceInTab();
const showVolumeUsage = computed(() => featuresStore.volumeUsageEnabled);
const personalEnabled = computed(() => featuresStore.personalEnabled);
const volumes = computed(() => volumeUsageStore.volumes);
const usage = computed(() => volumeUsageStore.usage);
const loading = computed(
  () => volumeUsageStore.isLoadingVolumes || !volumeUsageStore.hasLoadedVolumes
);

onMounted(async () => {
  await Promise.all([favoritesStore.ensureLoaded(), featuresStore.ensureLoaded()]);
  await volumeUsageStore.loadVolumes();
});

const resolveIconComponent = resolveFavoriteIcon;

const quickAccess = computed(() =>
  favoritesStore.favorites.map((favorite) => {
    const autoLabel = favorite.path.split('/').pop() || favorite.path;
    return {
      ...favorite,
      label: favorite.label || autoLabel,
      iconComponent: resolveIconComponent(favorite.icon),
      color: favorite.color || null,
    };
  })
);

/**
 * Command, or control, opens it in a tab behind — what a browser does with a
 * link. `metaKey` first, because on a Mac the command key is the one people
 * reach for and control there means something else entirely.
 */
const handleOpenFavorite = (favorite, event) => {
  if (!favorite?.path) return;
  if ((event?.metaKey || event?.ctrlKey) && openPlaceInTab(favorite.path)) return;
  openBreadcrumb(favorite.path);
};

const openVolume = (volume, event) => {
  if ((event?.metaKey || event?.ctrlKey) && openPlaceInTab(volume.name)) return;
  openItem(volume);
};

const PersonalIcon = OutlineIcons.FolderIcon || SolidIcons.FolderIcon;

const openPersonal = (event) => {
  if ((event?.metaKey || event?.ctrlKey) && openPlaceInTab('personal')) return;
  openBreadcrumb('personal');
};
</script>

<template>
  <!--
    Scrolls itself: the content area this sits in clips, so a dashboard with
    enough volumes on it would otherwise have its last rows nowhere to go.
    Measured at 31 volumes: 1,120 px of content in a 660 px box.
  -->
  <div class="flex h-full min-h-0 flex-col gap-8 overflow-y-auto px-8">
    <!-- Quick Access -->
    <section>
      <h3
        class="mt-6 mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
      >
        {{ $t('volumes.quickAccess') }}
      </h3>
      <div
        v-if="quickAccess.length"
        class="grid grid-cols-[repeat(auto-fit,minmax(15.5rem,15.5rem))] gap-5"
      >
        <button
          v-for="fav in quickAccess"
          :key="fav.path"
          type="button"
          :title="fav.label"
          @click="handleOpenFavorite(fav, $event)"
          @auxclick.middle.prevent="openPlaceInTab(fav.path)"
          class="flex w-full items-center gap-3 rounded-md py-3 text-left text-neutral-700 select-none dark:text-neutral-300"
        >
          <div class="flex h-16 w-16 shrink-0 items-center">
            <component
              :is="fav.iconComponent"
              class="h-12 shrink-0"
              :style="{ color: fav.color || 'currentColor' }"
            />
          </div>
          <div class="min-w-0 text-left text-sm break-all line-clamp-2">
            {{ fav.label }}
          </div>
        </button>
      </div>
      <div v-else class="text-xs">
        {{ $t('volumes.quickAccessEmpty') }}
      </div>
    </section>

    <!-- Volumes -->
    <section>
      <h3
        class="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
      >
        {{ $t('titles.locations') }}
      </h3>
      <div
        v-if="!loading"
        class="grid grid-cols-[repeat(auto-fit,minmax(15.5rem,15.5rem))] items-start gap-5"
      >
        <button
          v-for="vol in volumes"
          :key="vol.name"
          type="button"
          @click="openVolume(vol, $event)"
          @auxclick.middle.prevent="openPlaceInTab(vol.name)"
          :class="[
            'w-full max-w-full rounded-lg py-3 pr-3 text-left transition-colors hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60',
            showVolumeUsage
              ? 'grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-x-3'
              : 'flex items-center gap-3',
          ]"
        >
          <IconDrive :class="showVolumeUsage ? 'h-16 shrink-0' : 'h-12 shrink-0'" />
          <div
            :class="
              showVolumeUsage
                ? 'flex w-full min-w-0 flex-col items-stretch gap-2 pt-1'
                : 'min-w-0 flex-1'
            "
          >
            <div
              :class="
                showVolumeUsage
                  ? 'flex w-full min-w-0 items-center gap-1.5 !text-left text-sm font-medium text-neutral-900 dark:text-white'
                  : 'flex min-w-0 items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-white'
              "
              style="text-align: left"
            >
              <span class="truncate">{{ vol.name }}</span>
              <ReadOnlyMark :reason="vol.readOnly" />
            </div>
            <VolumeUsageBar
              v-if="showVolumeUsage"
              :usage="usage[vol.path]"
              :loading="volumeUsageStore.isLoadingUsage"
              percent-inside
              class="w-full"
            />
          </div>
        </button>
      </div>
      <div v-else class="text-sm text-neutral-500 dark:text-neutral-400">
        {{ $t('loading.volumes') }}
      </div>
    </section>

    <!-- Personal -->
    <section v-if="personalEnabled">
      <h3
        class="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
      >
        {{ $t('drives.personal') }}
      </h3>
      <div v-if="!loading">
        <button
          type="button"
          @click="openPersonal($event)"
          @auxclick.middle.prevent="openPlaceInTab('personal')"
          class="flex items-center gap-3 py-4 text-left"
        >
          <component :is="PersonalIcon" class="h-14 w-16 shrink-0" />
          <div>
            <div class="mb-1 truncate text-sm font-medium text-neutral-900 dark:text-white">
              {{ $t('drives.myfiles') }}
            </div>
          </div>
        </button>
      </div>
      <div v-else class="text-sm text-neutral-500 dark:text-neutral-400">
        {{ $t('loading.volumes') }}
      </div>
    </section>
  </div>
</template>
