<script setup>
import { computed, onMounted, onBeforeUnmount, watch, ref } from 'vue';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/vue/24/outline';
import { useInfoPanelStore } from '@/stores/infoPanel';
import { useFolderSizeStore } from '@/stores/folderSize';
import { useFeaturesStore } from '@/stores/features';
import { useVersionsPanelStore } from '@/stores/versionsPanel';
import { useFileStore } from '@/stores/fileStore';
import { formatBytes, formatDate } from '@/utils';
import { getKindLabel } from '@/utils/fileKinds';
import FileIcon from '@/icons/FileIcon.vue';
import MapPreview from '@/components/MapPreview.vue';
import PermissionsPanel from '@/components/PermissionsPanel.vue';
import { fetchMetadata, fetchPermissions, changePermissions, changeOwnership } from '@/api';
import { useI18n } from 'vue-i18n';

const store = useInfoPanelStore();
const folderSizeStore = useFolderSizeStore();
const featuresStore = useFeaturesStore();

const isOpen = computed(() => store.isOpen);
const item = computed(() => store.item);
const relativePath = computed(() => store.relativePath);
const isSharedPath = computed(() => String(relativePath.value || '').startsWith('share/'));

const { t } = useI18n();
const title = computed(() => item.value?.name || t('common.details'));
const kindLabel = computed(() => (item.value ? getKindLabel(item.value) : ''));
const indexedFolderSize = computed(() => folderSizeStore.sizeFor(relativePath.value));

const directorySizeLabel = computed(() => {
  if (indexedFolderSize.value?.excluded) return t('info.folderSizeExcluded');
  const indexedSize = indexedFolderSize.value?.sizeBytes;
  if (Number.isFinite(indexedSize)) return formatBytes(indexedSize);
  const metadataSize = details.value?.directory?.totalSize;
  return Number.isFinite(metadataSize) ? formatBytes(metadataSize) : '—';
});

const sizeLabel = computed(() => {
  const it = item.value;
  if (!it) return '';
  if (it.kind === 'directory') {
    if (indexedFolderSize.value?.excluded) return t('info.folderSizeExcluded');
    const size = indexedFolderSize.value?.sizeBytes;
    return Number.isFinite(size) ? formatBytes(size) : '—';
  }
  if (typeof it.size === 'number') return formatBytes(it.size);
  return '';
});

const modifiedLabel = computed(() => {
  const it = item.value;
  if (!it || !it.dateModified) return '';
  return formatDate(it.dateModified);
});

const locationLabel = computed(() => item.value?.path || '');

const versionsPanel = useVersionsPanelStore();
const fileStore = useFileStore();
// Through a share whose owner keeps the history hidden, the listing says so.
const canShowVersions = computed(
  () =>
    featuresStore.versionsEnabled &&
    Boolean(item.value) &&
    !['directory', 'volume'].includes(item.value.kind) &&
    fileStore.currentPathData?.canSeeVersions !== false
);
const openVersions = () => {
  const target = item.value;
  if (!target) return;
  store.close();
  versionsPanel.open(target);
};

const loading = ref(false);
const details = ref(null);
const errorMsg = ref('');

const permissionsLoading = ref(false);
const permissions = ref(null);
const permissionsError = ref('');
const refreshingFolderSize = ref(false);
const folderSizeRefreshError = ref('');

const canRefreshDirectorySize = computed(
  () => item.value?.kind === 'directory' && featuresStore.folderSizeEnabled
);

const refreshDirectorySize = async () => {
  if (!canRefreshDirectorySize.value || !relativePath.value || refreshingFolderSize.value) return;

  refreshingFolderSize.value = true;
  folderSizeRefreshError.value = '';
  try {
    await folderSizeStore.refreshFolder(relativePath.value);
  } catch (error) {
    folderSizeRefreshError.value = error?.message || t('errors.loadMetadata');
  } finally {
    refreshingFolderSize.value = false;
  }
};

const loadDetails = async () => {
  if (!isOpen.value || !relativePath.value) {
    details.value = null;
    return;
  }
  loading.value = true;
  errorMsg.value = '';
  try {
    details.value = await fetchMetadata(relativePath.value);
  } catch (e) {
    errorMsg.value = e?.message || t('errors.loadMetadata');
  } finally {
    loading.value = false;
  }
};

const loadPermissions = async () => {
  if (!isOpen.value || !relativePath.value) {
    permissions.value = null;
    return;
  }
  permissionsLoading.value = true;
  permissionsError.value = '';
  try {
    permissions.value = await fetchPermissions(relativePath.value);
  } catch (e) {
    permissionsError.value = e?.message || 'Failed to load permissions';
  } finally {
    permissionsLoading.value = false;
  }
};

