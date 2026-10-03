import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupTestEnv } from '../helpers/env-test-utils.js';

const childProcess = require('node:child_process');

/**
 * Progress stops at the moment the copy does.
 *
 * A native copy is a child process that writes its progress to a pipe, and what
 * it has already written arrives after it has finished or been killed. So a
 * caller that was done with the transfer — and had taken down whatever it kept
 * for it — was still being told how far the copy had got.
 *
 * Nothing in the application minded, which is why it stood for so long. A test
 * that wrote to disk from its progress callback did mind: the callback fired
 * after its temporary directory had gone, and the suite failed on an error
 * thrown from nowhere, in a test that had passed. That is the shape of this
 * defect — it does not break the thing it belongs to, it breaks something else,
 * later, once.
 *
 * With a child of our own rather than rsync, because the property is about what
 * is done with what the pipe says and not about copying anything: a real rsync
 * cannot be asked to speak after it has stopped.
 */

let currentEnv = null;

const fakeChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 424242;
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child;
};

// One line of `--info=progress2`, which is what the service parses.
const PROGRESS = '      1,048,576  50%    1.00MB/s    0:00:01\n';

afterEach(async () => {
  vi.restoreAllMocks();
  if (currentEnv) {
    await currentEnv.cleanup();
    currentEnv = null;
  }
});

const setup = async () => {
  currentEnv = await setupTestEnv({
    tag: 'native-copy-progress-',
    env: { FILE_TRANSFER_ENGINE: 'native', FOLDER_SIZE_MODE: 'off' },
  });
  const child = fakeChild();
  vi.spyOn(childProcess, 'spawn').mockImplementation(() => child);
  const service = currentEnv.requireFresh('src/services/fileTransferService');
  return { service, child };
};

describe('what a native copy reports', () => {
  it('is reported while it is running', async () => {
    const { service, child } = await setup();
    const seen = [];

    const copying = service.copyWithNativeRsync('/from', '/to', (progress) => seen.push(progress));
    await Promise.resolve();
    child.stdout.emit('data', Buffer.from(PROGRESS));

    expect(seen).toHaveLength(1);

    child.emit('close', 0);
    await copying;
  });

  /**
   * And nothing once it has finished. The pipe can still hand over a line that
   * was written a moment before the end; the operation it described is over.
   */
  it('is not reported after it has finished', async () => {
    const { service, child } = await setup();
    const seen = [];

    const copying = service.copyWithNativeRsync('/from', '/to', (progress) => seen.push(progress));
    await Promise.resolve();
    child.emit('close', 0);
    await copying;

    child.stdout.emit('data', Buffer.from(PROGRESS));

    expect(seen).toEqual([]);
  });

  /** Nor once it has been cancelled, which is the way it actually happened. */
  it('is not reported after it has been cancelled', async () => {
    const { service, child } = await setup();
    const seen = [];
    const controller = new AbortController();

    const copying = service.copyWithNativeRsync(
      '/from',
      '/to',
      (progress) => seen.push(progress),
      controller.signal
    );
    await Promise.resolve();
    controller.abort();

    // Written before the signal reached it, arriving after.
    child.stdout.emit('data', Buffer.from(PROGRESS));
    child.emit('close', 143);

    await expect(copying).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    expect(seen).toEqual([]);
  });
});
