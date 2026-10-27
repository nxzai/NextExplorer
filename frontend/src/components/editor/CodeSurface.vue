<template>
  <div ref="host" class="h-full" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

/**
 * The editor fills its host, and scrolls inside it.
 *
 * Without this CodeMirror grows with the document — `.cm-editor` was 20,000 px
 * tall for a 900-line file — and there is no viewport to scroll: the page's own
 * root is `h-screen overflow-hidden`, so everything past the first screen was
 * simply clipped. The wheel moved nothing in any browser; what differed between
 * them was only what the keyboard did, because moving the caret scrolls a
 * hidden container by as much as each engine feels like.
 *
 * `&` is the editor itself in CodeMirror's theme syntax. Written as an
 * extension rather than as a stylesheet rule so it travels with the component
 * and cannot be undone by the order two stylesheets happen to load in.
 */
const fillsItsHost = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto' },
});

/**
 * CodeMirror, without a copy of the whole document on every keystroke.
 *
 * The editor used vue-codemirror's `v-model`. Every change made it turn the
 * whole document into a string to emit it, and the component then compared
 * that string with its prop — two full copies per key, and a comparison of
 * two such strings on top for "unsaved changes". On a nineteen-megabyte file
 * that was about 150 ms of frozen page per character typed.
 *
 * Here the document stays CodeMirror's. The text is taken once, when it is
 * saved. Whether there are unsaved changes is CodeMirror's own comparison with
 * the document last read or saved: two documents of different lengths differ
 * at once, and two of the same length share every part an edit did not touch,
 * which the comparison skips.
 *
 * The same setup vue-codemirror gave the editor: its basic setup, Tab to
 * indent, and a tab two columns wide.
 */

const props = defineProps({
  /** The document as read. A different value replaces the document. */
  content: { type: String, default: '' },
  /** Read once, when the editor is created; reconfigure through compartments. */
  extensions: { type: Array, default: () => [] },
  autofocus: { type: Boolean, default: false },
});

const emit = defineEmits(['ready', 'edit', 'dirty-change']);

const host = ref(null);
const view = shallowRef(null);

// The document last read or saved, and whether the one on screen differs.
let savedDoc = null;
let dirty = false;

const setDirty = (value) => {
  if (value === dirty) return;
  dirty = value;
  emit('dirty-change', value);
};

const trackChanges = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return;
  // A replacement from `content` is not an edit: it is the new saved document.
  if (update.transactions.some((tr) => tr.annotation(Transaction.remote))) return;
  setDirty(!update.state.doc.eq(savedDoc));
  emit('edit');
});

onMounted(() => {
  const state = EditorState.create({
    doc: props.content,
    extensions: [
      basicSetup,
      fillsItsHost,
      keymap.of([indentWithTab]),
      EditorState.tabSize.of(2),
      trackChanges,
      ...props.extensions,
    ],
  });
  savedDoc = state.doc;
  view.value = new EditorView({ state, parent: host.value });
  if (props.autofocus) view.value.focus();
  emit('ready', { view: view.value });
});

watch(
  () => props.content,
  (content) => {
    const current = view.value;
    if (!current) return;
    // The same text again is not a new document; replacing it would only throw
    // away the cursor and the undo history for nothing.
    if (current.state.doc.length === content.length && current.state.doc.toString() === content) {
      return;
    }
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: content },
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });
    savedDoc = current.state.doc;
    setDirty(false);
  }
);

onBeforeUnmount(() => {
  view.value?.destroy();
  view.value = null;
});

/**
 * Where the reader is in this file, and putting them back there.
 *
 * Both here rather than in the page, because both are CodeMirror's business and
 * neither is a scroll bar. A cursor is a position in a document; a place in a
 * long file is a *line*, not a pixel — and the pixel is the one that goes wrong.
 * The editor draws what is in view and estimates the rest, so its height is a
 * guess that improves as it measures, and a scrollTop written into it before it
 * has measured is silently clamped. That is what sent somebody back to the top of
 * a file they had scrolled halfway down, with their selection intact beside them.
 *
 * So the line is what is kept, and `scrollIntoView` is what puts it back: it is
 * asked of the editor rather than of the DOM, so it happens after the editor has
 * measured, whenever that is. The pixel is kept too and applied first, because
 * inside a line it is the more precise of the two and it costs nothing.
 */
const placeInDocument = () => {
  const editor = view.value;
  if (!editor) return { selection: null, scrollTop: 0, topLine: null };

  const selection = editor.state.selection.main;
  const box = editor.scrollDOM.getBoundingClientRect();
  return {
    selection: { anchor: selection.anchor, head: selection.head },
    scrollTop: editor.scrollDOM.scrollTop,
    // The document position at the top left of what is on screen. `false` asks
    // for the nearest position rather than only an exact hit, so an empty margin
    // still answers with the line beside it.
    topLine: editor.posAtCoords({ x: box.left + 1, y: box.top + 1 }, false) ?? null,
  };
};

const restorePlaceInDocument = (place) => {
  const editor = view.value;
  if (!editor || !place) return;

  const end = editor.state.doc.length;
  if (place.selection) {
    editor.dispatch({
      // Clamped: somebody else may have written to the file while this tab was
      // away, and a cursor past the end of the document throws.
      selection: {
        anchor: Math.min(place.selection.anchor, end),
        head: Math.min(place.selection.head, end),
      },
    });
  }

  if (place.scrollTop > 0) editor.scrollDOM.scrollTop = place.scrollTop;
  if (place.topLine !== null && place.topLine !== undefined) {
    editor.dispatch({
      effects: EditorView.scrollIntoView(Math.min(place.topLine, end), { y: 'start' }),
    });
  }
};

defineExpose({
  /** The document as it is now, to be saved; `String(snapshot())` is its text. */
  snapshot: () => view.value?.state.doc ?? null,
  /** Where the reader is: the cursor, and the line at the top of the screen. */
  place: placeInDocument,
  /** And putting them back there, once the document is in. */
  restorePlace: restorePlaceInDocument,
  /** Call with what `snapshot()` answered once that document has been written. */
  markSaved: (doc) => {
    if (!view.value || !doc) return;
    savedDoc = doc;
    setDirty(!view.value.state.doc.eq(savedDoc));
  },
  view,
});
</script>
