<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsPointingInIcon,
  ArrowsRightLeftIcon,
  ArrowUpIcon,
  Bars3BottomLeftIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline';
import { fetchFileContent, getVersionText, saveFileContent } from '@/api';
import {
  alignLines,
  alignThree,
  blocksOf,
  inlineSpans,
  readLines,
  writeLines,
} from '@/utils/textDiff';
import { compareAddress, comparedSides } from '@/utils/compareRoute';
import { usePageTitle } from '@/composables/usePageTitle';
import { useTabNavigation } from '@/composables/tabNavigation';
import { useTabsStore } from '@/stores/tabs';
import { useTabLoadingStore } from '@/stores/tabLoading';
import { useNotificationsStore } from '@/stores/notifications';
import { useCompareSessionsStore } from '@/stores/compareSessions';
import { useTabGuardsStore } from '@/stores/tabGuards';
import { useAsk } from '@/composables/useAsk';

/**
 * Two or three files, side by side.
 *
 * A comparison is a *place* here, like a folder or a document: it has an address
 * carrying the paths it is about, so it lives in a tab, can be linked to, and is
 * something the reader leaves and comes back to rather than a dialog they have to
 * finish. Nothing about it is modal.
 *
 * What makes it usable rather than merely correct is the three things a reader
 * actually does with a comparison: step through the differences without hunting for
 * them, take one side's version of a difference over the other's, and save. So the
 * differences are counted and numbered, the keyboard walks them (F7 and F8, as
 * WinMerge has for twenty years, and alt with the arrows for anybody without those
 * keys), and each block can be taken across in either direction.
 *
 * The lines are the state and the alignment is derived from them, which is what
 * makes taking a block across a three-line operation rather than a bookkeeping
 * exercise: replace those lines on that side, and every row, every difference, every
 * count and the position in the row of them is recomputed from that.
 */
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const tabsStore = useTabsStore();
const tabLoading = useTabLoadingStore();
const notifications = useNotificationsStore();
const tabNavigation = useTabNavigation();
const { ask } = useAsk();

/**
 * The tab this screen speaks for, re-read whenever the address changes.
 *
 * Taken once would be wrong for the same reason it was wrong in the text editor:
 * crossing between two comparison tabs never unmounts anything, because both
 * addresses match the same route, so a tab captured at setup goes stale the moment
 * the reader crosses from one comparison to another.
 */
const held = useCompareSessionsStore();
const ownTabId = ref(tabsStore.activeId);
/** The address this screen is showing, which is what a kept comparison belongs to. */
const shownAddress = ref('');
const wantedSides = computed(() => comparedSides(route.query));

/**
 * One entry per file: its lines, how it ends them, and whether it has been changed.
 *
 * The lines are the truth. Everything else on this screen — the rows, the blocks,
 * the counts — is worked out from them, so a copy across has nothing to keep in step.
 */
const sides = ref([]);
const loading = ref(true);
const failed = ref('');

/** left, middle, right — the names the alignment answers with. */
const SIDE_KEYS = [
  ['left', 'right'],
  ['left', 'middle', 'right'],
];
const keys = computed(() => SIDE_KEYS[sides.value.length === 3 ? 1 : 0] || []);
const keyAt = (index) => keys.value[index];

const rows = computed(() => {
  const all = sides.value;
  if (all.length === 3) return alignThree(all[0].lines, all[1].lines, all[2].lines);
  if (all.length === 2) return alignLines(all[0].lines, all[1].lines);
  return [];
});

const blocks = computed(() => blocksOf(rows.value));
/** Which difference the reader is on, counting from zero; -1 before they start. */
const at = ref(-1);
const identical = computed(() => !loading.value && !failed.value && blocks.value.length === 0);

/**
 * Only the differences, with a little around them.
 *
 * What a reader wants from a long file, and what keeps this screen quick: five
 * thousand identical lines are five thousand rows to lay out and nothing to read. On
 * by itself for a file long enough for it to matter, and always the reader's to turn
 * off — a comparison that hides two thirds of a file without saying so would be a
 * comparison nobody could trust.
 */
const CONTEXT_LINES = 3;
const LONG_ENOUGH_TO_FOLD = 400;
const onlyDifferences = ref(false);
const wrap = ref(false);
/**
 * Whether the map of the differences stays out.
 *
 * Up here with the other two switches because `load` reads it, and `load` runs while
 * this file is still being evaluated: a `const` declared further down is in its dead
 * zone, the throw goes into `void load()`, and the screen silently keeps whatever it
 * started with. This file has had that bug once already.
 */
const mapPinned = ref(false);

/**
 * Letting go of the tab this screen was speaking for.
 *
 * Called on the way out of the page *and* on the way from one comparison to
 * another's, because crossing between two comparison tabs unmounts nothing: the only
 * sign that a tab has been left is that the address changed.
 */
const handOver = (key, address) => {
  // Gone with its tab: nothing to hold it for.
  if (!key || !tabsStore.tabs.some((entry) => entry.id === key)) return;
  // Still the tab in front, so the address changed underneath it: this comparison is
  // not what the tab is on any more.
  if (tabsStore.activeId === key) {
    held.forget(key);
    return;
  }
  if (!sides.value.length) return;
  held.keep(key, address, {
    at: at.value,
    onlyDifferences: onlyDifferences.value,
    wrap: wrap.value,
    mapPinned: mapPinned.value,
    sides: sides.value.map((side) => ({ ...side, lines: [...side.lines] })),
  });
};

onBeforeUnmount(() => handOver(ownTabId.value, shownAddress.value));

const load = async () => {
  const address = route.fullPath;
  const wanted = wantedSides.value;
  if (wanted.length < 2) {
    failed.value = t('compare.needTwo');
    loading.value = false;
    return;
  }

  /**
   * What this tab was in the middle of, put straight back.
   *
   * No spinner, no second read, and — the part that matters most — the lines taken
   * across and not yet saved are still there. They exist nowhere else.
   */
  const kept = held.sessionFor(ownTabId.value, address);
  if (kept?.sides?.length) {
    sides.value = kept.sides.map((side) => ({ ...side, lines: [...side.lines] }));
    at.value = Number.isInteger(kept.at) ? kept.at : -1;
    onlyDifferences.value = kept.onlyDifferences === true;
    wrap.value = kept.wrap === true;
    mapPinned.value = kept.mapPinned === true;
    shownAddress.value = address;
    loading.value = false;
    failed.value = '';
    return;
  }

  loading.value = true;
  failed.value = '';
  const done = tabLoading.begin(ownTabId.value);
  try {
    const read = await Promise.all(
      wanted.map(async ({ path, versionId }) => {
        // An earlier version is read through its own door, and it is read-only: there
        // is nothing to write back to a version, and the point of having it here is to
        // take lines *out* of it.
        const response = versionId
          ? await getVersionText(path, versionId)
          : await fetchFileContent(path);
        const { lines, newline } = readLines(response?.content ?? '');
        const name = path.split('/').filter(Boolean).pop() || path;
        return {
          path,
          versionId,
          name: versionId ? t('compare.versionOf', { name: response?.name || name }) : name,
          lines,
          newline,
          dirty: false,
          saving: false,
          readOnly: Boolean(versionId),
        };
      })
    );
    sides.value = read;
    at.value = -1;
    shownAddress.value = address;
  } catch (error) {
    failed.value = error?.message || t('compare.failed');
    sides.value = [];
  } finally {
    loading.value = false;
    done();
  }
};

/**
 * The address changed under this screen: another comparison, or another tab holding
 * one. Which of the two it was is what `activeId` says, and it is the only moment
 * this page can change hands — so what the tab it was speaking for should keep is
 * settled first, and the new tab is adopted before anything is read.
 */
watch(
  () => route.fullPath,
  () => {
    // Our own doing — the sides were swapped over — so nothing changed hands and
    // there is nothing to read again: the screen already shows what the address now
    // says.
    if (weMovedTheAddress) {
      weMovedTheAddress = false;
      return;
    }
    handOver(ownTabId.value, shownAddress.value);
    ownTabId.value = tabsStore.activeId;
    void load();
  }
);

