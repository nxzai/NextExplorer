<script setup>
import { ref, onMounted, computed, onBeforeUnmount, nextTick, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { normalizePath } from '@/api';
import { useSettingsStore } from '@/stores/settings';
import FileObject from '@/components/FileObject.vue';
import { useFolderSizeStore } from '@/stores/folderSize';
import { useVolumeUsageStore } from '@/stores/volumeUsage';
import { useFeaturesStore } from '@/stores/features';
import { useFolderScrollStore } from '@/stores/folderScroll';
import { useTabsStore } from '@/stores/tabs';
import { tabKindForPath } from '@/config/tabKinds';
import { useTabLoadingStore } from '@/stores/tabLoading';
import { revealOffset } from '@/utils/revealOffset';
import LoadingIcon from '@/icons/LoadingIcon.vue';
import { useSelection } from '@/composables/itemSelection';
import { useExplorerContextMenu } from '@/composables/contextMenu';
import { isPreviewableImage, isPreviewableVideo } from '@/config/media';
import { ImagesOutline } from '@vicons/ionicons5';
import { useViewConfig } from '@/composables/useViewConfig';
import { DragSelect } from '@coleqiu/vue-drag-select';
import { useUppyDropTarget } from '@/composables/fileUploader';
import { FolderOpenIcon } from '@heroicons/vue/24/outline';
import {
  ChevronDoubleDownIcon,
  ChevronDoubleUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/vue/20/solid';
import { useEventListener } from '@vueuse/core';
import { useInputMode } from '@/composables/useInputMode';
import { LIST_ROW_HEIGHT, virtualWindow } from '@/utils/virtualWindow';
import {
  nextIndexInDirection,
  rangeBetween,
  normalizeTypeaheadText,
  findTypeaheadMatch,
} from '@/utils/folderKeyboard';
import { useFileDragDrop } from '@/composables/useFileDragDrop';
import { useNavigation } from '@/composables/navigation';
import { useOpenItemInTab } from '@/composables/itemAddress';
import { useFileActions } from '@/composables/fileActions';
import { useDeleteConfirm } from '@/composables/useDeleteConfirm';
import { useOperationTasksStore } from '@/stores/operationTasks';
import { usePaneFolder } from '@/composables/paneTab';

const settings = useSettingsStore();
const folderSizeStore = useFolderSizeStore();
const volumeUsageStore = useVolumeUsageStore();
const featuresStore = useFeaturesStore();
const folderScrollStore = useFolderScrollStore();
const operationTasksStore = useOperationTasksStore();
const {
  tabId: paneTabId,
  address: paneAddress,
  folderPath: paneFolderPath,
  focused: readerIsHere,
  view: pane,
} = usePaneFolder();
const { gridClasses, gridStyle } = useViewConfig();
const loading = ref(true);
const visibleLimit = ref(500);
const loadMoreTrigger = ref(null);
const isScrollable = ref(false);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const { clearSelection, toggleSelection } = useSelection();
const contextMenu = useExplorerContextMenu();
const dropTargetRef = ref(null);
const listHeaderRef = ref(null);
useUppyDropTarget(dropTargetRef);

const { isTouchDevice } = useInputMode();
const { handleDragOver, handleDragLeave, handleDrop, isDragTarget, isCopyDragTarget } =
  useFileDragDrop();

const currentFolderDropTarget = computed(() => ({
  destinationPath: normalizePath(pane.currentPath || ''),
  kind: 'directory',
}));

/**
 * The empty space below the rows, as a destination.
 *
 * The rows answer for themselves and the grid answers for the gaps between
 * them; what neither covers is the space *below* the last row, which in a short
 * folder is most of the pane and in an empty one is all of it. There was nothing
 * to drop on there, so moving a file into an empty folder by dropping on it
 * simply did not work — unnoticed while there was one folder on screen and the
 * destination was somewhere you walked to. With two panes it is the common case.
 *
 * Bound on the scroller, which is the element that actually occupies that space,
 * and guarded by `defaultPrevented`: a row or the grid that has taken the drag
 * has already said so, and a drop they handled stops before it gets here anyway.
 */
const onEmptySpaceDragOver = (event) => {
  if (event.defaultPrevented) return;
  handleCurrentFolderDragOver(event);
};

const onEmptySpaceDragLeave = (event) => {
  if (event.defaultPrevented) return;
  handleCurrentFolderDragLeave(event);
};

const onEmptySpaceDrop = (event) => {
  if (event.defaultPrevented) return;
  handleCurrentFolderDrop(event);
};

const handleCurrentFolderDragOver = (event) => {
  handleDragOver(event, currentFolderDropTarget.value);
};

const handleCurrentFolderDragLeave = (event) => {
  handleDragLeave(event, currentFolderDropTarget.value);
};

const handleCurrentFolderDrop = (event) => {
  handleDrop(event, currentFolderDropTarget.value);
};
const { openItem, goNext, goPrev, goUp } = useNavigation();
// Command (or control) with the key that opens things: a tab behind, as a
// browser does with a link.
const { openItemInTab } = useOpenItemInTab();
const actions = useFileActions();
const { isDeleteConfirmOpen } = useDeleteConfirm();

const INITIAL_VISIBLE_ITEMS = 500;
const VISIBLE_ITEMS_INCREMENT = 500;

const IDLE_THUMBNAIL_PREFETCH_DELAY_MS = 1500;
const IDLE_THUMBNAIL_PREFETCH_INTERVAL_MS = 2000;
const IDLE_THUMBNAIL_PREFETCH_LIMIT = 24;
let loadMoreObserver = null;
let idleThumbnailPrefetchTimer = null;
let idleThumbnailPrefetchGeneration = 0;
const idleThumbnailPrefetchedKeys = new Set();
const scrollTop = ref(0);
const scrollViewportHeight = ref(0);
const canRememberScroll = ref(false);
const keyboardSelectionAnchorKey = ref('');
const keyboardActiveItemKey = ref('');
const keyboardTypeahead = ref('');
let keyboardTypeaheadTimer = null;

// BrowserLayout keys this view by full route, so navigating into a directory
// replaces the component. Capture this instance's folder now: during unmount
// the reactive route may already point to the destination.
const ownFolderPath = normalizePath(paneFolderPath.value);

/**
 * Where the reader was, keyed by folder *and* by the view it was seen in.
 *
 * The view belongs in the key because the same folder is a different height in
 * each of them, so a position taken in one says nothing about the other. What it
 * cannot be is the view at the moment this instance was built: how a folder is
 * shown is its own preference, and walking into another folder applies that
 * folder's. Coming back, the window could be in a different view from the one this
 * tab was left in — so a key frozen at setup looked up a position that belonged to
 * a view nobody was in, found an old one, and put the reader two hundred pixels
 * down a folder they had left four thousand pixels down. The selection came back,
 * because a selection is not keyed by a view, and that is exactly how it was
 * reported.
 *
 * So the folder is captured and the view is read when it is asked for.
 */
const scrollKey = () => `${ownFolderPath}::${settings.view}`;

/**
 * The same folder, in this tab.
 *
 * Two tabs can be on one folder and be in different places in it, so the tab is
 * part of the key. The tab is taken once, like everything else about this
 * instance: the keyed router view builds a new one of these for every address, so
 * the tab in front when it is built is the tab it belongs to.
 */
const tabsStore = useTabsStore();
// Its pane's tab, not whichever is in front. In a split view the pane beside
// the reader draws a tab that does not have focus, and every measurement keyed
// on "the active tab" would be filed under the wrong one.
const ownTabId = paneTabId.value;
const tabLoading = useTabLoadingStore();
const placeKey = () => `${ownTabId}::${scrollKey()}`;

/**
 * Whether this is a tab coming back rather than a folder being opened.
 *
 * The tab says so itself — bringing one forward and walking into a folder are
 * indistinguishable from here, both being a new address on the same route, and a
 * guess made from what the store happens to hold calls a search result landing in
 * a folder somebody was just in a "return" too.
 *
 * And it has to already hold the folder: a tab brought forward before it ever
 * listed anything has nothing to come back to.
 */
const cameForward = tabsStore.takeBroughtForward(ownTabId);
const comingBack = () =>
  cameForward &&
  pane.getCurrentPathItems.length > 0 &&
  normalizePath(pane.currentPath || '') === normalizePath(paneFolderPath.value);

const getScrollTarget = () => {
  const localTarget = dropTargetRef.value;
  if (localTarget && localTarget.scrollHeight - localTarget.clientHeight > 2) {
    return localTarget;
  }

  return document.scrollingElement || document.documentElement;
};

/**
 * Where the reader is, written down — but only when there is something to write.
 *
 * Both answers come from whatever is actually scrolling, and the catch is what
 * happens when nothing is. On the way out the listing is taken off screen before
 * the last scroll events stop arriving, and the fallback behind it is the page,
 * which never scrolls and is therefore always at zero. Writing that down
 * overwrote where the reader was with the top of the folder, and the symptom was
 * the odd one: coming back, the file they had chosen was still chosen — that is
 * remembered separately — while the folder was scrolled to the top under it.
 *
 * So nothing is written from a container that cannot scroll. It has nothing to
 * say about where anybody was, and silence keeps what was already known.
 */
/**
 * Whether this instance still speaks for where the reader is.
 *
 * Bringing another tab forward is the moment this goes wrong, and the tab changes
 * before the address does. This listing reads the folder of whichever tab is in
 * front, so the instant that is somebody else's tab it is drawing somebody else's
 * folder — a handful of rows where there were twelve hundred. The container becomes
 * shorter than the position it was holding, the browser clamps that position, and
 * the clamp arrives as an ordinary scroll event. Four thousand pixels down became
 * two hundred, and two hundred is what was written down, a moment before anybody
 * could come back to it.
 *
 * Which is why it only ever happened in long folders: a short one has no position
 * to lose. And why the selection survived — a selection is not a measurement of a
 * container that had just been emptied.
 *
 * So this instance speaks only while the tab in front is its own and the address is
 * still its own. After that it has nothing to say about where anybody is.
 */
const stillOurs = () =>
  // On screen, rather than in front. The two are the same question while there is
  // one pane, and they stop being the same in a pair: the half the reader is not in
  // is as drawn as the other, and it was writing nothing down — so coming back it
  // had no place of its own and fell back to the folder's, which every tab on that
  // folder shares. It landed where another tab had been left.
  //
  // What the guard is for is unchanged: a listing on its way off the screen is
  // clamped to a container that can no longer hold it, and the last scroll events
  // it sends would write that clamped number over a position hundreds of pixels
  // down. A tab that has left the panes is exactly that listing.
  tabsStore.panes.includes(ownTabId) && normalizePath(paneFolderPath.value) === ownFolderPath;

const rememberScrollPosition = () => {
  if (!stillOurs()) return;
  const target = getScrollTarget();
  if (target && target.scrollHeight - target.clientHeight > 2) {
    folderScrollStore.remember(scrollKey(), target.scrollTop);
    // And for this tab, which is a different question with a different answer:
    // the tab never left this folder, another one simply came in front of it, so
    // where it was is always worth putting back. With the row that was at the top
    // of it, because a pane can come back a different width — one of a pair, or a
    // pair becoming one — and the listing re-flows under the same number of pixels.
    folderScrollStore.rememberTabPlace(placeKey(), target.scrollTop, rowAtTheTop());
  }
  rememberActiveItem();
};

/**
 * Where this tab was, taken on the way out and not touched again.
 *
 * The scroll handler remembers on every event, and a listing being taken off
 * screen produces a few last ones. Freezing costs nothing and says what is meant:
 * after this, where the reader was is settled.
 */
/**
 * The row the reader is looking at, which is what a place in a folder really is.
 *
 * Read from the rows on screen rather than worked out from the number: a listing
 * draws what it must and the arithmetic differs per view, but whatever is drawn is
 * at a measurable height.
 */
const rowAtTheTop = () => {
  const target = getScrollTarget();
  if (!target || target !== dropTargetRef.value) return '';
  const edge = target.getBoundingClientRect().top;
  const rows = target.querySelectorAll('[data-keyboard-item-key]');
  for (const row of rows) {
    if (row.getBoundingClientRect().bottom > edge + 4) {
      return row.getAttribute('data-keyboard-item-key') || '';
    }
  }
  return '';
};

/**
 * Put this tab back on the row it was on.
 *
 * Tried before the number, and the number is the fallback. A pane that comes back
 * a different width has re-flowed its listing: the row the reader was on is still
 * the row they were on, while the pixels that took them there are now somewhere
 * else entirely — a hundred files away, measured, when a pair was formed.
 */
const placeAtRow = async (anchorKey) => {
  if (!anchorKey) return false;
  const index = sortedItems.value.findIndex((item) => getItemKey(item) === anchorKey);
  if (index < 0) return false;
  const target = getScrollTarget();
  if (!target || target !== dropTargetRef.value) return false;

  // Roughly first, so the rows around that place are drawn at all: a virtual list
  // holds only what is in view, and a progressive one only what it has reached.
  if (useVirtualList.value) {
    const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
    target.scrollTop = Math.min(index * LIST_ROW_HEIGHT, maxScrollTop);
    await waitForScrollLayout();
  } else if (visibleLimit.value <= index) {
    visibleLimit.value = sortedItems.value.length;
    await nextTick();
    await waitForScrollLayout();
  }

  const row = target.querySelector(`[data-keyboard-item-key="${CSS.escape(anchorKey)}"]`);
  if (!row) return false;
  // Moved by the distance between the row and the top of the listing, rather than
  // asked to scroll itself into view: `scrollIntoView` keeps clear of whatever is
  // sticky above it, which lands the reader a few rows earlier than where they were.
  const shift = row.getBoundingClientRect().top - target.getBoundingClientRect().top;
  target.scrollTop = Math.max(
    0,
    Math.min(target.scrollTop + shift, target.scrollHeight - target.clientHeight)
  );
  updateScrollState();
  return true;
};

const freezeWhereItIs = () => {
  if (!canRememberScroll.value) return;
  rememberScrollPosition();
  canRememberScroll.value = false;
};

const rememberActiveItem = (itemKey = keyboardActiveItemKey.value) => {
  const selectedItem = pane.selectedItems[pane.selectedItems.length - 1];
  const key = itemKey || getItemKey(selectedItem);
  if (key) folderScrollStore.rememberActiveItem(scrollKey(), key);
};

/**
 * The item a search result, or a paste, asked us to land on.
 *
 * Selecting it was not enough: in a folder of any size the selection lands
 * somewhere below the fold and the folder opens looking like nothing happened.
 * The name is kept here and acted on after the list has laid out, because
 * where a row sits is only known then — and in a virtualised list the row does
 * not exist in the DOM at all until the scroll position brings it into the
 * window, so it has to be computed rather than looked up.
 */
const pendingRevealName = ref('');

const applySelectionFromQuery = () => {
  // From this pane's own address rather than from the router's: the pane beside
  // the reader is on an address the router is not.
  const selectName = new URLSearchParams(paneAddress.value.split('?')[1] || '').get('select') || '';
  if (!selectName) return;
  const match = pane.getCurrentPathItems.find((it) => it?.name === selectName);
  if (match) {
    pane.selectedItems = [match];
    // So the arrow keys carry on from what was just revealed rather than from
    // the top of the folder.
    const key = getItemKey(match);
    keyboardSelectionAnchorKey.value = key;
    keyboardActiveItemKey.value = key;
    pane.setKeyboardActionItem(match);
    pendingRevealName.value = selectName;
  }
};

const revealPendingItem = async () => {
  const name = pendingRevealName.value;
  if (!name) return false;
  pendingRevealName.value = '';

  const index = sortedItems.value.findIndex((item) => item?.name === name);
  if (index < 0) return false;

  const target = getScrollTarget();
  if (!target) return false;

  // A progressively rendered list has to hold the row before it can be
  // scrolled to; a virtual one computes the position instead.
  if (!useVirtualList.value && visibleLimit.value <= index) {
    visibleLimit.value = sortedItems.value.length;
    await nextTick();
    await waitForScrollLayout();
  }

  if (useVirtualList.value) {
    const offsetFor = () =>
      revealOffset({
        index,
        rowHeight: LIST_ROW_HEIGHT,
        viewportHeight: target.clientHeight,
        maxScrollTop: Math.max(0, target.scrollHeight - target.clientHeight),
      });

    target.scrollTop = offsetFor();
    // The window reacts to scrollTop one frame later, exactly as a restored
    // position does, so it is applied again once the rows exist and the
    // scrollable height is the real one.
    await waitForScrollLayout();
    target.scrollTop = offsetFor();
  } else {
    // Every row already carries its key for keyboard navigation, and the same
    // key already draws the ring that marks it — so the row can be found, and
    // it is visibly the one that was asked for once it is on screen.
    const item = sortedItems.value[index];
    const row = target.querySelector(`[data-keyboard-item-key="${CSS.escape(getItemKey(item))}"]`);
    if (!row?.scrollIntoView) return false;
    row.scrollIntoView({ block: 'center' });
  }

  updateScrollState();
  return true;
};

const sortedItems = computed(() => pane.getCurrentPathItems);
// The window arithmetic lives in utils so it can be tested without this file's
// fifteen stores around it.
const listWindow = computed(() =>
  virtualWindow({
    itemCount: sortedItems.value.length,
    view: settings.view,
    scrollTop: scrollTop.value,
    viewportHeight: scrollViewportHeight.value,
    visibleLimit: visibleLimit.value,
  })
);
const useVirtualList = computed(() => listWindow.value.virtualised);
const virtualStartIndex = computed(() => listWindow.value.startIndex);
const virtualEndIndex = computed(() => listWindow.value.endIndex);
const visibleItems = computed(() =>
  sortedItems.value.slice(virtualStartIndex.value, virtualEndIndex.value)
);
const hasActiveFileOperation = computed(() => operationTasksStore.operationCount > 0);

const isIdleThumbnailCandidate = (item) => {
  if (!item || item.kind === 'directory' || item.thumbnail || item.thumbnailUnavailable)
    return false;
  return Boolean(item.supportsThumbnail);
};

const stopIdleThumbnailPrefetch = () => {
  idleThumbnailPrefetchGeneration += 1;
  if (idleThumbnailPrefetchTimer) {
    window.clearTimeout(idleThumbnailPrefetchTimer);
    idleThumbnailPrefetchTimer = null;
  }
};

const scheduleIdleThumbnailPrefetch = (delayMs = IDLE_THUMBNAIL_PREFETCH_DELAY_MS) => {
  stopIdleThumbnailPrefetch();
  if (
    loading.value ||
    document.hidden ||
    hasActiveFileOperation.value ||
    idleThumbnailPrefetchedKeys.size >= IDLE_THUMBNAIL_PREFETCH_LIMIT
  ) {
    return;
  }

  const generation = idleThumbnailPrefetchGeneration;
  idleThumbnailPrefetchTimer = window.setTimeout(async () => {
    idleThumbnailPrefetchTimer = null;
    if (
      generation !== idleThumbnailPrefetchGeneration ||
      loading.value ||
      document.hidden ||
      hasActiveFileOperation.value
    ) {
      return;
    }

    const nextItem = sortedItems.value.find((item) => {
      const key = getItemKey(item);
      return key && !idleThumbnailPrefetchedKeys.has(key) && isIdleThumbnailCandidate(item);
    });
    if (!nextItem) return;

    const key = getItemKey(nextItem);
    const accepted = await pane.prefetchItemThumbnail(nextItem);
    if (accepted) idleThumbnailPrefetchedKeys.add(key);

    if (generation === idleThumbnailPrefetchGeneration) {
      scheduleIdleThumbnailPrefetch(IDLE_THUMBNAIL_PREFETCH_INTERVAL_MS);
    }
  }, delayMs);
};

const resetIdleThumbnailPrefetch = () => {
  idleThumbnailPrefetchedKeys.clear();
  scheduleIdleThumbnailPrefetch();
};
const hasMoreItems = computed(() => listWindow.value.hasMore);
const virtualTopSpacerHeight = computed(() => listWindow.value.topSpacerHeight);
const virtualBottomSpacerHeight = computed(() => listWindow.value.bottomSpacerHeight);

const getItemKey = (item) => {
  if (!item || !item.name) return '';
  const parent = normalizePath(item.path || '');
  return `${parent}::${item.name}`;
};

const allItemsSelected = computed(
  () =>
    sortedItems.value.length > 0 &&
    sortedItems.value.every((item) => pane.selectedItemKeys.has(getItemKey(item)))
);

const someItemsSelected = computed(
  () =>
    sortedItems.value.length > 0 &&
    sortedItems.value.some((item) => pane.selectedItemKeys.has(getItemKey(item)))
);

const resetVisibleItems = () => {
  visibleLimit.value = INITIAL_VISIBLE_ITEMS;
};

const revealMoreItems = () => {
  if (!hasMoreItems.value) return;
  visibleLimit.value = Math.min(
    sortedItems.value.length,
    visibleLimit.value + VISIBLE_ITEMS_INCREMENT
  );
  nextTick(updateScrollState);
};

const updateScrollState = () => {
  const target = getScrollTarget();
  if (!target) {
    isScrollable.value = false;
    canScrollUp.value = false;
    canScrollDown.value = false;
    return;
  }

  const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
  scrollTop.value = target.scrollTop;
  scrollViewportHeight.value = target.clientHeight;
  isScrollable.value = maxScrollTop > 2;
  canScrollUp.value = target.scrollTop > 2;
  canScrollDown.value = target.scrollTop < maxScrollTop - 2;
  if (canRememberScroll.value) {
    rememberScrollPosition();
  }
  scheduleIdleThumbnailPrefetch();
};

const waitForScrollLayout = () =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

const applySavedScrollPosition = (savedScrollTop) => {
  const target = getScrollTarget();
  if (!target) return 0;

  const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
  target.scrollTop = Math.min(savedScrollTop, maxScrollTop);
  return maxScrollTop;
};

/**
 * Put the listing back where it was, and keep asking until it holds.
 *
 * One attempt is enough for a folder of twenty and never enough for a folder of
 * two thousand. A long list is not as tall as it will be at the moment it is
 * asked: the virtual window has not measured its viewport yet, or the
 * progressive one is still on its first five hundred rows, so the container's
 * height is short and the browser clamps the position to what fits — which for a
 * container that is not scrollable yet is the top.
 *
 * So it is asked again on each of the next few frames, until the list is tall
 * enough to hold the answer. It stops as soon as it holds, and after a fixed
 * number of frames whatever happens, because a folder that has genuinely lost its
 * length — files deleted while this tab was away — is never going to be that tall.
 *
 * It does not try to tell whether the reader has scrolled in the meantime. The
 * first version did, by watching whether the position moved between two frames,
 * and it was wrong about the one case that matters: setting the position of a
 * virtual list makes it draw different rows, which changes its height for a frame,
 * which makes the browser clamp the position — a move that looks exactly like a
 * hand on the wheel. It gave up there, in the folders the whole thing exists for.
 * A third of a second is not long enough for anybody to have scrolled anywhere on
 * purpose, and if they do, the loop is over before it could fight them for long.
 */
const FRAMES_TO_SETTLE_SCROLL = 20;

const settleScrollAt = async (savedScrollTop) => {
  if (!(savedScrollTop > 0)) return false;

  for (let frame = 0; frame < FRAMES_TO_SETTLE_SCROLL; frame += 1) {
    // A progressively rendered list is only as tall as the rows it has drawn.
    if (!useVirtualList.value && visibleLimit.value < sortedItems.value.length) {
      visibleLimit.value = sortedItems.value.length;
      await nextTick();
    }

    const maxScrollTop = applySavedScrollPosition(savedScrollTop);
    const placed = getScrollTarget()?.scrollTop ?? 0;
    if (maxScrollTop >= savedScrollTop && Math.abs(placed - savedScrollTop) <= 1) return true;

    await waitForScrollLayout();
  }

  return false;
};

const restoreKeyboardActiveItem = (itemKey) => {
  const itemIndex = getItemIndexByKey(itemKey);
  if (itemIndex < 0) return;

  const item = sortedItems.value[itemIndex];
  if (!item) return;

  keyboardSelectionAnchorKey.value = itemKey;
  keyboardActiveItemKey.value = itemKey;
  pane.selectedItems = [item];
  pane.setKeyboardActionItem(item);
};

const restoreScrollPosition = async () => {
  // Landing on a named item wins over coming back to where this folder was
  // last left: one is what the reader just asked for, the other is where they
  // happened to be some time ago.
  const restoreState = folderScrollStore.consumeRestoreState(scrollKey(), ownTabId);
  if (await revealPendingItem()) return;
  if (!restoreState.permitted) return;

  restoreKeyboardActiveItem(restoreState.activeItemKey);
  const savedScrollTop = restoreState.scrollTop;
  if (savedScrollTop <= 0) return;

  // Non-virtual lists can initially render only 500 entries. Render their
  // small remainder before restoring, otherwise a saved lower position would
  // be clamped before the user can get back to it.
  if (!useVirtualList.value && visibleLimit.value < sortedItems.value.length) {
    visibleLimit.value = sortedItems.value.length;
  }

  await nextTick();
  await waitForScrollLayout();

  // The virtual window reacts to scrollTop, so restoring it changes the DOM one
  // frame later, and a list of any length is not yet as tall as it will be.
  await settleScrollAt(savedScrollTop);
  updateScrollState();
};

const revealAllItems = async () => {
  while (visibleLimit.value < sortedItems.value.length) {
    visibleLimit.value = Math.min(
      sortedItems.value.length,
      visibleLimit.value + VISIBLE_ITEMS_INCREMENT
    );
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

const scrollToTop = () => {
  getScrollTarget()?.scrollTo?.({ top: 0, behavior: useVirtualList.value ? 'auto' : 'smooth' });
};

const scrollToBottom = async () => {
  if (!useVirtualList.value) {
    await revealAllItems();
  }
  await nextTick();
  const target = getScrollTarget();
  target?.scrollTo?.({
    top: target.scrollHeight,
    behavior: useVirtualList.value ? 'auto' : 'smooth',
  });
  updateScrollState();
};

const toggleSelectAll = () => {
  if (allItemsSelected.value) {
    clearSelection();
    return;
  }

  pane.selectedItems = [...sortedItems.value];
};

const isKeyboardNavigationBlocked = () => {
  // A listing has no focus of its own to hang its keys on, so it listens to the
  // window — and in a pair that is two listings listening. Both of them acted:
  // pressing Enter in the half the reader was in opened the file chosen in the
  // half they were not, over the half they were. The keyboard belongs to the pane
  // the reader is in; with one pane that is always this one.
  if (!readerIsHere.value) return true;
  if (loading.value || pane.renameState || isDeleteConfirmOpen.value) return true;
  const active = document.activeElement;
  return actions.isEditableElement ? actions.isEditableElement(active) : false;
};

const getItemIndexByKey = (key) => sortedItems.value.findIndex((item) => getItemKey(item) === key);

const getKeyboardActiveIndex = () => {
  const activeIndex = getItemIndexByKey(keyboardActiveItemKey.value);
  if (activeIndex >= 0) return activeIndex;

  const selected = pane.selectedItems[pane.selectedItems.length - 1];
  return selected ? getItemIndexByKey(getItemKey(selected)) : -1;
};

const getKeyboardSelectionAnchorIndex = () => {
  const anchorIndex = getItemIndexByKey(keyboardSelectionAnchorKey.value);
  if (anchorIndex >= 0) return anchorIndex;

  const selected = pane.selectedItems[0];
  if (selected) return getItemIndexByKey(getItemKey(selected));

  return getKeyboardActiveIndex();
};

const selectItemRange = async (anchorIndex, activeIndex) => {
  const items = sortedItems.value;
  const [start, end] = rangeBetween(anchorIndex, activeIndex);
  const activeItem = items[activeIndex];
  if (!activeItem) return;

  pane.selectedItems = items.slice(start, end + 1);
  pane.setKeyboardActionItem(activeItem);
  keyboardActiveItemKey.value = getItemKey(activeItem);
  rememberActiveItem(getItemKey(activeItem));
  await scrollSelectionIntoView(activeItem, activeIndex);
};

const scrollSelectionIntoView = async (item, index) => {
  if (!item || index < 0) return;

  if (useVirtualList.value) {
    getScrollTarget()?.scrollTo({ top: index * LIST_ROW_HEIGHT, behavior: 'auto' });
  } else if (index >= visibleLimit.value) {
    visibleLimit.value = Math.min(sortedItems.value.length, index + 1);
  }

  await nextTick();
  const key = getItemKey(item);
  const element = Array.from(document.querySelectorAll('[data-keyboard-item-key]')).find(
    (candidate) => candidate.getAttribute('data-keyboard-item-key') === key
  );
  if (!element) return;

  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const target = getScrollTarget();
  if (!target) return;

  const itemRect = element.getBoundingClientRect();
  const isDocumentScroller =
    target === document.scrollingElement || target === document.documentElement;
  const scrollContainerRect = dropTargetRef.value?.getBoundingClientRect?.();
  const headerRect = listHeaderRef.value?.getBoundingClientRect?.();
  const baseTargetRect = isDocumentScroller
    ? {
        // The document can scroll behind the fixed toolbar. Use the folder viewport
        // as the actual visible bounds for keyboard focus.
        top: scrollContainerRect?.top ?? 0,
        bottom: Math.min(scrollContainerRect?.bottom ?? window.innerHeight, window.innerHeight),
      }
    : target.getBoundingClientRect();
  // The sticky header obscures rows at the top of both document and local scrollers.
  const targetRect = {
    ...baseTargetRect,
    top: Math.max(baseTargetRect.top, headerRect?.bottom ?? baseTargetRect.top),
  };
  const padding = 8;
  const topAdjustment = itemRect.top - (targetRect.top + padding);
  const bottomAdjustment = itemRect.bottom - (targetRect.bottom - padding);
  const adjustment =
    topAdjustment < 0 ? topAdjustment : bottomAdjustment > 0 ? bottomAdjustment : 0;

  if (adjustment === 0) return;
  if (typeof target.scrollBy === 'function') {
    target.scrollBy({ top: adjustment, behavior: 'auto' });
  } else {
    target.scrollTop += adjustment;
  }
};

const selectRelativeItem = async (direction, extendSelection = false) => {
  const items = sortedItems.value;
  if (!items.length) return;

  const currentIndex = getKeyboardActiveIndex();
  const nextIndex = nextIndexInDirection(currentIndex, direction, items.length);
  const nextItem = items[nextIndex];
  if (!nextItem) return;

  if (extendSelection) {
    const anchorIndex = getKeyboardSelectionAnchorIndex();
    const resolvedAnchorIndex =
      anchorIndex >= 0 ? anchorIndex : currentIndex >= 0 ? currentIndex : nextIndex;
    keyboardSelectionAnchorKey.value = getItemKey(items[resolvedAnchorIndex]);
    await selectItemRange(resolvedAnchorIndex, nextIndex);
    return;
  }

  keyboardSelectionAnchorKey.value = getItemKey(nextItem);
  keyboardActiveItemKey.value = getItemKey(nextItem);
  pane.setKeyboardActionItem(nextItem);
  rememberActiveItem(getItemKey(nextItem));
  await scrollSelectionIntoView(nextItem, nextIndex);
};

const toggleKeyboardSelection = async () => {
  const items = sortedItems.value;
  if (!items.length) return;

  const activeIndex = getKeyboardActiveIndex();
  const itemIndex = activeIndex >= 0 ? activeIndex : 0;
  const item = items[itemIndex];
  if (!item) return;

  toggleSelection(item);
  keyboardSelectionAnchorKey.value = getItemKey(item);
  keyboardActiveItemKey.value = getItemKey(item);
  pane.setKeyboardActionItem(item);
  rememberActiveItem(getItemKey(item));
  await scrollSelectionIntoView(item, itemIndex);
};

const handleKeyboardItemClick = (item) => {
  const key = getItemKey(item);
  keyboardSelectionAnchorKey.value = key;
  keyboardActiveItemKey.value = key;
  pane.clearKeyboardActionItem();
  rememberActiveItem(key);
};

const selectTypeaheadMatch = async (key) => {
  const items = sortedItems.value;
  if (!items.length) return;

  const normalizedKey = normalizeTypeaheadText(key);
  keyboardTypeahead.value += normalizedKey;
  window.clearTimeout(keyboardTypeaheadTimer);
  keyboardTypeaheadTimer = window.setTimeout(() => {
    keyboardTypeahead.value = '';
    keyboardTypeaheadTimer = null;
  }, 600);

  const activeIndex = getKeyboardActiveIndex();
  const { match, query } = findTypeaheadMatch(
    items,
    keyboardTypeahead.value,
    activeIndex,
    normalizedKey
  );
  keyboardTypeahead.value = query;

  if (!match) return;
  const matchIndex = getItemIndexByKey(getItemKey(match));
  if (matchIndex < 0) return;

  pane.selectedItems = [match];
  keyboardSelectionAnchorKey.value = getItemKey(match);
  keyboardActiveItemKey.value = getItemKey(match);
  pane.setKeyboardActionItem(match);
  rememberActiveItem(getItemKey(match));
  await scrollSelectionIntoView(match, matchIndex);
};

const handleFolderKeydown = (event) => {
  if (event.defaultPrevented || isKeyboardNavigationBlocked()) return;

  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    goPrev();
    return;
  }

  if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    goNext();
    return;
  }

  if (event.altKey && event.key === 'ArrowUp') {
    event.preventDefault();
    goUp();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectRelativeItem(1, event.shiftKey);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectRelativeItem(-1, event.shiftKey);
    return;
  }

  if (event.key === ' ') {
    event.preventDefault();
    toggleKeyboardSelection();
    return;
  }

  const activeIndex = getKeyboardActiveIndex();
  const activeItem = activeIndex >= 0 ? sortedItems.value[activeIndex] : null;
  const selected = activeItem || (pane.selectedItems.length === 1 ? pane.selectedItems[0] : null);
  if (event.key === 'Enter' || (event.key === 'ArrowRight' && selected?.kind === 'directory')) {
    if (!selected) return;
    event.preventDefault();
    // The modifier a browser uses to open a link in a tab, on the key that opens
    // things here. `metaKey` first: on a Mac the command key is the one people
    // reach for, and control there means something else entirely.
    //
    // It is the *keyboard* that carries this, because on a row the same modifier
    // with a click already means "and this one too" — taking multiple selection
    // away to offer a tab would be a poor trade. The middle button and the row's
    // own menu say it with a pointer.
    if ((event.metaKey || event.ctrlKey) && openItemInTab(selected, pane.currentPath || '')) return;
    openItem(selected);
    return;
  }

  if (event.key === 'Backspace' || event.key === 'ArrowLeft') {
    event.preventDefault();
    goUp();
    return;
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    selectTypeaheadMatch(event.key);
  }
};

const disconnectLoadMoreObserver = () => {
  if (loadMoreObserver) {
    loadMoreObserver.disconnect();
    loadMoreObserver = null;
  }
};

const setupLoadMoreObserver = async () => {
  disconnectLoadMoreObserver();

  if (!hasMoreItems.value || typeof IntersectionObserver === 'undefined') {
    return;
  }

  await nextTick();
  if (!loadMoreTrigger.value) {
    return;
  }

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        revealMoreItems();
      }
    },
    { root: null, rootMargin: '800px 0px' }
  );
  loadMoreObserver.observe(loadMoreTrigger.value);
};

