import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useTabGuardsStore } from './tabGuards';

/**
 * A tab that has something to say before it is closed.
 *
 * Closing is the one gesture that destroys what a tab was holding, and the tabs store
 * cannot know whether that matters: it holds addresses, not work. So a screen with
 * something to lose leaves a question, and whoever closes a tab asks it — while a tab
 * nobody asked about closes as it always has, because being asked about a folder would
 * train everybody to click through the question without reading it.
 */

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('a question left for a tab', () => {
  it('is asked when that tab is closed', async () => {
    const guards = useTabGuardsStore();
    const ask = vi.fn(() => false);
    guards.guard('tab-1', ask);

    expect(await guards.mayClose('tab-1')).toBe(false);
    expect(ask).toHaveBeenCalled();
  });

  it('lets the tab go when the answer is yes', async () => {
    const guards = useTabGuardsStore();
    guards.guard('tab-1', () => true);

    expect(await guards.mayClose('tab-1')).toBe(true);
  });

  /**
   * The question the application actually asks.
   *
   * It used to be `window.confirm`, which answered on the spot by stopping the world.
   * The dialog that replaced it is part of the page, so it cannot: it answers when it
   * has been read, and everything from here to the cross on the tab waits for it.
   */
  it('waits for an answer that does not come at once', async () => {
    const guards = useTabGuardsStore();
    let answer;
    guards.guard(
      'tab-1',
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );

    let closed = null;
    const asking = guards.mayClose('tab-1').then((may) => (closed = may));
    // Nothing has been decided while the question is still on screen.
    await Promise.resolve();
    expect(closed).toBe(null);

    answer(false);
    await asking;
    expect(closed).toBe(false);
  });

  it('is not asked of any other tab', async () => {
    const guards = useTabGuardsStore();
    guards.guard('tab-1', () => false);

    expect(await guards.mayClose('tab-9')).toBe(true);
  });

  /** Nearly every tab: being asked about a folder is a question nobody reads. */
  it('is nothing at all for a tab nobody asked about', async () => {
    expect(await useTabGuardsStore().mayClose('tab-1')).toBe(true);
  });

  it('is taken back the way it was given', async () => {
    const guards = useTabGuardsStore();
    const release = guards.guard('tab-1', () => false);

    release();

    expect(await guards.mayClose('tab-1')).toBe(true);
  });

  /** A screen that has moved on must not be able to take back the next one's. */
  it('is taken back by whoever left it, and by nobody else', async () => {
    const guards = useTabGuardsStore();
    const release = guards.guard('tab-1', () => true);
    guards.guard('tab-1', () => false);

    release();

    expect(await guards.mayClose('tab-1')).toBe(false);
  });

  it('is let go when the tab is closed for good', async () => {
    const guards = useTabGuardsStore();
    guards.guard('tab-1', () => false);

    guards.release('tab-1');

    expect(await guards.mayClose('tab-1')).toBe(true);
  });

  /**
   * A screen with a broken question must not be able to make a tab unclosable: the
   * reader would have no way out of it at all.
   */
  it('lets the tab go when the question itself goes wrong', async () => {
    const guards = useTabGuardsStore();
    guards.guard('tab-1', () => {
      throw new Error('broken');
    });

    expect(await guards.mayClose('tab-1')).toBe(true);
  });

  it('is nothing for a tab with no id, and nothing for something that is not a question', async () => {
    const guards = useTabGuardsStore();

    expect(() => guards.guard('', () => false)()).not.toThrow();
    expect(() => guards.guard('tab-1', null)()).not.toThrow();
    expect(await guards.mayClose('tab-1')).toBe(true);
  });
});
