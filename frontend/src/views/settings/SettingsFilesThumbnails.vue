<script setup>
import { computed, reactive, watch } from 'vue';
import { useAppSettings } from '@/stores/appSettings';
import { useI18n } from 'vue-i18n';

const appSettings = useAppSettings();
const { t } = useI18n();

const local = reactive({
  enabled: true,
  quality: 70,
  size: 200,
  concurrency: 10,
});

const original = computed(
  () => appSettings.systemSettings?.thumbnails || appSettings.state.thumbnails
);
const dirty = computed(
  () =>
    local.enabled !== original.value.enabled ||
    local.quality !== original.value.quality ||
    local.size !== original.value.size ||
    local.concurrency !== original.value.concurrency
);

watch(
  () => appSettings.systemSettings?.thumbnails || appSettings.state.thumbnails,
  (t) => {
    if (t) {
      local.enabled = t.enabled;
      local.quality = t.quality;
      local.size = t.size;
      local.concurrency = t.concurrency ?? 10;
    }
  },
  { immediate: true }
);

const reset = () => {
  const t = appSettings.systemSettings?.thumbnails || appSettings.state.thumbnails;
  if (t) {
    local.enabled = t.enabled;
    local.quality = t.quality;
    local.size = t.size;
    local.concurrency = t.concurrency ?? 10;
  }
};

const save = async () => {
  await appSettings.save({
    thumbnails: {
      enabled: local.enabled,
      quality: local.quality,
      size: local.size,
      concurrency: local.concurrency,
    },
  });
};
</script>

<template>
  <div class="space-y-6">
    <div
      v-if="dirty"
      class="sticky top-0 z-10 flex items-center justify-between rounded-md border border-yellow-400/30 bg-yellow-100/40 p-3 text-yellow-900 dark:border-yellow-400/20 dark:bg-yellow-500/10 dark:text-yellow-200"
    >
      <div class="text-sm">{{ t('common.unsavedChanges') }}</div>
      <div class="flex gap-2">
        <button
          class="rounded-md bg-yellow-500 px-3 py-1 text-black hover:bg-yellow-400"
          @click="save"
        >
          {{ t('common.save') }}
        </button>
        <button
          class="rounded-md border border-white/10 px-3 py-1 hover:bg-white/10"
          @click="reset"
        >
          {{ t('common.discard') }}
        </button>
      </div>
    </div>

    <!-- Header -->
    <div>
      <h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {{ t('titles.thumbnails') }}
      </h2>
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
        {{ t('settings.thumbs.subtitle') }}
      </p>
    </div>

    <!-- Content -->
    <div
      class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6"
    >
      <div class="space-y-6">
        <div class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.thumbs.enable') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.thumbs.enableHelp') }}
            </div>
          </div>
          <label class="inline-flex cursor-pointer items-center">
            <input type="checkbox" v-model="local.enabled" class="peer sr-only" />
            <div
              class="peer relative h-6 w-11 rounded-full bg-zinc-200 transition-colors peer-checked:bg-zinc-900 dark:bg-zinc-700 dark:peer-checked:bg-zinc-100"
            >
              <div
                class="absolute left-[2px] top-[2px] h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5"
              ></div>
            </div>
          </label>
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
          :class="{ 'opacity-60 pointer-events-none': !local.enabled }"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.thumbs.quality') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.thumbs.qualityHelp') }}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="100"
              v-model.number="local.quality"
              class="w-64 h-2 rounded-lg appearance-none bg-zinc-200 dark:bg-zinc-700 accent-zinc-900 dark:accent-zinc-100"
            />
            <input
              type="number"
              min="1"
              max="100"
              v-model.number="local.quality"
              class="w-20 rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border text-center"
            />
          </div>
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
          :class="{ 'opacity-60 pointer-events-none': !local.enabled }"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.thumbs.maxDim') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.thumbs.maxDimHelp') }}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <input
              type="number"
              min="64"
              max="1024"
              step="1"
              v-model.number="local.size"
              class="w-24 rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border text-center"
            />
            <span class="text-sm text-zinc-500 dark:text-zinc-400">px</span>
          </div>
        </div>

        <div
          class="flex items-center justify-between py-3"
          :class="{ 'opacity-60 pointer-events-none': !local.enabled }"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.thumbs.concurrency') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.thumbs.concurrencyHelp') }}
            </div>
          </div>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="50"
              v-model.number="local.concurrency"
              class="w-64 h-2 rounded-lg appearance-none bg-zinc-200 dark:bg-zinc-700 accent-zinc-900 dark:accent-zinc-100"
            />
            <input
              type="number"
              min="1"
              max="50"
              v-model.number="local.concurrency"
              class="w-20 rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border text-center"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