const selectionModel = computed({
  get: () => pane.selectedItems,
  set: (val) => {
    // val is the new selection from drag-select (array of items)
    // We update the store.
    // Note: drag-select might replace the selection.
    // If we want to support modifiers, the library handles 'multiple' prop.
    pane.selectedItems = val;
  },
});

const loadFiles = async () => {
  loading.value = true;
  canRememberScroll.value = false;
  resetVisibleItems();
  // And said on the tab as well, where the reader can see it from anywhere: this is
  // the same wait, and a tab that was opened in the background is having it while
  // somebody is looking at something else.
  const doneLoading = tabLoading.begin(ownTabId);
  const path = paneFolderPath.value;
  try {
    await pane.fetchPathItems(path);
    applySelectionFromQuery();
  } catch (error) {
    console.error('Failed to load directory contents', error);
  } finally {
    loading.value = false;
    doneLoading();
    await setupLoadMoreObserver();
    await nextTick();
    await restoreScrollPosition();
    canRememberScroll.value = true;
    updateScrollState();
    resetIdleThumbnailPrefetch();
  }
};

/**
 * Coming back to a tab: what is on screen is what this tab was holding, and it
 * appears at once — no spinner, no lost selection, and back where it was.
 */
const returnToFolder = async () => {
  loading.value = false;
  // As it was left, which includes how it was shown: how a folder is shown is its
  // own preference, and walking into another folder applied that one to the window.
  // Coming back to a tab that was left in the list view and finding it in the grid
  // is wrong on its own, and it also asks the wrong question about where the reader
  // was — the position is remembered per view, because the same folder is a
  // different height in each.
  settings.restoreFolderPreferences(ownFolderPath);
  await nextTick();
  await setupLoadMoreObserver();
  await nextTick();
  /**
   * Where this tab was — and, failing that, where this folder was.
   *
   * Two memories answer the same question from different angles. The tab's is the
   * precise one: two tabs on one folder can be in different places in it, so the
   * tab is part of the key. The folder's is the one that has been putting readers
   * back where they were since long before tabs existed — it is what a walk back
   * up the path reads, and it demonstrably works.
   *
   * So the tab's answer is preferred and the folder's is the fallback, rather than
   * the tab's being the only one asked. A tab that never left the folder has the
   * same answer under both keys, so the fallback costs nothing when the first one
   * is there — and when it is not, for any of the reasons a tab place can be
   * missing, the reader still lands where they were instead of at the top.
   */
  // Asked as "has this tab a place here", not as a number: the top is an answer,
  // and as a number it is zero, which reads as no answer at all. A tab left at the
  // top therefore fell through to the folder's memory — shared by every tab on that
  // folder — and came back wherever another tab had last been left in it.
  const savedScrollTop = folderScrollStore.hasTabPlace(placeKey())
    ? folderScrollStore.tabPlace(placeKey())
    : folderScrollStore.get(scrollKey());
  // The row it was on first, and the number only when there is no row to go to.
  const anchor = folderScrollStore.tabAnchor(placeKey());
  if (!(await placeAtRow(anchor)) && savedScrollTop > 0) {
    await waitForScrollLayout();
    // Asked for over several frames: a folder of two thousand files is not as
    // tall as it will be on the frame it is asked, and a place the container
    // cannot hold yet is a place the browser quietly turns into the top.
    await settleScrollAt(savedScrollTop);
  }
  canRememberScroll.value = true;
  updateScrollState();
  resetIdleThumbnailPrefetch();

  /**
   * Somebody else may have changed the folder while this tab was behind another.
   *
   * Asked for quietly: the listing is replaced under whatever is selected, and
   * nothing about it moves the reader. That last part took two goes. Replacing the
   * rows makes the listing briefly shorter than it was, and a browser handed a
   * container that can no longer hold the position clamps it — so the reader,
   * having just been put back four thousand pixels down, was taken to two hundred
   * the moment the answer arrived. Whether it happened at all depended on whether
   * the answer beat the loop that was still placing them, which is why it came and
   * went: a slower network made it certain.
   *
   * So the position is placed again, and only where it was clamped — a position
   * that is still where it was put, or further down, is the reader's own and is
   * left alone.
   */
  void pane
    .fetchPathItems(paneFolderPath.value, { preserveInteraction: true })
    .then(async () => {
      if (!(savedScrollTop > 0)) return;
      const now = getScrollTarget()?.scrollTop ?? 0;
      if (now >= savedScrollTop - 1) return;
      await settleScrollAt(savedScrollTop);
    })
    .catch(() => {});
};