/**
 * And the first read, once, outside that watcher.
 *
 * Not `immediate`, which is the trap: on a fresh mount the watcher would run its
 * change-of-hands with the tab it is about to adopt, and a change of hands to the tab
 * in front means "the address changed underneath it, forget what it held" — so the
 * comparison the previous instance had just handed over was thrown away a moment
 * before this one asked for it. Every glance at another tab read both files again, and
 * the two of them looked exactly like a feature that did not work.
 */
void load();

usePageTitle(
  computed(() =>
    sides.value.length ? sides.value.map((side) => side.name).join(' ↔ ') : t('compare.title')
  )
);

/**
 * Stepping through the differences.
 *
 * Wrapping round, because a comparison is read in circles — somebody on the last
 * difference pressing "next" means "start again", not "do nothing", and a button that
 * does nothing is a button they press twice to be sure.
 */
const rowRefs = ref({});
const setRowRef = (index, element) => {
  if (element) rowRefs.value[index] = element;
  else delete rowRefs.value[index];
};

const goToBlock = async (index) => {
  const total = blocks.value.length;
  if (total === 0) return;
  const wanted = ((index % total) + total) % total;
  at.value = wanted;
  await nextTick();
  rowRefs.value[blocks.value[wanted].from]?.scrollIntoView?.({
    block: 'center',
    behavior: 'smooth',
  });
};

const next = () => goToBlock(at.value + 1);
const previous = () => goToBlock(at.value <= 0 ? blocks.value.length - 1 : at.value - 1);

/**
 * One side's version of a difference, taken over the other's.
 *
 * The rows say which lines each side contributes to the block, so the whole
 * operation is: take those lines from one side, put them where the other side's were.
 * A block the target side has nothing in — a run only the source has — goes in after
 * the last line the target does have above it, which is the only place it can mean
 * anything.
 */
const copyBlock = (fromIndex, toIndex, blockIndex = at.value) => {
  const block = blocks.value[blockIndex];
  const source = sides.value[fromIndex];
  const target = sides.value[toIndex];
  if (!block || !source || !target) return;
  // Never into an earlier version: there is nothing to write it back to, and offering
  // it would be offering to change something that has already happened.
  if (target.readOnly) return;

  const fromKey = keyAt(fromIndex);
  const toKey = keyAt(toIndex);
  const within = rows.value.slice(block.from, block.to + 1);

  const taken = within
    .map((row) => row[fromKey])
    .filter((line) => line !== null && line !== undefined)
    .map((line) => source.lines[line]);

  const replacing = within
    .map((row) => row[toKey])
    .filter((line) => line !== null && line !== undefined);

  let start;
  if (replacing.length) {
    start = replacing[0];
  } else {
    // Nothing of the target's in this block: it goes after the last line of the
    // target above it, or at the very top when there is none.
    let above = -1;
    for (let index = block.from - 1; index >= 0; index -= 1) {
      const line = rows.value[index][toKey];
      if (line !== null && line !== undefined) {
        above = line;
        break;
      }
    }
    start = above + 1;
  }

  target.lines = [
    ...target.lines.slice(0, start),
    ...taken,
    ...target.lines.slice(start + replacing.length),
  ];
  target.dirty = true;

  // The block is gone, so the one at this position is the next one along — which is
  // where somebody working through a file wants to be.
  const total = blocksOf(
    sides.value.length === 3
      ? alignThree(sides.value[0].lines, sides.value[1].lines, sides.value[2].lines)
      : alignLines(sides.value[0].lines, sides.value[1].lines)
  ).length;
  at.value = total === 0 ? -1 : Math.min(blockIndex, total - 1);
};

/**
 * The address this comparison is at, built from the sides as they now stand.
 *
 * A string rather than an object for the router, because a tab holds an address as a
 * string and this screen is handed `route.fullPath`: the two have to be the same
 * string or a tab comes back to a comparison it thinks it has never seen. Which is
 * why the router spells it — see `compareAddress`.
 */
const addressFor = (list) =>
  compareAddress(
    router,
    list.map((side) => ({ path: side.path, versionId: side.versionId }))
  );

/**
 * Two sides swapped over.
 *
 * Which file is on the left is the reader's business, not the order they happened to
 * click in — and with an earlier version in the comparison it is the difference
 * between reading "what happened since" and reading it backwards.
 *
 * The address changes with them, so the tab's name, a reload and a link all agree
 * with what is on screen. What must not change is what the tab is holding, so the
 * session is written under the new address before the address becomes it.
 */
let weMovedTheAddress = false;

const swapSides = (index) => {
  const list = sides.value;
  if (index < 0 || index + 1 >= list.length) return;

  const next = [...list];
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  const address = addressFor(next);
  if (!address) return;

  sides.value = next;
  at.value = -1;
  held.keep(ownTabId.value, address, {
    at: -1,
    onlyDifferences: onlyDifferences.value,
    wrap: wrap.value,
    mapPinned: mapPinned.value,
    sides: next.map((side) => ({ ...side, lines: [...side.lines] })),
  });
  shownAddress.value = address;
  weMovedTheAddress = true;
  // The same tab at a new address, said before the address becomes it: without this
  // the landing takes a swap for the reader walking somewhere, and the cross in this
  // screen's own bar stops closing the tab.
  tabsStore.retarget(ownTabId.value, address);
  void router.replace(address);
};

const save = async (index) => {
  const side = sides.value[index];
  if (!side || side.readOnly || !side.dirty || side.saving) return;
  side.saving = true;
  try {
    await saveFileContent(side.path, writeLines(side.lines, side.newline));
    side.dirty = false;
    notifications.addNotification({
      type: 'success',
      heading: t('compare.saved', { name: side.name }),
    });
  } catch (error) {
    notifications.addNotification({
      type: 'error',
      heading: t('compare.saveFailed', { name: side.name }),
      body: error?.message || '',
    });
  } finally {
    side.saving = false;
  }
};

const anythingUnsaved = computed(() => sides.value.some((side) => side.dirty));

/**
 * Leaving with a side taken across and not saved.
 *
 * Said out loud, because there is no submit button to forget to press: lines taken
 * across exist nowhere but this window until they are saved.
 *
 * Not for another tab coming forward, though — that is not leaving. The comparison is
 * handed to the tab and comes back with it, lines and place and all, so asking there
 * would be asking about something that is not going to happen. It asked, the answer
 * was no, and the reader could not leave their own comparison.
 */
onBeforeRouteLeave(async () => {
  if (!anythingUnsaved.value) return true;
  if (tabsStore.activeId !== ownTabId.value) return true;
  return ask({
    title: t('compare.unsavedTitle'),
    body: t('compare.leaveUnsaved'),
    confirmLabel: t('common.leaveAnyway'),
    tone: 'danger',
  });
});

/**
 * And closing the tab, which is the one gesture that really loses them.
 *
 * Coming back to a tab is not losing anything — the comparison is handed to the tab
 * and comes back with it — but closing the tab ends that, and the lines exist nowhere
 * else. The question is left for this tab and taken back on the way out, because a
 * page the router unmounts whenever another tab comes forward cannot be there to
 * answer for itself.
 */
const guards = useTabGuardsStore();
let releaseGuard = () => {};

watch(
  [ownTabId, anythingUnsaved],
  ([id, unsaved]) => {
    releaseGuard();
    releaseGuard = unsaved
      ? guards.guard(id, () =>
          ask({
            title: t('compare.unsavedTitle'),
            body: t('compare.closeUnsaved'),
            confirmLabel: t('common.closeAnyway'),
            tone: 'danger',
          })
        )
      : () => {};
  },
  { immediate: true }
);

onBeforeUnmount(() => releaseGuard());

/**
 * The window itself going away, which no router hook sees.
 *
 * The browser asks its own question in its own words; all a page can do is say that
 * there is one to ask.
 */
const askBeforeUnload = (event) => {
  if (!anythingUnsaved.value) return;
  event.preventDefault();
  event.returnValue = '';
};

