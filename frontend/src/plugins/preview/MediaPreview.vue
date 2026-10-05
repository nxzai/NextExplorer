<template>
  <div
    v-if="currentMedia"
    class="fixed left-[var(--pane-left)] top-[var(--pane-top)] h-[var(--pane-height)] w-[var(--pane-width)] z-2000 flex flex-col bg-black text-white"
  >
    <header
      class="flex shrink-0 items-center gap-3 border-b border-white/15 bg-black/80 px-3 py-2 backdrop-blur-sm"
    >
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium">{{ currentMedia.item.name }}</h2>
      <span v-if="mediaItems.length > 1" class="text-xs text-neutral-300" aria-live="polite">
        {{ currentIndex + 1 }} / {{ mediaItems.length }}
      </span>
      <!--
        Only Safari implements audioTracks; Chrome and Firefox keep it behind a
        flag. So this appears where switching actually works and is absent
        everywhere else, rather than offering a control that does nothing.
      -->
      <label v-if="switchableAudio.length > 1" class="flex items-center gap-1.5 text-xs">
        <span class="sr-only">{{ t('mediaPreview.audioTrack') }}</span>
        <SpeakerWaveIcon class="h-4 w-4 text-neutral-300" />
        <select
          v-model="selectedAudioTrack"
          class="max-w-40 rounded-md border border-white/20 bg-black/60 px-1.5 py-1 text-xs text-white"
          :aria-label="t('mediaPreview.audioTrack')"
        >
          <option v-for="track in switchableAudio" :key="track.id" :value="track.id">
            {{ track.label }}
          </option>
        </select>
      </label>

      <div v-if="canZoom && !imageFailed" class="hidden items-center gap-1 sm:flex">
        <button
          type="button"
          class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white"
          :aria-label="t('mediaPreview.rotateLeft')"
          @click="rotateImage(-90)"
        >
          <ArrowUturnLeftIcon class="h-5 w-5" />
        </button>
        <button
          type="button"
          class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white"
          :aria-label="t('mediaPreview.rotateRight')"
          @click="rotateImage(90)"
        >
          <ArrowUturnRightIcon class="h-5 w-5" />
        </button>
        <button
          type="button"
          class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          :aria-label="t('mediaPreview.zoomOut')"
          :disabled="!zoom.isZoomed.value"
          @click="zoomOut"
        >
          <MagnifyingGlassMinusIcon class="h-5 w-5" />
        </button>
        <button
          type="button"
          class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          :aria-label="t('mediaPreview.zoomIn')"
          :disabled="zoom.scale.value >= zoom.maxScale"
          @click="zoomIn"
        >
          <MagnifyingGlassPlusIcon class="h-5 w-5" />
        </button>
      </div>

      <button
        v-if="api.download"
        type="button"
        class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white"
        :aria-label="t('mediaPreview.download')"
        @click="downloadCurrent"
      >
        <ArrowDownTrayIcon class="h-5 w-5" />
      </button>
      <button
        type="button"
        class="rounded-md p-2 text-neutral-200 transition hover:bg-white/15 hover:text-white"
        :aria-label="t('mediaPreview.close')"
        @click="close"
      >
        <XMarkIcon class="h-5 w-5" />
      </button>
    </header>

    <main
      ref="stageRef"
      class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2"
      data-test="media-preview"
      :style="{ touchAction: zoom.isZoomed.value ? 'none' : 'pan-y' }"
      @pointerdown.capture="startSwipe"
      @pointermove.capture="movePointer"
      @pointerup.capture="finishSwipe"
      @pointercancel.capture="resetSwipe"
      @touchstart.capture="startTouchSwipe"
      @touchmove.capture="moveTouch"
      @touchend.capture="finishTouchSwipe"
      @touchcancel.capture="resetSwipe"
      @wheel="handleWheel"
      @dblclick="canZoom && zoom.toggle(stageBounds())"
    >
      <button
        v-if="mediaItems.length > 1"
        type="button"
        class="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white shadow-sm transition hover:bg-black/80"
        :aria-label="t('mediaPreview.previous')"
        @pointerdown.stop
        @click.stop="previous"
      >
        <ChevronLeftIcon class="h-6 w-6" />
      </button>

      <img
        v-if="isPreviewableImage(currentMedia.extension) && !imageFailed"
        :src="currentMedia.previewUrl"
        :alt="currentMedia.item.name"
        class="max-h-full max-w-full object-contain"
        :class="{
          'cursor-grab': zoom.isZoomed.value && !pointerPanActive,
          'cursor-grabbing': pointerPanActive,
        }"
        draggable="false"
        :style="{
          touchAction: zoom.isZoomed.value ? 'none' : 'pan-y',
          transform: imageTransform,
          transformOrigin: 'center center',
        }"
        @dragstart.prevent
        @load="imageFailed = false"
        @error="imageFailed = true"
      />
      <div
        v-else-if="isPreviewableImage(currentMedia.extension)"
        class="mx-12 max-w-md rounded-lg border border-white/15 bg-white/5 px-6 py-5 text-center"
        role="alert"
      >
        <p class="font-medium">{{ t('mediaPreview.imageLoadError') }}</p>
        <p class="mt-1 text-sm text-neutral-400">{{ currentMedia.item.name }}</p>
      </div>
      <!--
        A grid, so the video is actually contained.

        `max-h-full` on the video used to resolve against this wrapper, whose
        own height is content-driven — and a percentage against an indefinite
        height computes to none. A portrait video therefore rendered at its
        natural height and hung below the stage, which clips it: the control
        bar was simply off-screen, and only fullscreen brought it back. A grid
        area has a definite size, so the same percentage now means what it
        says. Landscape videos, which fit either way, are laid out identically.
      -->
      <div v-else class="relative grid min-h-0 max-h-full max-w-full place-items-center">
        <video
          :key="currentMedia.key"
          ref="videoRef"
          class="block min-h-0 max-h-full max-w-full bg-black"
          controls
          autoplay
          playsinline
          :poster="currentMedia.item.thumbnail"
          style="touch-action: pan-y"
          @loadedmetadata="handleVideoMetadata"
        >
          <source :src="currentMedia.previewUrl" :type="getVideoMimeType(currentMedia.extension)" />
          <!--
            Subtitles are converted to WebVTT server-side, because it is the
            only format a video element accepts. Declaring them as tracks is
            what makes the browser's own caption button appear — there is no
            menu of ours to maintain.
          -->
          <track
            v-for="track in subtitleTracks"
            :key="`${track.source}-${track.index ?? track.fileName}`"
            kind="subtitles"
            :src="track.url"
            :srclang="track.language || undefined"
            :label="subtitleLabel(track)"
            :default="track.isDefault || undefined"
          />
          Your browser does not support the video tag.
        </video>
        <div
          class="absolute inset-x-0 top-0 bottom-14"
          aria-hidden="true"
          style="touch-action: pan-y"
        ></div>
      </div>

      <!--
        Why a film plays in silence. Placed over the stage rather than beneath
        the video so it changes no layout, and it cannot be clicked through to
        — the controls underneath stay reachable.
      -->
      <p
        v-if="showAudioNotice"
        class="pointer-events-none absolute inset-x-4 top-3 z-10 mx-auto max-w-lg rounded-md bg-amber-500/90 px-3 py-2 text-center text-xs font-medium text-black shadow-lg"
        role="status"
      >
        {{ noticeText }}
      </p>

      <button
        v-if="mediaItems.length > 1"
        type="button"
        class="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white shadow-sm transition hover:bg-black/80"
        :aria-label="t('mediaPreview.next')"
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
import { useI18n } from 'vue-i18n';
import {
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  SpeakerWaveIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline';
import { isPreviewableImage, isPreviewableVideo } from '@/config/media';
import { useMediaZoom } from './useMediaZoom';
import { useMediaTracks, languageName } from './useMediaTracks';

const { t, locale } = useI18n();

const props = defineProps({
  item: { type: Object, required: true },
  extension: { type: String, required: true },
  filePath: { type: String, required: true },
  previewUrl: { type: String, required: true },
  api: { type: Object, required: true },
});

const SWIPE_THRESHOLD = 48;
const SWIPE_DOWN_CLOSE_THRESHOLD = 96;
const SWIPE_DOWN_INTENT_THRESHOLD = 16;
// Two taps further apart than this are two taps, not a double tap.
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30;
// A trackpad pinch arrives as a wheel event with ctrlKey; this turns its
// delta into a factor gentle enough to be controllable.
const WHEEL_ZOOM_SENSITIVITY = 0.005;

const swipeStart = ref(null);
const videoRef = ref(null);
const stageRef = ref(null);
const zoom = useMediaZoom();
const pinchStart = ref(null);
const lastTap = ref(null);
const imageFailed = ref(false);
const imageRotation = ref(0);
const pointerPanActive = ref(false);

const imageTransform = computed(() => {
  const transforms = [];
  if (zoom.transform.value !== 'none') transforms.push(zoom.transform.value);
  if (imageRotation.value) transforms.push(`rotate(${imageRotation.value}deg)`);
  return transforms.join(' ') || 'none';
});

const stageBounds = () => stageRef.value?.getBoundingClientRect() || null;

const touchDistance = (touches) => {
  const [first, second] = touches;
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
};

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

/** Videos keep their own controls; only pictures zoom. */
const canZoom = computed(
  () => Boolean(currentMedia.value) && isPreviewableImage(currentMedia.value.extension)
);

/**
 * What the file holds, and what this browser will refuse.
 *
 * Only worth asking for the things played through a video element; a picture
 * has no tracks.
 */
const isPlayedAsVideo = computed(
  () => Boolean(currentMedia.value) && !isPreviewableImage(currentMedia.value.extension)
);

const {
  subtitleTracks,
  audioTracks,
  hasUnplayableAudio,
  unplayableCodecs,
  hasUnplayableVideo,
  unplayableVideoCodecs,
} = useMediaTracks(currentMedia, props.api, isPlayedAsVideo);

/**
 * A caption's name in the reader's own language, and where it came from.
 *
 * A file next to the video and a track inside it can carry the same language,
 * so the source is part of the name — otherwise the menu offers "French"
 * twice and picking one is a guess.
 */
const subtitleLabel = (track) => {
  const named = track.title || languageName(track.language, locale.value) || track.label;
  const parts = [named];
  if (track.forced) parts.push(t('mediaPreview.subtitleForced'));
  if (track.source === 'sidecar') parts.push(t('mediaPreview.subtitleExternal'));
  return parts.join(' · ');
};

/**
 * The audio notice, which says its piece and then gets out of the way.
 *
 * It answers a question asked in the first seconds — why is this silent — and
 * has no business sitting over a film for two hours afterwards.
 */
const AUDIO_NOTICE_MS = 10000;
const noticeVisible = ref(false);
let noticeTimer = null;

/**
 * One sentence, and the picture comes first: a video that does not play at all
 * makes a remark about its soundtrack beside the point.
 */
const noticeText = computed(() => {
  if (hasUnplayableVideo.value) {
    return t('mediaPreview.noPlayableVideo', {
      codecs: unplayableVideoCodecs.value.join(', ').toUpperCase(),
    });
  }
  if (hasUnplayableAudio.value) {
    return t('mediaPreview.noPlayableAudio', {
      codecs: unplayableCodecs.value.join(', ').toUpperCase(),
    });
  }
  return '';
});

const showAudioNotice = computed(() => Boolean(noticeText.value) && noticeVisible.value);

watch(noticeText, (text) => {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeVisible.value = Boolean(text);
  if (!text) return;
  noticeTimer = setTimeout(() => {
    noticeVisible.value = false;
  }, AUDIO_NOTICE_MS);
});

/**
 * Audio tracks this browser will let anyone switch between.
 *
 * `audioTracks` is Safari's alone — Chrome and Firefox keep it behind a flag —
 * so this is empty nearly everywhere, and the control that reads it is absent
 * rather than present and inert. What the file contains is still reported by
 * the notice above, which needs no browser support at all.
 */
const switchableAudio = ref([]);
const selectedAudioTrack = ref('');

const readSwitchableAudio = () => {
  const native = videoRef.value?.audioTracks;
  if (!native || typeof native.length !== 'number' || native.length < 2) {
    switchableAudio.value = [];
    return;
  }

  const list = [];
  for (let index = 0; index < native.length; index += 1) {
    const track = native[index];
    // Prefer what the server read from the container: ffprobe reports titles
    // and languages the browser's own track objects often leave empty.
    const described = audioTracks.value[index];
    const language = described?.language || track.language;
    list.push({
      id: track.id || String(index),
      index,
      label:
        described?.title ||
        languageName(language, locale.value) ||
        track.label ||
        t('mediaPreview.audioTrackNumbered', { number: index + 1 }),
    });
    if (track.enabled) selectedAudioTrack.value = track.id || String(index);
  }
  switchableAudio.value = list;
};

watch(selectedAudioTrack, (id) => {
  const native = videoRef.value?.audioTracks;
  if (!native || !id) return;
  for (let index = 0; index < native.length; index += 1) {
    // Exactly one enabled at a time is what the specification allows, and what
    // Safari enforces anyway.
    native[index].enabled = (native[index].id || String(index)) === id;
  }
});

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

/**
 * The browser only knows what tracks exist once it has read the container's
 * header, so the list is taken then rather than on mount.
 */
const handleVideoMetadata = () => readSwitchableAudio();

const pauseVideo = () => {
  if (!videoRef.value) return;

  videoRef.value.pause();
  videoRef.value.currentTime = 0;
};

watch(currentMedia, (nextMedia, previousMedia) => {
  if (previousMedia?.key !== nextMedia?.key) {
    pauseVideo();
    // The previous video's tracks are not this one's; the element is rebuilt
    // and will report its own through loadedmetadata.
    switchableAudio.value = [];
    selectedAudioTrack.value = '';
    // A new picture starts at natural size — carrying the previous one's zoom
    // over would land somewhere arbitrary in an unrelated image.
    zoom.reset();
    imageRotation.value = 0;
    imageFailed.value = false;
  }
});

const zoomIn = () => zoom.zoomBy(1.5, stageBounds());
const zoomOut = () => zoom.zoomBy(1 / 1.5, stageBounds());
const rotateImage = (degrees) => {
  imageRotation.value = (imageRotation.value + degrees + 360) % 360;
};

const move = (offset) => {
  const { length } = mediaItems.value;
  if (length < 2) return;

  const nextIndex = (currentIndex.value + offset + length) % length;
  activeMediaKey.value = mediaItems.value[nextIndex].key;
};

const previous = () => move(-1);
const next = () => move(1);

const startSwipe = (event) => {
  // Touch has its own handlers below. A mouse drag only has meaning after an
  // image is zoomed; at natural size it must not turn ordinary clicks into
  // gallery navigation.
  if (event.pointerType === 'touch' || (event.pointerType === 'mouse' && !zoom.isZoomed.value)) {
    return;
  }

  swipeStart.value = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
  };

  if (zoom.isZoomed.value) {
    pointerPanActive.value = true;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }
};