/**
 * Whether the address this listing is drawn for is a folder's at all.
 *
 * A pane can be handed another tab, and that tab may hold a file: for the tick
 * before that tab's own screen replaces this one, this listing's address is the
 * file's. Reading it asks the server to list a file as a folder, which is an error
 * with a 500 on it — `ENOTDIR: not a directory` — and nothing on screen to explain
 * it. The other screens ask the same question before speaking; this is the fourth.
 */
const isAFolderAddress = () => tabKindForPath(paneAddress.value)?.id === 'folder';

onMounted(() => {
  if (!isAFolderAddress()) return;
  return comingBack() ? returnToFolder() : loadFiles();
});

// Populate folder sizes for the directories currently in view (one batch
// request; O(1) index reads server-side). Re-runs whenever the listing changes.
// Serving a folder also asks the server to re-check these folders' mtime in the
// background (on-view refresh), so we schedule one follow-up fetch a few seconds
// later to surface any external change without waiting for the periodic refresh.
let onViewFollowupTimer = null;
const refreshFolderSizes = () => {
  if (!featuresStore.folderSizeEnabled) return;
  const dirPaths = pane.getCurrentPathItems
    .filter((item) => item?.kind === 'directory')
    .map((item) => (item.path ? `${item.path}/${item.name}` : item.name));
  if (dirPaths.length) {
    folderSizeStore.ensureSizes(dirPaths).catch(() => {});
    if (onViewFollowupTimer) window.clearTimeout(onViewFollowupTimer);
    onViewFollowupTimer = window.setTimeout(() => folderSizeStore.scheduleRefresh(), 4000);
  }
};