window.addEventListener('beforeunload', askBeforeUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', askBeforeUnload));

watch(rows, (all) => {
  if (all.length > LONG_ENOUGH_TO_FOLD && blocks.value.length > 0) onlyDifferences.value = true;
});

const shown = computed(() => {
  const all = rows.value;
  if (!onlyDifferences.value || blocks.value.length === 0) {
    return all.map((row, index) => ({ row, index }));
  }

  const keep = new Set();
  for (const block of blocks.value) {
    for (let index = block.from - CONTEXT_LINES; index <= block.to + CONTEXT_LINES; index += 1) {
      if (index >= 0 && index < all.length) keep.add(index);
    }
  }

  const list = [];
  let hidden = 0;
  all.forEach((row, index) => {
    if (keep.has(index)) {
      if (hidden > 0) {
        list.push({ gap: hidden, index: `gap-${index}` });
        hidden = 0;
      }
      list.push({ row, index });
      return;
    }
    hidden += 1;
  });
  if (hidden > 0) list.push({ gap: hidden, index: 'gap-end' });

  return list;
});

/**
 * How many lines folding would put away.
 *
 * Said out loud because a checkbox that can do nothing looks like a checkbox that
 * does nothing: on a short file with differences all through it there is nothing more
 * than three lines from a change, so folding hides none of it and the reader is left
 * wondering what they turned on.
 */
const foldable = computed(() => {
  const all = rows.value;
  if (blocks.value.length === 0) return 0;
  const keep = new Set();
  for (const block of blocks.value) {
    for (let index = block.from - CONTEXT_LINES; index <= block.to + CONTEXT_LINES; index += 1) {
      if (index >= 0 && index < all.length) keep.add(index);
    }
  }
  return all.length - keep.size;
});

/** Which block a row belongs to, so the one being read can be marked. */
const blockAt = (index) =>
  blocks.value.findIndex((block) => index >= block.from && index <= block.to);
const isCurrent = (index) => at.value >= 0 && blockAt(index) === at.value;

const cellFor = (row, index) => {
  const line = row[keyAt(index)];
  if (line === null || line === undefined) return null;
  return { number: line + 1, text: sides.value[index].lines[line] ?? '' };
};

/**
 * The part of a changed line that differs, in three pieces.
 *
 * Only where there are two lines to compare and only for the pair the reader is
 * looking at from: on a line of two hundred characters a mark on the whole line is not an
 * answer, and one character in a long path is exactly the case this is for.
 */
const pieces = (row, index) => {
  const cell = cellFor(row, index);
  if (!cell) return null;
  if (row.kind === 'same' || sides.value.length !== 2) return null;
  const other = cellFor(row, index === 0 ? 1 : 0);
  if (!other) return null;
  const spans = inlineSpans(
    index === 0 ? cell.text : other.text,
    index === 0 ? other.text : cell.text
  );
  if (!spans) return null;
  const span = index === 0 ? spans.left : spans.right;
  return [
    cell.text.slice(0, span.from),
    cell.text.slice(span.from, span.to),
    cell.text.slice(span.to),
  ];
};

/**
 * A line, in the pieces it is drawn from.
 *
 * One function rather than two, because two would have to agree about which of them
 * wins where a search match sits inside a changed part. The search wins: somebody
 * looking for a word is looking for *that*, and the difference is still marked on the
 * row and in the gutter.
 */
const segments = (row, sideIndex, rowIndex) => {
  const cell = cellFor(row, sideIndex);
  if (!cell) return [];
  const text = cell.text;

  if (searching.value && query.value && inScope(sideIndex)) {
    const spans = occurrences(text, query.value);
    if (spans.length) {
      const current = matches.value[atMatch.value];
      const parts = [];
      let from = 0;
      for (const span of spans) {
        if (span.from > from) parts.push({ text: text.slice(from, span.from), kind: '' });
        const isCurrent =
          current &&
          current.rowIndex === rowIndex &&
          current.sideIndex === sideIndex &&
          current.from === span.from;
        parts.push({ text: text.slice(span.from, span.to), kind: isCurrent ? 'current' : 'match' });
        from = span.to;
      }
      if (from < text.length) parts.push({ text: text.slice(from), kind: '' });
      return parts;
    }
  }

  const marked = pieces(row, sideIndex);
  if (!marked) return [{ text, kind: '' }];
  return [
    { text: marked[0], kind: '' },
    { text: marked[1], kind: 'diff' },
    { text: marked[2], kind: '' },
  ];
};

const segmentClass = (kind) => {
  if (kind === 'current') return 'rounded bg-orange-400 text-black';
  if (kind === 'match')
    return 'rounded bg-yellow-200 text-black dark:bg-yellow-500/50 dark:text-white';
  if (kind === 'diff') return 'rounded bg-amber-300/60 dark:bg-amber-400/40';
  return '';
};

const rowClass = (row) => {
  if (row.kind === 'same') return '';
  return 'bg-amber-50/70 dark:bg-amber-500/10';
};

/**
 * What one cell of one line is, in a word — and the only place that decides it.
 *
 * The map and the panes were each deciding for themselves and disagreeing, which is
 * the worst thing a colour can do. The panes read a line at a time; the map read a
 * whole difference at a time and asked "does either side have anything here" — so a
 * rewrite of three hundred lines, which is one difference with a line on the left and
 * three hundred on the right, came out amber in the map while the panes showed it
 * green. Both were defensible and together they were unreadable.
 *
 * So there is one answer to the question and two renderings of it. `none` is the one
 * worth naming: it is not a pale version of a difference, it is the absence of a line,
 * and it has to read as a hole rather than as something faint.
 */
const tintFor = (row, index) => {
  const cell = cellFor(row, index);
  if (!cell) return 'none';
  if (row.kind === 'same') return 'plain';
  if (sides.value.length === 3) {
    // Three files are read against the middle one: a side that agrees with it has
    // nothing to say, which is the whole point of putting the common version between
    // the two that changed it.
    const middle = cellFor(row, 1);
    if (index === 1 || !middle) return 'plain';
    return cell.text === middle.text ? 'plain' : 'both';
  }
  if (row.kind === 'removed') return 'gone';
  if (row.kind === 'added') return 'new';
  return 'both';
};

/** The same five answers, as a line of text on the page. */
const CELL_TINTS = {
  none: 'bg-neutral-200/80 dark:bg-black/25',
  plain: '',
  gone: 'bg-rose-100/70 dark:bg-rose-500/15',
  new: 'bg-emerald-100/70 dark:bg-emerald-500/15',
  both: 'bg-amber-100/70 dark:bg-amber-400/15',
};

const cellClass = (row, index) => CELL_TINTS[tintFor(row, index)];

/**
 * Where the reader is in the file, and where the differences are.
 *
 * Two questions, and they were both being answered by one thin lane laid over the
 * right-hand edge of the scrolling box — which is where a scrollbar is drawn, so it
 * covered it. Uncovering it was not enough: this platform draws scrollbars *over* the
 * content and fades them out when nothing is moving, measured and not guessed, so there
 * was still nothing to see while reading. A scrollbar nobody can see is not a scrollbar.
 *
 * So the comparison draws its own, and the platform's is hidden — one bar, on every
 * platform, there the whole time. It is a real one: the thumb is grabbed where it is
 * grabbed and follows the pointer from that point, and the track jumps.
 *
 * The map of the differences is the other question and gets its own lane beside it,
 * out of the way until it is wanted: it appears when the pointer comes near the right
 * edge, and stays for good when it is pinned. Over the text rather than beside it, so
 * nothing reflows when it arrives.
 */
const scroller = ref(null);
const mapLane = ref(null);
const barTrack = ref(null);
/** Both as fractions of the whole file, so a lane can be any height. */
const view = ref({ top: 0, height: 1, progress: 0 });

const measureView = () => {
  const box = scroller.value;
  if (!box) return;
  const whole = box.scrollHeight || 1;
  const runway = box.scrollHeight - box.clientHeight;
  view.value = {
    // Where in the file, for the map, which draws the whole file.
    top: box.scrollTop / whole,
    height: Math.min(1, box.clientHeight / whole),
    // How far along, for the bar, whose thumb runs the track rather than the file.
    progress: runway > 0 ? box.scrollTop / runway : 0,
  };
};

/** Redrawn when what is in the box changes, not only when it is scrolled. */
watch([shown, wrap], () => nextTick(measureView));

let watchingSize = null;
onMounted(() => {
  measureView();
  if (typeof ResizeObserver === 'undefined') return;
  watchingSize = new ResizeObserver(measureView);
  if (scroller.value) watchingSize.observe(scroller.value);
});
onBeforeUnmount(() => watchingSize?.disconnect());

/**
 * How near the right-hand edge the pointer has to come for the map to appear, and how
 * far it has to go for the map to leave.
 *
 * Two distances rather than one, because one made a line the pointer could sit on: at
 * the boundary the map appeared, which moved nothing, and the next stray pixel put it
 * away again. A band between them is the ordinary cure, and it costs nothing.
 */
const REVEAL_WITHIN = 40;
const HIDE_BEYOND = 72;
const mapNear = ref(false);
const mapShown = computed(() => blocks.value.length > 0 && (mapPinned.value || mapNear.value));

/**
 * Watched on the box that holds both, not on the text alone.
 *
 * On the text alone it could not work, and did not: the map is over the text, so the
 * pointer moving onto it *left* the text — the map was taken off screen, which put the
 * pointer back over the text, which brought the map back. It flickered, and there was
 * no way to press a mark on it. Listening where both live, moving onto the map is not
 * leaving anything, and the pointer is then nearer the edge than ever.
 *
 * Read from where the pointer is rather than from a strip laid over the text: a
 * transparent strip would be the thing under the pointer at the right-hand edge, and a
 * selection dragged down that edge would end on it instead of on the line.
 */
const onEdgePointerMove = (event) => {
  const box = scroller.value;
  if (!box) return;
  const from = box.getBoundingClientRect().right - event.clientX;
  if (from <= REVEAL_WITHIN) mapNear.value = true;
  else if (from > HIDE_BEYOND) mapNear.value = false;
};

/**
 * The map, as bands of colour — one per run of lines that say the same thing.
 *
 * Not one per difference, which is what it was and what made it disagree with the
 * panes: a difference is a run of lines that differ *somehow*, and a three hundred line
 * rewrite is one of them. Asked of the whole run, "does either side have anything here"
 * answers yes for both sides, and the map painted amber over what the panes were showing
 * green. A reader comparing the two had no way to tell which was lying.
 *
 * So the map is built from the lines, like the panes, and a band is as long as the
 * answer stays the same. Each band still belongs to a difference, which is where a press
 * on it goes: the colour is line by line, the navigation is difference by difference,
 * and neither has to pretend to be the other.
 */
const mapBands = computed(() => {
  const all = rows.value;
  const runs = [];
  let run = null;
  let block = -1;
  let wasSame = true;

  all.forEach((row, index) => {
    if (row.kind === 'same') {
      run = null;
      wasSame = true;
      return;
    }
    // A new difference begins wherever a run of differing lines begins.
    if (wasSame) block += 1;
    wasSame = false;

    const tints = keys.value.map((_, side) => tintFor(row, side));
    const signature = tints.join('|');
    if (run && run.signature === signature && run.to === index - 1) {
      run.to = index;
      return;
    }
    run = { from: index, to: index, signature, tints, block };
    runs.push(run);
  });

  return runs;
});

/** The same five answers, as a band in the map. */
const MAP_TINTS = {
  none: 'bg-neutral-300/60 dark:bg-neutral-700/60',
  plain: 'bg-neutral-300/60 dark:bg-neutral-700/60',
  gone: 'bg-rose-500',
  new: 'bg-emerald-500',
  both: 'bg-amber-400',
};

const tintClass = (tint) => MAP_TINTS[tint];

/** Where a band sits down the whole file, and how much of it there is to see. */
const bandStyle = (band) => ({
  top: `${(band.from / Math.max(1, rows.value.length)) * 100}%`,
  height: `${Math.max(0.8, ((band.to - band.from + 1) / Math.max(1, rows.value.length)) * 100)}%`,
});

/** The file put where a lane was pressed, with that point in the middle of the view. */
const scrollToPointer = (event, lane) => {
  const box = scroller.value;
  if (!box || !lane) return;
  const rect = lane.getBoundingClientRect();
  const fraction = (event.clientY - rect.top) / Math.max(1, rect.height);
  const wanted = fraction * box.scrollHeight - box.clientHeight / 2;
  box.scrollTop = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, wanted));
  measureView();
};

