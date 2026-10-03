<script setup>
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { XMarkIcon } from '@heroicons/vue/24/outline';
import FolderViewToolbar from '@/components/FolderViewToolbar.vue';
import { tabTitle } from '@/config/tabKinds';
import { useI18n } from 'vue-i18n';
import { useReportsPaneBox } from '@/composables/paneBoxes';
import { providePaneTab } from '@/composables/paneTab';
import { useTabNavigation } from '@/composables/tabNavigation';
import { useTabsStore } from '@/stores/tabs';
import { draggedTabId, isTabDrag } from '@/utils/tabDrag';

/**
 * One of the panes a split view is made of, and the only one there is when it
 * is not split.
 *
 * What it does is say which tab everything inside it belongs to. The screens
 * below read that instead of "the tab in front", which is the whole of what two
 * panes cost them — see `composables/paneTab.js`.
 *
 * The pane the reader is in draws the router's own component, so that pane keeps
 * every route guard, every `onBeforeRouteLeave` and the address bar. The pane
 * beside it is on an address the router is not, so it resolves its own
 * component from that address. Both end up rendering the same screens; only one
 * of them is the route.
 */
const props = defineProps({
  tabId: { type: String, required: true },
  /** The router's component, for whichever pane is the one in front. */
  routedComponent: { type: [Object, Function], default: null },
  /** Its key, so walking into a folder replaces the view as it always has. */
  routedKey: { type: String, default: '' },
  /** Whether this pane sits beside another, which is when it says where it is. */
  split: { type: Boolean, default: false },
  /** Which side this pane is, for a tab dropped into it. */
  side: { type: String, default: 'left' },
});

const tabsStore = useTabsStore();
const tabNavigation = useTabNavigation();
const tabId = computed(() => props.tabId);
providePaneTab(tabId);

/**
 * Its own address and whether the reader is in it, read from the tab it was
 * given rather than through the injection it just made.
 *
 * `inject` does not see what the same component provided — it looks at the
 * parents — so asking the pane composable here answered the tab in *front*,
 * and both panes said they had focus. The screens below are the ones that ask,
 * and they are children.
 */
/**
 * And where it is, for the surfaces drawn over it.
 *
 * A document and a shell are drawn outside the page — above every layout, so that
 * they outlive their tab going behind another — and `fixed`, so nesting cannot
 * tell them where to stop. The pane that knows is this one, and it says so rather
 * than being hunted for: a surface that went looking found nothing on a window
 * that opened split, and covered the whole of it.
 */
const root = ref(null);
useReportsPaneBox(tabId, root);

const address = computed(() => tabsStore.tabs.find((one) => one.id === tabId.value)?.path || '');
const focused = computed(() => tabId.value === tabsStore.activeId);

/**
 * The folder's own toolbar, for a pane that holds one.
 *
 * All of it is about a folder — where it is, how it is sorted, how it is shown,
 * what can be made in it — so it belongs to the pane rather than to the window,
 * and two panes on two folders are two of them. What *is* the window's went to
 * `WindowBar.vue`: searching and what the application has to tell you, of which
 * two side by side was absurd.
 */
const paneKind = computed(() => tabsStore.tabs.find((one) => one.id === tabId.value)?.kind || '');
const showsFolderToolbar = computed(() => paneKind.value === 'folder');

const { t } = useI18n();
const paneName = computed(() => {
  const tab = tabsStore.tabs.find((one) => one.id === tabId.value);
  return tab ? tabTitle(tab, t) : '';
});
const router = useRouter();

/**
 * The screen for an address the router is not on.
 *
 * Kept in a `shallowRef` and replaced only when the address changes: building
 * an async component inside a computed makes a *new* component every time
 * anything it reads moves, and a new component is a remount — the pane would
 * have thrown its listing away on every keystroke elsewhere in the window.
 */
const resolved = shallowRef(null);
const resolveFor = (path) => {
  if (!path) return null;
  try {
    const matched = router.resolve(path).matched;
    const component = matched[matched.length - 1]?.components?.default;
    if (!component) return null;
    return typeof component === 'function' ? defineAsyncComponent(component) : component;
  } catch (_) {
    // An address no route claims draws nothing rather than throwing the window away.
    return null;
  }
};

// Always, not only while this pane is beside the reader: the pane the reader is in
// falls back to this one for the tick in which its tab and the window's address
// disagree, and a screen it has not resolved is a screen it cannot fall back to.
watch(
  address,
  (path) => {
    resolved.value = resolveFor(path);
  },
  { immediate: true }
);

/**
 * Whether this pane's tab and the window's address are saying the same thing.
 *
 * They do, except for the tick after a tab is brought forward: the store is told
 * first and the address bar follows. The pane the reader is in draws the router's
 * own screen — which is still the screen for the tab they are *leaving*.
 */
const inStep = computed(() => pathOf(props.routedKey) === pathOf(address.value));

/**
 * The router's own screen for the pane the reader is in, and this pane's own
 * everywhere else — including in that one tick.
 *
 * Without the second half, clicking into the other half drew the neighbour's
 * screen in this one for a frame: a document over a folder, under the folder's own
 * key, so Vue replaced the listing with it and replaced it back a frame later. The
 * click that crossed was swallowed whole — the row it was pressed on no longer
 * existed when the button came up — and the reader had to click twice.
 */