const movePointer = (event) => {
  const start = swipeStart.value;
  if (
    !start ||
    event.pointerType === 'touch' ||
    event.pointerId !== start.pointerId ||
    !zoom.isZoomed.value
  ) {
    return;
  }

  event.preventDefault();
  zoom.panBy(event.clientX - start.lastX, event.clientY - start.lastY, stageBounds());
  start.lastX = event.clientX;
  start.lastY = event.clientY;
};

const startTouchSwipe = (event) => {
  // Two fingers are never a swipe — on a picture they pinch, and on a video
  // they do nothing at all. Letting one of them arm the swipe would turn a
  // pinch on a video into a page turn.
  if (event.touches?.length === 2) {
    swipeStart.value = null;
    pinchStart.value = canZoom.value
      ? { distance: touchDistance(event.touches), scale: zoom.scale.value }
      : null;
    return;
  }

  const touch = event.changedTouches[0];
  if (!touch) return;

  swipeStart.value = {
    pointerId: touch.identifier,
    x: touch.clientX,
    y: touch.clientY,
    // Panning a zoomed picture moves it under the finger, so each move is
    // measured from the last rather than from where the gesture began.
    lastX: touch.clientX,
    lastY: touch.clientY,
  };
};

const moveTouch = (event) => {
  if (pinchStart.value && event.touches?.length === 2) {
    event.preventDefault();
    const distance = touchDistance(event.touches);
    if (pinchStart.value.distance > 0) {
      zoom.zoomTo((pinchStart.value.scale * distance) / pinchStart.value.distance, stageBounds());
    }
    return;
  }

  const start = swipeStart.value;
  if (!start) return;
  const touch = Array.from(event.touches || []).find((item) => item.identifier === start.pointerId);
  if (!touch) return;

  // Once a downward gesture is clearly intentional, keep the browser from
  // scrolling the page under the fixed viewer. The distance remains generous
  // enough that taps and the native video controls are left untouched.
  if (!zoom.isZoomed.value) {
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (deltaY >= SWIPE_DOWN_INTENT_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX)) {
      event.preventDefault();
    }
    return;
  }

  // One finger on a zoomed picture moves the picture. At natural size it is
  // left alone, so the gallery can read it as a swipe when it ends.
  event.preventDefault();
  zoom.panBy(touch.clientX - start.lastX, touch.clientY - start.lastY, stageBounds());
  start.lastX = touch.clientX;
  start.lastY = touch.clientY;
};

