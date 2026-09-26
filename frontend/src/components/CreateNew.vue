<script setup>
import { computed, ref, watch } from 'vue';
import { PlusIcon, ChevronRightIcon } from '@heroicons/vue/24/outline';
import { useToggle, onClickOutside } from '@vueuse/core';
import {
  CreateNewFolderRound,
  DriveFolderUploadOutlined,
  UploadFileOutlined,
  FileOpenOutlined,
  DescriptionOutlined,
} from '@vicons/material';

import { useFileUploader } from '@/composables/fileUploader';
import { useFileStore } from '@/stores/fileStore';
import { useFeaturesStore } from '@/stores/features';
import { usePreviewManager } from '@/plugins/preview/manager';
import NewOfficeDocumentDialog from '@/components/NewOfficeDocumentDialog.vue';

const popuplRef = ref(null);
const toggleRef = ref(null);
const drawerOpen = ref(false);

const [menuOpen, toggle] = useToggle();

// The button that opens the menu sits outside it. Left to count as outside, its
// click shut the menu in the capture phase and its own toggle opened it again, so
// the button could open the menu and never close it.
onClickOutside(
  popuplRef,
  () => {
    menuOpen.value = false;
  },
  { ignore: [toggleRef] }
);

// The drawer lives inside the menu, so it disappears with it — but its state does
// not. Without this it would be open again the next time the menu is.
watch(menuOpen, (open) => {
  if (!open) drawerOpen.value = false;
});

const { openDialog } = useFileUploader();
const fileStore = useFileStore();
const featuresStore = useFeaturesStore();
const previewManager = usePreviewManager();
const isCreating = ref(false);

/**
 * Blank office documents are only worth offering when something can open them:
 * with no editor configured, this would create files the app can only download.
 */
const hasOfficeEditor = computed(
  () => featuresStore.onlyofficeEnabled || featuresStore.collaboraEnabled
);

/**
 * What the "New document" drawer offers.
 *
 * `office` entries need an editor to be worth creating; the text ones are useful
 * on their own and are always listed. Order is deliberate: the office formats are
 * what the drawer was added for, the plain ones sit below.
 */
const DOCUMENT_TYPES = [
  {
    format: 'docx',
    office: true,
    titleKey: 'actions.newWordDocument',
    nameKey: 'create.defaultDocumentName',
    tint: 'text-blue-500',
  },
  {
    format: 'xlsx',
    office: true,
    titleKey: 'actions.newSpreadsheet',
    nameKey: 'create.defaultSpreadsheetName',
    tint: 'text-green-600',
  },
  {
    format: 'pptx',
    office: true,
    titleKey: 'actions.newPresentation',
    nameKey: 'create.defaultPresentationName',
    tint: 'text-orange-500',
  },
  {
    format: 'txt',
    titleKey: 'actions.newTextFile',
    nameKey: 'create.defaultDocumentName',
    tint: 'text-neutral-400',
  },
  {
    format: 'md',
    titleKey: 'actions.newMarkdownFile',
    nameKey: 'create.defaultDocumentName',
    tint: 'text-neutral-400',
  },
  {
    format: 'csv',
    titleKey: 'actions.newCsvFile',
    nameKey: 'create.defaultDataName',
    tint: 'text-green-600',
  },
];

const documentTypes = computed(() =>
  DOCUMENT_TYPES.filter((type) => !type.office || hasOfficeEditor.value)
);

const dialogOpen = ref(false);
const chosen = ref(DOCUMENT_TYPES[0]);

// The drawer opens beside its row, which says nothing about whether it fits.
// Measured against the viewport each time: a menu near the right edge has to hand
// its drawer to the other side or it opens off-screen.
const drawerOnLeft = ref(false);
const documentRowRef = ref(null);
const DRAWER_WIDTH = 240;

// Opening only, never a toggle: the row opens the drawer on hover too, so a
// toggle closed again the drawer the pointer had just opened on its way to the
// click. It closes when a format is chosen or when the menu does.
const openDrawer = () => {
  const rect = documentRowRef.value?.getBoundingClientRect();
  if (rect) {
    const room = window.innerWidth - rect.right;
    drawerOnLeft.value = room < DRAWER_WIDTH && rect.left > room;
  }
  drawerOpen.value = true;
};

const closeMenus = () => {
  drawerOpen.value = false;
  menuOpen.value = false;
};

const promptFor = (type) => {
  chosen.value = type;
  closeMenus();
  dialogOpen.value = true;
};

/**
 * Create the document, then open it in the editor it was made for. Landing back
 * in the file list would leave the user to find and open a document they have
 * just asked for by name.
 */