const handleChangePermissions = async ({ mode, recursive }) => {
  if (!relativePath.value || isSharedPath.value) return;

  permissionsLoading.value = true;
  permissionsError.value = '';

  try {
    await changePermissions(relativePath.value, mode, recursive);
    // Reload permissions after successful change
    await loadPermissions();
  } catch (e) {
    permissionsError.value = e?.message || 'Failed to change permissions';
  } finally {
    permissionsLoading.value = false;
  }
};

const handleChangeOwner = async ({ owner, group }) => {
  if (!relativePath.value || isSharedPath.value) return;

  permissionsLoading.value = true;
  permissionsError.value = '';

  try {
    await changeOwnership(relativePath.value, owner, group);
    // Reload permissions after successful change
    await loadPermissions();
  } catch (e) {
    permissionsError.value = e?.message || 'Failed to change ownership';
  } finally {
    permissionsLoading.value = false;
  }
};

const panelRef = ref(null);
const trapFocus = (e) => {
  if (!store.isOpen) return;
  const el = panelRef.value;
  if (!el) return;
  if (!el.contains(e.target)) {
    e.stopPropagation();
    el.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )?.focus?.();
  }
};

onMounted(() => {
  // Minimal focus trap to avoid scrolling issues when open
  window.addEventListener('focusin', trapFocus);
  const onKey = (e) => {
    if (e.key === 'Escape' && store.isOpen) {
      e.preventDefault();
      close();
    }
  };
  window.addEventListener('keydown', onKey);
  // store handler to remove later
  cleanup.value = () => {
    window.removeEventListener('keydown', onKey);
  };
});

watch(isOpen, (open) => {
  document.body.classList.toggle('overflow-hidden', open);
  if (open) {
    loadDetails();
    loadPermissions();
  }
});

watch(relativePath, () => {
  if (isOpen.value) {
    loadDetails();
    loadPermissions();
  }
});

const cleanup = ref(() => {});
const close = () => store.close();

onBeforeUnmount(() => {
  window.removeEventListener('focusin', trapFocus);
  cleanup.value?.();
});
</script>

