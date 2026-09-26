import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

/**
 * What a failure nobody caught costs the server.
 *
 * Node stops the process for a rejected promise with no listener, so one
 * forgotten `await` answers a single bad request by ending the server for
 * everybody. The first test here is a real Node process rather than an injected
 * emitter, because that default is the thing being changed and nothing short of
 * a process shows it.
 *
 * The rest use an injected emitter and an injected `exit`: an uncaught exception
 * must still stop the server — after the shutdown has had a bounded chance to
 * run — and a test that really exited would take the runner with it.
 */

const require = createRequire(import.meta.url);
const MODULE = path.join(__dirname, '..', '..', 'src', 'utils', 'processFailures.js');
const { installProcessFailureHandlers } = require(MODULE);

/** Run a snippet in its own Node process and report how it ended. */
const run = (source) =>
  new Promise((resolve) => {
    execFile(process.execPath, ['-e', source], { timeout: 10_000 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });

// A rejection nobody listens to, then a line printed once the queue has drained.
const STRAY_REJECTION = `
  Promise.reject(new Error('nobody awaited this'));
  setTimeout(() => { console.log('still here'); }, 50);
`;

describe('a promise rejected with nobody listening', () => {
  it('ends a Node process that has not installed the handlers', async () => {
    const { code, stdout } = await run(STRAY_REJECTION);

    // Node's default, and the behaviour being changed.
    expect(code).toBe(1);
    expect(stdout).not.toContain('still here');
  });

  it('leaves the server running once they are installed', async () => {
    const { code, stdout, stderr } = await run(`
      require(${JSON.stringify(MODULE)}).installProcessFailureHandlers();
      ${STRAY_REJECTION}
    `);

    expect(code).toBe(0);
    expect(stdout).toContain('still here');
    // And it is not silent about it.
    expect(`${stdout}${stderr}`).toContain('nobody awaited this');
  });

  it('reports what was rejected with, even when it was not an Error', () => {
    const target = new EventEmitter();
    const log = { error: vi.fn() };
    const remove = installProcessFailureHandlers({ target, log, exit: vi.fn() });

    target.emit('unhandledRejection', 'a bare string');

    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0].err).toBeInstanceOf(Error);
    expect(log.error.mock.calls[0][0].err.message).toBe('a bare string');
    remove();
  });
});

describe('an uncaught exception', () => {
  const uncaught = (overrides = {}) => {
    const target = new EventEmitter();
    const log = { error: vi.fn() };
    const exit = vi.fn();
    const remove = installProcessFailureHandlers({ target, log, exit, ...overrides });
    return { target, log, exit, remove };
  };

  it('shuts the server down, in that order', async () => {
    const order = [];
    const onFatal = vi.fn(() => {
      order.push('shutdown');
    });
    const { target, exit, log, remove } = uncaught({ onFatal });
    exit.mockImplementation(() => order.push('exit'));

    target.emit('uncaughtException', new Error('the stack unwound'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));

    // What is in memory cannot be trusted, so it goes — but the shutdown is
    // given its chance first, or the server would leave its locks behind.
    expect(order).toEqual(['shutdown', 'exit']);
    expect(log.error).toHaveBeenCalled();
    remove();
  });

  it('stops even when the shutdown never finishes', async () => {
    const { target, exit, remove } = uncaught({
      onFatal: () => new Promise(() => {}),
      shutdownTimeoutMs: 20,
    });

    target.emit('uncaughtException', new Error('and the shutdown hangs'));

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    remove();
  });

  it('stops even when the shutdown fails too, and says so', async () => {
    const { target, exit, log, remove } = uncaught({
      onFatal: () => Promise.reject(new Error('the store was already closed')),
    });

    target.emit('uncaughtException', new Error('the stack unwound'));

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    // Through the error itself: JSON.stringify flattens an Error to {} and
    // would have passed whatever the shutdown reported.
    const reported = log.error.mock.calls.map(
      ([context, message]) => `${message} ${context?.err?.message ?? ''}`
    );
    expect(reported.some((line) => line.includes('already closed'))).toBe(true);
    remove();
  });

  it('exits once, not once per path that could end it', async () => {
    const { target, exit, remove } = uncaught({ onFatal: () => {}, shutdownTimeoutMs: 5 });

    target.emit('uncaughtException', new Error('the stack unwound'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(exit).toHaveBeenCalledTimes(1);
    remove();
  });
});

describe('the handlers', () => {
  it('can be taken off again, leaving the process as it was', () => {
    const target = new EventEmitter();
    const log = { error: vi.fn() };

    const remove = installProcessFailureHandlers({ target, log, exit: vi.fn() });
    expect(target.listenerCount('unhandledRejection')).toBe(1);
    expect(target.listenerCount('uncaughtException')).toBe(1);

    remove();

    expect(target.listenerCount('unhandledRejection')).toBe(0);
    expect(target.listenerCount('uncaughtException')).toBe(0);
  });
});
