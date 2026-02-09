<script setup>
import { computed, reactive, watch, ref } from 'vue';
import { useAppSettings } from '@/stores/appSettings';
import { useI18n } from 'vue-i18n';
import { XMarkIcon } from '@heroicons/vue/24/solid';
import logger from '@/utils/logger';

const appSettings = useAppSettings();
const { t } = useI18n();

const local = reactive({
  appName: 'Explorer',
  showPoweredBy: false,
});

const DEFAULT_LOGO_URL = '/logo.svg';
const logoPreviewUrl = ref(DEFAULT_LOGO_URL);
const isUploading = ref(false);
const uploadMessage = ref('');
const uploadMessageType = ref(''); // 'success' or 'error'
const fileInputRef = ref(null);

const original = computed(() => appSettings.state.branding);
const dirty = computed(
  () =>
    local.appName !== original.value.appName ||
    logoPreviewUrl.value !== original.value.appLogoUrl ||
    local.showPoweredBy !== original.value.showPoweredBy
);

watch(
  () => appSettings.state.branding,
  (b) => {
    local.appName = b.appName;
    logoPreviewUrl.value = b.appLogoUrl;
    local.showPoweredBy = b.showPoweredBy || false;
  },
  { immediate: true }
);

const reset = () => {
  const b = appSettings.state.branding;
  local.appName = b.appName;
  logoPreviewUrl.value = b.appLogoUrl;
  local.showPoweredBy = b.showPoweredBy || false;
};

const save = async () => {
  try {
    await appSettings.save({
      branding: {
        appName: local.appName,
        appLogoUrl: logoPreviewUrl.value,
        showPoweredBy: local.showPoweredBy,
      },
    });
    uploadMessage.value = 'Branding saved successfully!';
    uploadMessageType.value = 'success';
    setTimeout(() => {
      uploadMessage.value = '';
      uploadMessageType.value = '';
    }, 3000);
  } catch (error) {
    uploadMessage.value = `Failed to save: ${error.message}`;
    uploadMessageType.value = 'error';
  }
};

const handleLogoSelect = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  // Validate file size (2MB max)
  const maxSize = 2 * 1024 * 1024; // 2MB
  if (file.size > maxSize) {
    uploadMessage.value = t('settings.branding.logoError') || 'File must be smaller than 2MB';
    uploadMessageType.value = 'error';
    return;
  }

  // Validate file type
  const validTypes = ['image/svg+xml', 'image/png', 'image/jpeg'];
  if (!validTypes.includes(file.type)) {
    uploadMessage.value =
      t('settings.branding.invalidFileType') || 'Please upload SVG, PNG, or JPG';
    uploadMessageType.value = 'error';
    return;
  }

  isUploading.value = true;
  uploadMessage.value = 'Uploading...';
  uploadMessageType.value = '';

  try {
    logger.debug('Starting file upload', {
      filename: file.name,
      size: file.size,
      type: file.type,
    });

    // Upload file to backend
    const formData = new FormData();
    formData.append('logo', file);

    const response = await fetch('/api/settings/upload-logo', {
      method: 'POST',
      body: formData,
    });

    logger.debug('Upload response status', response.status);

    const data = await response.json();
    logger.debug('Upload response data', data);

    if (!response.ok) {
      throw new Error(data.error || `Upload failed: ${response.statusText}`);
    }

    if (data.logoUrl) {
      logoPreviewUrl.value = data.logoUrl;
      uploadMessage.value = t('settings.branding.uploadSuccess') || 'Logo uploaded successfully!';
      uploadMessageType.value = 'success';

      logger.info('Logo uploaded successfully', data.logoUrl);

      // Auto clear message after 3 seconds
      setTimeout(() => {
        uploadMessage.value = '';
        uploadMessageType.value = '';
      }, 3000);
    } else {
      throw new Error('No logo URL returned from server');
    }
  } catch (error) {
    console.error('Logo upload error:', error);
    uploadMessage.value = `Upload failed: ${error.message}`;
    uploadMessageType.value = 'error';
  } finally {
    isUploading.value = false;
    // Clear the input so the same file can be selected again
    if (fileInputRef.value) {
      fileInputRef.value.value = '';
    }
  }
};

const triggerFileInput = () => {
  fileInputRef.value?.click();
};

const useDefaultLogo = () => {
  logoPreviewUrl.value = DEFAULT_LOGO_URL;
  uploadMessage.value =
    t('settings.branding.defaultLogoSelected') || 'Default logo selected. Click Save to apply.';
  uploadMessageType.value = 'success';
  setTimeout(() => {
    uploadMessage.value = '';
    uploadMessageType.value = '';
  }, 3000);
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
  }
};
</script>

