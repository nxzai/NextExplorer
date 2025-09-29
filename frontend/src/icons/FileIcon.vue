<script setup>
import { computed, watch } from 'vue';

import { apiBase, appendAuthQuery } from '@/api';
import { useFileStore } from '@/stores/fileStore';
import { isPreviewableImage, isPreviewableVideo } from '@/config/media';

import TxtIcon from './files/txt-icon.vue';
import DirectoryIcon from './files/directory-icon.vue';
import CodeIcon from './files/code-icon.vue';
import PdfIcon from './files/pdf-icon.vue';

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
});

const fileStore = useFileStore();

const thumbnailUrl = computed(() => {
  const kind = (props.item?.kind || '').toLowerCase();
  if (kind === 'pdf') {
    return null;
  }

  const thumbnailPath = props.item?.thumbnail;
  if (!thumbnailPath) {
    return null;
  }

  if (/^https?:\/\//i.test(thumbnailPath)) {
    return thumbnailPath;
  }

  return appendAuthQuery(`${apiBase}${thumbnailPath}`);
});

const isPreviewable = computed(() => {
  const kind = (props.item?.kind || '').toLowerCase();
  if (!kind) {
    return false;
  }

  if (kind === 'pdf') {
    return false;
  }

  return isPreviewableImage(kind) || isPreviewableVideo(kind);
});

const requestThumbnailIfNeeded = () => {
  if (!props.item || props.item.kind === 'directory') {
    return;
  }

  if (!isPreviewable.value) {
    return;
  }

  if (props.item.thumbnail) {
    return;
  }

  fileStore.ensureItemThumbnail(props.item);
};

watch(
  () => [props.item?.name, props.item?.path, props.item?.thumbnail, isPreviewable.value],
  () => {
    requestThumbnailIfNeeded();
  },
  { immediate: true },
);
</script>

<template>
  <DirectoryIcon v-if="props.item.kind === 'directory'" />
  <CodeIcon v-else-if="['json', 'vue'].includes(props.item.kind)" />
  <PdfIcon v-else-if="props.item.kind === 'pdf'" />
  <div v-else-if="thumbnailUrl" class="flex items-center justify-center">
    <img :src="thumbnailUrl" alt="Preview thumbnail" loading="lazy" />
  </div>
  <TxtIcon v-else />
</template>
