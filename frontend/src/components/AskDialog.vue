<script setup>
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ModalDialog from '@/components/ModalDialog.vue';
import { useAsk } from '@/composables/useAsk';

/**
 * Where a question the application asks is drawn.
 *
 * Mounted once, above the router's view, because the screens that ask are the ones on
 * their way out: a dialog belonging to the page would go with the page it is asking
 * about. `elevated`, so it is still reachable over a document filling the window.
 */
const { question, answer, isOpen, wantsText, cancel, accept } = useAsk();
const { t } = useI18n();

const field = ref(null);

// The field, not the cross in the corner, which is what the dialog would otherwise
// hand the keyboard to: somebody asked to type something should be able to type.
watch(isOpen, async (open) => {
  if (!open || !wantsText.value) return;
  await nextTick();
  field.value?.focus();
  field.value?.select();
});
</script>

<template>
  <ModalDialog elevated :model-value="isOpen" @update:model-value="(open) => !open && cancel()">
    <template #title>{{ question?.title }}</template>

    <p v-if="question?.body" class="text-base text-zinc-700 dark:text-zinc-200">
      {{ question.body }}
    </p>

    <label v-if="wantsText" class="mt-4 block">
      <span v-if="question?.label" class="mb-1 block text-sm text-zinc-500 dark:text-zinc-400">
        {{ question.label }}
      </span>
      <input
        ref="field"
        v-model="answer"
        :type="question?.password ? 'password' : 'text'"
        class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-neutral-200"
        data-test="ask-field"
        @keydown.enter.prevent="accept"
      />
    </label>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          class="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
          data-test="ask-cancel"
          @click="cancel"
        >
          {{ t('common.cancel') }}
        </button>
        <!-- Red only where the answer takes something away, so the colour still means
             something the one time it matters. -->
        <button
          type="button"
          class="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
          :class="
            question?.tone === 'danger'
              ? 'bg-red-600 hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400'
              : 'bg-blue-600 hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400'
          "
          data-test="ask-confirm"
          @click="accept"
        >
          {{ question?.confirmLabel || t('common.confirm') }}
        </button>
      </div>
    </template>
  </ModalDialog>
</template>