let draggingMap = false;

const onMapDown = (event) => {
  // A mark is a difference to go to, not a place in the file: it has its own answer.
  if (event.target?.closest?.('[data-test^="compare-map-mark"]')) return;
  draggingMap = true;
  mapLane.value?.setPointerCapture?.(event.pointerId);
  scrollToPointer(event, mapLane.value);
};

const onMapMove = (event) => {
  if (draggingMap) scrollToPointer(event, mapLane.value);
};

const onMapUp = (event) => {
  draggingMap = false;
  mapLane.value?.releasePointerCapture?.(event.pointerId);
};

/**
 * The bar the application draws for itself.
 *
 * Grabbed where it is grabbed: a thumb that jumped its middle under the pointer on
 * every press is the thing that makes a scrollbar feel like somebody else's. Pressing
 * the track away from the thumb does jump, because that is what a track is for.
 */
const MIN_THUMB = 0.06;
/**
 * The thumb runs the track, not the file: at the end of a long file it has to sit
 * against the bottom of the track, and a thumb placed by where the *file* is would stop
 * short of it by its own height. A floor under the height, so it stays grabbable on a
 * file of five thousand lines.
 */
const thumbStyle = computed(() => {
  const height = Math.max(MIN_THUMB, view.value.height);
  return {
    top: `${view.value.progress * (1 - height) * 100}%`,
    height: `${height * 100}%`,
  };
});

let draggingBar = null;

const scrollByThumb = (event) => {
  const box = scroller.value;
  const track = barTrack.value;
  if (!box || !track || !draggingBar) return;
  const rect = track.getBoundingClientRect();
  const runway = Math.max(1, rect.height * (1 - Math.max(MIN_THUMB, view.value.height)));
  const at = event.clientY - rect.top - draggingBar.grab;
  const fraction = Math.max(0, Math.min(1, at / runway));
  box.scrollTop = fraction * Math.max(0, box.scrollHeight - box.clientHeight);
  measureView();
};

const onBarDown = (event) => {
  const track = barTrack.value;
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const height = Math.max(MIN_THUMB, view.value.height) * rect.height;
  const thumbTop = rect.top + (parseFloat(thumbStyle.value.top) / 100) * rect.height;
  const within = event.clientY - thumbTop;
  // On the track rather than the thumb: go there, then carry on from its middle.
  draggingBar = { grab: within >= 0 && within <= height ? within : height / 2 };
  if (within < 0 || within > height) scrollByThumb(event);
  track.setPointerCapture?.(event.pointerId);
};

const onBarMove = (event) => {
  if (draggingBar) scrollByThumb(event);
};

const onBarUp = (event) => {
  draggingBar = null;
  barTrack.value?.releasePointerCapture?.(event.pointerId);
};

/**
 * Editing a side, not just correcting a word in it.
 *
 * Taking a whole difference across is the common gesture and the reason this screen
 * exists, but not every fix is one side or the other: sometimes the answer is neither,
 * and walking to the text editor and back is a walk nobody should have to make. So a
 * side that can be written to is edited here — and edited the way an editor is, which
 * means lines can be added and removed and not merely retyped. A screen where a line
 * could be changed but not split was a screen that looked broken, and was.
 *
 * One line under the caret at a time rather than a text area over the whole file,
 * because the alignment *is* the screen: the rows are worked out from the lines, so
 * they are redrawn as soon as a line is added or removed, and a text area would be
 * pulling its own ground out from under itself on every keystroke. The line is the
 * unit the alignment is made of, so it is the unit the editing is made of too.
 *
 * Everything an editor does to the number of lines has its usual key, because these
 * are the keys hands already know: Enter breaks the line at the caret, backspace at
 * the start of a line joins it to the one above, delete at the end pulls the next one
 * up, the arrows walk from line to line without letting go, and a paste of several
 * lines becomes several lines.
 */
const editing = ref(null);
const draft = ref('');
/** Where the caret goes once the field for the line being edited is on screen. */
let wantedCaret = null;

/**
 * Hands the field to the reader.
 *
 * A double-click used to leave a field nobody was typing in: the click that opened it
 * landed on the text it replaced, so the field arrived unfocused and the next keystroke
 * went nowhere. It is also where the caret is placed, which is what makes the line
 * operations feel like an editor rather than a form — a break leaves the caret at the
 * start of the new line, a join leaves it where the two lines met.
 *
 * Deliberately not an inline arrow in the template: Vue calls a fresh ref function on
 * every patch, so an inline one would refocus and pull the caret back to the same spot
 * on every keystroke.
 */
