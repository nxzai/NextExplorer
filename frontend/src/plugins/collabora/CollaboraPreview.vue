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
      class="h-full w-full border-0"
      :src="urlSrc"
      :title="title"
      referrerpolicy="no-referrer"
      allow="clipboard-read; clipboard-write"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue';
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

const title = computed(() => props?.item?.name || 'Collabora');

const load = async () => {
  error.value = null;
  urlSrc.value = null;
  try {
    const filePath = props.filePath;
    if (!filePath) throw new Error('Missing file path.');
    const config = await fetchCollaboraConfig(filePath, 'edit');
    urlSrc.value = config?.urlSrc || null;
    if (!urlSrc.value) throw new Error('Missing Collabora iframe URL.');
  } catch (e) {
    error.value = e?.message || 'Failed to initialize Collabora.';
  }
};

onMounted(load);
watch(
  () => props.filePath,
  () => load()
);
</script>

