<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFeaturesStore } from '@/stores/features';
import { useAppSettings } from '@/stores/appSettings';

/**
 * How many tabs a row may hold, for everybody on this installation.
 *
 * The strip never scrolls: a row that scrolls hides the very tabs somebody
 * opened, and tabs that keep shrinking stop being readable. So the row stops
 * instead, and where it stops is the one decision this asks for.
 *
 * A handful of numbers rather than a free one. Nobody browses twenty folders at
 * once and can still tell them apart, and four choices are easier to answer than
 * a box that will take any number and then argue about it.
 */
const featuresStore = useFeaturesStore();
const appSettings = useAppSettings();
const { t } = useI18n();

const CHOICES = [5, 10, 15, 20];

const maxOpen = computed(() => featuresStore.maxTabs);
const saving = ref(false);

const setMaxOpen = async (next) => {
  const asked = Number(next);
  if (saving.value || !CHOICES.includes(asked) || asked === maxOpen.value) return;
  saving.value = true;
  try {
    await appSettings.save({ tabs: { maxOpen: asked } });
    featuresStore.maxTabs = asked;
  } catch {
    // The store keeps the error for the page; the choice stays where it was.
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {{ t('settings.tabs.title') }}
      </h2>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {{ t('settings.tabs.description') }}
      </p>
    </div>

    <div
      class="flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div class="pr-6">
        <div class="font-medium text-zinc-900 dark:text-zinc-100">
          {{ t('settings.tabs.maxOpen') }}
        </div>
        <div class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {{ t('settings.tabs.maxOpenHelp') }}
        </div>
      </div>
      <select
        class="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        :value="maxOpen"
        :disabled="saving"
        :aria-label="t('settings.tabs.maxOpen')"
        data-testid="tabs-max-open"
        @change="setMaxOpen($event.target.value)"
      >
        <option v-for="choice in CHOICES" :key="choice" :value="choice">{{ choice }}</option>
      </select>
    </div>
  </div>
</template>
