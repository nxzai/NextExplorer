<template>
  <div class="h-full w-full bg-white dark:bg-zinc-900">
    <div
      v-if="error"
      class="flex h-full items-center justify-center text-sm text-red-600 dark:text-red-400"
    >
      {{ error }}
    </div>
    <div
      v-else-if="!urlSrc"
      class="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400"
    >
      Loading Collabora…
    </div>
    <iframe
      v-else
      ref="iframeRef"
      class="h-full w-full border-0"
      :src="urlSrc"
      :title="title"
      referrerpolicy="no-referrer"
      allow="clipboard-read; clipboard-write"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { fetchCollaboraConfig } from '@/api';

const props = defineProps({
  item: { type: Object, required: true },
  extension: { type: String, required: true },
  filePath: { type: String, required: true },
  previewUrl: { type: String, required: true },
  api: { type: Object, required: true },
});

const urlSrc = ref(null);
const error = ref(null);
const iframeRef = ref(null);
const collaboraOrigin = ref(null);

const title = computed(() => props?.item?.name || 'Collabora');

/**
 * Handle PostMessage events from Collabora iframe
 */
const handlePostMessage = (event) => {
  if (!urlSrc.value) return;

  // Store the Collabora origin for sending messages back
  if (!collaboraOrigin.value && event.origin) {
    collaboraOrigin.value = event.origin;
  }

  let data = event.data;

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return;
    }
  }

  // When Collabora is ready, send Host_PostmessageReady
  // This is required for PostMessage API communication per Collabora docs
  if (data.MessageId === 'App_LoadingStatus' && data.Values?.Status === 'Frame_Ready') {
    const iframe = iframeRef.value;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        JSON.stringify({
          MessageId: 'Host_PostmessageReady',
          SendTime: Date.now(),
          Values: {},
        }),
        collaboraOrigin.value || '*'
      );
    }
  }
};

const load = async () => {
  error.value = null;
  urlSrc.value = null;
  collaboraOrigin.value = null;

  try {
    const filePath = props.filePath;
    if (!filePath) throw new Error('Missing file path.');
    const config = await fetchCollaboraConfig(filePath, 'edit');
    urlSrc.value = config?.urlSrc || null;
    if (!urlSrc.value) throw new Error('Missing Collabora iframe URL.');

    // Extract origin from urlSrc for PostMessage communication
    try {
      const url = new URL(urlSrc.value);
      collaboraOrigin.value = url.origin;
    } catch {
      // Ignore URL parsing errors
    }
  } catch (e) {
    error.value = e?.message || 'Failed to initialize Collabora.';
  }
};

onMounted(() => {
  load();
  window.addEventListener('message', handlePostMessage);
});

onUnmounted(() => {
  window.removeEventListener('message', handlePostMessage);
});

watch(
  () => props.filePath,
  () => load()
);
</script>
