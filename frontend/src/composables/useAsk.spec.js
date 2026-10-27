import { beforeEach, describe, expect, it } from 'vitest';

/**
 * A question the application asks in its own voice.
 *
 * What the browser's `confirm` and `prompt` gave for free was a call that waits for the
 * answer — by stopping the world, which is why the page behind them painted nothing and
 * why the box was headed by the server's address rather than by this application. A
 * dialog that is part of the page cannot stop anything, so what it has to keep is the
 * waiting: everything here is about a promise settling when, and only when, somebody
 * has answered.
 *
 * Imported afresh for each case: the asking is one thing the window is doing, so the
 * composable holds one, and a test that inherited the previous one's unanswered
 * question would be answering it.
 */
let useAsk;

beforeEach(async () => {
  const { vi } = await import('vitest');
  vi.resetModules();
  ({ useAsk } = await import('./useAsk'));
});

describe('asking yes or no', () => {
  it('is nothing on screen until something asks', () => {
    expect(useAsk().isOpen.value).toBe(false);
  });

  it('puts the question on screen and waits', async () => {
    const asking = useAsk();
    const answer = asking.ask({ title: 'Close it?', body: 'Nothing is saved.' });

    expect(asking.isOpen.value).toBe(true);
    expect(asking.question.value).toMatchObject({ title: 'Close it?', body: 'Nothing is saved.' });

    let settled = 'still asking';
    void answer.then((value) => (settled = value));
    await Promise.resolve();
    expect(settled).toBe('still asking');
  });

  it('answers true when it is agreed to, and takes the question off the screen', async () => {
    const asking = useAsk();
    const answer = asking.ask({ title: 'Close it?' });

    asking.accept();

    expect(await answer).toBe(true);
    expect(asking.isOpen.value).toBe(false);
  });

  it('answers false when it is called off', async () => {
    const asking = useAsk();
    const answer = asking.ask({ title: 'Close it?' });

    asking.cancel();

    expect(await answer).toBe(false);
  });
});

describe('asking for something to be typed', () => {
  it('starts from what is there, and answers with what was typed', async () => {
    const asking = useAsk();
    const answer = asking.askFor({ title: 'Rename', value: 'old name' });

    expect(asking.wantsText.value).toBe(true);
    expect(asking.answer.value).toBe('old name');
    asking.answer.value = 'new name';
    asking.accept();

    expect(await answer).toBe('new name');
  });

  /**
   * Null, not an empty string: "nothing" and "no" are different answers, and every
   * caller of the browser's `prompt` told them apart by exactly this.
   */
  it('answers with nothing at all when it is called off', async () => {
    const asking = useAsk();
    const answer = asking.askFor({ title: 'Rename', value: 'old name' });

    asking.cancel();

    expect(await answer).toBe(null);
  });

  it('answers with an empty string when that is what was typed', async () => {
    const asking = useAsk();
    const answer = asking.askFor({ title: 'Rename', value: 'old name' });

    asking.answer.value = '';
    asking.accept();

    expect(await answer).toBe('');
  });
});

/**
 * Two questions cannot be on screen at once, and the one being replaced must not be
 * left hanging: whoever is waiting on it is holding a gesture that would otherwise
 * never finish — a tab that neither closes nor stops closing.
 */
describe('a second question', () => {
  it('answers the first as refused rather than leaving it', async () => {
    const asking = useAsk();
    const first = asking.ask({ title: 'First' });

    asking.ask({ title: 'Second' });

    expect(await first).toBe(false);
    expect(asking.question.value).toMatchObject({ title: 'Second' });
  });

  it('answers a first that asked for something with nothing', async () => {
    const asking = useAsk();
    const first = asking.askFor({ title: 'First' });

    asking.ask({ title: 'Second' });

    expect(await first).toBe(null);
  });
});

/** Answering something nobody asked is not an error, and not an answer either. */
it('has nothing to settle when nothing was asked', () => {
  expect(() => useAsk().accept()).not.toThrow();
  expect(useAsk().isOpen.value).toBe(false);
});