const drawn = computed(() =>
  focused.value && inStep.value ? props.routedComponent : resolved.value
);
/**
 * The key that decides when the screen is replaced rather than reused.
 *
 * The *path*, not the whole address. Walking into another folder changes the
 * path, and the folder view wants a new instance for it — it captures where it
 * is on the way in. A screen rewriting its own query does not: a comparison
 * whose two sides are swapped over is the same comparison, saying itself the
 * other way round, and it has lines taken across and not yet saved that exist
 * nowhere else. Keyed on the full address it was rebuilt from the file and threw
 * all of that away.
 */
const pathOf = (address) => String(address || '').split('?')[0];
/**
 * And the tab, because a pane given another tab is another *place* even when the
 * address is the same word.
 *
 * Two tabs on one folder are two places: each has its own listing, its own
 * selection, its own position in it and possibly its own rename half typed. Keyed
 * on the address alone, a pane handed the second of them kept the screen built for
 * the first — so the new tab was a dead panel saying the folder was empty, with
 * nothing asked of the server and nothing to click. Duplicating a tab does exactly
 * this, and so does dropping a tab into the half beside one already on that folder.
 */
const drawnAddress = computed(() => pathOf(address.value));

/**
 * Held still while this pane's tab and the address it draws are out of step.
 *
 * A tab coming forward is two moves: the store is told first and the address bar
 * follows. For that one tick a pane names its new tab while the screen on it is
 * still the old tab's — and a key made then would build the *old* screen for the
 * *new* tab. A document page built in a folder tab's name opens its document into
 * that folder tab, which then closes it again a tick later: a session on a document
 * server opened and ended for nothing, in a tab that never asked for it.
 *
 * So the key waits for the two to agree, which they do on the very next tick. The
 * pane beside the reader draws its own address and is never out of step.
 */
const drawnKey = computed(() => `${tabId.value}::${drawnAddress.value}`);

/**
 * Clicking anywhere in a pane puts the reader in it.
 *
 * Which is what makes everything that acts for the person — the clipboard, the
 * toolbar, the keyboard — act on the pane being looked at. On pointerdown
 * rather than on click, so the gesture that follows (a drag, a right-click, a
 * rubber band) already belongs to this pane.
 */
/**
 * A tab dragged out of the strip and dropped in here.
 *
 * The other way of asking for two panes, beside the entry in the tab's own
 * menu, and the one a reader tries first once they have seen a split view. The
 * same rule decides both — a tab the menu greys out is a tab this refuses —
 * so a drop that lands does something and a drop that cannot says so by not
 * lighting up.
 */
const tabOver = ref(false);

// Claimed on the way *down* rather than on the way up: the uploader's own drop
// target is the scrolling area inside this pane, and it stops a drop before it
// can bubble out again. A file drag falls straight through — these handlers
// answer for nothing else — so nothing below loses a drop it wanted.

const onTabDragOver = (event) => {
  if (!isTabDrag(event)) return;
  // Said before the drop can happen: without this the browser refuses it.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  tabOver.value = true;
};

const onTabDragLeave = (event) => {
  if (!isTabDrag(event)) return;
  // Only when the pointer has actually left: moving between the rows inside a
  // listing fires `dragleave` for every one of them.
  if (event.currentTarget?.contains(event.relatedTarget)) return;
  tabOver.value = false;
};

const onTabDrop = (event) => {
  if (!isTabDrag(event)) return;
  event.preventDefault();
  tabOver.value = false;
  const id = draggedTabId(event);
  // Through the navigation rather than the store, because taking this pane over
  // can move the reader, and the window's address belongs to the tab they are in.
  if (id) tabNavigation.showInPane(props.side, id);
};

const takeFocus = () => {
  if (focused.value) return;
  // One scribe for the address: the navigation activates the tab and takes the
  // window there, rather than this pane doing half of it itself.
  tabNavigation.activate(tabId.value);
};
</script>

<template>
  <section
    ref="root"
    data-test="tab-pane"
    :data-pane-tab="tabId"
    :data-focused="focused ? 'true' : 'false'"
    class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    :data-tab-over="tabOver ? 'true' : 'false'"
    @pointerdown="takeFocus"
    @dragover.capture="onTabDragOver"
    @dragleave.capture="onTabDragLeave"
    @drop.capture="onTabDrop"
  >
    <!-- Where the tab would land, over the whole pane rather than at an edge:
         a pane is the target, and half of it would be a guess about which. -->
    <div
      v-if="tabOver"
      class="pointer-events-none absolute inset-0 z-20 border-2 border-accent bg-accent/10"
      aria-hidden="true"
    ></div>
    <!-- Only when there are two of them: one pane has the window's own toolbar
         above it and nothing to add, and a bar that appeared the moment a
         window split would move everything below it down. -->
    <header
      v-if="split"
      data-test="pane-header"
      class="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-sm"
      :class="
        focused
          ? 'border-neutral-300 bg-default-muted dark:border-neutral-700'
          : 'border-neutral-200 bg-default-muted/50 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400'
      "
    >
      <!-- Its name, not a second breadcrumb: a folder pane has one of those in
           its own toolbar just below, and saying where it is twice is noise. -->
      <span class="min-w-0 flex-1 truncate">{{ paneName }}</span>
      <button
        type="button"
        data-test="pane-close"
        class="shrink-0 rounded p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        :aria-label="$t('tabs.closeSplit')"
        :title="$t('tabs.closeSplit')"
        @pointerdown.stop
        @click.stop="tabNavigation.closePane(side)"
      >
        <XMarkIcon class="h-4 w-4" />
      </button>
    </header>

    <FolderViewToolbar v-if="showsFolderToolbar" />

    <component :is="drawn" v-if="drawn" :key="drawnKey" class="min-h-0 flex-1" />
  </section>
</template>
