import { describe, expect, it } from 'vitest';
import { createThumbnailQueue } from './thumbnails';

/**
 * The queue on its own, where its two properties can be watched directly: no
 * more than so many requests at once, and nothing left running for a folder
 * the reader has walked out of.
 */

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the thumbnail queue', () => {
  it('runs no more than its bound at once', async () => {
    const queue = createThumbnailQueue({ concurrency: 2 });
    const running = [];
    const gates = [];
    const results = [];
    for (let index = 0; index < 5; index += 1) {
      const gate = deferred();
      gates.push(gate);
      results.push(
        queue.enqueue(`k${index}`, async () => {
          running.push(index);
          return gate.promise;
        })
      );
    }

    await settle();
    expect(running).toEqual([0, 1]);

    gates[0].resolve('a');
    await settle();
    expect(running).toEqual([0, 1, 2]);

    gates.slice(1).forEach((gate, index) => gate.resolve(String(index)));
    await settle();
    await settle();
    expect(await results[0]).toBe('a');
    expect(running).toEqual([0, 1, 2, 3, 4]);
  });

  it('answers null for what was queued, and aborts what was running, when cancelled', async () => {
    const queue = createThumbnailQueue({ concurrency: 1 });
    let signal;
    const running = queue.enqueue('running', (given) => {
      signal = given;
      return new Promise((_resolve, reject) =>
        given.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        )
      );
    });
    let ranLater = false;
    const waiting = queue.enqueue('waiting', async () => {
      ranLater = true;
      return 'never';
    });

    await settle();
    queue.cancel();

    expect(signal.aborted).toBe(true);
    expect(await running).toBeNull();
    expect(await waiting).toBeNull();
    expect(ranLater).toBe(false);
  });

  it('passes on a failure that is not a cancellation', async () => {
    const queue = createThumbnailQueue({ concurrency: 1 });
    await expect(
      queue.enqueue('broken', async () => {
        throw new Error('server said no');
      })
    ).rejects.toThrow('server said no');
  });
});