watch(
  () => pane.getCurrentPathItems,
  () => {
    refreshFolderSizes();
    resetIdleThumbnailPrefetch();
  },
  { immediate: true }
);

watch(hasActiveFileOperation, (active) => {
  if (active) {
    stopIdleThumbnailPrefetch();
    return;
  }
  scheduleIdleThumbnailPrefetch();
});

// Folder sizes and volume usage are updated server-side the moment any client
// (or the watcher) changes the filesystem, but a given browser tab only re-reads
// them on demand. To surface changes made elsewhere without a manual refresh,
// re-fetch both when the tab regains focus/visibility and, while the tab is
// visible, on a gentle interval. Refreshing them together keeps the folder sizes
// and the volume usage bar in sync (otherwise a folder size can update while the
// volume total lags, which looks inconsistent). Both scheduleRefresh helpers are
// throttled (2.5s) so these triggers never hammer the API.
const refreshLiveData = () => {
  if (featuresStore.folderSizeEnabled) folderSizeStore.scheduleRefresh();
  if (featuresStore.volumeUsageEnabled) volumeUsageStore.scheduleRefresh();
};

const LIVE_REFRESH_INTERVAL_MS = 30000;
const RETURN_TO_TAB_REFRESH_THROTTLE_MS = 1500;
let currentViewRefresh = null;
let lastCurrentViewRefreshAt = 0;

