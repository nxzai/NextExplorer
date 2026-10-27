<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { usePageTitle } from '@/composables/usePageTitle';

import { normalizePath } from '@/api';
import { usePreviewManager } from '@/plugins/preview/manager';
import { whenPreviewPluginsReady } from '@/plugins';
import { useFileStore } from '@/stores/fileStore';
import { folderRoute } from '@/utils/folderRoute';
import { useTabNavigation } from '@/composables/tabNavigation';
import { isEditableExtension } from '@/config/editor';

/**
 * One document, at an address of its own.
 *
 * Everything this page does, the folder listing also does — it is the same
 * preview, the same plugins, the same component. What it adds is the one thing
 * a panel over a folder cannot have: a URL. That is what lets a document be
 * opened in a browser tab, kept open while somebody browses elsewhere, opened
 * twice, linked to and bookmarked (nxzai/NextExplorer#303).
 *
 * Two things it has to get right, and both are about leaving:
 *
 * - closing the document must land somewhere, not on a blank page. It goes
 *   back to the folder the document is in, with the document selected, which
 *   is where closing the panel leaves you;
 * - leaving the page is not always leaving the document. In one of this
 *   application's own tabs, another tab coming forward unmounts this page while
 *   the document goes on existing — so what ends the document is the tab
 *   letting go of it, not this page being taken off screen. That is why the
 *   session is the manager's, keyed by tab, and this page only asks for it and
 *   says when it is over.
 */

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const previewManager = usePreviewManager();
const fileStore = useFileStore();

/** Nothing opened this, and nothing is going to. */
const nothingOpensIt = ref(false);

const documentPath = computed(() => {
  const raw = route.params.path;
  const joined = Array.isArray(raw) ? raw.join('/') : typeof raw === 'string' ? raw : '';
  return normalizePath(joined);
});

const name = computed(() => documentPath.value.split('/').filter(Boolean).pop() || '');
const parentPath = computed(() =>
  documentPath.value.split('/').filter(Boolean).slice(0, -1).join('/')
);

// The point of this page is that several of them are open at once, and four
// tabs all reading "Explorer" would be four tabs nobody can tell apart. The
// folder listing names its tab after the folder (BrowserLayout); this one
// names it after the document, and both after the instance.
usePageTitle(name);

const tabNavigation = useTabNavigation();
const tabs = tabNavigation.tabs;

/**
 * The tab this page is showing a document for.
 *
 * Not taken once, and that was the defect behind half a week of "my tabs keep
 * reloading": bringing one document tab forward while another document tab is in
 * front does **not** mount a new page. The address matches the same route, so
 * vue-router keeps this component and hands it new parameters — and a key read
 * once at setup went on speaking for the tab the reader had left. The document
 * they opened went into that tab's session, the tab they were actually on stayed
 * empty, and coming back to either of them found the wrong thing there and built
 * it again.
 *
 * So it is re-read whenever the address changes, which is the only moment it can
 * change hands. Never in between: read on the way out it would already name
 * whichever tab had come forward, and the session ended would be somebody else's.
 */
const tabKey = ref(tabs.activeId);

/** Back where closing the panel would have left you. */
const leave = () => {
  router.replace(folderRoute(parentPath.value, name.value ? { select: name.value } : undefined));
};

/**
 * Closing a document that has a tab to itself.
 *
 * The close button belongs to the document, and in a tab of its own the thing
 * it should close is the tab. It used to send this tab to the folder listing
 * instead, which left whoever pressed it looking at two identical explorer
 * tabs and wondering which was which (nxzai#303).
 *
 * `window.close()` is allowed here, which is easy to doubt because the tab is
 * opened with `noopener`. That flag severs the opener and the browsing context
 * group; it does not touch what closing depends on. From the standard: a
 * navigable is script-closable if it "is created by web content", or if its
 * session history holds a single entry — the first is true of a tab opened by
 * `window.open`, and the second of any tab opened for one document, including
 * one a middle-click made.
 *
 * Where neither holds — an `/open/` address pasted into a tab that has already
 * been somewhere — the browser refuses and nothing happens, so the folder is
 * still the answer. Closing is asynchronous by specification, so the fallback
 * waits a moment rather than racing it.
 */
const CLOSE_REFUSED_AFTER_MS = 150;

/**
 * Whether this tab has only ever shown this document.
 *
 * The guard matters more than it looks. "Created by web content" is also true
 * of the tab somebody opened the whole application in by following a link, and
 * closing that one because they shut a document would take the rest of their
 * session with it. A single history entry says the tab was opened for this and
 * nothing else — which is exactly the case the button is being fixed for, and
 * is the other condition the standard gives for closing.
 */
const tabIsThisDocument = () => window.history.length === 1;

