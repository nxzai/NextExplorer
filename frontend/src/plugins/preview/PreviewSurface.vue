<template>
  <!-- Standalone plugins render directly -->
  <div v-if="isStandalone" data-test="preview-surface">
    <component v-if="component" :is="component" v-bind="item" />
    <!-- Lightweight fallback while standalone plugin component loads -->
    <div
      v-else
      class="fixed inset-x-0 bottom-0 top-[var(--tab-strip-height)] z-2000 flex items-center justify-center text-sm text-neutral-200"
    >
      <div class="flex items-center pr-4 bg-neutral-300 dark:bg-black bg-opacity-20 rounded-lg">
        <LoadingIcon /> {{ $t('common.loading') }}
      </div>
    </div>
  </div>

  <!-- Regular plugins render in modal -->
  <transition v-else name="preview-fade">
    <div
      v-if="isOpen"
      data-test="preview-surface"
      class="fixed inset-x-0 bottom-0 top-[var(--tab-strip-height)] z-2000 flex items-center justify-center bg-black/70"
      @click.self="handleClose"
      @keydown.esc="handleClose"
    >
      <div
        class="relative flex h-full w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-zinc-900"
      >
        <!-- Header (unless minimal) -->
        <header
          v-if="!isMinimal"
          class="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 shadow-xs dark:border-neutral-700 dark:bg-zinc-800"
        >
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {{ plugin?.label || 'Preview' }}
            </p>
            <h2 class="truncate text-base font-semibold text-neutral-900 dark:text-white">
              {{ item?.item?.name || '—' }}
            </h2>
          </div>

          <!-- Actions -->
          <div class="ml-auto flex items-center gap-2">
            <button
              v-for="action in actions"
              :key="action.id"
              type="button"
              class="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition"
              :class="
                action.variant === 'primary'
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-700'
              "
              @click="runAction(action)"
            >
              <component
                v-if="getActionIcon(action.id)"
                :is="getActionIcon(action.id)"
                class="h-4 w-4"
              />
              <span>{{ action.label }}</span>
            </button>

            <button
              type="button"
              class="rounded-md p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              :title="$t('common.close')"
              :aria-label="$t('common.close')"
              data-test="preview-close"
              @click="handleClose"
            >
              <XMarkIcon class="h-5 w-5" />
            </button>
          </div>
        </header>

        <!-- Content -->
        <main class="flex-1 overflow-hidden bg-neutral-50 dark:bg-zinc-950/40">
          <!--
            Fallback close button, shown only until the plugin reports that
            its own viewer draws one.

            A plugin rendering third-party chrome — ONLYOFFICE — asks that
            viewer for a close button and clears this flag once the document
            is ready. Until then, and for anything that never gets there,
            this is the only way out of a header-less overlay.

            Sized and placed to sit over the editor's own logo in the top left
            corner, hiding it: the right-hand side belongs to the editor's
            toolbar, where a floating button sat among real controls and read
            as one of them. The offset was trimmed against the running editor
            rather than computed, so adjust it the same way. Any larger and it
            spills onto the File menu underneath.

            Solid fill in the app's primary blue with a white ring, so it
            stays visible against a toolbar that is light in one theme and
            dark in the other — the previous translucent grey disappeared into
            both.
          -->
          <!--
            In a box of its own, and that is not styling.

            This button comes and goes, and Vue leaves a comment where something
            it has taken away used to be — anchored on whatever comes next. What
            comes next is the viewer's own element, and ONLYOFFICE takes that
            element out of the page and puts an `iframe` in its place, so the
            anchor is a node the page no longer holds: `insertBefore` throws, the
            patch stops half done, and everything after it fails on elements that
            are suddenly null. Inside a wrapper of its own it can appear and
            disappear against its own edges, and never against the viewer's.
          -->
          <div>
            <button
              v-if="isMinimal && !hasNativeClose"
              type="button"
              :title="$t('common.close')"
              :aria-label="$t('common.close')"
              data-test="preview-close"
              class="absolute left-1.75 top-0.5 z-2100 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-md ring-1 ring-white/80 transition hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:ring-zinc-900/80"
              @click="handleClose"
            >
              <XMarkSolidIcon class="h-4 w-4" />
            </button>
          </div>

          <!--
            And the viewer in a box of its own for the same reason: whatever it
            does to the element it is given, it does inside here, where nothing
            above it needs to find that element again.
          -->
          <div class="h-full">
            <component v-if="component" :is="component" v-bind="item" class="h-full" />
            <div
              v-else
              class="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400"
            >
              Loading preview…
            </div>
          </div>
        </main>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { computed, shallowRef, watch } from 'vue';
import {
  XMarkIcon,
  ArrowDownTrayIcon,
  PencilSquareIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/vue/24/outline';
// Solid, only for the floating button: an outline glyph on a filled circle
// reads as thin at that size.
import { XMarkIcon as XMarkSolidIcon } from '@heroicons/vue/24/solid';
import LoadingIcon from '@/icons/LoadingIcon.vue';

/**
 * What one tab is showing.
 *
 * This is the whole of what `PreviewHost` used to be, moved out of it so that
 * there can be several: one per tab, all mounted at once, only one of them
 * visible. It reads a session rather than the manager, which is the point —
 * a surface in a background tab draws the document *that tab* holds, not
 * whatever happens to be in front.
 */
const props = defineProps({
  session: { type: Object, required: true },
});

const item = computed(() => props.session.item.value);
const plugin = computed(() => props.session.plugin.value);
const isOpen = computed(() => props.session.isOpen.value);

// Derived state
const isStandalone = computed(() => plugin.value?.standalone ?? false);
const isMinimal = computed(() => plugin.value?.minimalHeader ?? false);
// Set by plugins whose embedded viewer provides its own close control.
const hasNativeClose = computed(() => item.value?.previewState?.hasNativeClose === true);

const actions = computed(() => {
  if (!plugin.value || !item.value || isStandalone.value || isMinimal.value) {
    return [];
  }

  const pluginActions = plugin.value.actions?.(item.value);
  return Array.isArray(pluginActions) ? pluginActions : [];
});

// Component loading
const component = shallowRef(null);

watch(
  plugin,
  async (current) => {
    component.value = null;
    if (!current) return;

    try {
      const factory = current.component;
      const result = typeof factory === 'function' ? await factory() : factory;
      component.value = result?.default || result;
    } catch (error) {
      console.error(`Failed to load plugin ${current.id}:`, error);
    }
  },
  { immediate: true }
);

// Handlers
const handleClose = async () => {
  if (!isStandalone.value) {
    await props.session.close();
  }
};

const runAction = (action) => {
  if (!action?.run || !item.value) return;

  try {
    action.run(item.value);
  } catch (error) {
    console.error(`Action ${action.id} failed:`, error);
  }
};

// Action icons
const getActionIcon = (id) => {
  const icons = {
    download: ArrowDownTrayIcon,
    edit: PencilSquareIcon,
    'open-editor': PencilSquareIcon,
    open: ArrowTopRightOnSquareIcon,
  };
  return icons[id];
};
</script>

<style scoped>
.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity 0.2s ease;
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}
</style>