<template>
  <div class="space-y-6">
    <!-- Upload Message Alert -->
    <div
      v-if="uploadMessage"
      :class="[
        'rounded-md border p-4 text-sm',
        uploadMessageType === 'success'
          ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-400/30 dark:border-green-400/20'
          : 'bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-400/30 dark:border-red-400/20',
      ]"
    >
      {{ uploadMessage }}
    </div>

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
        {{ t('titles.branding') || 'Branding' }}
      </h2>
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
        {{ t('settings.branding.subtitle') || 'Customize the application name and logo' }}
      </p>
    </div>

    <!-- Content -->
    <div
      class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6"
    >
      <div class="space-y-6">
        <div class="grid gap-6 md:grid-cols-2">
          <!-- Logo (left) -->
          <div>
            <div class="mb-3">
              <label class="block font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                {{ t('settings.branding.logo') || 'Logo Image' }}
              </label>
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                {{
                  t('settings.branding.logoHelp') ||
                  'Upload SVG, PNG, or JPG file for your custom logo'
                }}
              </p>
            </div>

            <input
              ref="fileInputRef"
              type="file"
              accept=".svg,.png,.jpg,.jpeg"
              style="display: none"
              @change="handleLogoSelect"
            />

            <div class="max-w-sm">
              <div
                class="group relative flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-700 dark:bg-zinc-900/50"
              >
                <img
                  :src="logoPreviewUrl"
                  :alt="local.appName + ' logo'"
                  class="h-24 w-auto max-w-full"
                />
                <button
                  v-if="logoPreviewUrl !== DEFAULT_LOGO_URL"
                  type="button"
                  :title="t('common.remove') || 'Remove'"
                  class="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow-sm opacity-0 transition hover:bg-white hover:text-zinc-900 focus:opacity-100 dark:bg-zinc-800/90 dark:text-zinc-200 group-hover:opacity-100"
                  @click="useDefaultLogo"
                >
                  <XMarkIcon class="h-4 w-4" />
                </button>
              </div>

              <div class="mt-3 flex flex-col gap-2">
                <button
                  :disabled="isUploading"
                  class="w-full inline-flex justify-center rounded-md border border-transparent bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-zinc-800 focus:outline-hidden focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="triggerFileInput"
                >
                  <span v-if="!isUploading">
                    {{
                      logoPreviewUrl === DEFAULT_LOGO_URL ? 'Upload logo' : 'Upload another file'
                    }}
                  </span>
                  <span v-else>{{ t('settings.branding.uploading') || 'Uploading...' }}</span>
                </button>

                <button
                  v-if="logoPreviewUrl !== DEFAULT_LOGO_URL"
                  type="button"
                  class="w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-xs hover:bg-zinc-50 focus:outline-hidden focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 md:hidden"
                  @click="useDefaultLogo"
                >
                  {{ t('common.remove') || 'Remove' }}
                </button>
              </div>
            </div>
          </div>

          <!-- App Name (right) -->
          <div>
            <div class="mb-3">
              <label class="block font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {{ t('settings.branding.appName') || 'Application Name' }}
              </label>
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                {{
                  t('settings.branding.appNameHelp') ||
                  'The name displayed in the header and login page'
                }}
              </p>
            </div>
            <input
              v-model="local.appName"
              type="text"
              maxlength="100"
              placeholder="Explorer"
              class="block w-full rounded-md border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs focus:border-zinc-500 focus:ring-zinc-500 sm:text-sm p-2 border"
            />
            <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {{ local.appName.length }}/100
            </p>
          </div>
        </div>

        <!-- Preview -->
        <div
          class="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/50"
        >
          <p class="mb-3 font-medium text-zinc-600 dark:text-zinc-300">
            {{ t('settings.branding.preview') || 'Preview' }}
          </p>
          <div class="flex items-center gap-3">
            <img
              :src="logoPreviewUrl"
              :alt="local.appName + ' logo'"
              class="h-10 w-auto"
              @error="$event.target.style.display = 'none'"
            />
            <span class="text-lg font-bold text-zinc-900 dark:text-zinc-100">{{
              local.appName
            }}</span>
          </div>
        </div>
        <div>
          <label class="flex items-start gap-3 cursor-pointer">
            <div class="flex h-5 items-center pt-0.5">
              <input
                v-model="local.showPoweredBy"
                type="checkbox"
                class="h-4 w-4 rounded-sm border-zinc-300 text-zinc-600 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
            <div>
              <span class="font-medium text-zinc-700 dark:text-zinc-300">
                {{ t('settings.branding.showPoweredBy') || 'Show Powered by NextExplorer' }}
              </span>
              <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {{
                  t('settings.branding.showPoweredByHelp') ||
                  'Display a link to NextExplorer in the footer'
                }}
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