const closeTabOrLeave = async () => {
  // In one of this application's own tabs, the thing to close is that tab. The
  // rule itself is in `tabNavigation`, because the text editor's cross means
  // exactly the same thing and a rule kept in two places is a rule that will
  // disagree with itself.
  if (await tabNavigation.closeOwn()) return;

  if (!tabIsThisDocument()) {
    leave();
    return;
  }

  window.close();
  setTimeout(() => {
    if (!window.closed) leave();
  }, CLOSE_REFUSED_AFTER_MS);
};

/**
 * The item a plugin is matched against.
 *
 * A path is all this page is given, and a path is all a plugin needs: the
 * manager works the extension out of the name when `kind` does not say.
 */
const itemFromPath = () => ({ name: name.value, path: parentPath.value });

const openDocument = async () => {
  nothingOpensIt.value = false;
  if (!documentPath.value || !name.value) {
    leave();
    return;
  }

  // Already here. This page is mounted again every time its tab comes forward,
  // and opening the document again would build a new editor over a live one:
  // ONLYOFFICE would reconnect, the cursor and the undo history would go, and
  // whoever was typing would watch it happen. Answered before anything else is
  // asked, so nothing is fetched either.
  if (previewManager.shows(tabKey.value, itemFromPath())) return;

  // The folder behind it, so that moving to the next image or the previous one
  // works here exactly as it does over the listing — the plugins read the
  // siblings from the file store. Best effort: a folder that cannot be listed
  // costs the arrows, not the document.
  void fileStore.fetchPathItems(parentPath.value, { preserveInteraction: true }).catch(() => {});

  // Waited for, because the editors register once the server has said they are
  // configured. Asking before that would answer "nothing opens this" about a
  // document ONLYOFFICE was a moment away from claiming.
  await whenPreviewPluginsReady();

  if (previewManager.openIn(tabKey.value, itemFromPath())) return;

  // No preview: the text editor has its own page, and it is where this kind of
  // file opens from the listing too.
  const extension = name.value.includes('.') ? name.value.split('.').pop().toLowerCase() : '';
  if (isEditableExtension(extension)) {
    const encoded = documentPath.value.split('/').map(encodeURIComponent).join('/');
    router.replace({ path: `/editor/${encoded}` });
    return;
  }

  nothingOpensIt.value = true;
};

/**
 * The document closed itself — the button in its header, or Escape.
 *
 * Watched rather than passed as a callback because closing is the plugin's to
 * do: it may be asynchronous, and it may be refused. When the manager has let
 * go of it, this page has nothing left to show.
 *
 * Watched on *this tab's* session and not on whatever is in front, and only
 * acted on while this tab is in front. Closing the tab from the strip also ends
 * its session, and that arrives here as the same event — acting on it would have
 * closed the tab that had just come forward instead.
 */
watch(
  () => [tabKey.value, previewManager.isOpenIn(tabKey.value)],
  ([key, open], [wasKey, wasOpen]) => {
    // The page changed hands rather than a document closing: the tab it speaks
    // for is another one now, and what it is showing is that tab's business.
    // Without this, crossing from one document tab to another read as "the
    // document I was showing has gone" and sent the reader to a folder.
    if (key !== wasKey) return;
    if (!wasOpen || open) return;
    if (tabs.activeId !== key) return;
    closeTabOrLeave();
  }
);

onMounted(() => {
  void openDocument();
});

onBeforeUnmount(() => {
  // Whether leaving this page is leaving the document.
  //
  // It is not, when another tab simply came forward: this page goes, the tab
  // stays on its document, and the document goes on living in the manager —
  // which is what makes coming back to the tab instant rather than a fresh
  // ONLYOFFICE connection. It is, when this tab is still the one in front, which
  // means the address changed underneath it and the document is not what this
  // tab holds any more.
  //
  // And when the tab itself has gone there is nothing to do: the manager ended
  // the session the moment the tab did, beacon and all.
  if (!tabs.tabs.some((entry) => entry.id === tabKey.value)) return;
  if (tabs.activeId !== tabKey.value) return;
  if (previewManager.isOpenIn(tabKey.value)) void previewManager.closeIn(tabKey.value);
});

/**
 * The address changed under this page: another document, or another tab holding
 * one. Which of the two it was is what `activeId` says, and it is the only moment
 * this page can change hands — so the tab is read again before anything is opened.
 *
 * Watched on the whole address rather than on the path: two tabs can hold the same
 * document, and crossing between them changes nothing but the address.
 */
watch(
  () => route.fullPath,
  () => {
    tabKey.value = tabs.activeId;
    void openDocument();
  }
);
</script>

<template>
  <div class="flex h-full w-full flex-col bg-neutral-950">
    <!-- Only ever seen when nothing claimed the document: the preview itself
         covers the page. -->
    <div
      v-if="nothingOpensIt"
      class="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center"
      data-test="document-unopenable"
    >
      <p class="text-sm text-neutral-300">{{ t('preview.nothingOpensIt', { name }) }}</p>
      <button
        type="button"
        class="rounded-md border border-neutral-600 px-4 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
        data-test="document-back"
        @click="leave"
      >
        {{ t('preview.backToFolder') }}
      </button>
    </div>
  </div>
</template>
