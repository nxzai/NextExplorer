<script setup>
import { ChevronLeft16Filled, ChevronRight16Filled } from '@vicons/fluent';
import { ArrowUp } from '@vicons/tabler';
import { useNavigation } from '@/composables/navigation';

const { goNext, goPrev, goUp, canGoPrev, canGoNext } = useNavigation();
</script>
<template>
  <div class="flex items-center">
    <button
      @click="goPrev"
      :disabled="!canGoPrev"
      class="p-1.5 rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600 mr-1 disabled:opacity-40 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
      :title="$t('nav.back')"
      data-test="nav-back"
    >
      <ChevronLeft16Filled class="h-5" />
    </button>
    <button
      @click="goNext"
      :disabled="!canGoNext"
      class="p-1.5 rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600 mr-1 disabled:opacity-40 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
      :title="$t('nav.forward')"
      data-test="nav-forward"
    >
      <ChevronRight16Filled class="h-5" />
    </button>
    <button
      @click="goUp"
      class="p-1.5 rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600 mr-2"
      :title="$t('nav.upOneFolder')"
    >
      <ArrowUp class="h-5" />
    </button>
  </div>
</template>
