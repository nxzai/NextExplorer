<template>
  <div v-if="currentMedia" class="fixed inset-0 z-2000 flex flex-col bg-black text-white">
    <header
      class="flex shrink-0 items-center gap-3 border-b border-white/15 bg-black/80 px-3 py-2 backdrop-blur-sm"
    >
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium">{{ currentMedia.item.name }}</h2>
      <span v-if="mediaItems.length > 1" class="text-xs text-neutral-300" aria-live="polite">
        {{ currentIndex + 1 }} / {{ mediaItems.length }}
      </span>
      <button
        v-if="api.download"
        type="button"
        class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white"
        aria-label="Download media"
        @click="downloadCurrent"
      >
        <ArrowDownTrayIcon class="h-5 w-5" />
      </button>
      <button
        type="button"
        class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white"
        aria-label="Close preview"
        @click="close"
      >
        <XMarkIcon class="h-5 w-5" />
      </button>
    </header>

    <main
      class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
      data-test="media-preview"
      style="touch-action: pan-y"
      @pointerdown.capture="startSwipe"
      @pointerup.capture="finishSwipe"
      @pointercancel.capture="resetSwipe"
      @touchstart.capture="startTouchSwipe"
      @touchend.capture="finishTouchSwipe"
      @touchcancel.capture="resetSwipe"
    >
      <button
        v-if="mediaItems.length > 1"
        type="button"
        class="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white shadow-sm transition hover:bg-black/80"
        aria-label="Previous media"
        @pointerdown.stop
        @click.stop="previous"
      >
        <ChevronLeftIcon class="h-6 w-6" />
      </button>

      <img
        v-if="isPreviewableImage(currentMedia.extension)"
        :src="currentMedia.previewUrl"
        :alt="currentMedia.item.name"
        class="max-h-full max-w-full object-contain"
        draggable="false"
        style="touch-action: pan-y"
        @dragstart.prevent
      />
      <div v-else class="relative max-h-full max-w-full">
        <video
          :key="currentMedia.key"
          ref="videoRef"
          class="block max-h-full max-w-full bg-black"
          controls
          autoplay
          playsinline
          :poster="currentMedia.item.thumbnail"
          style="touch-action: pan-y"
        >
          <source :src="currentMedia.previewUrl" :type="getVideoMimeType(currentMedia.extension)" />
          Your browser does not support the video tag.
        </video>
        <div
          class="absolute inset-x-0 top-0 bottom-14"
          aria-hidden="true"
          style="touch-action: pan-y"
        ></div>
      </div>

      <button
        v-if="mediaItems.length > 1"
        type="button"
        class="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white shadow-sm transition hover:bg-black/80"
        aria-label="Next media"
        @pointerdown.stop
        @click.stop="next"
      >
        <ChevronRightIcon class="h-6 w-6" />
      </button>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowDownTrayIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline';
import { isPreviewableImage, isPreviewableVideo } from '@/config/media';

const props = defineProps({
  item: { type: Object, required: true },
  extension: { type: String, required: true },
  filePath: { type: String, required: true },
  previewUrl: { type: String, required: true },
  api: { type: Object, required: true },
});

const SWIPE_THRESHOLD = 48;
const swipeStart = ref(null);
const videoRef = ref(null);

const getItemKey = (item) => `${item.path || ''}/${item.name || ''}`;

const getItemExtension = (item) => {
  const name = String(item?.name || '');
  const dot = name.lastIndexOf('.');
  if (dot > 0) return name.slice(dot + 1).toLowerCase();

  const kind = String(item?.kind || '').toLowerCase();
  return kind === 'directory' ? '' : kind;
};

const isPreviewableMedia = (item) => {
  const extension = getItemExtension(item);
  return isPreviewableImage(extension) || isPreviewableVideo(extension);
};

const mediaItems = computed(() => {
  const siblings = props.api.getSiblings(props.item);
  const items = Array.isArray(siblings) ? siblings.filter(isPreviewableMedia) : [];
  const currentItemKey = getItemKey(props.item);

  if (!items.some((item) => getItemKey(item) === currentItemKey)) {
    items.unshift(props.item);
  }

  return items
    .map((item) => {
      const key = getItemKey(item);
      const isCurrentItem = key === currentItemKey;
      return {
        key,
        item,
        extension: isCurrentItem ? props.extension.toLowerCase() : getItemExtension(item),
        previewUrl: isCurrentItem ? props.previewUrl : props.api.getPreviewUrl(item),
      };
    })
    .filter((item) => item.previewUrl);
});

const activeMediaKey = ref(getItemKey(props.item));

const currentIndex = computed(() => {
  const index = mediaItems.value.findIndex((item) => item.key === activeMediaKey.value);
  return index >= 0 ? index : 0;
});

const currentMedia = computed(() => mediaItems.value[currentIndex.value] || null);

watch(
  mediaItems,
  (items) => {
    if (!items.some((item) => item.key === activeMediaKey.value)) {
      activeMediaKey.value = items[0]?.key || '';
    }
  },
  { immediate: true }
);

watch(
  () => props.item,
  (item) => {
    activeMediaKey.value = getItemKey(item);
  }
);

const pauseVideo = () => {
  if (!videoRef.value) return;

  videoRef.value.pause();
  videoRef.value.currentTime = 0;
};

watch(currentMedia, (nextMedia, previousMedia) => {
  if (previousMedia?.key !== nextMedia?.key) {
    pauseVideo();
  }
});

const move = (offset) => {
  const { length } = mediaItems.value;
  if (length < 2) return;

  const nextIndex = (currentIndex.value + offset + length) % length;
  activeMediaKey.value = mediaItems.value[nextIndex].key;
};

const previous = () => move(-1);
const next = () => move(1);

const startSwipe = (event) => {
  if (event.pointerType === 'mouse' || event.pointerType === 'touch') return;

  swipeStart.value = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
};

const startTouchSwipe = (event) => {
  const touch = event.changedTouches[0];
  if (!touch) return;

  swipeStart.value = {
    pointerId: touch.identifier,
    x: touch.clientX,
    y: touch.clientY,
  };
};

const resetSwipe = () => {
  swipeStart.value = null;
};

const navigateForSwipe = (start, event) => {
  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;

  if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) {
    return false;
  }

  if (deltaX < 0) {
    next();
  } else {
    previous();
  }

  return true;
};

const finishSwipe = (event) => {
  if (event.pointerType === 'touch') return;

  const start = swipeStart.value;
  resetSwipe();

  if (!start || event.pointerId !== start.pointerId) return;
  navigateForSwipe(start, event);
};

const finishTouchSwipe = (event) => {
  const start = swipeStart.value;
  const touch = Array.from(event.changedTouches).find((item) => item.identifier === start?.pointerId);
  resetSwipe();

  if (!start || !touch) return;
  navigateForSwipe(start, touch);
};

const getVideoMimeType = (extension) => {
  const types = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    m4v: 'video/x-m4v',
    avi: 'video/x-msvideo',
  };
  return types[extension] || 'video/mp4';
};

const close = () => {
  props.api.close();
};

const downloadCurrent = () => {
  props.api.download(currentMedia.value?.item);
};

const originatedFromVideo = (event) => {
  if (event.target === videoRef.value) return true;
  return event.composedPath?.().includes(videoRef.value) ?? false;
};

const handleKeydown = (event) => {
  if (originatedFromVideo(event)) return;

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    previous();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    next();
  } else if (event.key === 'Escape') {
    close();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  pauseVideo();
  window.removeEventListener('keydown', handleKeydown);
});
</script>
