import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What can be compared side by side.
 *
 * Whatever the text editor can open, plus whatever this installation adds — and
 * nothing listed twice, because a comparison reads two files as lines of text, which
 * is exactly what the editor does. The offer has to be refused for everything else:
 * comparing two photographs line by line produces pages of binary nonsense and an
 * offer that was never worth making.
 */

const editable = new Set(['txt', 'md', 'json', 'yml']);
vi.mock('@/config/editor', () => ({
  isEditableExtension: (extension) => editable.has(String(extension || '').toLowerCase()),
}));

const features = { compareExtensions: [] };
vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));

import { canCompare, extensionOf, isComparableExtension, isComparableItem } from './compare';

const file = (name, kind = '') => ({ name, path: 'Docs', kind: kind || name.split('.').pop() });

beforeEach(() => {
  features.compareExtensions = [];
});

describe('what can be compared', () => {
  it('is whatever the text editor can open', () => {
    expect(isComparableExtension('txt')).toBe(true);
    expect(isComparableExtension('yml')).toBe(true);
  });

  it('is not a photograph, whatever anybody would do with it', () => {
    expect(isComparableExtension('png')).toBe(false);
    expect(isComparableItem(file('holiday.png'))).toBe(false);
  });

  /** What counts as text is a local question: somebody's `.ino`, somebody's `.tf`. */
  it('is also whatever this installation adds', () => {
    expect(isComparableExtension('tf')).toBe(false);

    features.compareExtensions = ['tf', 'ino'];

    expect(isComparableExtension('tf')).toBe(true);
    expect(isComparableExtension('ino')).toBe(true);
  });

  it('is read the same whether it is written with a dot or in capitals', () => {
    features.compareExtensions = ['TF'];

    expect(isComparableExtension('.TF')).toBe(true);
    expect(isComparableExtension('tf')).toBe(true);
  });

  it('is nothing for a name with no extension at all', () => {
    expect(isComparableExtension('')).toBe(false);
    expect(isComparableItem({ name: 'LICENCE', path: '', kind: '' })).toBe(false);
  });

  it('is never a folder, nor a volume, nor somebody’s own folder', () => {
    expect(isComparableItem({ name: 'Docs', kind: 'directory' })).toBe(false);
    expect(isComparableItem({ name: 'Volume', kind: 'volume' })).toBe(false);
    expect(isComparableItem({ name: 'personal', kind: 'personal' })).toBe(false);
    expect(isComparableItem(null)).toBe(false);
  });

  it('reads the extension from the name, and falls back to the kind', () => {
    expect(extensionOf({ name: 'notes.MD' })).toBe('md');
    expect(extensionOf({ name: 'notes', kind: 'txt' })).toBe('txt');
  });
});

describe('a selection a comparison can be offered for', () => {
  it('is two comparable files', () => {
    expect(canCompare([file('a.txt'), file('b.txt')])).toBe(true);
  });

  /** Three is the one that answers "who changed what". */
  it('is three of them too', () => {
    expect(canCompare([file('a.txt'), file('b.txt'), file('c.txt')])).toBe(true);
  });

  it('is not one file, which has nothing to be compared with', () => {
    expect(canCompare([file('a.txt')])).toBe(false);
  });

  /** Four would be a table nobody can read on a screen. */
  it('is not four', () => {
    expect(canCompare([file('a.txt'), file('b.txt'), file('c.txt'), file('d.txt')])).toBe(false);
  });

  it('is not a selection with anything uncomparable in it', () => {
    expect(canCompare([file('a.txt'), file('holiday.png')])).toBe(false);
    expect(canCompare([file('a.txt'), { name: 'Docs', kind: 'directory' }])).toBe(false);
  });

  it('is nothing at all when nothing is selected', () => {
    expect(canCompare([])).toBe(false);
    expect(canCompare(null)).toBe(false);
  });

  /** Two kinds of text against each other is still two texts. */
  it('is two files of different kinds, since both are text', () => {
    expect(canCompare([file('a.txt'), file('b.json')])).toBe(true);
  });
});