const refreshCurrentView = async () => {
  if (document.hidden || loading.value || currentViewRefresh) return currentViewRefresh;
  if (Date.now() - lastCurrentViewRefreshAt < RETURN_TO_TAB_REFRESH_THROTTLE_MS) return null;

  const path = pane.currentPath;
  lastCurrentViewRefreshAt = Date.now();
  currentViewRefresh = pane
    .fetchPathItems(path)
    .catch(() => {})
    .finally(() => {
      currentViewRefresh = null;
    });
  return currentViewRefresh;
};

const refreshOnTabReturn = () => {
  refreshCurrentView();
  refreshLiveData();
};

useEventListener(window, 'focus', refreshOnTabReturn);
useEventListener(window, 'pointerdown', () => scheduleIdleThumbnailPrefetch());
useEventListener(window, 'keydown', () => scheduleIdleThumbnailPrefetch());
useEventListener(window, 'wheel', () => scheduleIdleThumbnailPrefetch(), { passive: true });
useEventListener(document, 'visibilitychange', () => {
  if (!document.hidden) {
    refreshOnTabReturn();
    scheduleIdleThumbnailPrefetch();
  } else {
    stopIdleThumbnailPrefetch();
  }
});

const liveRefreshTimer = window.setInterval(() => {
  if (!document.hidden) refreshLiveData();
}, LIVE_REFRESH_INTERVAL_MS);