/** Two quick taps in the same spot zoom in, or all the way back out. */
const registerTap = (touch) => {
  if (!canZoom.value || !touch) return false;

  const now = Date.now();
  const previous = lastTap.value;
  lastTap.value = { at: now, x: touch.clientX, y: touch.clientY };

  if (
    previous &&
    now - previous.at < DOUBLE_TAP_MS &&
    Math.abs(touch.clientX - previous.x) < DOUBLE_TAP_SLOP &&
    Math.abs(touch.clientY - previous.y) < DOUBLE_TAP_SLOP
  ) {
    lastTap.value = null;
    zoom.toggle(stageBounds());
    return true;
  }

  return false;
};

/** A trackpad pinch, or ctrl with a wheel — the desktop way in. */
const handleWheel = (event) => {
  if (!canZoom.value || !event.ctrlKey) return;
  event.preventDefault();
  zoom.zoomBy(Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY), stageBounds());
};

const resetSwipe = () => {
  swipeStart.value = null;
  pinchStart.value = null;
  pointerPanActive.value = false;
};

const navigateForSwipe = (start, event) => {
  // Zoomed in, the same movement was panning the picture and must not also
  // turn the page — that conflation is what made the old viewer unusable.
  if (zoom.isZoomed.value) return false;

  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;

  if (deltaY >= SWIPE_DOWN_CLOSE_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX)) {
    close();
    return true;
  }

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
  if (pinchStart.value && (event.touches?.length ?? 0) < 2) {
    pinchStart.value = null;
    return;
  }

  const start = swipeStart.value;
  const touch = Array.from(event.changedTouches || []).find(
    (item) => item.identifier === start?.pointerId
  );
  resetSwipe();

  if (!start || !touch) return;

  const travelled = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
  if (travelled < DOUBLE_TAP_SLOP && registerTap(touch)) return;

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
  // Escape belongs to the containing viewer even when the native video has
  // focus. Arrow keys remain the video's, so seeking and volume still work.
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }

  if (originatedFromVideo(event)) return;

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    previous();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    next();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
  pauseVideo();
  window.removeEventListener('keydown', handleKeydown);
});
</script>
