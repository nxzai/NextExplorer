import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

/**
 * Where a tab was in a file, held between two glances.
 *
 * Two rules, and both of them are about *not* handing something back: what is
 * kept belongs to one address, and it goes when its tab does. Get either wrong
 * and somebody's unsaved work — or their cursor — turns up inside another file,
 * which is worse than losing it. Losing it they would notice.
 */

import { useEditorDraftsStore } from './editorDrafts';
import { useTabsStore } from '@/stores/tabs';

const ADDRESS = '/editor/Docs/notes.md';
/**
 * A place as the editor answers one, `topLine` included.
 *
 * That field is the reason the fixture is worth spelling out: where the reader is
 * in a long file is the line at the top of the screen rather than a number of
 * pixels, because a scroll position written into CodeMirror before it has measured
 * is clamped to whatever fits. The editor started answering with it and this store
 * dropped it on the way past, so the fix was in the file and the reader still came
 * back to the top — with their cursor intact beside them, which is what made it
 * look as though the editor were at fault.
 */
const PLACE = {
  text: 'half a sentence',
  selection: { anchor: 4, head: 9 },
  scrollTop: 320,
  topLine: 1840,
};

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('what is kept belongs to a tab and an address', () => {
  it('is handed back whole to the tab that left it', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, PLACE);

    expect(drafts.placeFor('tab-1', ADDRESS)).toEqual({ address: ADDRESS, ...PLACE });
  });

  /**
   * Whole means whole: this store is not the thing that decides which parts of a
   * place survive. It was written as a list of the fields it knew the names of,
   * and the one the editor added later never came back.
   */
  it('is handed back with a part of it this store has never heard of', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, { ...PLACE, somethingNew: 'from a later editor' });

    expect(drafts.placeFor('tab-1', ADDRESS)).toMatchObject({
      topLine: 1840,
      somethingNew: 'from a later editor',
    });
  });

  /** Another file in the same tab: none of this has anything to do with it. */
  it('is not handed to another address', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, PLACE);

    expect(drafts.placeFor('tab-1', '/editor/Docs/other.md')).toBeNull();
  });

  it('is not handed to another tab', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, PLACE);

    expect(drafts.placeFor('tab-2', ADDRESS)).toBeNull();
  });

  it('is nothing at all until something is kept', () => {
    const drafts = useEditorDraftsStore();

    expect(drafts.placeFor('tab-1', ADDRESS)).toBeNull();
  });

  /**
   * A file nobody typed into still has a place worth keeping — that was the whole
   * complaint: scrolled two hundred lines down, a paragraph selected, and back to
   * the top of the file with nothing selected.
   */
  it('keeps the place of a file with nothing typed into it', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, { selection: { anchor: 12, head: 12 }, scrollTop: 900 });

    const kept = drafts.placeFor('tab-1', ADDRESS);
    expect(kept.text).toBeNull();
    expect(kept.selection).toEqual({ anchor: 12, head: 12 });
    expect(kept.scrollTop).toBe(900);
  });

  /** An empty document is a change like any other, and not "nothing typed". */
  it('keeps an empty document as text rather than as nothing', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, { text: '' });

    expect(drafts.placeFor('tab-1', ADDRESS).text).toBe('');
  });

  it('answers a place of its own for a tab that was given none', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, {});

    expect(drafts.placeFor('tab-1', ADDRESS)).toEqual({
      address: ADDRESS,
      text: null,
      selection: null,
      scrollTop: 0,
    });
  });

  it('is gone once it is let go of', () => {
    const drafts = useEditorDraftsStore();
    drafts.keep('tab-1', ADDRESS, PLACE);

    drafts.forget('tab-1');

    expect(drafts.placeFor('tab-1', ADDRESS)).toBeNull();
  });
});

describe('a tab that goes', () => {
  /**
   * Closing a tab is a decision about what is in it. Kept, the text would come
   * back in whatever tab was later given the same identifier.
   */
  it('takes what was kept with it', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const second = tabs.open('/editor/Docs/notes.md', { own: true });
    const drafts = useEditorDraftsStore();
    drafts.keep(second.id, ADDRESS, PLACE);

    tabs.close(second.id);
    await nextTick();

    expect(drafts.placeFor(second.id, ADDRESS)).toBeNull();
  });

  it('leaves the other tabs holding theirs', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const first = tabs.activeId;
    const second = tabs.open('/editor/Docs/notes.md', { own: true });
    const drafts = useEditorDraftsStore();
    drafts.keep(first, ADDRESS, { text: 'kept' });
    drafts.keep(second.id, ADDRESS, { text: 'goes' });

    tabs.close(second.id);
    await nextTick();

    expect(drafts.placeFor(first, ADDRESS).text).toBe('kept');
  });
});