// The keyed RouterView normally unmounts this component on folder changes, but
// this guard runs before the route transition starts. It captures the actual
// scroll container before a view transition or layout change can reset it.
onBeforeRouteLeave(freezeWhereItIs);

watch(hasMoreItems, () => {
  setupLoadMoreObserver();
  nextTick(updateScrollState);
});

watch(
  () => [visibleItems.value.length, sortedItems.value.length, settings.view, useVirtualList.value],
  () => {
    nextTick(updateScrollState);
  }
);

watch(
  () => paneFolderPath.value,
  () => {
    stopIdleThumbnailPrefetch();
    idleThumbnailPrefetchedKeys.clear();
    resetVisibleItems();
    keyboardSelectionAnchorKey.value = '';
    keyboardActiveItemKey.value = '';
    keyboardTypeahead.value = '';
    window.clearTimeout(keyboardTypeaheadTimer);
    keyboardTypeaheadTimer = null;
  }
);

const handleBackgroundContextMenu = (event) => {
  if (!contextMenu || !event) return;
  contextMenu?.openBackgroundMenu(event);
};

const showNoPhotosMessage = computed(() => {
  if (loading.value) return false;
  if (settings.view !== 'photos') return false;

  const items = pane.getCurrentPathItems;
  if (items.length === 0) return false;

  // Check if any item is an image or video
  const hasPhotos = items.some((item) => {
    const kind = (item?.kind || '').toLowerCase();
    return isPreviewableImage(kind) || isPreviewableVideo(kind);
  });

  return !hasPhotos;
});

