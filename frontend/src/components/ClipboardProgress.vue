<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFileStore } from '@/stores/fileStore';

const fileStore = useFileStore();
const { t } = useI18n();

const operation = computed(() => fileStore.clipboardOperation);

const title = computed(() => {
  const op = operation.value;
  if (!op) return '';

  const count = Number(op.itemCount) || 0;
  const itemsLabel = count === 1 ? t('common.item') : t('common.items');

  return op.type === 'move'
    ? t('clipboard.moving', { count, items: itemsLabel })
    : t('clipboard.copying', { count, items: itemsLabel });
});

const destination = computed(() => operation.value?.destination ?? '');
</script>

<template>
  <div
    v-if="operation"
    class="fixed right-4 bottom-4 min-w-[360px] max-w-sm rounded-2xl border border-zinc-200/70 dark:border-white/10 bg-white/85 dark:bg-zinc-700/90 backdrop-blur-md shadow-xl ring-1 ring-black/5 p-5"
    role="status"
    aria-live="polite"
  >
    <h3 class="text-lg font-semibold tracking-tight">
      {{ title }}
    </h3>

    <div v-if="destination" class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
      {{ t('common.to') }}
      <span class="text-indigo-600 dark:text-indigo-300 font-medium">{{ destination }}</span>
    </div>

    <div class="mt-3">
      <div
        class="w-full h-2 rounded-full overflow-hidden border border-zinc-200/70 dark:border-zinc-700/50 bg-zinc-100/80 dark:bg-zinc-800/70"
      >
        <div class="h-full rounded-full clipboard-bar clipboard-bar--animated" />
      </div>
    </div>

    <div class="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
      {{ t('clipboard.working') }}
    </div>
  </div>
</template>

<style scoped>
.clipboard-bar {
  width: 42%;
  background: linear-gradient(90deg, #4f46e5, #6366f1, #818cf8);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.25),
    0 0 0 1px rgba(79, 70, 229, 0.18),
    0 10px 24px rgba(79, 70, 229, 0.22);
  will-change: transform;
}

.clipboard-bar--animated {
  animation: clipboardSlide 1.35s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .clipboard-bar--animated {
    animation: none;
  }
}

@keyframes clipboardSlide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(260%);
  }
}
</style>
