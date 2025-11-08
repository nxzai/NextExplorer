<template>
  <VueEasyLightbox
    :visible="isVisible"
    :imgs="lightboxImages"
    :index="activeIndex"
    :escDisabled="false"
    @hide="handleClose"
    @on-index-change="handleIndexChange"
    :titleDisabled="false"
    :maskClosable="false"
  />
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import VueEasyLightbox from 'vue-easy-lightbox';
import { isPreviewableImage } from '@/config/media';

const props = defineProps({
  context: {
    type: Object,
    required: true,
  },
  previewUrl: {
    type: String,
    default: null,
  },
});

const isVisible = ref(false);

const previewSrc = computed(() => props.previewUrl || props.context?.previewUrl || null);

// Sibling gallery from current directory
const galleryItems = ref([]); // [{ src, title }]

const stem = (name = '') => {
  const idx = String(name).lastIndexOf('.');
  return idx > 0 ? String(name).slice(0, idx) : String(name);
};

const loadGallery = async () => {
  try {
    const items = props.context?.api?.getCurrentDirItems?.({ sorted: true }) || [];
    if (!Array.isArray(items) || items.length === 0) {
      galleryItems.value = [];
      return;
    }
    const images = items.filter((it) => isPreviewableImage(String(it?.kind || '').toLowerCase()));
    const mapped = images
      .map((it) => {
        const parent = String(it?.path || '').replace(/^\/+|\/+$/g, '');
        const full = parent ? `${parent}/${it.name}` : it?.name;
        const src = props.context?.api?.getPreviewUrl?.(full);
        if (!src) return null;
        return { src, title: stem(it?.name || '') };
      })
      .filter(Boolean);
    galleryItems.value = mapped;
  } catch (_) {
    galleryItems.value = [];
  }
};

const lightboxImages = computed(() => {
  if (galleryItems.value.length > 0) return galleryItems.value;
  if (previewSrc.value) {
    return [{ src: previewSrc.value, title: stem(props.context?.item?.name || '') }];
  }
  return [];
});

const initialIndex = computed(() => {
  if (galleryItems.value.length === 0 || !previewSrc.value) return 0;
  const idx = galleryItems.value.findIndex((it) => it.src === previewSrc.value);
  return idx >= 0 ? idx : 0;
});

const activeIndex = ref(0);
const handleIndexChange = (i) => {
  if (Number.isInteger(i)) activeIndex.value = i;
};

const ensureVisible = () => {
  isVisible.value = Boolean(previewSrc.value && isPreviewableImage(props.context?.extension));
};

const handleClose = () => {
  isVisible.value = false;
  props.context?.api?.closePreview?.();
};

onMounted(async () => {
  ensureVisible();
  await loadGallery();
  activeIndex.value = initialIndex.value;
});

watch(previewSrc, async () => {
  ensureVisible();
  await loadGallery();
  activeIndex.value = initialIndex.value;
});

watch(
  () => props.context?.item?.path,
  async () => {
    await loadGallery();
    activeIndex.value = initialIndex.value;
  },
);
</script>
