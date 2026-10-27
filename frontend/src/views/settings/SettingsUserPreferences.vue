<script setup>
import { computed, onMounted, reactive, watch } from 'vue';
import { useAppSettings } from '@/stores/appSettings';
import { useFeaturesStore } from '@/stores/features';
import { useI18n } from 'vue-i18n';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/vue/20/solid';
import { languageLabel, supportedLocaleOptions } from '@/i18n';
import { useQuickActionsStore } from '@/stores/quickActions';
import { QUICK_ACTIONS_BY_ID } from '@/config/quickActions';
import ToggleSwitch from '@/components/ToggleSwitch.vue';

const appSettings = useAppSettings();
const features = useFeaturesStore();
const { t } = useI18n();

// Inline quick-actions menu config is a client-side (localStorage) preference,
// applied instantly — it is not part of the server-saved settings above.
const quickActions = useQuickActionsStore();
const quickActionLabel = (id) => {
  const meta = QUICK_ACTIONS_BY_ID[id];
  return meta ? t(meta.labelKey) : id;
};

const local = reactive({
  showHiddenFiles: false,
  showThumbnails: true,
  showSidebarFavorites: true,
  showSidebarShares: true,
  showSidebarTools: true,
  defaultShareExpirationValue: null,
  defaultShareExpirationUnit: 'weeks',
  skipHome: null, // null = use env, true/false = override
  defaultView: null, // null = the built-in default, otherwise a view mode
  markdownOpensInEditor: false,
  documentsOpenInNewTab: false,
  showVersionMarks: true,
  locale: null,
  downloadMode: 'zip',
  browseInTabs: false,
  closeTabsOnDoubleClick: false,
  reopenTabs: false,
  // On unless it is turned off: a tab opened in the background is opened in order
  // not to wait for it.
  preloadBackgroundTabs: true,
});

const original = computed(() => appSettings.userSettings);
const dirty = computed(() => {
  const orig = original.value;
  const origExpiration = orig.defaultShareExpiration;
  const localExpiration = local.defaultShareExpirationValue
    ? { value: local.defaultShareExpirationValue, unit: local.defaultShareExpirationUnit }
    : null;

  return (
    local.showHiddenFiles !== orig.showHiddenFiles ||
    local.showThumbnails !== orig.showThumbnails ||
    local.showSidebarFavorites !== (orig.showSidebarFavorites ?? true) ||
    local.showSidebarShares !== (orig.showSidebarShares ?? true) ||
    local.showSidebarTools !== (orig.showSidebarTools ?? true) ||
    JSON.stringify(localExpiration) !== JSON.stringify(origExpiration) ||
    local.skipHome !== orig.skipHome ||
    local.defaultView !== orig.defaultView ||
    local.markdownOpensInEditor !== (orig.markdownOpensInEditor ?? false) ||
    local.documentsOpenInNewTab !== (orig.documentsOpenInNewTab ?? false) ||
    local.showVersionMarks !== (orig.showVersionMarks ?? true) ||
    local.locale !== (orig.locale ?? null) ||
    local.downloadMode !== (orig.downloadMode ?? 'zip') ||
    local.browseInTabs !== (orig.browseInTabs ?? false) ||
    local.closeTabsOnDoubleClick !== (orig.closeTabsOnDoubleClick ?? false) ||
    local.reopenTabs !== (orig.reopenTabs ?? false) ||
    local.preloadBackgroundTabs !== (orig.preloadBackgroundTabs ?? true)
  );
});

// Empty means no default. Anything else has to be a whole number of at least
// one, as the server takes it: minus three weeks used to be sent as it was.
const expirationInvalid = computed(() => {
  const value = local.defaultShareExpirationValue;
  if (value === null || value === '') return false;
  return !(Number.isInteger(value) && value >= 1);
});

const hiddenFilePatternsLabel = computed(() => {
  const patterns = Array.isArray(features.hiddenFilePatterns) ? features.hiddenFilePatterns : [];
  return patterns.length ? patterns.join(', ') : t('common.disabled');
});

onMounted(() => {
  features.ensureLoaded();
});

// Named in their own language, so somebody looking for theirs finds it even
// when the page is in one they do not read.
const languages = supportedLocaleOptions.map(({ code }) => ({
  code,
  label: languageLabel(code),
}));

const sidebarPreferenceRows = [
  {
    key: 'showSidebarFavorites',
    label: 'settings.userPreferences.showSidebarFavorites',
    help: 'settings.userPreferences.showSidebarFavoritesHelp',
  },
  {
    key: 'showSidebarShares',
    label: 'settings.userPreferences.showSidebarShares',
    help: 'settings.userPreferences.showSidebarSharesHelp',
  },
  {
    key: 'showSidebarTools',
    label: 'settings.userPreferences.showSidebarTools',
    help: 'settings.userPreferences.showSidebarToolsHelp',
  },
];

