import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { createSelection } from './selection';

/** The selection, against a list of entries and nothing else. */

const entries = () =>
  ref([
    { name: 'a.txt', path: 'Docs' },
    { name: 'b.txt', path: 'Docs' },
    { name: 'Sub', path: 'Docs', kind: 'directory' },
  ]);

describe('the selection', () => {
  it('selects what was just made, when it is on screen', () => {
    const items = entries();
    const selection = createSelection(items);

    expect(selection.selectCreated('Docs', 'b.txt')).toBe(items.value[1]);
    expect(selection.selectedItems.value).toEqual([items.value[1]]);

    expect(selection.selectCreated('Docs', 'missing.txt')).toBeNull();
    expect(selection.selectCreated('Docs', undefined)).toBeNull();
    expect(selection.selectedItems.value).toEqual([items.value[1]]);
  });

  it('selects by name, and keeps the selection when none is on screen', () => {
    const items = entries();
    const selection = createSelection(items);
    selection.selectItemsByName(['a.txt', 'Sub']);
    expect(selection.selectedItems.value.map((entry) => entry.name)).toEqual(['a.txt', 'Sub']);

    selection.selectItemsByName(['elsewhere.txt']);
    expect(selection.selectedItems.value.map((entry) => entry.name)).toEqual(['a.txt', 'Sub']);
  });

  // The keyboard's entry is held by key, so a fresh listing that replaces the
  // row still finds it.
  it('keeps the keyboard on the same entry across a new listing', () => {
    const items = entries();
    const selection = createSelection(items);
    selection.setKeyboardActionItem(items.value[0]);

    items.value = [{ name: 'a.txt', path: 'Docs', size: 9 }];
    expect(selection.keyboardActionItem.value).toBe(items.value[0]);

    selection.clearKeyboardActionItem();
    expect(selection.keyboardActionItem.value).toBeNull();
  });

  it('empties the selection on leaving selection mode, unless asked not to', () => {
    const items = entries();
    const selection = createSelection(items);
    selection.setSelectionMode(true);
    selection.selectedItems.value = [items.value[0]];

    selection.setSelectionMode(false, { clearOnDisable: false });
    expect(selection.selectedItems.value).toHaveLength(1);

    selection.toggleSelectionMode();
    selection.toggleSelectionMode();
    expect(selection.selectionMode.value).toBe(false);
    expect(selection.selectedItems.value).toEqual([]);
    expect(selection.hasSelection.value).toBe(false);
  });
});
