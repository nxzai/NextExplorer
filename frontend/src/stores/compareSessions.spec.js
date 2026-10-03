import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import { useCompareSessionsStore } from './compareSessions';
import { useTabsStore } from '@/stores/tabs';

/**
 * A comparison a tab is in the middle of.
 *
 * Two rules, and both are about *not* handing something back: what is kept belongs to
 * one address, and it goes when its tab does. Get either wrong and one pair of files'
 * work turns up inside another pair, which is worse than losing it — losing it they
 * would notice.
 */

const ADDRESS = '/compare?paths=Docs%2Fa.txt&paths=Docs%2Fb.txt';
const STATE = {
  at: 2,
  onlyDifferences: true,
  wrap: false,
  sides: [
    { path: 'Docs/a.txt', lines: ['one'], newline: '\n', dirty: false },
    { path: 'Docs/b.txt', lines: ['ONE'], newline: '\n', dirty: true },
  ],
};

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('what is kept belongs to a tab and an address', () => {
  it('is handed back whole to the tab that left it', () => {
    const held = useCompareSessionsStore();
    held.keep('tab-1', ADDRESS, STATE);

    expect(held.sessionFor('tab-1', ADDRESS)).toEqual({ address: ADDRESS, ...STATE });
  });

  /** Whole means whole: this store is not the thing that decides what survives. */
  it('is handed back with a part of it this store has never heard of', () => {
    const held = useCompareSessionsStore();
    held.keep('tab-1', ADDRESS, { ...STATE, somethingNew: 'from a later screen' });

    expect(held.sessionFor('tab-1', ADDRESS)).toMatchObject({
      somethingNew: 'from a later screen',
    });
  });

  it('is not handed to another comparison in the same tab', () => {
    const held = useCompareSessionsStore();
    held.keep('tab-1', ADDRESS, STATE);

    expect(held.sessionFor('tab-1', '/compare?paths=x&paths=y')).toBeNull();
  });

  it('is not handed to another tab', () => {
    const held = useCompareSessionsStore();
    held.keep('tab-1', ADDRESS, STATE);

    expect(held.sessionFor('tab-9', ADDRESS)).toBeNull();
  });

  it('is nothing at all until something is kept', () => {
    expect(useCompareSessionsStore().sessionFor('tab-1', ADDRESS)).toBeNull();
  });

  it('is kept for nobody when there is no tab or no address', () => {
    const held = useCompareSessionsStore();

    held.keep('', ADDRESS, STATE);
    held.keep('tab-1', '', STATE);

    expect(held.sessionFor('tab-1', ADDRESS)).toBeNull();
  });

  it('is gone once it is let go of', () => {
    const held = useCompareSessionsStore();
    held.keep('tab-1', ADDRESS, STATE);

    held.forget('tab-1');

    expect(held.sessionFor('tab-1', ADDRESS)).toBeNull();
  });
});

describe('a tab that goes', () => {
  /**
   * Closing a tab is a decision about what is in it, and keeping the lines would only
   * make them reappear in whatever tab happened to be given the same id later.
   */
  it('takes what was kept with it', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const opened = tabs.open('/compare?paths=a&paths=b');
    const held = useCompareSessionsStore();
    held.keep(opened.id, ADDRESS, STATE);

    tabs.close(opened.id);
    await nextTick();

    expect(held.sessionFor(opened.id, ADDRESS)).toBeNull();
  });

  it('leaves the other tabs holding theirs', async () => {
    const tabs = useTabsStore();
    tabs.setEnabled(true);
    const first = tabs.open('/compare?paths=a&paths=b');
    const second = tabs.open('/compare?paths=c&paths=d');
    const held = useCompareSessionsStore();
    held.keep(first.id, ADDRESS, STATE);
    held.keep(second.id, ADDRESS, STATE);

    tabs.close(second.id);
    await nextTick();

    expect(held.sessionFor(first.id, ADDRESS)).not.toBeNull();
  });
});
