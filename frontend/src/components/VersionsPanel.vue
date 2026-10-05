<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useEventListener } from '@vueuse/core';
import {
  ArrowPathIcon,
  EllipsisVerticalIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline';
import ModalDialog from '@/components/ModalDialog.vue';
import { useVersionsPanelStore } from '@/stores/versionsPanel';
import { useNotificationsStore } from '@/stores/notifications';
import { useFileStore } from '@/stores/fileStore';
import { useDestinationPicker } from '@/composables/useDestinationPicker';
import { isEditableExtension } from '@/config/editor';
import { usePreviewManager } from '@/plugins/preview/manager';
import { formatBytes, formatLocalDateTime } from '@/utils';
import {
  copyVersionTo,
  deleteVersions,
  getVersionDownloadUrl,
  getVersions,
  normalizePath,
  replaceWithVersion,
  restoreVersion,
  updateVersion,
} from '@/api';

/**
 * A file's history: the earlier versions its saves left, newest first, and
 * what can be done with each — look at it, download it, put it back, take it
 * out as a copy or over another file, name it, pin it, delete it.
 *
 * It sits above the preview layer, since an office editor opens it too, and its
 * own dialogs sit above it.
 */

const MAX_LABEL_LENGTH = 200;

const store = useVersionsPanelStore();
const notifications = useNotificationsStore();
const fileStore = useFileStore();
const picker = useDestinationPicker();
const router = useRouter();
const { t } = useI18n();

const isOpen = computed(() => store.isOpen);
const filePath = computed(() => store.relativePath);
const fileName = computed(() => store.item?.name || '');
const parentPath = computed(() => {
  const segments = filePath.value.split('/').filter(Boolean);
  segments.pop();
  return segments.join('/');
});

const data = ref(null);
const loading = ref(false);
const loadError = ref('');
const selected = ref([]);
const openMenu = ref(null);
const busy = ref(false);
const confirmation = ref(null);
const naming = ref(null);

const versions = computed(() => data.value?.versions || []);
const rights = computed(
  () => data.value?.rights || { see: false, download: false, restore: false, remove: false }
);
const allSelected = computed(
  () => versions.value.length > 0 && selected.value.length === versions.value.length
);

const load = async () => {
  if (!isOpen.value || !filePath.value) return;
  const requested = filePath.value;
  loading.value = true;
  loadError.value = '';
  try {
    const response = await getVersions(requested);
    if (requested !== filePath.value) return;
    data.value = response;
    const ids = new Set((response?.versions || []).map((version) => version.id));
    selected.value = selected.value.filter((id) => ids.has(id));
  } catch (error) {
    if (requested !== filePath.value) return;
    data.value = null;
    loadError.value =
      error?.statusCode === 403
        ? t('versions.notShared')
        : error?.message || t('versions.loadFailed');
  } finally {
    if (requested === filePath.value) loading.value = false;
  }
};

watch(
  [isOpen, filePath],
  ([open]) => {
    openMenu.value = null;
    if (!open) return;
    data.value = null;
    selected.value = [];
    void load();
  },
  { immediate: true }
);

const close = () => store.close();

useEventListener(window, 'keydown', (event) => {
  if (event.key !== 'Escape' || !isOpen.value) return;
  if (confirmation.value || naming.value || picker.isOpen.value) return;
  if (openMenu.value) {
    openMenu.value = null;
    return;
  }
  close();
});

useEventListener(document, 'pointerdown', (event) => {
  if (!openMenu.value) return;
  if (event.target?.closest?.('[data-version-menu]')) return;
  openMenu.value = null;
});

const SOURCES = {
  editor: 'editor',
  'share-editor': 'shareEditor',
  onlyoffice: 'onlyoffice',
  collabora: 'collabora',
  restore: 'restore',
  external: 'external',
};

const sourceLabel = (source) => (SOURCES[source] ? t(`versions.source.${SOURCES[source]}`) : '');

/** Who wrote a content, as a person recognises it. */
const authorLabel = (author) => {
  if (!author) return t('versions.unknownAuthor');
  if (!author.id && author.label === 'share-link') return t('versions.shareLink');
  return author.label || t('versions.unknownAuthor');
};

const describe = (entry) =>
  [authorLabel(entry.author), sourceLabel(entry.source), formatBytes(entry.size)]
    .filter(Boolean)
    .join(' · ');

const extension = computed(() => {
  const name = fileName.value;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
});

const previewManager = usePreviewManager();

/**
 * Whether an office editor opens this document, and can open one of its versions
 * to be read. A text file goes to the text editor instead.
 */
const officeViewer = computed(() => {
  if (isEditableExtension(extension.value) || !fileName.value) return null;
  const match = previewManager.findPlugin?.({
    name: fileName.value,
    path: parentPath.value,
    kind: extension.value,
  });
  return match?.plugin?.supportsVersions ? match.plugin : null;
});

const actionsFor = (version) => {
  const usable = version.available !== false;
  const list = [];
  if (usable && (isEditableExtension(extension.value) || officeViewer.value)) {
    list.push({ id: 'preview', label: t('versions.actions.preview') });
  }
  if (usable && rights.value.download) {
    list.push({ id: 'download', label: t('versions.actions.download') });
  }
  if (usable && rights.value.restore) {
    list.push({ id: 'restore', label: t('versions.actions.restore') });
  }
  if (usable && rights.value.download) {
    list.push({ id: 'restoreCopy', label: t('versions.actions.restoreCopy') });
    list.push({ id: 'replaceOther', label: t('versions.actions.replaceOther') });
  }
  if (rights.value.restore) {
    list.push({ id: 'rename', label: t('versions.actions.rename') });
    list.push({
      id: 'pin',
      label: version.pinned ? t('versions.actions.unpin') : t('versions.actions.pin'),
    });
  }
  if (rights.value.remove) {
    list.push({ id: 'delete', label: t('versions.actions.delete'), danger: true });
  }
  return list;
};

const toggleMenu = (id) => {
  openMenu.value = openMenu.value === id ? null : id;
};

const toggleSelected = (id) => {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((candidate) => candidate !== id)
    : [...selected.value, id];
};

const toggleAll = () => {
  selected.value = allSelected.value ? [] : versions.value.map((version) => version.id);
};

const notifyFailure = (error) => {
  notifications.addNotification({
    type: 'error',
    heading: t('versions.errors.action'),
    body: error?.message || '',
  });
};

/** What changed on disk shows in the folder being browsed, if it is the one. */
const refreshListing = async (folder) => {
  try {
    const current = normalizePath(fileStore.currentPath || '');
    if (typeof fileStore.fetchPathItems === 'function' && current === normalizePath(folder || '')) {
      await fileStore.fetchPathItems(current);
    }
  } catch {
    // The listing catches up on the next visit; the change itself succeeded.
  }
};

const work = async (task) => {
  busy.value = true;
  try {
    await task();
  } catch (error) {
    notifyFailure(error);
  } finally {
    busy.value = false;
    await load();
  }
};

const download = (version) => {
  const link = document.createElement('a');
  link.href = getVersionDownloadUrl(filePath.value, version.id);
  link.rel = 'noopener';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const preview = (version) => {
  const path = filePath.value;
  close();
  // A document opens in its office editor, read-only on that version; the
  // editor is closed like any preview, and the history reopened from there.
  if (officeViewer.value) {
    previewManager.open({
      name: fileName.value,
      path: parentPath.value,
      kind: extension.value,
      versionId: version.id,
    });
    return;
  }
  router.push({ name: 'VersionFileViewer', params: { versionId: version.id, path } });
};

const restoreCopy = async (version) => {
  const destination = await picker.pick({
    mode: 'version-copy',
    items: [{ name: fileName.value, path: parentPath.value, kind: 'file' }],
    from: parentPath.value,
  });
  if (!destination) return;
  await work(async () => {
    const result = await copyVersionTo(filePath.value, version.id, destination);
    notifications.addNotification({
      type: 'success',
      heading: t('versions.results.copied', { path: result?.path || destination }),
      durationMs: 5000,
    });
    await refreshListing(destination);
  });
};

const replaceOther = async (version) => {
  const target = await picker.pick({
    mode: 'file',
    items: [{ name: fileName.value, path: parentPath.value, kind: 'file' }],
    from: parentPath.value,
  });
  if (!target) return;
  confirmation.value = { kind: 'replace', version, target };
};

const runAction = (action, version) => {
  openMenu.value = null;
  switch (action.id) {
    case 'preview':
      preview(version);
      break;
    case 'download':
      download(version);
      break;
    case 'restore':
      confirmation.value = { kind: 'restore', version };
      break;
    case 'restoreCopy':
      void restoreCopy(version);
      break;
    case 'replaceOther':
      void replaceOther(version);
      break;
    case 'rename':
      naming.value = { version, value: version.label || '' };
      break;
    case 'pin':
      void work(async () => {
        await updateVersion(filePath.value, version.id, { pinned: !version.pinned });
        notifications.addNotification({
          type: 'success',
          heading: version.pinned ? t('versions.results.unpinned') : t('versions.results.pinned'),
          durationMs: 3000,
        });
      });
      break;
    case 'delete':
      confirmation.value = { kind: 'delete', ids: [version.id] };
      break;
    default:
      break;
  }
};

const confirmationOpen = computed({
  get: () => Boolean(confirmation.value),
  set: (value) => {
    if (!value) confirmation.value = null;
  },
});

const confirmationTitle = computed(() => {
  const request = confirmation.value;
  if (!request) return '';
  if (request.kind === 'restore') return t('versions.confirm.restoreTitle');
  if (request.kind === 'replace') {
    return t('versions.confirm.replaceTitle', { target: request.target.split('/').pop() });
  }
  if (request.kind === 'deleteAll') return t('versions.confirm.deleteAllTitle');
  return t('versions.confirm.deleteTitle', { count: request.ids.length }, request.ids.length);
});

const confirmationMessage = computed(() => {
  const request = confirmation.value;
  if (!request) return '';
  if (request.kind === 'restore') {
    return t('versions.confirm.restoreMessage', {
      name: fileName.value,
      date: formatLocalDateTime(request.version.modifiedAt),
    });
  }
  if (request.kind === 'replace') {
    return t('versions.confirm.replaceMessage', {
      target: request.target.split('/').pop(),
      name: fileName.value,
    });
  }
  if (request.kind === 'deleteAll') {
    return t('versions.confirm.deleteAllMessage', { name: fileName.value });
  }
  return t('versions.confirm.deleteMessage', { count: request.ids.length }, request.ids.length);
});

const confirmationDanger = computed(() =>
  ['delete', 'deleteAll'].includes(confirmation.value?.kind)
);

/** The button says what happens. */
const confirmationButton = computed(() => {
  if (confirmation.value?.kind === 'restore') return t('versions.actions.restore');
  if (confirmation.value?.kind === 'replace') return t('versions.confirm.replace');
  return t('common.delete');
});

const confirm = async () => {
  const request = confirmation.value;
  if (!request) return;
  confirmation.value = null;
  await work(async () => {
    if (request.kind === 'restore') {
      const result = await restoreVersion(filePath.value, request.version.id);
      store.markRestored();
      notifications.addNotification({
        type: result?.status === 'unchanged' ? 'info' : 'success',
        heading:
          result?.status === 'unchanged'
            ? t('versions.results.unchanged')
            : t('versions.results.restored'),
        durationMs: 4000,
      });
      await refreshListing(parentPath.value);
    } else if (request.kind === 'replace') {
      await replaceWithVersion(filePath.value, request.version.id, request.target);
      notifications.addNotification({
        type: 'success',
        heading: t('versions.results.replaced', { path: request.target }),
        durationMs: 5000,
      });
      const folder = request.target.split('/').slice(0, -1).join('/');
      await refreshListing(folder);
    } else {
      const result = await deleteVersions(
        filePath.value,
        request.kind === 'deleteAll' ? { all: true } : { ids: request.ids }
      );
      const count = Number(result?.deleted) || 0;
      selected.value = [];
      notifications.addNotification({
        type: 'success',
        heading: t('versions.results.deleted', { count }, count),
        durationMs: 4000,
      });
      // The row behind the panel carries a mark saying how many versions the
      // file has. Deleting them here and leaving that mark at its old number
      // is the panel disagreeing with the listing it was opened from.
      await refreshListing(parentPath.value);
    }
  });
};

const namingOpen = computed({
  get: () => Boolean(naming.value),
  set: (value) => {
    if (!value) naming.value = null;
  },
});

const saveName = async () => {
  const request = naming.value;
  if (!request || request.value.trim().length > MAX_LABEL_LENGTH) return;
  naming.value = null;
  await work(async () => {
    await updateVersion(filePath.value, request.version.id, { label: request.value.trim() });
    notifications.addNotification({
      type: 'success',
      heading: t('versions.results.renamed'),
      durationMs: 3000,
    });
  });
};
</script>

<template>
  <teleport to="body">
    <transition name="vp-fade">
      <!--
      A panel beside what a tab holds, so it stops where the strip starts.

      It is `fixed` and teleported, which no amount of nesting can tell about the
      strip — hence `--tab-strip-height`, which is 0px when there is no strip.
      Before this the backdrop covered the whole window and swallowed every click
      on a tab: opening the terminal meant being unable to leave it.
    -->
      <div
        v-if="isOpen"
        class="fixed inset-x-0 bottom-0 top-[var(--tab-strip-height)] z-2140 bg-black/30"
        @click="close"
      />
    </transition>

    <div
      class="fixed bottom-0 right-0 top-[var(--tab-strip-height)] z-2150 w-[400px] max-w-full transform transition-transform duration-200 ease-out sm:w-[460px]"
      :class="isOpen ? 'translate-x-0' : 'translate-x-full'"
      :aria-hidden="!isOpen"
    >
      <aside
        class="flex h-full flex-col border-l bg-white/95 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/90"
        role="dialog"
        :aria-label="t('versions.aria')"
        data-test="versions-panel"
      >
        <header class="flex items-start gap-3 border-b px-5 py-4 dark:border-white/5">
          <div class="min-w-0">
            <p class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {{ t('versions.title') }}
            </p>
            <h2
              class="truncate text-lg font-semibold text-neutral-900 dark:text-white"
              data-test="versions-file-name"
            >
              {{ fileName }}
            </h2>
          </div>
          <button
            type="button"
            class="ml-auto rounded-md p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:cursor-wait disabled:opacity-60 dark:text-neutral-400 dark:hover:bg-zinc-800 dark:hover:text-neutral-200"
            :disabled="loading || busy"
            :title="t('common.refresh')"
            :aria-label="t('common.refresh')"
            @click="load"
          >
            <ArrowPathIcon :class="['h-5 w-5', loading || busy ? 'animate-spin' : '']" />
          </button>
          <button
            type="button"
            class="rounded-md p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-zinc-800 dark:hover:text-neutral-200"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            data-test="versions-close"
            @click="close"
          >
            <XMarkIcon class="h-6 w-6" />
          </button>
        </header>

        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <p
            v-if="loadError"
            class="text-sm text-red-600 dark:text-red-400"
            data-test="versions-error"
          >
            {{ loadError }}
          </p>

          <template v-else-if="data">
            <p
              v-if="data.enabled === false"
              class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
              data-test="versions-disabled"
            >
              {{ t('versions.disabled') }}
            </p>

            <section
              class="rounded-lg border border-neutral-200 p-3 dark:border-white/10"
              data-test="versions-current"
            >
              <p
                class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {{ t('versions.current') }}
              </p>
              <p class="text-neutral-900 dark:text-neutral-100">
                {{ formatLocalDateTime(data.file.modifiedAt) }}
              </p>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {{
                  data.file.author
                    ? describe(data.file)
                    : [sourceLabel(data.file.source), formatBytes(data.file.size)]
                        .filter(Boolean)
                        .join(' · ')
                }}
              </p>
            </section>

            <p
              v-if="versions.length === 0"
              class="text-sm text-neutral-500 dark:text-neutral-400"
              data-test="versions-empty"
            >
              {{ t('versions.empty') }}
            </p>

            <template v-else>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p
                  class="text-xs text-neutral-500 dark:text-neutral-400"
                  data-test="versions-total"
                >
                  {{
                    t(
                      'versions.total',
                      { count: versions.length, size: formatBytes(data.totalBytes || 0) },
                      versions.length
                    )
                  }}
                </p>
                <div v-if="rights.remove" class="flex flex-wrap items-center gap-2">
                  <label
                    class="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300"
                  >
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-neutral-300"
                      :checked="allSelected"
                      data-test="versions-select-all"
                      @change="toggleAll"
                    />
                    {{ t('versions.actions.selectAll') }}
                  </label>
                  <button
                    type="button"
                    class="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:hover:bg-zinc-800"
                    :disabled="selected.length === 0 || busy"
                    data-test="versions-delete-selected"
                    @click="confirmation = { kind: 'delete', ids: [...selected] }"
                  >
                    {{ t('versions.actions.deleteSelected', { count: selected.length }) }}
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                    :disabled="busy"
                    data-test="versions-delete-all"
                    @click="confirmation = { kind: 'deleteAll' }"
                  >
                    {{ t('versions.actions.deleteAll') }}
                  </button>
                </div>
              </div>

              <ul
                class="divide-y divide-neutral-100 dark:divide-zinc-800"
                data-test="versions-list"
              >
                <li
                  v-for="version in versions"
                  :key="version.id"
                  class="flex items-start gap-3 py-3"
                  data-test="version-row"
                >
                  <input
                    v-if="rights.remove"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-neutral-300"
                    :checked="selected.includes(version.id)"
                    :aria-label="t('versions.actions.select')"
                    data-test="version-select"
                    @change="toggleSelected(version.id)"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="flex flex-wrap items-center gap-2">
                      <span
                        class="truncate font-medium text-neutral-900 dark:text-neutral-100"
                        data-test="version-title"
                      >
                        {{ version.label || formatLocalDateTime(version.modifiedAt) }}
                      </span>
                      <span
                        v-if="version.pinned"
                        class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-500/15 dark:text-blue-200"
                        data-test="version-pinned"
                      >
                        <MapPinIcon class="h-3 w-3" aria-hidden="true" />
                        {{ t('versions.pinned') }}
                      </span>
                      <span
                        v-if="version.aside"
                        class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
                        :title="t('versions.asideHelp')"
                        data-test="version-aside"
                      >
                        {{ t('versions.aside') }}
                      </span>
                    </p>
                    <p v-if="version.label" class="text-xs text-neutral-600 dark:text-neutral-300">
                      {{ formatLocalDateTime(version.modifiedAt) }}
                    </p>
                    <p class="text-xs text-neutral-500 dark:text-neutral-400">
                      {{ describe(version) }}
                    </p>
                    <p
                      v-if="version.available === false"
                      class="text-xs text-amber-700 dark:text-amber-300"
                    >
                      {{ t('versions.unavailable') }}
                    </p>
                  </div>
                  <div v-if="actionsFor(version).length" class="relative" data-version-menu>
                    <button
                      type="button"
                      class="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-zinc-800"
                      aria-haspopup="menu"
                      :aria-expanded="openMenu === version.id"
                      :aria-label="t('versions.actions.menu')"
                      :disabled="busy"
                      data-test="version-menu"
                      @click="toggleMenu(version.id)"
                    >
                      <EllipsisVerticalIcon class="h-5 w-5" />
                    </button>
                    <div
                      v-if="openMenu === version.id"
                      role="menu"
                      class="absolute right-0 z-10 mt-1 w-60 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-zinc-800"
                    >
                      <button
                        v-for="action in actionsFor(version)"
                        :key="action.id"
                        type="button"
                        role="menuitem"
                        class="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-white/10"
                        :class="
                          action.danger
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-neutral-700 dark:text-neutral-200'
                        "
                        :data-test="`version-action-${action.id}`"
                        @click="runAction(action, version)"
                      >
                        {{ action.label }}
                      </button>
                    </div>
                  </div>
                </li>
              </ul>
            </template>
          </template>

          <p v-else-if="loading" class="text-sm text-neutral-500 dark:text-neutral-400">
            {{ t('common.loadingEllipsis') }}
          </p>
        </div>
      </aside>
    </div>

    <ModalDialog v-model="confirmationOpen" elevated>
      <template #title>{{ confirmationTitle }}</template>
      <p
        class="text-sm text-neutral-700 dark:text-neutral-300"
        data-test="versions-confirm-message"
      >
        {{ confirmationMessage }}
      </p>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-zinc-800"
          @click="confirmation = null"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium text-white"
          :class="
            confirmationDanger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
          "
          data-test="versions-confirm"
          @click="confirm"
        >
          {{ confirmationButton }}
        </button>
      </div>
    </ModalDialog>

    <ModalDialog v-model="namingOpen" elevated>
      <template #title>{{ t('versions.rename.title') }}</template>
      <form v-if="naming" class="space-y-3" @submit.prevent="saveName">
        <input
          v-model="naming.value"
          type="text"
          :maxlength="MAX_LABEL_LENGTH"
          :placeholder="t('versions.rename.placeholder')"
          class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-zinc-800"
          data-test="versions-name-input"
        />
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('versions.rename.help') }}
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-zinc-800"
            @click="naming = null"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            type="submit"
            class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            data-test="versions-name-save"
          >
            {{ t('common.save') }}
          </button>
        </div>
      </form>
    </ModalDialog>
  </teleport>
</template>

<style scoped>
.vp-fade-enter-active,
.vp-fade-leave-active {
  transition: opacity 0.15s ease;
}
.vp-fade-enter-from,
.vp-fade-leave-to {
  opacity: 0;
}
</style>