watch(
  () => appSettings.userSettings,
  (userSettings) => {
    local.showHiddenFiles = userSettings.showHiddenFiles ?? false;
    local.showThumbnails = userSettings.showThumbnails ?? true;
    local.showSidebarFavorites = userSettings.showSidebarFavorites ?? true;
    local.showSidebarShares = userSettings.showSidebarShares ?? true;
    local.showSidebarTools = userSettings.showSidebarTools ?? true;

    const expiration = userSettings.defaultShareExpiration;
    if (expiration && typeof expiration === 'object') {
      local.defaultShareExpirationValue = expiration.value ?? null;
      local.defaultShareExpirationUnit = expiration.unit ?? 'weeks';
    } else {
      local.defaultShareExpirationValue = null;
      local.defaultShareExpirationUnit = 'weeks';
    }

    local.skipHome = userSettings.skipHome ?? null;
    local.defaultView = userSettings.defaultView ?? null;
    local.markdownOpensInEditor = userSettings.markdownOpensInEditor ?? false;
    local.documentsOpenInNewTab = userSettings.documentsOpenInNewTab ?? false;
    local.showVersionMarks = userSettings.showVersionMarks ?? true;
    local.locale = userSettings.locale ?? null;
    local.downloadMode = userSettings.downloadMode ?? 'zip';
    local.browseInTabs = userSettings.browseInTabs ?? false;
    local.closeTabsOnDoubleClick = userSettings.closeTabsOnDoubleClick ?? false;
    local.reopenTabs = userSettings.reopenTabs ?? false;
    local.preloadBackgroundTabs = userSettings.preloadBackgroundTabs ?? true;
  },
  { immediate: true }
);

const reset = () => {
  const userSettings = appSettings.userSettings;
  local.showHiddenFiles = userSettings.showHiddenFiles ?? false;
  local.showThumbnails = userSettings.showThumbnails ?? true;
  local.showSidebarFavorites = userSettings.showSidebarFavorites ?? true;
  local.showSidebarShares = userSettings.showSidebarShares ?? true;
  local.showSidebarTools = userSettings.showSidebarTools ?? true;

  const expiration = userSettings.defaultShareExpiration;
  if (expiration && typeof expiration === 'object') {
    local.defaultShareExpirationValue = expiration.value ?? null;
    local.defaultShareExpirationUnit = expiration.unit ?? 'weeks';
  } else {
    local.defaultShareExpirationValue = null;
    local.defaultShareExpirationUnit = 'weeks';
  }

  local.skipHome = userSettings.skipHome ?? null;
  local.defaultView = userSettings.defaultView ?? null;
  local.markdownOpensInEditor = userSettings.markdownOpensInEditor ?? false;
  local.documentsOpenInNewTab = userSettings.documentsOpenInNewTab ?? false;
  local.showVersionMarks = userSettings.showVersionMarks ?? true;
  local.locale = userSettings.locale ?? null;
  local.downloadMode = userSettings.downloadMode ?? 'zip';
  local.browseInTabs = userSettings.browseInTabs ?? false;
};