const createDocument = async ({ format, name }) => {
  if (isCreating.value) return;

  isCreating.value = true;
  try {
    const item = await fileStore.createOfficeDocument({ format, name });
    if (item) previewManager.open(item);
  } catch (error) {
    console.error('Failed to create document', error);
  } finally {
    isCreating.value = false;
  }
};

const uploadFolder = async () => {
  await openDialog({ directory: true });
};

const uploadFiles = async () => {
  await openDialog();
};

const createFolder = async () => {
  if (isCreating.value) return;

  isCreating.value = true;
  try {
    await fileStore.createFolder();
  } catch (error) {
    console.error('Failed to create folder', error);
  } finally {
    menuOpen.value = false;
    isCreating.value = false;
  }
};

const createFile = async () => {
  if (isCreating.value) return;

  isCreating.value = true;
  try {
    await fileStore.createFile();
  } catch (error) {
    console.error('Failed to create file', error);
  } finally {
    menuOpen.value = false;
    isCreating.value = false;
  }
};
</script>
<template>
  <div class="relative">
    <button
      ref="toggleRef"
      @click="toggle()"
      class="inline-flex items-center justify-center rounded-lg bg-neutral-900 dark:bg-zinc-600/60 hover:bg-zinc-600 active:bg-zinc-700 px-2 py-1.5 text-xs font-medium text-white shadow-sm transition md:px-3 md:pl-2 md:py-2 md:text-sm"
      :title="$t('create.createNew')"
    >
      <PlusIcon class="w-4 h-4 md:mr-1" />
      <span class="hidden md:inline">
        {{ $t('create.createNew') }}
      </span>
    </button>

    <div
      ref="popuplRef"
      v-if="menuOpen"
      class="absolute top-full mt-2 left-0 z-50 min-w-[200px] bg-white dark:bg-zinc-700 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-600"
    >
      <button
        @click="createFolder"
        :disabled="isCreating"
        class="cursor-pointer w-full flex items-center gap-2 p-2 px-4 hover:bg-blue-500 hover:text-white border-b border-gray-300 dark:border-gray-600 rounded-t-lg disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <CreateNewFolderRound class="w-6 text-yellow-400" />
        {{ $t('actions.newFolder') }}
      </button>
      <button
        @click="createFile"
        :disabled="isCreating"
        class="cursor-pointer w-full flex items-center gap-2 p-2 px-4 hover:bg-blue-500 hover:text-white border-b border-gray-300 dark:border-gray-600 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <FileOpenOutlined class="w-6 text-orange-400" />{{ $t('actions.newFile') }}
      </button>

      <div ref="documentRowRef" class="relative" @mouseenter="openDrawer">
        <button
          type="button"
          :disabled="isCreating"
          @click="openDrawer"
          class="cursor-pointer w-full flex items-center gap-2 p-2 px-4 hover:bg-blue-500 hover:text-white border-b border-gray-300 dark:border-gray-600 disabled:opacity-60 disabled:cursor-not-allowed"
          :aria-expanded="drawerOpen"
        >
          <DescriptionOutlined class="w-6 text-blue-500" />
          <span class="flex-1 text-left">{{ $t('actions.newDocument') }}</span>
          <ChevronRightIcon class="w-4 h-4 shrink-0" />
        </button>

        <div
          v-if="drawerOpen"
          class="absolute top-0 z-50 min-w-[220px] bg-white dark:bg-zinc-700 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-600 overflow-hidden"
          :class="drawerOnLeft ? 'right-full mr-1' : 'left-full ml-1'"
        >
          <button
            v-for="type in documentTypes"
            :key="type.format"
            type="button"
            :disabled="isCreating"
            @click="promptFor(type)"
            class="cursor-pointer w-full flex items-center gap-2 p-2 px-4 hover:bg-blue-500 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <DescriptionOutlined class="w-6 shrink-0" :class="type.tint" />
            <span class="flex-1 text-left">{{ $t(type.titleKey) }}</span>
          </button>
        </div>
      </div>

      <button
        @click="uploadFiles"
        class="cursor-pointer w-full flex items-center gap-2 p-2 px-4 hover:bg-blue-500 hover:text-white border-b border-gray-300 dark:border-gray-600"
      >
        <UploadFileOutlined class="w-6 text-sky-400" />{{ $t('actions.fileUpload') }}
      </button>
      <button
        @click="uploadFolder"
        class="cursor-pointer w-full flex items-center gap-2 p-2 px-4 hover:bg-blue-500 hover:text-white rounded-b-lg"
      >
        <DriveFolderUploadOutlined class="w-6 text-green-400" />{{ $t('actions.folderUpload') }}
      </button>
    </div>

    <NewOfficeDocumentDialog
      v-model="dialogOpen"
      :format="chosen.format"
      :title="$t(chosen.titleKey)"
      :default-name="$t(chosen.nameKey)"
      @create="createDocument"
    />
  </div>
</template>
