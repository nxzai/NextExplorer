import { describe, expect, it } from 'vitest';
import {
  collectTransferredNames,
  isAbortError,
  itemKey,
  itemRelativePath,
  serializeItems,
} from './items';

describe('an entry, on its own', () => {
  it('is known by its folder and its name', () => {
    expect(itemKey({ name: 'a.txt', path: '/Docs/' })).toBe('Docs::a.txt');
    expect(itemKey({ name: 'a.txt' })).toBe('::a.txt');
    expect(itemKey({ path: 'Docs' })).toBe('');
  });

  it('has a path from the top', () => {
    expect(itemRelativePath({ name: 'a.txt', path: 'Docs' })).toBe('Docs/a.txt');
    expect(itemRelativePath({ name: 'Docs', path: '' })).toBe('Docs');
    expect(itemRelativePath(null)).toBeNull();
  });

  // A volume is where things are, not a thing to move or delete.
  it('is sent without volumes and without nameless rows', () => {
    expect(
      serializeItems([
        { name: 'a.txt', path: 'Docs/', kind: 'txt', size: 3 },
        { name: 'Docs', kind: 'volume' },
        { path: 'Docs' },
        null,
      ])
    ).toEqual([{ name: 'a.txt', path: 'Docs', kind: 'txt' }]);
  });

  it('is named, after a copy, by where it landed', () => {
    const names = [];
    collectTransferredNames({ items: [{ to: 'Dest/a (1).txt' }, { to: 'b.txt' }, {}] }, names);
    expect(names).toEqual(['a (1).txt', 'b.txt']);
  });

  it('recognises every way a request says it was cancelled', () => {
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError({ code: 'OPERATION_CANCELLED' })).toBe(true);
    expect(isAbortError(new Error('The operation was aborted'))).toBe(true);
    expect(isAbortError(new Error('Network down'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