const save = async () => {
  if (expirationInvalid.value) return;
  const defaultShareExpiration = local.defaultShareExpirationValue
    ? { value: local.defaultShareExpirationValue, unit: local.defaultShareExpirationUnit }
    : null;

  await appSettings.save({
    user: {
      showHiddenFiles: local.showHiddenFiles,
      showThumbnails: local.showThumbnails,
      showSidebarFavorites: local.showSidebarFavorites,
      showSidebarShares: local.showSidebarShares,
      showSidebarTools: local.showSidebarTools,
      defaultShareExpiration,
      skipHome: local.skipHome,
      defaultView: local.defaultView,
      markdownOpensInEditor: local.markdownOpensInEditor,
      documentsOpenInNewTab: local.documentsOpenInNewTab,
      showVersionMarks: local.showVersionMarks,
      locale: local.locale,
      downloadMode: local.downloadMode,
      browseInTabs: local.browseInTabs,
      closeTabsOnDoubleClick: local.closeTabsOnDoubleClick,
      reopenTabs: local.reopenTabs,
      preloadBackgroundTabs: local.preloadBackgroundTabs,
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
          type="button"
          data-test="preferences-save"
          class="rounded-md bg-yellow-500 px-3 py-1 text-black hover:bg-yellow-400 disabled:opacity-50"
          :disabled="expirationInvalid"
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
        {{ t('settings.userPreferences.title') }}
      </h2>
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
        {{ t('settings.userPreferences.subtitle') }}
      </p>
    </div>

    <!-- Content -->
    <div
      class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6"
    >
      <div class="space-y-6">
        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('i18n.language') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.languageHelp') }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-model="local.locale"
              data-test="preferences-language"
              class="rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border"
            >
              <option :value="null">{{ t('i18n.followBrowser') }}</option>
              <option v-for="language in languages" :key="language.code" :value="language.code">
                {{ language.label }}
              </option>
            </select>
          </div>
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.showHiddenFiles') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{
                t('settings.userPreferences.showHiddenFilesHelp', {
                  patterns: hiddenFilePatternsLabel,
                })
              }}
            </div>
          </div>
          <ToggleSwitch v-model="local.showHiddenFiles" />
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.showThumbnails') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.showThumbnailsHelp') }}
            </div>
          </div>
          <ToggleSwitch v-model="local.showThumbnails" />
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.markdownOpensInEditor') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.markdownOpensInEditorHelp') }}
            </div>
          </div>
          <ToggleSwitch v-model="local.markdownOpensInEditor" />
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.documentsOpenInNewTab') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.documentsOpenInNewTabHelp') }}
            </div>
          </div>
          <ToggleSwitch v-model="local.documentsOpenInNewTab" data-test="documents-in-new-tab" />
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.browseInTabs') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.browseInTabsHelp') }}
            </div>
          </div>
          <ToggleSwitch v-model="local.browseInTabs" data-test="browse-in-tabs" />
        </div>

        <!-- Under the switch that offers tabs at all, and greyed out without it:
             a way of closing something that does not exist is a control that can
             only puzzle. -->
        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
          :class="local.browseInTabs ? '' : 'opacity-50'"
        >
          <div class="pl-6">
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.closeTabsOnDoubleClick') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.closeTabsOnDoubleClickHelp') }}
            </div>
          </div>
          <ToggleSwitch
            v-model="local.closeTabsOnDoubleClick"
            :disabled="!local.browseInTabs"
            data-test="close-tabs-on-double-click"
          />
        </div>

        <!-- Off by default, which is what makes keeping a tab mean something: with
             everything coming back, "kept" said nothing that "open" did not. -->
        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
          :class="local.browseInTabs ? '' : 'opacity-50'"
        >
          <div class="pl-6">
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.reopenTabs') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.reopenTabsHelp') }}
            </div>
          </div>
          <ToggleSwitch
            v-model="local.reopenTabs"
            :disabled="!local.browseInTabs"
            data-test="reopen-tabs"
          />
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.preloadBackgroundTabs') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.preloadBackgroundTabsHelp') }}
            </div>
          </div>
          <ToggleSwitch
            v-model="local.preloadBackgroundTabs"
            :disabled="!local.browseInTabs"
            data-test="preload-background-tabs"
          />
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.showVersionMarks') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.showVersionMarksHelp') }}
            </div>
          </div>
          <ToggleSwitch v-model="local.showVersionMarks" data-test="show-version-marks" />
        </div>

        <div
          v-for="row in sidebarPreferenceRows"
          :key="row.key"
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t(row.label) }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t(row.help) }}
            </div>
          </div>
          <ToggleSwitch v-model="local[row.key]" />
        </div>

        <div
          class="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
        >
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.defaultShareExpiration') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.defaultShareExpirationHelp') }}
            </div>
            <p
              v-if="expirationInvalid"
              data-test="expiration-invalid"
              class="mt-1 text-sm text-red-600"
            >
              {{ t('settings.userPreferences.defaultShareExpirationInvalid') }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <input
              type="number"
              min="1"
              v-model.number="local.defaultShareExpirationValue"
              :placeholder="t('settings.userPreferences.expirationValue')"
              class="w-20 rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border text-center"
            />
            <select
              v-model="local.defaultShareExpirationUnit"
              data-test="preferences-expiry-unit"
              class="rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border"
            >
              <option value="days">{{ t('settings.userPreferences.days') }}</option>
              <option value="weeks">{{ t('settings.userPreferences.weeks') }}</option>
              <option value="months">{{ t('settings.userPreferences.months') }}</option>
            </select>
            <button
              v-if="local.defaultShareExpirationValue"
              @click="local.defaultShareExpirationValue = null"
              class="p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              :title="t('common.clear')"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between py-3">
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.defaultView') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.defaultViewHelp') }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-model="local.defaultView"
              data-test="preferences-default-view"
              class="rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border"
            >
              <option :value="null">{{ t('settings.userPreferences.viewGrid') }}</option>
              <option value="list">{{ t('settings.userPreferences.viewList') }}</option>
              <option value="tab">{{ t('settings.userPreferences.viewColumns') }}</option>
              <option value="photos">{{ t('settings.userPreferences.viewPhotos') }}</option>
            </select>
          </div>
        </div>

        <div class="flex items-center justify-between py-3">
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.downloadMode') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.downloadModeHelp') }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-model="local.downloadMode"
              data-test="preferences-download-mode"
              class="rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border"
            >
              <option value="zip">{{ t('settings.userPreferences.downloadModeZip') }}</option>
              <option value="separate">
                {{ t('settings.userPreferences.downloadModeSeparate') }}
              </option>
            </select>
          </div>
        </div>

        <div class="flex items-center justify-between py-3">
          <div>
            <div class="font-medium text-zinc-900 dark:text-zinc-100">
              {{ t('settings.userPreferences.skipHome') }}
            </div>
            <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {{ t('settings.userPreferences.skipHomeHelp') }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <select
              v-model="local.skipHome"
              data-test="preferences-start"
              class="rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border"
            >
              <option :value="null">{{ t('settings.userPreferences.useEnvSetting') }}</option>
              <option :value="true">{{ t('common.enabled') }}</option>
              <option :value="false">{{ t('common.disabled') }}</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- Inline quick-actions menu (client-side preference, applied instantly) -->
    <div
      class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6"
    >
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium text-zinc-900 dark:text-zinc-100">
            {{ t('settings.userPreferences.quickActions') }}
          </div>
          <div class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {{ t('settings.userPreferences.quickActionsHelp') }}
          </div>
        </div>
        <ToggleSwitch
          :model-value="quickActions.enabled"
          @update:model-value="quickActions.setEnabled"
        />
      </div>

      <div v-if="quickActions.enabled" class="mt-4">
        <div class="mb-4 flex items-center justify-between gap-4">
          <div class="text-sm text-zinc-700 dark:text-zinc-300">
            {{ t('settings.userPreferences.quickActionsMode') }}
          </div>
          <select
            :value="quickActions.displayMode"
            class="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs sm:text-sm p-2"
            @change="quickActions.setDisplayMode($event.target.value)"
          >
            <option value="full">{{ t('settings.userPreferences.quickActionsModeFull') }}</option>
            <option value="compact">
              {{ t('settings.userPreferences.quickActionsModeCompact') }}
            </option>
          </select>
        </div>
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <div class="text-sm text-zinc-700 dark:text-zinc-300">
              {{ t('settings.userPreferences.quickActionsPosition') }}
            </div>
            <div class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {{ t('settings.userPreferences.quickActionsPositionHelp') }}
            </div>
          </div>
          <select
            :value="quickActions.position"
            data-test="preferences-quick-actions-position"
            class="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs sm:text-sm p-2"
            @change="quickActions.setPosition($event.target.value)"
          >
            <option value="after">
              {{ t('settings.userPreferences.quickActionsPositionAfter') }}
            </option>
            <option value="start">
              {{ t('settings.userPreferences.quickActionsPositionStart') }}
            </option>
            <option value="end">
              {{ t('settings.userPreferences.quickActionsPositionEnd') }}
            </option>
          </select>
        </div>
        <div class="mb-2 flex items-center justify-between">
          <div class="text-sm text-zinc-500 dark:text-zinc-400">
            {{ t('settings.userPreferences.quickActionsReorder') }}
          </div>
          <button
            type="button"
            class="text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            @click="quickActions.reset()"
          >
            {{ t('common.reset') }}
          </button>
        </div>
        <ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
          <li
            v-for="(entry, index) in quickActions.config"
            :key="entry.id"
            class="flex items-center gap-3 py-2"
          >
            <div class="flex flex-col">
              <button
                type="button"
                class="rounded p-0.5 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-100"
                :disabled="index === 0"
                :aria-label="t('common.moveUp')"
                @click="quickActions.move(entry.id, -1)"
              >
                <ArrowUpIcon class="h-4 w-4" />
              </button>
              <button
                type="button"
                class="rounded p-0.5 text-zinc-400 hover:text-zinc-800 disabled:opacity-30 dark:hover:text-zinc-100"
                :disabled="index === quickActions.config.length - 1"
                :aria-label="t('common.moveDown')"
                @click="quickActions.move(entry.id, 1)"
              >
                <ArrowDownIcon class="h-4 w-4" />
              </button>
            </div>
            <span class="flex-1 text-sm text-zinc-800 dark:text-zinc-200">
              {{ quickActionLabel(entry.id) }}
            </span>
            <ToggleSwitch
              size="sm"
              :model-value="entry.on"
              @update:model-value="(value) => quickActions.setActionOn(entry.id, value)"
            />
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
