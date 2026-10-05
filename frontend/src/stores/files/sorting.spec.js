import { describe, expect, it } from 'vitest';
import { sortItems } from './sorting';

/**
 * The order of a folder, on its own: it used to be a computed inside a store
 * of twelve hundred lines, reachable only by building the store.
 */

const noSizes = () => null;

describe('the order a folder is shown in', () => {
  const entries = [
    { name: 'beta.txt', kind: 'txt', size: 30 },
    { name: 'Alpha', kind: 'directory', size: 4096 },
    { name: 'alpha.txt', kind: 'txt', size: 10 },
    { name: 'gamma', kind: 'directory', size: 64 },
  ];

  it('puts folders first, and orders names without regard to case', () => {
    expect(sortItems(entries, { by: 'name', order: 'asc' }, noSizes).map((e) => e.name)).toEqual([
      'Alpha',
      'gamma',
      'alpha.txt',
      'beta.txt',
    ]);
  });

  it('turns the order round and keeps folders first', () => {
    expect(sortItems(entries, { by: 'name', order: 'desc' }, noSizes).map((e) => e.name)).toEqual([
      'gamma',
      'Alpha',
      'beta.txt',
      'alpha.txt',
    ]);
  });

  // A folder's own size on disk is a few kilobytes whatever it holds; the
  // number shown beside it is what the folder-size index counted.
  it('ranks folders by what they hold when sorting by size', () => {
    const sizes = { Alpha: 5, gamma: 900 };
    const sorted = sortItems(entries, { by: 'size', order: 'desc' }, (full) =>
      sizes[full] != null ? { sizeBytes: sizes[full] } : null
    );
    expect(sorted.map((e) => e.name)).toEqual(['gamma', 'Alpha', 'beta.txt', 'alpha.txt']);
  });

  it('falls back to the size on disk when a folder has not been counted', () => {
    const sorted = sortItems(entries, { by: 'size', order: 'asc' }, noSizes);
    expect(sorted.map((e) => e.name)).toEqual(['gamma', 'Alpha', 'alpha.txt', 'beta.txt']);
  });

  it('leaves the list it was given as it was', () => {
    const before = entries.map((e) => e.name);
    sortItems(entries, { by: 'name', order: 'asc' }, noSizes);
    expect(entries.map((e) => e.name)).toEqual(before);
  });
});
