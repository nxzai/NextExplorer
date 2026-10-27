import { normalizePath } from '@/api';
import { usePaneTabId } from '@/composables/paneTab';
import { useFileStore } from '@/stores/fileStore';

const getItemKey = (item) => {
  if (!item || !item.name) return '';
  const parent = normalizePath(item.path || '');
  return `${parent}::${item.name}`;
};

/**
 * What a click selects, in the place the click landed in.
 *
 * Every row asks this, and a row is drawn in a pane: what is selected belongs to
 * a *place*, and two panes side by side are two places. Asked of the window — the
 * store's own surface, which follows the tab in front — one selection served both
 * halves: choosing a file in one half moved the highlight in the other, and in the
 * half the reader was not in it jumped to wherever the other one had just been
 * pressed. Two tabs on one folder had the same single selection between them.
 *
 * `usePaneTabId` answers the tab in front wherever nobody is drawing panes, which
 * is every other screen and every window that has never been split — so this is
 * the same question it always asked, asked of the right place.
 */
export function useSelection() {
  const fileStore = useFileStore();
  const tabId = usePaneTabId();

  /** This pane's folder: its listing, its selection, as the tab holds them. */
  const folder = () => fileStore.folderFor(tabId.value);
  /** In the order they are on screen, which is the order a range runs in. */
  const itemsHere = () => fileStore.arrange(folder().items.value);
  const chosen = () => folder().selection;
  const put = (items) => {
    chosen().selectedItems.value = items;
  };

  const findInCurrentItems = (item) => {
    const key = getItemKey(item);
    return itemsHere().find((candidate) => getItemKey(candidate) === key) || item;
  };

  const isSelected = (item) => chosen().selectedItemKeys.value.has(getItemKey(item));

  const toggleSelection = (item) => {
    const key = getItemKey(item);
    const here = chosen().selectedItems.value;

    if (!chosen().selectedItemKeys.value.has(key)) {
      put([...here, findInCurrentItems(item)]);
      return;
    }

    const nextSelection = [...here];
    const index = nextSelection.findIndex((selected) => getItemKey(selected) === key);
    if (index === -1) return;
    nextSelection.splice(index, 1);
    put(nextSelection);
  };

  const selectRange = (item) => {
    const currentItems = itemsHere();
    const targetKey = getItemKey(item);
    const endIndex = currentItems.findIndex((entry) => getItemKey(entry) === targetKey);

    if (endIndex === -1) {
      return;
    }

    const here = chosen().selectedItems.value;
    const anchor = here[here.length - 1] || item;
    const anchorKey = getItemKey(anchor);
    const startIndex = currentItems.findIndex((entry) => getItemKey(entry) === anchorKey);

    if (startIndex === -1) {
      put([currentItems[endIndex]]);
      return;
    }

    const [start, end] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    put(currentItems.slice(start, end + 1));
  };

  const clearSelection = () => {
    chosen().clearSelection();
  };

  const selectOnly = (item) => {
    clearSelection();
    toggleSelection(item);
  };

  const handleSelection = (item, event) => {
    if (event?.ctrlKey || event?.metaKey) {
      toggleSelection(item);
    } else if (event?.shiftKey && chosen().selectedItems.value.length > 0) {
      selectRange(item);
    } else {
      selectOnly(item);
    }
  };

  return {
    isSelected,
    handleSelection,
    clearSelection,
    toggleSelection,
    selectOnly,
    selectRange,
  };
}