const bindEditor = (element) => {
  if (!element) return;
  element.focus();
  const where =
    wantedCaret === null
      ? element.value.length
      : Math.max(0, Math.min(element.value.length, wantedCaret));
  element.setSelectionRange(where, where);
  wantedCaret = null;
};

/** The lines of a side, replaced — and the side is then worth saving. */
const putLines = (sideIndex, lines) => {
  const side = sides.value[sideIndex];
  if (!side || side.readOnly) return false;
  side.lines = lines;
  side.dirty = true;
  return true;
};

const startEditing = (sideIndex, lineIndex, caret = null) => {
  const side = sides.value[sideIndex];
  if (!side || side.readOnly || lineIndex === null || lineIndex === undefined) return;
  if (lineIndex < 0 || lineIndex >= side.lines.length) return;
  editing.value = { sideIndex, lineIndex };
  draft.value = side.lines[lineIndex] ?? '';
  wantedCaret = caret;
};

/**
 * What the field holds, written to the line it belongs to.
 *
 * Told which line rather than reading it from `editing`, because a field is blurred by
 * the field that replaces it: every operation that moves the caret to another line has
 * already pointed `editing` there by the time the old field's blur arrives, and a
 * commit that trusted `editing` would write one line's text into another.
 */
const writeDraft = (sideIndex, lineIndex) => {
  const side = sides.value[sideIndex];
  if (!side || side.readOnly) return;
  if ((side.lines[lineIndex] ?? '') === draft.value) return;
  putLines(sideIndex, [
    ...side.lines.slice(0, lineIndex),
    draft.value,
    ...side.lines.slice(lineIndex + 1),
  ]);
};

const commitEdit = () => {
  const where = editing.value;
  editing.value = null;
  if (!where) return;
  writeDraft(where.sideIndex, where.lineIndex);
};

/**
 * Clicked away from — as opposed to replaced by the field on another line.
 *
 * The field carries which line it is for, so a blur from a field the editing has
 * already left is the tail of an operation that wrote that line itself, and there is
 * nothing here to do but let it go.
 */
const onEditorBlur = (event) => {
  const where = editing.value;
  const field = event?.target;
  if (!where || !field) return;
  if (Number(field.dataset?.side) !== where.sideIndex) return;
  if (Number(field.dataset?.line) !== where.lineIndex) return;
  commitEdit();
};

const cancelEdit = () => {
  editing.value = null;
};

const isEditing = (sideIndex, lineIndex) =>
  editing.value?.sideIndex === sideIndex && editing.value?.lineIndex === lineIndex;

/** Where the caret sits in the field, and whether it is sitting rather than selecting. */
const caretIn = (field) => {
  const start = field?.selectionStart;
  const end = field?.selectionEnd;
  if (typeof start !== 'number' || start !== end) return null;
  return start;
};

/**
 * Enter: the line broken in two at the caret.
 *
 * Which is also how a line is added — at the end of a line it leaves an empty one
 * below, at the start an empty one above — so there is one gesture to learn instead of
 * a button for each direction.
 */
const splitLine = (event) => {
  const where = editing.value;
  if (!where) return;
  const side = sides.value[where.sideIndex];
  if (!side || side.readOnly) return;
  const caret = caretIn(event?.target) ?? draft.value.length;
  const head = draft.value.slice(0, caret);
  const tail = draft.value.slice(caret);
  if (
    !putLines(where.sideIndex, [
      ...side.lines.slice(0, where.lineIndex),
      head,
      tail,
      ...side.lines.slice(where.lineIndex + 1),
    ])
  )
    return;
  startEditing(where.sideIndex, where.lineIndex + 1, 0);
};

/** Backspace at the start of a line: joined to the one above, which removes a line. */
const joinWithPrevious = (event) => {
  const where = editing.value;
  if (!where || where.lineIndex === 0) return false;
  if (caretIn(event?.target) !== 0) return false;
  const side = sides.value[where.sideIndex];
  if (!side || side.readOnly) return false;
  const above = side.lines[where.lineIndex - 1] ?? '';
  if (
    !putLines(where.sideIndex, [
      ...side.lines.slice(0, where.lineIndex - 1),
      above + draft.value,
      ...side.lines.slice(where.lineIndex + 1),
    ])
  )
    return false;
  startEditing(where.sideIndex, where.lineIndex - 1, above.length);
  return true;
};

/** Delete at the end of a line: the next one pulled up into it. */
const joinWithNext = (event) => {
  const where = editing.value;
  if (!where) return false;
  if (caretIn(event?.target) !== draft.value.length) return false;
  const side = sides.value[where.sideIndex];
  if (!side || side.readOnly || where.lineIndex >= side.lines.length - 1) return false;
  const below = side.lines[where.lineIndex + 1] ?? '';
  const caret = draft.value.length;
  if (
    !putLines(where.sideIndex, [
      ...side.lines.slice(0, where.lineIndex),
      draft.value + below,
      ...side.lines.slice(where.lineIndex + 2),
    ])
  )
    return false;
  startEditing(where.sideIndex, where.lineIndex, caret);
  return true;
};

/**
 * The arrows: on to the next line without letting go of the keyboard.
 *
 * Without this, editing a run of lines means a double-click for each of them, which
 * is the difference between an editor and a form with one field in it. What was typed
 * is written on the way past — leaving it for the blur would be leaving it to arrive
 * after the editing had already moved.
 */
const stepLine = (event, by) => {
  const where = editing.value;
  if (!where) return;
  const side = sides.value[where.sideIndex];
  if (!side) return;
  const wanted = where.lineIndex + by;
  if (wanted < 0 || wanted >= side.lines.length) return;
  const column = event?.target?.selectionStart ?? draft.value.length;
  writeDraft(where.sideIndex, where.lineIndex);
  startEditing(where.sideIndex, wanted, column);
};

/** A line put in below this one, ready to be typed into. */
const insertLine = (sideIndex, lineIndex) => {
  const side = sides.value[sideIndex];
  if (!side || side.readOnly || lineIndex === null || lineIndex === undefined) return;
  const where = Math.max(0, Math.min(side.lines.length, lineIndex + 1));
  if (!putLines(sideIndex, [...side.lines.slice(0, where), '', ...side.lines.slice(where)])) return;
  startEditing(sideIndex, where, 0);
};

/**
 * This line, gone.
 *
 * The last line of a file is emptied rather than removed: a file of no lines at all is
 * not a thing the rest of this screen — or `writeLines` — has any meaning for.
 */
const deleteLine = (sideIndex, lineIndex) => {
  const side = sides.value[sideIndex];
  if (!side || side.readOnly || lineIndex === null || lineIndex === undefined) return;
  editing.value = null;
  if (side.lines.length <= 1) {
    putLines(sideIndex, ['']);
    return;
  }
  putLines(sideIndex, [...side.lines.slice(0, lineIndex), ...side.lines.slice(lineIndex + 1)]);
};

/**
 * One keystroke, read by name.
 *
 * Written out rather than as a modifier on each handler because Vue's `.delete`
 * answers to Backspace as well as Delete: the two joins would both have run on one
 * backspace, and a line would have gone in each direction.
 */
const onEditorKey = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    splitLine(event);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelEdit();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    stepLine(event, -1);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    stepLine(event, 1);
    return;
  }
  // These two only when there is nothing left of the caret to delete, so the key does
  // what it always does first and joins lines only at the edges of one.
  if (event.key === 'Backspace' && joinWithPrevious(event)) event.preventDefault();
  else if (event.key === 'Delete' && joinWithNext(event)) event.preventDefault();
};

/**
 * Several lines pasted in become several lines.
 *
 * A field holds one line, so the newlines would be dropped in silence — the one way a
 * paste can go wrong that nobody notices until they look at the file afterwards. A
 * paste with no newline in it is left to the field, which already does it right.
 */