const showEmptyFolderMessage = computed(() => {
  if (loading.value) return false;
  return pane.getCurrentPathItems.length === 0;
});

const toggleSort = (by, defaultOrder = 'asc') => {
  const currentBy = settings.sortBy?.by;
  const currentOrder = settings.sortBy?.order;

  if (currentBy === by) {
    settings.setSort(by, currentOrder === 'asc' ? 'desc' : 'asc');
    return;
  }

  settings.setSort(by, defaultOrder);
};

const listColumns = [
  {
    key: 'name',
    labelKey: 'common.name',
    by: 'name',
    defaultOrder: 'asc',
    widthIndex: 1,
  },
  {
    key: 'size',
    labelKey: 'common.size',
    by: 'size',
    defaultOrder: 'desc',
    widthIndex: 2,
  },
  {
    key: 'kind',
    labelKey: 'folder.kind',
    by: 'kind',
    defaultOrder: 'asc',
    widthIndex: 3,
  },
  {
    key: 'dateModified',
    labelKey: 'folder.dateModified',
    by: 'dateModified',
    defaultOrder: 'desc',
    widthIndex: 4,
  },
];

const sortIndicator = (by) => {
  if (settings.sortBy?.by !== by) return null;
  return settings.sortBy?.order || null;
};

const resizeState = ref(null);
const bodyStyleBeforeResize = ref({ cursor: '', userSelect: '' });

const stopResize = () => {
  if (!resizeState.value) return;
  resizeState.value = null;
  document.body.style.cursor = bodyStyleBeforeResize.value.cursor;
  document.body.style.userSelect = bodyStyleBeforeResize.value.userSelect;
};

const startResize = (colIndex, event) => {
  if (!event) return;
  if (event.button !== undefined && event.button !== 0) return;

  const startWidth = Number(settings.listViewColumnWidths?.[colIndex]);
  if (!Number.isFinite(startWidth)) return;

  resizeState.value = { colIndex, startX: event.clientX, startWidth };
  bodyStyleBeforeResize.value = {
    cursor: document.body.style.cursor || '',
    userSelect: document.body.style.userSelect || '',
  };
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
};

useEventListener(window, 'pointermove', (event) => {
  const state = resizeState.value;
  if (!state) return;
  const deltaX = event.clientX - state.startX;
  settings.setListViewColumnWidth(state.colIndex, state.startWidth + deltaX);
});

useEventListener(window, 'pointerup', stopResize);
useEventListener(window, 'pointercancel', stopResize);
useEventListener(window, 'resize', updateScrollState);
useEventListener(window, 'scroll', updateScrollState, { passive: true });
useEventListener(window, 'keydown', handleFolderKeydown);

onBeforeUnmount(() => {
  stopIdleThumbnailPrefetch();
  freezeWhereItIs();
  stopResize();
  window.clearInterval(liveRefreshTimer);
  if (onViewFollowupTimer) window.clearTimeout(onViewFollowupTimer);
  window.clearTimeout(keyboardTypeaheadTimer);
  disconnectLoadMoreObserver();
});
</script>

