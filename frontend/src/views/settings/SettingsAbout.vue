<script setup>
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeaturesStore } from '@/stores/features';

const { t } = useI18n();
const featuresStore = useFeaturesStore();

const commitShort = computed(() => {
  const commit = featuresStore.gitCommit;
  return commit ? commit.slice(0, 7) : '';
});

const commitUrl = computed(() => {
  const repo = featuresStore.repoUrl;
  const commit = featuresStore.gitCommit;
  return repo && commit ? `${repo}/commit/${commit}` : '';
});

onMounted(async () => {
  try {
    await featuresStore.ensureLoaded();
  } catch (_) {
    // Non-fatal; version info is optional
  }
});
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {{ t('titles.about') }}
      </h2>
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
        {{ t('settings.about.subtitle') }}
      </p>
    </div>

    <!-- Content -->
    <div
      class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden"
    >
      <div class="divide-y divide-zinc-200 dark:divide-zinc-800">
        <div class="flex items-center justify-between px-6 py-4">
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.about.appVersion') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.about.appVersionHelp') }}
            </div>
          </div>
          <div
            class="rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-sm font-mono text-zinc-900 dark:text-zinc-100"
          >
            <span>v{{ featuresStore.version }}</span>
          </div>
        </div>

        <div class="flex items-center justify-between px-6 py-4">
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.about.gitCommit') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.about.gitCommitHelp') }}
            </div>
          </div>
          <div
            class="rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-sm font-mono text-zinc-900 dark:text-zinc-100"
          >
            <template v-if="commitShort">
              <a
                v-if="commitUrl"
                :href="commitUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 underline decoration-dotted underline-offset-4"
              >
                {{ commitShort }}
              </a>
              <span v-else class="text-zinc-900 dark:text-zinc-100">{{ commitShort }}</span>
            </template>
            <span v-else class="text-zinc-500 dark:text-zinc-400">{{ t('common.unknown') }}</span>
          </div>
        </div>

        <div class="flex items-center justify-between px-6 py-4">
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.about.branch') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.about.branchHelp') }}
            </div>
          </div>
          <div
            class="rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-1.5 text-sm font-mono text-zinc-900 dark:text-zinc-100"
          >
            <span v-if="featuresStore.gitBranch" class="text-zinc-900 dark:text-zinc-100">{{
              featuresStore.gitBranch
            }}</span>
            <span v-else class="text-zinc-500 dark:text-zinc-400">{{ t('common.unknown') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