const onEditorPaste = (event) => {
  const where = editing.value;
  if (!where) return;
  const text = event?.clipboardData?.getData?.('text') ?? '';
  if (!/[\r\n]/.test(text)) return;
  event.preventDefault();
  const side = sides.value[where.sideIndex];
  if (!side || side.readOnly) return;
  const field = event.target;
  const from = field?.selectionStart ?? draft.value.length;
  const to = field?.selectionEnd ?? from;
  const pasted = text.split(/\r\n|\r|\n/);
  const last = pasted.length - 1;
  pasted[0] = draft.value.slice(0, from) + pasted[0];
  const caret = pasted[last].length;
  pasted[last] += draft.value.slice(to);
  if (
    !putLines(where.sideIndex, [
      ...side.lines.slice(0, where.lineIndex),
      ...pasted,
      ...side.lines.slice(where.lineIndex + 1),
    ])
  )
    return;
  startEditing(where.sideIndex, where.lineIndex + last, caret);
};

/**
 * Looking for something, and putting something else in its place.
 *
 * A comparison is read for a reason, and the reason is usually a name: which of these
 * two files still says the old server, and what does the other one say instead. So the
 * search is not a convenience bolted on — it is how somebody gets to the line they
 * came for, and the replacement is how they leave.
 *
 * Scoped, because that is the question people actually ask: in this file, in that one,
 * or in all of them. Replacing everywhere by default would be the kind of help nobody
 * asked for.
 */
const searching = ref(false);
const query = ref('');
const replacement = ref('');
const matchCase = ref(false);
/** -1 is every side; otherwise the one side being searched. */
const scope = ref(-1);
const atMatch = ref(-1);

const inScope = (index) => scope.value < 0 || scope.value === index;

const occurrences = (text, wanted) => {
  const found = [];
  if (!wanted) return found;
  const haystack = matchCase.value ? text : text.toLowerCase();
  const needle = matchCase.value ? wanted : wanted.toLowerCase();
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return found;
    found.push({ from: index, to: index + needle.length });
    from = index + Math.max(1, needle.length);
  }
};

/**
 * Every match, in the order they are read: down the rows, and left to right within a
 * row. Which is the order somebody stepping through them expects, and the order a
 * replacement has to happen in for the positions not to move under it.
 */
const matches = computed(() => {
  if (!searching.value || !query.value) return [];
  const found = [];
  rows.value.forEach((row, rowIndex) => {
    sides.value.forEach((side, sideIndex) => {
      if (!inScope(sideIndex)) return;
      const line = row[keyAt(sideIndex)];
      if (line === null || line === undefined) return;
      for (const span of occurrences(side.lines[line] ?? '', query.value)) {
        found.push({ rowIndex, sideIndex, line, ...span });
      }
    });
  });
  return found;
});

const goToMatch = async (index) => {
  const total = matches.value.length;
  if (total === 0) {
    atMatch.value = -1;
    return;
  }
  const wanted = ((index % total) + total) % total;
  atMatch.value = wanted;
  await nextTick();
  rowRefs.value[matches.value[wanted].rowIndex]?.scrollIntoView?.({
    block: 'center',
    behavior: 'smooth',
  });
};

const nextMatch = () => goToMatch(atMatch.value + 1);
const previousMatch = () =>
  goToMatch(atMatch.value <= 0 ? matches.value.length - 1 : atMatch.value - 1);

const toggleSearch = () => {
  searching.value = !searching.value;
  if (!searching.value) {
    atMatch.value = -1;
    return;
  }
  // Nothing is hidden while somebody is looking: a match folded away is a match they
  // would swear was not there.
  onlyDifferences.value = false;
};

watch([query, matchCase, scope], () => {
  atMatch.value = -1;
});

const replaceOne = () => {
  const match = matches.value[atMatch.value];
  if (!match) return;
  const side = sides.value[match.sideIndex];
  if (!side || side.readOnly) return;
  const text = side.lines[match.line] ?? '';
  side.lines = [
    ...side.lines.slice(0, match.line),
    text.slice(0, match.from) + replacement.value + text.slice(match.to),
    ...side.lines.slice(match.line + 1),
  ];
  side.dirty = true;
  // The one that took its place is behind us; the next one is where this one was.
  void goToMatch(atMatch.value);
};

/**
 * Every match in scope, at once.
 *
 * Line by line and right to left within a line, so that replacing one does not move
 * the ones not yet replaced — the classic way to lose the last match on a line.
 */
const replaceAll = () => {
  if (!query.value) return;
  let count = 0;
  sides.value.forEach((side, sideIndex) => {
    if (!inScope(sideIndex) || side.readOnly) return;
    const next = side.lines.map((text) => {
      const spans = occurrences(text, query.value);
      if (spans.length === 0) return text;
      count += spans.length;
      return spans
        .slice()
        .reverse()
        .reduce(
          (line, span) => line.slice(0, span.from) + replacement.value + line.slice(span.to),
          text
        );
    });
    if (count > 0) {
      side.lines = next;
      side.dirty = true;
    }
  });
  atMatch.value = -1;
  if (count > 0) {
    notifications.addNotification({
      type: 'success',
      heading: t('compare.replaced', { count }),
    });
  }
};

/**
 * The keys a comparison has always had.
 *
 * F8 and F7 walk the differences, which is what WinMerge has done for twenty years
 * and what anybody arriving here will try first; alt with the arrows does the same
 * for a keyboard without function keys, and on a Mac where F-keys do other things by
 * default. Command or control with S saves the side that has been changed — the only
 * one, when only one has.
 */
const onKey = (event) => {
  if (event.defaultPrevented) return;
  const going =
    event.key === 'F8' || (event.altKey && event.key === 'ArrowDown')
      ? 1
      : event.key === 'F7' || (event.altKey && event.key === 'ArrowUp')
        ? -1
        : 0;
  if (going) {
    event.preventDefault();
    if (going > 0) void next();
    else void previous();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S')) {
    const dirty = sides.value.findIndex((side) => side.dirty);
    if (dirty < 0) return;
    event.preventDefault();
    void save(dirty);
  }
};

window.addEventListener('keydown', onKey);
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

const close = async () => {
  if (await tabNavigation.closeOwn()) return;
  void router.push('/browse/');
};
</script>