<template>
  <teleport to="body">
    <!-- Backdrop -->
    <transition name="ip-fade">
      <!--
      A panel beside what a tab holds, so it stops where the strip starts.

      It is `fixed` and teleported, which no amount of nesting can tell about the
      strip — hence `--tab-strip-height`, which is 0px when there is no strip.
      Before this the backdrop covered the whole window and swallowed every click
      on a tab: opening the terminal meant being unable to leave it.
    -->
      <div
        v-if="isOpen"
        class="fixed inset-x-0 bottom-0 top-[var(--tab-strip-height)] z-1450 bg-black/30"
        @click="close"
      />
    </transition>

    <!-- Panel -->
    <div
      class="fixed bottom-0 right-0 top-[var(--tab-strip-height)] z-1500 w-[380px] sm:w-[420px] transform transition-transform duration-200 ease-out"
      :class="isOpen ? 'translate-x-0' : 'translate-x-full'"
      :aria-label="t('info.aria')"
    >
      <aside
        ref="panelRef"
        class="flex h-full flex-col border-l bg-white/90 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/80"
      >
        <header class="flex items-start gap-3 border-b px-5 py-4 dark:border-white/5">
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {{ t('common.details') }}
            </p>
            <h2 class="truncate text-lg font-semibold text-neutral-900 dark:text-white">
              {{ title }}
            </h2>
          </div>
          <button
            v-if="canRefreshDirectorySize"
            type="button"
            class="rounded-md p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-wait disabled:opacity-60 dark:text-neutral-400 dark:hover:bg-zinc-800 dark:hover:text-neutral-200"
            :disabled="refreshingFolderSize"
            :title="$t('common.refresh')"
            :aria-label="$t('common.refresh')"
            @click="refreshDirectorySize"
          >
            <ArrowPathIcon :class="['h-5 w-5', refreshingFolderSize ? 'animate-spin' : '']" />
          </button>
          <button
            type="button"
            class="ml-auto rounded-md p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-zinc-800 dark:hover:text-neutral-200"
            @click="close"
          >
            <XMarkIcon class="h-6 w-6" />
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <!-- Preview / icon -->
          <div class="mb-4">
            <div
              class="rounded-xl border bg-neutral-50 p-3 dark:border-white/10 dark:bg-zinc-800/60"
            >
              <div class="h-48 w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-zinc-800">
                <FileIcon v-if="item" :item="item" class="h-full w-full" />
              </div>
            </div>
          </div>

          <!-- Details list -->
          <div class="space-y-4">
            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('info.fileName') }}
              </p>
              <p class="truncate text-neutral-900 dark:text-neutral-100">
                {{ item?.name }}
              </p>
            </div>

            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('common.type') }}
              </p>
              <p class="text-neutral-900 dark:text-neutral-100">
                {{ kindLabel }}
              </p>
            </div>

            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('common.size') }}
              </p>
              <p class="text-neutral-900 dark:text-neutral-100">
                {{ sizeLabel }}
              </p>
            </div>

            <div>
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('common.modified') }}
              </p>
              <p class="text-neutral-900 dark:text-neutral-100">
                {{ modifiedLabel }}
              </p>
            </div>

            <div v-if="locationLabel">
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('common.location') }}
              </p>
              <p class="break-all text-neutral-900 dark:text-neutral-100">
                {{ locationLabel }}
              </p>
            </div>

            <button
              v-if="canShowVersions"
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-zinc-800"
              data-test="info-versions"
              @click="openVersions"
            >
              {{ t('info.versions') }}
            </button>

            <!-- Folder specific metadata -->
            <div
              v-if="details?.directory"
              class="pt-2 border-t border-neutral-200 dark:border-white/5"
            >
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1"
              >
                {{ t('common.folder') }}
              </p>
              <p class="text-neutral-900 dark:text-neutral-100">
                {{
                  t('info.folderSize', {
                    size: directorySizeLabel,
                  })
                }}
              </p>
              <p class="text-neutral-900 dark:text-neutral-100">
                {{
                  t('info.itemsCount', {
                    files: details.directory.fileCount || 0,
                    folders: details.directory.dirCount || 0,
                  })
                }}
              </p>
              <p v-if="folderSizeRefreshError" class="mt-2 text-sm text-red-600 dark:text-red-400">
                {{ folderSizeRefreshError }}
              </p>
            </div>

            <!-- Image specific metadata -->
            <div
              v-if="details?.image"
              class="pt-2 border-t border-neutral-200 dark:border-white/5 space-y-2"
            >
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('common.image') }}
              </p>
              <p
                v-if="details.image.width && details.image.height"
                class="text-neutral-900 dark:text-neutral-100"
              >
                {{
                  t('info.dimensions', {
                    w: details.image.width,
                    h: details.image.height,
                  })
                }}
              </p>
              <p v-if="details.image.dateTaken" class="text-neutral-900 dark:text-neutral-100">
                {{
                  t('info.dateTaken', {
                    date: formatDate(details.image.dateTaken),
                  })
                }}
              </p>
              <p
                v-if="details.image.cameraMake || details.image.cameraModel"
                class="text-neutral-900 dark:text-neutral-100"
              >
                {{
                  t('info.camera', {
                    makeModel: [details.image.cameraMake, details.image.cameraModel]
                      .filter(Boolean)
                      .join(' '),
                  })
                }}
              </p>
              <p v-if="details.image.lensModel" class="text-neutral-900 dark:text-neutral-100">
                {{ t('info.lens', { lens: details.image.lensModel }) }}
              </p>

              <!-- Map preview matching theme -->
              <div
                v-if="details.image.gps && details.image.gps.lat && details.image.gps.lon"
                class="mt-2"
              >
                <MapPreview
                  :lat="details.image.gps.lat"
                  :lon="details.image.gps.lon"
                  :height="200"
                />
              </div>
            </div>

            <!-- Video specific metadata -->
            <div
              v-if="details?.video"
              class="pt-2 border-t border-neutral-200 dark:border-white/5 space-y-1"
            >
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('common.video') }}
              </p>
              <p
                v-if="details.video.width && details.video.height"
                class="text-neutral-900 dark:text-neutral-100"
              >
                {{
                  t('info.dimensions', {
                    w: details.video.width,
                    h: details.video.height,
                  })
                }}
              </p>
              <p
                v-if="Number.isFinite(details.video.duration)"
                class="text-neutral-900 dark:text-neutral-100"
              >
                {{
                  t('info.duration', {
                    seconds: Math.round(details.video.duration),
                  })
                }}
              </p>
            </div>

            <!-- Loading / error states -->
            <div v-if="loading" class="text-sm text-neutral-500 dark:text-neutral-400">
              {{ t('loading.metadata') }}
            </div>
            <div v-else-if="errorMsg" class="text-sm text-red-600 dark:text-red-400">
              {{ errorMsg }}
            </div>

            <!-- Permissions Panel -->
            <PermissionsPanel
              :permissions="permissions"
              :is-directory="item?.kind === 'directory'"
              :loading="permissionsLoading"
              :read-only="isSharedPath"
              @change-permissions="handleChangePermissions"
              @change-owner="handleChangeOwner"
            />
            <div v-if="permissionsError" class="text-sm text-red-600 dark:text-red-400 mt-2">
              {{ permissionsError }}
            </div>
          </div>
        </div>
      </aside>
    </div>
  </teleport>
</template>

<style scoped>
.ip-fade-enter-active,
.ip-fade-leave-active {
  transition: opacity 0.15s ease;
}
.ip-fade-enter-from,
.ip-fade-leave-to {
  opacity: 0;
}
</style>