<template>
  <div
    ref="dropTargetRef"
    class="upload-drop-target relative flex flex-col flex-1 min-h-0 overflow-auto"
    @click.self="clearSelection()"
    @scroll.passive="updateScrollState"
    @dragover="onEmptySpaceDragOver"
    @dragleave="onEmptySpaceDragLeave"
    @drop="onEmptySpaceDrop"
  >
    <template v-if="!loading">
      <DragSelect
        v-model="selectionModel"
        :click-option-to-select="false"
        :draggable-on-option="false"
        :disabled="isTouchDevice || !!pane.renameState"
        class="grow px-2"
        @click.self="clearSelection()"
        @contextmenu.prevent="handleBackgroundContextMenu"
      >
        <!-- Horizontal overflow is handled by the outer scroll container so the
             horizontal scrollbar stays pinned to the bottom of the viewport (you
             can scroll sideways from anywhere in the list). The bottom padding in
             list view keeps the last row from hiding under that scrollbar. -->
        <div
          :class="[gridClasses, 'min-h-full', settings.view === 'list' ? 'pb-5' : '']"
          :style="gridStyle"
          :data-view="settings.view"
          data-test="listing"
          @dragover.self="handleCurrentFolderDragOver"
          @dragleave.self="handleCurrentFolderDragLeave"
          @drop.self="handleCurrentFolderDrop"
        >
          <!-- Detail view header -->
          <div
            v-if="settings.view === 'list'"
            ref="listHeaderRef"
            class="sticky top-0 z-30 isolate -mx-2 min-w-max bg-white dark:bg-default"
          >
            <div
              :class="[
                'grid items-center',
                'px-4 py-2 text-xs',
                'text-neutral-600 dark:text-neutral-300',
                'uppercase tracking-wide select-none',
                'backdrop-blur-sm',
                'min-w-max',
              ]"
              :style="{
                gridTemplateColumns: settings.listViewGridTemplateColumns,
              }"
            >
              <div class="flex items-center justify-center">
                <input
                  type="checkbox"
                  class="h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
                  :checked="allItemsSelected"
                  :indeterminate.prop="someItemsSelected && !allItemsSelected"
                  :aria-label="allItemsSelected ? $t('folder.deselectAll') : $t('folder.selectAll')"
                  @change="toggleSelectAll"
                  @click.stop
                />
              </div>
              <div
                v-for="col in listColumns"
                :key="col.key"
                role="button"
                tabindex="0"
                :aria-sort="
                  sortIndicator(col.by) === 'asc'
                    ? 'ascending'
                    : sortIndicator(col.by) === 'desc'
                      ? 'descending'
                      : 'none'
                "
                class="relative flex cursor-pointer items-center gap-1 text-left outline-none hover:text-neutral-900 focus-visible:text-neutral-900 dark:hover:text-white dark:focus-visible:text-white"
                @click="toggleSort(col.by, col.defaultOrder)"
                @keydown.enter.prevent="toggleSort(col.by, col.defaultOrder)"
                @keydown.space.prevent="toggleSort(col.by, col.defaultOrder)"
              >
                <span>{{ $t(col.labelKey) }}</span>
                <ChevronUpIcon v-if="sortIndicator(col.by) === 'asc'" class="h-3.5 w-3.5" />
                <ChevronDownIcon v-else-if="sortIndicator(col.by) === 'desc'" class="h-3.5 w-3.5" />
                <div
                  class="absolute -right-2 top-0 h-full w-4 cursor-col-resize touch-none"
                  title="Resize"
                  @click.stop
                  @pointerdown.stop.prevent="startResize(col.widthIndex, $event)"
                  @dblclick.stop.prevent="settings.resetListViewColumnWidths()"
                >
                  <div
                    class="mx-auto h-full w-px bg-transparent hover:bg-neutral-300 dark:hover:bg-neutral-600"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="useVirtualList && virtualTopSpacerHeight > 0"
            class="shrink-0"
            :style="{ height: `${virtualTopSpacerHeight}px` }"
          ></div>

          <FileObject
            v-for="item in visibleItems"
            :key="(item.path || '') + '::' + item.name"
            :item="item"
            :view="settings.view"
            :data-keyboard-item-key="getItemKey(item)"
            :class="[
              'relative',
              getItemKey(item) === keyboardActiveItemKey
                ? 'z-10 ring-2 ring-blue-500 dark:ring-blue-400 ring-offset-1 dark:ring-offset-zinc-800 rounded-lg'
                : '',
              item.kind === 'directory' && isDragTarget(item)
                ? isCopyDragTarget(item)
                  ? 'z-10 ring-2 ring-emerald-500 dark:ring-emerald-400 ring-offset-2 dark:ring-offset-zinc-800 rounded-lg'
                  : 'z-10 ring-2 ring-blue-500 dark:ring-blue-400 ring-offset-2 dark:ring-offset-zinc-800 rounded-lg'
                : '',
            ]"
            @dragover="(e) => item.kind === 'directory' && handleDragOver(e, item)"
            @dragleave="(e) => item.kind === 'directory' && handleDragLeave(e, item)"
            @drop="(e) => item.kind === 'directory' && handleDrop(e, item)"
            @click="handleKeyboardItemClick(item)"
          />

          <div
            v-if="useVirtualList && virtualBottomSpacerHeight > 0"
            class="shrink-0"
            :style="{ height: `${virtualBottomSpacerHeight}px` }"
          ></div>

          <div
            v-if="hasMoreItems"
            ref="loadMoreTrigger"
            class="flex items-center justify-center py-4 text-xs text-neutral-500 dark:text-neutral-400"
          >
            <button
              type="button"
              class="rounded-md border border-neutral-200 px-3 py-1.5 transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="revealMoreItems"
            >
              {{ visibleItems.length }} / {{ sortedItems.length }} {{ $t('common.items') }}
            </button>
          </div>

          <!-- No photos message -->
          <div
            v-if="showNoPhotosMessage || showEmptyFolderMessage"
            class="absolute inset-0 flex flex-col items-center justify-center min-h-[400px] text-center px-4"
          >
            <div class="text-neutral-400 dark:text-neutral-500 mb-2">
              <FolderOpenIcon v-if="showEmptyFolderMessage" class="w-16 h-16 mb-4 opacity-30" />
              <ImagesOutline v-else class="w-20 h-20 mx-auto mb-4 opacity-50" />
            </div>
            <h3 class="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              {{ showEmptyFolderMessage ? $t('folder.empty') : $t('folder.noPhotos') }}
            </h3>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {{ showEmptyFolderMessage ? $t('folder.emptyHint') : $t('folder.noPhotosHint') }}
            </p>
          </div>
        </div>
      </DragSelect>

      <div
        v-if="isScrollable"
        class="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col gap-2"
      >
        <button
          v-if="canScrollUp"
          type="button"
          class="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-neutral-200 bg-white/90 text-neutral-700 shadow-lg backdrop-blur transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-100 dark:hover:bg-neutral-800"
          :aria-label="$t('folder.scrollTop')"
          :title="$t('folder.scrollTop')"
          @click="scrollToTop"
        >
          <ChevronDoubleUpIcon class="h-5 w-5" />
        </button>
        <button
          v-if="canScrollDown"
          type="button"
          class="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-neutral-200 bg-white/90 text-neutral-700 shadow-lg backdrop-blur transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-100 dark:hover:bg-neutral-800"
          :aria-label="$t('folder.scrollBottom')"
          :title="$t('folder.scrollBottom')"
          @click="scrollToBottom"
        >
          <ChevronDoubleDownIcon class="h-5 w-5" />
        </button>
      </div>
    </template>

    <template v-else>
      <div
        class="flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-300"
      >
        <div class="flex items-center pr-4 bg-neutral-200 dark:bg-zinc-700/50 rounded-xl">
          <LoadingIcon /> {{ $t('common.loading') }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.upload-drop-target.uppy-is-drag-over {
  outline: 2px dashed rgba(59, 130, 246, 0.6);
  outline-offset: -2px;
}
</style>
