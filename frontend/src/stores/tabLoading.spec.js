import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useTabLoadingStore } from './tabLoading';

/**
 * Which tabs are still working.
 *
 * A count rather than a flag, and that is the whole of what is worth holding here:
 * more than one thing is in flight at once — a document tab reads the folder behind
 * it for the arrows while its editor is still connecting — and the first of them to
 * finish must not declare the tab done.
 */

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('a tab that is working', () => {
  it('says so, and stops when the work is over', () => {
    const busy = useTabLoadingStore();

    const done = busy.begin('tab-1');
    expect(busy.isLoading('tab-1')).toBe(true);

    done();

    expect(busy.isLoading('tab-1')).toBe(false);
  });

  it('is not every other tab', () => {
    const busy = useTabLoadingStore();

    busy.begin('tab-1');

    expect(busy.isLoading('tab-2')).toBe(false);
    expect(busy.busyIds).toEqual(['tab-1']);
  });

  /** Two things in flight, and the first to finish does not speak for the second. */
  it('is still working while anything of its own is', () => {
    const busy = useTabLoadingStore();
    const first = busy.begin('tab-1');
    busy.begin('tab-1');

    first();

    expect(busy.isLoading('tab-1')).toBe(true);
  });

  /**
   * A caller that ends its own work twice must not end somebody else's, which is
   * why what `begin` answers with can only be used once.
   */
  it('cannot be ended twice by the same piece of work', () => {
    const busy = useTabLoadingStore();
    const first = busy.begin('tab-1');
    busy.begin('tab-1');

    first();
    first();

    expect(busy.isLoading('tab-1')).toBe(true);
  });

  it('is nothing for a tab nobody named', () => {
    const busy = useTabLoadingStore();

    expect(busy.isLoading('')).toBe(false);
    expect(() => busy.begin('')()).not.toThrow();
    expect(busy.busyIds).toEqual([]);
  });

  it('is forgotten when its tab goes', () => {
    const busy = useTabLoadingStore();
    busy.begin('tab-1');
    busy.begin('tab-2');

    busy.forget('tab-1');

    expect(busy.isLoading('tab-1')).toBe(false);
    expect(busy.isLoading('tab-2')).toBe(true);
  });

  it('is forgotten for every tab that has gone at once', () => {
    const busy = useTabLoadingStore();
    busy.begin('tab-1');
    busy.begin('tab-2');

    busy.keepOnly(['tab-2']);

    expect(busy.busyIds).toEqual(['tab-2']);
  });

  /** Work that outlives its tab must not leave the count standing for a new one. */
  it('does not come back when a tab that has gone finishes', () => {
    const busy = useTabLoadingStore();
    const done = busy.begin('tab-1');

    busy.forget('tab-1');
    done();

    expect(busy.isLoading('tab-1')).toBe(false);
    expect(busy.busyIds).toEqual([]);
  });
});
