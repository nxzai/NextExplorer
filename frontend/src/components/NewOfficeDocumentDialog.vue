<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ModalDialog from '@/components/ModalDialog.vue';

/**
 * Name a new document before it exists.
 *
 * Everything else here creates a file first and renames it in the list, which
 * works because the file stays in view. A document created here opens straight
 * into an editor covering the whole window, so the rename box would be behind it
 * — the name has to be settled first.
 *
 * The extension is shown but not editable: the format was chosen from the menu,
 * and the server owns the extension either way.
 */

const props = defineProps({
  modelValue: Boolean,
  /** 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'txt' | 'md' | 'csv' */
  format: { type: String, default: 'docx' },
  title: { type: String, default: '' },
  defaultName: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue', 'create']);
const { t } = useI18n();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const name = ref('');
const inputRef = ref(null);
const isSubmitting = ref(false);

const canSubmit = computed(() => name.value.trim().length > 0 && !isSubmitting.value);

const submit = async () => {
  if (!canSubmit.value) return;
  isSubmitting.value = true;
  try {
    emit('create', { format: props.format, name: name.value.trim() });
    isOpen.value = false;
  } finally {
    isSubmitting.value = false;
  }
};

watch(
  () => props.modelValue,
  async (opened) => {
    if (!opened) return;
    name.value = props.defaultName;
    await nextTick();
    // Selected rather than given a caret: the default name is a suggestion, and
    // typing over it is what most people do next.
    inputRef.value?.focus();
    inputRef.value?.select();
  }
);
</script>

<template>
  <ModalDialog v-model="isOpen">
    <template #title>{{ title }}</template>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <label class="flex flex-col gap-1">
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('create.documentName') }}
        </span>
        <span class="flex items-center gap-1">
          <input
            ref="inputRef"
            v-model="name"
            type="text"
            class="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-zinc-800"
            :placeholder="defaultName"
          />
          <span class="shrink-0 text-sm text-neutral-500 dark:text-neutral-400">.{{ format }}</span>
        </span>
      </label>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-zinc-800"
          @click="isOpen = false"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="submit"
          class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          :disabled="!canSubmit"
        >
          {{ t('create.createAndOpen') }}
        </button>
      </div>
    </form>
  </ModalDialog>
</template>