<template>
  <div class="flex h-full w-full flex-col bg-white dark:bg-default" data-test="compare">
    <!--
      One line, and it stays one line.

      Everything here used to be spelled out — the count, the position, and a save
      button naming its file — and on a screen narrower than those words it wrapped,
      which made the bar two rows tall and pushed the comparison down. What a toolbar
      owes is to be readable at a glance and to stay out of the way; the words live in
      the titles now, where they are read by whoever asks.
    -->
    <header
      class="flex items-center gap-2 overflow-hidden border-b border-neutral-200 px-3 py-1.5 dark:border-neutral-800"
    >
      <h1
        class="min-w-0 flex-1 truncate text-sm text-neutral-900 dark:text-white"
        :title="sides.map((side) => side.path).join('  ↔  ')"
        data-test="compare-names"
      >
        {{ sides.map((side) => side.name).join(' ↔ ') }}
      </h1>

      <span
        v-if="identical"
        class="shrink-0 whitespace-nowrap rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        data-test="compare-identical"
      >
        {{ t('compare.identical') }}
      </span>
      <span
        v-else-if="blocks.length"
        class="shrink-0 whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400"
        data-test="compare-count"
        :title="t('compare.differences', { count: blocks.length })"
      >
        <span v-if="at >= 0" class="text-neutral-700 dark:text-neutral-200">{{ at + 1 }}</span
        ><span v-if="at >= 0">/</span>{{ blocks.length }}
      </span>

      <div class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/10"
          :disabled="!blocks.length"
          :title="t('compare.previous')"
          :aria-label="t('compare.previous')"
          data-test="compare-previous"
          @click="previous"
        >
          <ArrowUpIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/10"
          :disabled="!blocks.length"
          :title="t('compare.next')"
          :aria-label="t('compare.next')"
          data-test="compare-next"
          @click="next"
        >
          <ArrowDownIcon class="h-4 w-4" />
        </button>

        <span class="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700"></span>

        <!-- Taking one side's version over the other's, and putting the two of them
             the other way round. Between neighbours only: with three files, left and
             right are not next to each other, and a copy between them would skip the
             very version the middle is there to be compared against. -->
        <template v-for="(side, index) in sides.slice(0, -1)" :key="`pair-${index}`">
          <button
            type="button"
            class="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/10"
            :disabled="at < 0 || sides[index + 1].readOnly"
            :title="t('compare.copyForward', { from: side.name, to: sides[index + 1].name })"
            :aria-label="t('compare.copyForward', { from: side.name, to: sides[index + 1].name })"
            :data-test="`compare-copy-forward-${index}`"
            @click="copyBlock(index, index + 1)"
          >
            <ArrowRightIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/10"
            :disabled="at < 0 || side.readOnly"
            :title="t('compare.copyBack', { from: sides[index + 1].name, to: side.name })"
            :aria-label="t('compare.copyBack', { from: sides[index + 1].name, to: side.name })"
            :data-test="`compare-copy-back-${index}`"
            @click="copyBlock(index + 1, index)"
          >
            <ArrowLeftIcon class="h-4 w-4" />
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10"
            :title="t('compare.swap', { left: side.name, right: sides[index + 1].name })"
            :aria-label="t('compare.swap', { left: side.name, right: sides[index + 1].name })"
            :data-test="`compare-swap-${index}`"
            @click="swapSides(index)"
          >
            <ArrowsRightLeftIcon class="h-4 w-4" />
          </button>
        </template>

        <span class="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700"></span>

        <button
          type="button"
          class="rounded-md p-1.5 transition hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-white/10"
          :class="
            searching
              ? 'bg-neutral-100 text-accent dark:bg-white/10'
              : 'text-neutral-600 dark:text-neutral-300'
          "
          :aria-pressed="searching"
          :title="t('compare.search')"
          :aria-label="t('compare.search')"
          data-test="compare-search-toggle"
          @click="toggleSearch"
        >
          <MagnifyingGlassIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="rounded-md p-1.5 transition hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-white/10"
          :class="
            onlyDifferences
              ? 'bg-neutral-100 text-accent dark:bg-white/10'
              : 'text-neutral-600 dark:text-neutral-300'
          "
          :aria-pressed="onlyDifferences"
          :disabled="foldable === 0"
          :title="
            foldable === 0
              ? t('compare.nothingToFold')
              : t('compare.onlyDifferencesOf', { count: foldable })
          "
          :aria-label="t('compare.onlyDifferences')"
          data-test="compare-fold"
          @click="onlyDifferences = !onlyDifferences"
        >
          <ArrowsPointingInIcon class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="rounded-md p-1.5 transition hover:bg-neutral-100 dark:hover:bg-white/10"
          :class="
            wrap
              ? 'bg-neutral-100 text-accent dark:bg-white/10'
              : 'text-neutral-600 dark:text-neutral-300'
          "
          :aria-pressed="wrap"
          :title="t('compare.wrap')"
          :aria-label="t('compare.wrap')"
          data-test="compare-wrap"
          @click="wrap = !wrap"
        >
          <Bars3BottomLeftIcon class="h-4 w-4" />
        </button>
        <!-- The map of the differences comes out when the pointer nears the right-hand
             edge; this is how it stays. Here rather than on the lane itself, where it
             would sit on top of whatever difference is at the top of the file — and
             where nobody would find it, since the lane is not on screen to be looked
             at until it is already out. -->
        <button
          v-if="blocks.length"
          type="button"
          class="rounded-md p-1.5 transition hover:bg-neutral-100 dark:hover:bg-white/10"
          :class="
            mapPinned
              ? 'bg-neutral-100 text-accent dark:bg-white/10'
              : 'text-neutral-600 dark:text-neutral-300'
          "
          :aria-pressed="mapPinned"
          :title="t('compare.pinMap')"
          :aria-label="t('compare.pinMap')"
          data-test="compare-map-pin"
          @click="mapPinned = !mapPinned"
        >
          <MapPinIcon class="h-4 w-4" />
        </button>

        <!-- Only when there is something to save: a row of greyed buttons naming
             files is what made this bar wrap in the first place. -->
        <template
          v-for="(side, index) in sides"
          :key="`save-${side.path}-${side.versionId || 'now'}`"
        >
          <button
            v-if="side.dirty && !side.readOnly"
            type="button"
            class="ml-1 max-w-40 truncate rounded-md bg-accent/10 px-2 py-1 text-xs text-accent transition hover:bg-accent/20 disabled:opacity-40"
            :disabled="side.saving"
            :title="t('compare.save', { name: side.name })"
            :data-test="`compare-save-${index}`"
            @click="save(index)"
          >
            {{ t('compare.saveShort') }} {{ side.name }}
          </button>
        </template>

        <button
          type="button"
          class="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/10"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          data-test="compare-close"
          @click="close"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>
    </header>

    <!--
      Looking for something, and putting something else in its place. Under the bar
      rather than in it, because it has a field in it and a field in a toolbar is what
      made the toolbar two rows tall.
    -->
    <div
      v-if="searching && !loading && !failed"
      class="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm dark:border-neutral-800 dark:bg-white/5"
      data-test="compare-search"
    >
      <input
        v-model="query"
        type="search"
        class="w-48 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-zinc-900"
        :placeholder="t('compare.searchFor')"
        :aria-label="t('compare.searchFor')"
        data-test="compare-search-query"
        @keydown.enter.prevent="nextMatch"
      />
      <input
        v-model="replacement"
        type="text"
        class="w-48 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-zinc-900"
        :placeholder="t('compare.replaceWith')"
        :aria-label="t('compare.replaceWith')"
        data-test="compare-search-replacement"
      />
      <select
        v-model.number="scope"
        class="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-zinc-900"
        :aria-label="t('compare.searchIn')"
        data-test="compare-search-scope"
      >
        <option :value="-1">{{ t('compare.everywhere') }}</option>
        <option v-for="(side, index) in sides" :key="`scope-${index}`" :value="index">
          {{ side.name }}
        </option>
      </select>
      <label class="flex items-center gap-1 text-neutral-600 dark:text-neutral-300">
        <input v-model="matchCase" type="checkbox" data-test="compare-search-case" />
        {{ t('compare.matchCase') }}
      </label>

      <span
        class="text-xs text-neutral-500 dark:text-neutral-400"
        data-test="compare-search-count"
        :data-count="matches.length"
      >
        <!-- How many, until the reader starts stepping through them: "0 of 2" before
             they have gone anywhere is a position nobody is in. -->
        {{
          !matches.length
            ? t('compare.noMatch')
            : atMatch < 0
              ? t('compare.matchCount', { count: matches.length })
              : t('compare.matchPosition', { index: atMatch + 1, count: matches.length })
        }}
      </span>

      <button
        type="button"
        class="rounded-md p-1 text-neutral-600 transition hover:bg-neutral-200 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/10"
        :disabled="!matches.length"
        :title="t('compare.previousMatch')"
        :aria-label="t('compare.previousMatch')"
        data-test="compare-search-previous"
        @click="previousMatch"
      >
        <ArrowUpIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="rounded-md p-1 text-neutral-600 transition hover:bg-neutral-200 disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-white/10"
        :disabled="!matches.length"
        :title="t('compare.nextMatch')"
        :aria-label="t('compare.nextMatch')"
        data-test="compare-search-next"
        @click="nextMatch"
      >
        <ArrowDownIcon class="h-4 w-4" />
      </button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-white/10"
        :disabled="atMatch < 0"
        data-test="compare-replace-one"
        @click="replaceOne"
      >
        {{ t('compare.replace') }}
      </button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-white/10"
        :disabled="!matches.length"
        data-test="compare-replace-all"
        @click="replaceAll"
      >
        {{ t('compare.replaceAll') }}
      </button>
    </div>

    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400"
      data-test="compare-loading"
    >
      {{ t('common.loading') }}
    </div>
    <div
      v-else-if="failed"
      class="p-6 text-sm text-red-600 dark:text-red-400"
      data-test="compare-failed"
    >
      {{ failed }}
    </div>

    <template v-else>
      <!-- One header row of names, so a column is never a mystery on a long file. -->
      <div
        class="grid border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600 dark:border-neutral-800 dark:bg-white/5 dark:text-neutral-300"
        :style="{ gridTemplateColumns: `repeat(${sides.length}, minmax(0, 1fr))` }"
      >
        <div
          v-for="side in sides"
          :key="`head-${side.path}`"
          class="truncate border-l border-neutral-200 px-3 py-1 first:border-l-0 dark:border-neutral-800"
          :title="side.path"
        >
          {{ side.name }}
          <span v-if="side.dirty" class="text-amber-600 dark:text-amber-400">•</span>
        </div>
      </div>

      <div
        class="relative min-h-0 flex-1"
        data-test="compare-surface"
        @pointermove="onEdgePointerMove"
        @pointerleave="mapNear = false"
      >
        <!--
          The bar the application draws for itself, there the whole time.

          The platform's is hidden below: it is drawn over the content and fades out
          when nothing is moving, so on this screen there was nothing to see while
          reading — measured, not guessed. One bar, on every platform, and a real one:
          the thumb is grabbed where it is grabbed and the track jumps.
        -->
        <div
          ref="barTrack"
          class="absolute inset-y-0 right-0 z-20 w-2.5 bg-neutral-200/70 dark:bg-zinc-800/80"
          data-test="compare-bar"
          @pointerdown="onBarDown"
          @pointermove="onBarMove"
          @pointerup="onBarUp"
          @pointercancel="onBarUp"
        >
          <div
            class="absolute inset-x-0.5 rounded-full bg-neutral-400 transition-colors hover:bg-neutral-500 dark:bg-neutral-500 dark:hover:bg-neutral-400"
            :style="thumbStyle"
            data-test="compare-bar-thumb"
          ></div>
        </div>

        <!--
          Where the differences are, down the whole file, in the colours the panes use.

          Out of the way until it is wanted: it comes out when the pointer nears the
          right-hand edge, and stays when it is pinned. Over the text rather than beside
          it, so nothing reflows when it arrives.

          One band per side, side by side, because that is the thing worth seeing at a
          glance and the map could not show it: red where a line is only on the left,
          green where it is only on the right, amber where both have one and they
          differ. A block on one side only reads as a colour and a gap.
        -->
        <div
          v-if="mapShown"
          ref="mapLane"
          class="absolute inset-y-0 right-2.5 z-10 w-4 cursor-pointer border-x border-neutral-200/70 bg-neutral-50/95 dark:border-neutral-800 dark:bg-zinc-900/95"
          :title="t('compare.mapHint')"
          data-test="compare-map"
          @pointerdown="onMapDown"
          @pointermove="onMapMove"
          @pointerup="onMapUp"
          @pointercancel="onMapUp"
        >
          <!--
            What is on screen, drawn over the whole file: the reader's place and the
            differences they are looking for in one picture. Behind the marks, so a
            difference under the view is still the thing a press lands on.
          -->
          <div
            class="pointer-events-none absolute inset-x-0 rounded-sm border border-neutral-500/60 bg-neutral-500/20 dark:border-neutral-400/60 dark:bg-neutral-400/20"
            :style="{
              top: `${view.top * 100}%`,
              height: `${Math.max(2, view.height * 100)}%`,
            }"
            data-test="compare-map-view"
          ></div>
          <button
            v-for="(band, index) in mapBands"
            :key="`map-${index}`"
            type="button"
            class="absolute inset-x-0 flex overflow-hidden rounded-[1px]"
            :class="band.block === at ? 'ring-1 ring-accent ring-offset-0' : ''"
            :style="bandStyle(band)"
            :title="t('compare.position', { index: band.block + 1, count: blocks.length })"
            :aria-label="t('compare.position', { index: band.block + 1, count: blocks.length })"
            :data-test="`compare-map-mark-${index}`"
            :data-block="band.block"
            @click="goToBlock(band.block)"
          >
            <span
              v-for="(tint, side) in band.tints"
              :key="side"
              class="h-full flex-1"
              :class="tintClass(tint)"
              :data-tint="tint"
            ></span>
          </button>
        </div>

        <!--
          Selectable, which it was not.

          The window sets `user-select: none` on the body so a file list behaves like a
          file list rather than a page of prose, and gives it back to the few surfaces
          that are text — fields, the editor, a terminal, prose, `pre`. These panes are
          none of those, so the one thing everybody does with two files side by side,
          take a line out of one of them, silently did nothing. The gutter keeps saying
          no, so a selection dragged down the pane copies the lines without the numbers.
        -->
        <div
          ref="scroller"
          class="compare-scroller absolute inset-0 select-text overflow-auto pr-4 font-mono text-xs"
          data-test="compare-rows"
          @scroll="measureView"
        >
          <div
            v-for="entry in shown"
            :key="entry.index"
            :ref="(element) => (entry.row ? setRowRef(entry.index, element) : null)"
          >
            <!-- What was folded away, said out loud: a comparison that hid two thirds
               of a file without saying so would be one nobody could trust. -->
            <div
              v-if="entry.gap"
              class="border-y border-dashed border-neutral-200 bg-neutral-50 px-3 py-1 text-center text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-white/5 dark:text-neutral-400"
              data-test="compare-gap"
            >
              {{ t('compare.folded', { count: entry.gap }) }}
            </div>
            <div
              v-else
              class="grid"
              :class="[
                rowClass(entry.row),
                isCurrent(entry.index) ? 'ring-1 ring-inset ring-accent' : '',
              ]"
              :style="{ gridTemplateColumns: `repeat(${sides.length}, minmax(0, 1fr))` }"
              :data-kind="entry.row.kind"
              :data-current="isCurrent(entry.index) ? 'true' : 'false'"
              data-test="compare-row"
            >
              <div
                v-for="(side, index) in sides"
                :key="`${entry.index}-${index}`"
                class="flex min-w-0 border-l border-neutral-200/70 dark:border-neutral-800 first:border-l-0"
                :class="cellClass(entry.row, index)"
                :data-cell="index"
              >
                <span
                  class="w-12 shrink-0 select-none border-r border-neutral-200/70 px-1 text-right text-neutral-400 dark:border-neutral-800 dark:text-neutral-500"
                >
                  {{ cellFor(entry.row, index)?.number ?? '' }}
                </span>
                <template v-if="isEditing(index, entry.row[keyAt(index)])">
                  <input
                    :ref="bindEditor"
                    v-model="draft"
                    class="min-w-0 flex-1 bg-white px-2 font-mono text-xs outline-none ring-1 ring-accent dark:bg-zinc-900"
                    :data-test="`compare-edit-${index}`"
                    :data-side="index"
                    :data-line="entry.row[keyAt(index)]"
                    :title="t('compare.editKeys')"
                    @keydown="onEditorKey"
                    @paste="onEditorPaste"
                    @blur="onEditorBlur"
                  />
                  <!--
                    A line added and a line removed, said out loud on the line being
                    edited.

                    Only there, and not on every line of the file: the keys do it
                    anywhere, and a pair of buttons on all five thousand rows would be
                    ten thousand buttons to lay out for the two that get used. Here
                    they are what tells a reader who has just double-clicked a line
                    that adding and removing lines is something this screen does.
                  -->
                  <span class="flex shrink-0 items-center gap-px pr-1">
                    <button
                      type="button"
                      class="rounded p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
                      :title="t('compare.insertLine')"
                      :aria-label="t('compare.insertLine')"
                      :data-test="`compare-insert-${index}`"
                      @mousedown.prevent
                      @click="insertLine(index, entry.row[keyAt(index)])"
                    >
                      <PlusIcon class="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      class="rounded p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-red-400"
                      :title="t('compare.deleteLine')"
                      :aria-label="t('compare.deleteLine')"
                      :data-test="`compare-delete-${index}`"
                      @mousedown.prevent
                      @click="deleteLine(index, entry.row[keyAt(index)])"
                    >
                      <TrashIcon class="h-3.5 w-3.5" />
                    </button>
                  </span>
                </template>
                <span
                  v-else
                  class="min-w-0 flex-1 px-2"
                  :class="
                    wrap ? 'whitespace-pre-wrap break-words' : 'overflow-hidden whitespace-pre'
                  "
                  :title="side.readOnly ? undefined : t('compare.editHint')"
                  @dblclick="startEditing(index, entry.row[keyAt(index)])"
                  ><span
                    v-for="(part, piece) in segments(entry.row, index, entry.index)"
                    :key="piece"
                    :class="segmentClass(part.kind)"
                    :data-test="part.kind === 'diff' ? 'compare-inline' : undefined"
                    >{{ part.text }}</span
                  ></span
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * The platform's own bar, hidden on this one surface.
 *
 * Not everywhere: every other scrolling surface in the window keeps whatever the
 * platform gives it. Here the comparison draws its own, and two bars side by side —
 * one of them fading in and out — would be worse than the none there was.
 */
.compare-scroller {
  scrollbar-width: none;
}

.compare-scroller::-webkit-scrollbar {
  display: none;
}
</style>
