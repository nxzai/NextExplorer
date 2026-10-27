const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const env = require('../config/env');
const { ensureDir, pathExists } = require('../utils/fsUtils');
const logger = require('../utils/logger');
const {
  assertNotTopLevelEntry,
  isTopLevelEntry,
  normalizeRelativePath,
  combineRelativePath,
  ensureValidName,
} = require('../utils/pathUtils');
const { placeWithoutOverwrite } = require('../utils/placeWithoutOverwrite');
const { track: trackInFlight } = require('./inFlightFiles');
const { ValidationError, ForbiddenError, NotFoundError } = require('../errors/AppError');
const { ACTIONS, authorizeAndResolve, authorizePath } = require('./authorizationService');
const {
  getSharesForSourceTargets,
  getSharesBySourceTarget,
  shareTargetKey,
  deleteSharesByIds,
} = require('./sharesService');
const pathBindings = require('./pathBindingsService');
const folderSizeHooks = require('./folderSizeHooks');
const config = require('../config/index');
const { getIndexDb } = require('./indexDb');
const folderSizeIndex = require('./folderSizeIndex');
const { getVolumeScope } = require('./folderSizeIndexer');
const { scheduleThumbnailRemoval } = require('./thumbnailService');
const trash = require('./trash');
const { getTrashSettings } = require('./trash/settings');

// How often (ms) progress is reported to the caller while bytes stream, so a
// large file emits a steady trickle of updates rather than one per chunk.
const PROGRESS_THROTTLE_MS = 75;
// Node defaults file streams to 64 KiB buffers. That makes a 90 GiB transfer
// cross JavaScript over 1.4 million times. Keep the transfer cancellable, but
// use a bounded 4 MiB buffer to cut that overhead drastically without growing
// memory with the size of the copy.
const COPY_STREAM_HIGH_WATER_MARK = 4 * 1024 * 1024;
/**
 * Which engine moves and removes files, asked at the moment it matters.
 *
 * There are two implementations of every transfer — `rsync` and `rm` on one
 * side, streams and `fs.rm` on the other — and the choice used to be frozen
 * into a constant when the module loaded, from the platform the process
 * happened to be running on. Each half was then only ever exercised where it
 * was chosen: the native path is unreachable on a developer's macOS machine,
 * and the JavaScript path is unreachable on the Linux that CI runs. Nobody ran
 * both, and no test named the setting at all — `FILE_TRANSFER_ENGINE` appeared
 * exactly once in the repository, in the line above.
 *
 * So it is a question now rather than a constant, and `native` is accepted as
 * well as `stream`. The default is unchanged — native on Linux, streams
 * elsewhere — and naming either one explicitly makes both reachable from a
 * test, wherever the test is running.
 */
const nativeTransferEnabled = () => {
  const configured = process.env.FILE_TRANSFER_ENGINE;
  if (configured === 'stream') return false;
  if (configured === 'native') return true;
  return process.platform === 'linux';
};
const activeNativeOperations = new Map();
const activeWriteOperations = new Map();
let nextNativeOperationId = 1;
let nextWriteOperationId = 1;

const isPathWithin = (candidatePath, parentPath) =>
  candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);

// Coordinate mutation requests with an in-flight write. A copy fills a hidden
// entry inside the destination folder, and lands under its name once whole;
// deleting that folder, or the landed entry, must stop and reap the writer
// first, otherwise the child process keeps writing into a path that no longer
// exists. `displayName` is what diagnostics show while the path is hidden.
const registerWriteOperation = (
  sourcePath,
  destinationPath,
  parentSignal,
  displayName = path.basename(destinationPath)
) => {
  const id = nextWriteOperationId;
  nextWriteOperationId += 1;
  const controller = new AbortController();
  let complete;
  const completion = new Promise((resolve) => {
    complete = resolve;
  });
  const abortFromParent = () => controller.abort();

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const operation = {
    id,
    sourcePath,
    destinationPath,
    sourceName: path.basename(sourcePath),
    destinationName: displayName,
    startedAt: Date.now(),
    cancel: () => controller.abort(),
    completion,
  };
  activeWriteOperations.set(id, operation);

  let finished = false;
  return {
    signal: controller.signal,
    /** The entry has landed under a name: a deletion of that name now waits for it. */
    retarget: (landedPath) => {
      operation.destinationPath = landedPath;
      operation.destinationName = path.basename(landedPath);
    },
    finish: () => {
      if (finished) return;
      finished = true;
      parentSignal?.removeEventListener('abort', abortFromParent);
      activeWriteOperations.delete(id);
      complete();
    },
  };
};

const cancelWritesTargeting = async (absolutePath) => {
  const operations = Array.from(activeWriteOperations.values()).filter((operation) =>
    isPathWithin(operation.destinationPath, absolutePath)
  );
  if (operations.length === 0) return;

  operations.forEach((operation) => operation.cancel());
  await Promise.all(operations.map((operation) => operation.completion));
};

const registerNativeOperation = (type, child, sourcePath, destinationPath = null) => {
  const id = nextNativeOperationId;
  nextNativeOperationId += 1;
  activeNativeOperations.set(id, {
    id,
    type,
    pid: child?.pid || null,
    sourceName: path.basename(sourcePath),
    ...(destinationPath ? { destinationName: path.basename(destinationPath) } : {}),
    startedAt: Date.now(),
  });
  return id;
};

const unregisterNativeOperation = (id) => {
  if (id != null) activeNativeOperations.delete(id);
};

const getDiagnosticsSnapshot = () => {
  const now = Date.now();
  return {
    nativeTransferEnabled: nativeTransferEnabled(),
    activeNativeOperations: Array.from(activeNativeOperations.values())
      .map((operation) => ({ ...operation, ageMs: now - operation.startedAt }))
      .sort((a, b) => b.ageMs - a.ageMs)
      .slice(0, 5),
    activeWriteOperations: Array.from(activeWriteOperations.values())
      .map((operation) => ({
        id: operation.id,
        sourceName: operation.sourceName,
        destinationName: operation.destinationName,
        ageMs: now - operation.startedAt,
      }))
      .sort((a, b) => b.ageMs - a.ageMs)
      .slice(0, 5),
  };
};

const createCancellationError = () => {
  const error = new Error('Operation cancelled.');
  error.code = 'OPERATION_CANCELLED';
  return error;
};

const throwIfCancelled = (signal) => {
  if (signal?.aborted) throw createCancellationError();
};

const getFolderSizeLookup = async () => {
  if (!config.folderSize.enabled) return null;
  try {
    return { db: await getIndexDb(), scope: getVolumeScope() };
  } catch (_) {
    // Folder-size indexing is optional. A transfer must never depend on it.
    return null;
  }
};

const indexedDirectorySize = (lookup, absolutePath) => {
  if (!lookup || !folderSizeIndex.isWithinRoot(lookup.scope.root, absolutePath)) return null;
  const entry = folderSizeIndex.getByAbsolutePath(lookup.db, absolutePath);
  return Number.isFinite(entry?.sizeBytes) ? entry.sizeBytes : null;
};

const parseRsyncProgress = (line) => {
  const match = line.match(/^\s*([\d,]+)\s+(\d+)%/);
  if (!match) return null;
  return {
    copiedBytes: Number(match[1].replaceAll(',', '')) || 0,
    percent: Math.min(100, Number(match[2]) || 0),
  };
};

const stopChildProcessGroup = (child, signal) => {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (_) {
    child.kill(signal);
  }
};

// rsync keeps file transfer outside the Node event loop while retaining three
// properties the UI needs: safe argv handling, global progress, and immediate
// cancellation. It is used only in the Linux container; local development and
// the explicit FILE_TRANSFER_ENGINE=stream override keep the JS fallback.
/**
 * rsync stops at 23 for a "partial transfer due to error", which covers a great
 * deal more than permissions — a vanished source file gets the same code. The
 * message is what distinguishes the case worth retrying, so both are required.
 */
const isPermissionPreservationFailure = (exitCode, stderr) =>
  exitCode === 23 && /failed to set permissions/i.test(stderr || '');

const runRsyncCopy = (
  sourcePath,
  destinationPath,
  onProgress,
  signal,
  { preservePermissions, inPlace = false }
) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancellationError());
      return;
    }

    const child = spawn(
      'rsync',
      [
        '-a',
        '--no-owner',
        '--no-group',
        ...(preservePermissions ? [] : ['--no-perms']),
        // Written at the path it is given rather than under a temporary name of
        // rsync's own: that path is hidden and recorded, the temporary is not.
        ...(inPlace ? ['--inplace'] : []),
        '--info=progress2',
        '--outbuf=L',
        '--out-format=%n',
        '--',
        sourcePath,
        destinationPath,
      ],
      {
        detached: true,
        env: { ...process.env, LC_ALL: 'C' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const operationId = registerNativeOperation('rsync', child, sourcePath, destinationPath);
    let output = '';
    let errorOutput = '';
    let settled = false;
    let killTimer = null;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
      unregisterNativeOperation(operationId);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    /**
     * Progress stops at the moment the operation does.
     *
     * A cancelled copy is killed with a signal, and what the child had already
     * written to its pipe arrives afterwards — so a caller that has finished
     * with the transfer, and taken down whatever it was keeping for it, was
     * still being told how far the copy had got. Nothing in the application
     * minded; a test that wrote to disk from its progress callback did, which is
     * how it came to light, and it is the right answer either way: an operation
     * that is over reports nothing.
     */
    const emitOutput = (chunk) => {
      if (settled || signal?.aborted) return;
      output += chunk.toString();
      const lines = output.split(/[\r\n]/);
      output = lines.pop() || '';
      for (const line of lines) {
        const progress = parseRsyncProgress(line);
        if (progress) onProgress?.(progress);
      }
    };
    const abort = () => {
      stopChildProcessGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => stopChildProcessGroup(child, 'SIGKILL'), 3000);
    };

    child.stdout.on('data', emitOutput);
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) => {
      if (signal?.aborted) return finish(reject, createCancellationError());
      if (code === 0) return finish(resolve);
      const error = new Error(errorOutput.trim() || `Native copy failed with exit code ${code}.`);
      error.code = 'NATIVE_COPY_FAILED';
      error.exitCode = code;
      error.stderr = errorOutput;
      return finish(reject, error);
    });
    signal?.addEventListener('abort', abort, { once: true });
  });

/**
 * Copy with rsync, preserving permissions — and once more without them if that
 * is the only thing that failed.
 *
 * `-a` implies `-p`, so rsync chmods the destination after writing it. A ZFS
 * dataset with `aclmode=restricted` refuses that chmod, because new files there
 * must inherit the directory's ACL untouched (nxzai/NextExplorer#367). rsync
 * copies the contents correctly and only then fails, so the data is already
 * where it belongs and just the metadata step was refused.
 *
 * The retry is safe because rsync is idempotent: everything transferred in the
 * first pass is seen as up to date in the second, which therefore moves no
 * bytes and only finishes what the first could not. Preserving permissions
 * remains the default — the fallback happens where it cannot work, and nowhere
 * else.
 *
 * The retry reports no progress: percentages restart at zero for each rsync
 * invocation, and the caller turns them into an absolute byte count, so passing
 * them on would send the bar backwards for the moment the second pass takes.
 */
const copyWithNativeRsync = async (
  sourcePath,
  destinationPath,
  onProgress,
  signal,
  { inPlace = false } = {}
) => {
  // Where the answer is known in advance, skip the attempt that cannot succeed:
  // on a dataset that always refuses, every copy would otherwise pay for a
  // failed pass and a retry.
  if (!env.COPY_PRESERVE_PERMISSIONS) {
    return runRsyncCopy(sourcePath, destinationPath, onProgress, signal, {
      inPlace,
      preservePermissions: false,
    });
  }

  try {
    return await runRsyncCopy(sourcePath, destinationPath, onProgress, signal, {
      inPlace,
      preservePermissions: true,
    });
  } catch (error) {
    if (!isPermissionPreservationFailure(error?.exitCode, error?.stderr)) throw error;
    if (signal?.aborted) throw error;

    logger.info(
      { sourcePath, destinationPath },
      'Destination refuses to have its permissions set; copying again without preserving them'
    );
    return runRsyncCopy(sourcePath, destinationPath, undefined, signal, {
      inPlace,
      preservePermissions: false,
    });
  }
};

/**
 * Whether removing this entry is worth a child process.
 *
 * `rm -rf` earns its fork on a directory: the recursion happens in one native
 * call, and killing the process cancels it. A single file has neither — the
 * unlink is one syscall — so forking per file costs about 1.2 ms of process
 * setup against 0.06 ms of actual work. On a selection of two thousand files
 * that is over two seconds spent starting processes, and it only happens on
 * Linux, which is to say only in the container.
 */
/**
 * Whether the native tool could not be used at all, as opposed to having tried
 * and failed partway.
 *
 * The distinction is the whole point. A copy that fails midway has already
 * written something, and falling back would resume over a half-written tree.
 * These two failures happen before anything is written: the binary is not
 * there, or it is too old to understand what it was asked for.
 *
 * That second one is not hypothetical. `--info=progress2` arrived in rsync 3.1,
 * and RHEL 7 ships 3.0.9 while macOS ships 2.6.9 — on either, every copy failed
 * with a raw rsync usage error, while a working implementation in this same
 * file went unused. The setting documented for exactly this case
 * (`FILE_TRANSFER_ENGINE=stream`) only helped someone who already knew to reach
 * for it, after their copies had failed.
 */
const nativeToolIsUnusable = (error) => {
  if (error?.code === 'ENOENT') return true;
  const stderr = String(error?.stderr || error?.message || '');
  return /unrecognized option|unknown option|invalid option|illegal option/i.test(stderr);
};

/**
 * Set once a native tool has proved unusable, so the rest of the process stops
 * paying for an attempt whose answer is already known.
 */
const unusableNativeTools = new Set();

const recordUnusableNativeTool = (tool, error) => {
  if (unusableNativeTools.has(tool)) return;
  unusableNativeTools.add(tool);
  logger.warn(
    {
      tool,
      reason: String(error?.stderr || error?.message || '')
        .trim()
        .slice(0, 200),
    },
    `${tool} cannot be used here; falling back to the in-application implementation for the life of this process`
  );
};

const nativeToolUsable = (tool) => !unusableNativeTools.has(tool);

const shouldRemoveNatively = (isDirectoryEntry, nativeEnabled = nativeTransferEnabled()) =>
  Boolean(nativeEnabled) && Boolean(isDirectoryEntry);

const removeWithNativeRm = (absolutePath, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createCancellationError());
    const child = spawn('rm', ['-rf', '--', absolutePath], { detached: true, stdio: 'ignore' });
    const operationId = registerNativeOperation('rm', child, absolutePath);
    let settled = false;
    let killTimer = null;
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      if (killTimer) clearTimeout(killTimer);
      unregisterNativeOperation(operationId);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = () => {
      stopChildProcessGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => stopChildProcessGroup(child, 'SIGKILL'), 3000);
    };
    child.once('error', (error) => finish(reject, error));
    child.once('close', (code) => {
      if (signal?.aborted) return finish(reject, createCancellationError());
      if (code === 0) return finish(resolve);
      const error = new Error(`Native deletion failed with exit code ${code}.`);
      error.code = 'NATIVE_DELETE_FAILED';
      return finish(reject, error);
    });
    signal?.addEventListener('abort', abort, { once: true });
  });

/**
 * Where a copy is written until it is whole: a hidden entry beside where it
 * goes, under a name nobody else knows.
 *
 * Nothing is visible under the entry's name while it is written, so nobody can
 * put a file into a folder being filled, have it replaced by the copy, or have
 * it removed with the copy when the copy is cancelled. The name has a fixed
 * length, never derived from the file's: a long file name with a suffix
 * appended could pass the filesystem's limit.
 */
const stagingPathIn = (directory) =>
  path.join(directory, `.nextexplorer-copying-${crypto.randomUUID()}`);

/** Stream `sourcePath` into an open `handle`, settled once the handle is closed. */
const streamInto = (sourcePath, handle, onBytes, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      handle.close().then(
        () => reject(createCancellationError()),
        () => reject(createCancellationError())
      );
      return;
    }

    const readStream = fsSync.createReadStream(sourcePath, {
      highWaterMark: COPY_STREAM_HIGH_WATER_MARK,
    });
    const writeStream = fsSync.createWriteStream(null, {
      fd: handle,
      highWaterMark: COPY_STREAM_HIGH_WATER_MARK,
    });

    let failure = null;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error) => {
      if (failure || writeStream.writableFinished) return;
      failure = error;
      readStream.destroy();
      writeStream.destroy();
    };
    const abort = () => fail(createCancellationError());

    readStream.on('error', fail);
    writeStream.on('error', fail);
    if (typeof onBytes === 'function') {
      readStream.on('data', (chunk) => onBytes(chunk.length));
    }
    writeStream.once('close', () => {
      cleanup();
      if (failure) reject(failure);
      else if (writeStream.writableFinished) resolve();
      else reject(createCancellationError());
    });
    signal?.addEventListener('abort', abort, { once: true });
    readStream.pipe(writeStream);
  });

/**
 * Copy a single regular file through streams so bytes can be reported as they
 * are written. The source mode is applied at creation to mirror fs.copyFile.
 *
 * The file is created exclusively, so a copy never truncates a file it did not
 * create: its callers hand it a fresh hidden path, and a path that is somehow
 * taken fails the copy rather than being written into.
 */
const copyFileWithProgress = async (sourcePath, destinationPath, mode, onBytes, signal) => {
  throwIfCancelled(signal);
  const handle = await fs.open(destinationPath, 'wx', mode);
  try {
    await streamInto(sourcePath, handle, onBytes, signal);
  } catch (error) {
    // The file this copy created exclusively, and nothing else.
    await fs.unlink(destinationPath).catch(() => {});
    throw error;
  }

  // When it was last written, kept. A copy that stamps everything with the
  // moment it ran turns a folder of photographs sorted by date into a folder
  // all dated today, and there is no getting the dates back. `fs.cp` and rsync
  // both keep them; the path that reports progress reads a file itself, so it
  // has to put them back itself. Best-effort: a filesystem that will not take
  // them is not a reason to fail a copy that has already landed.
  try {
    const { atime, mtime } = await fs.lstat(sourcePath);
    await fs.utimes(destinationPath, atime, mtime);
  } catch (error) {
    logger.debug({ err: error, destinationPath }, 'Could not carry the times over to the copy');
  }
};

/** Make a symbolic link at `destinationPath`, pointing where the source's points. */
const copySymbolicLink = async (sourcePath, destinationPath) => {
  await fs.symlink(await fs.readlink(sourcePath), destinationPath);
};

// Recursively copy a file/dir, reporting copied bytes. It returns the actual
// copied byte count, so folder-size updates never need a second filesystem walk.
const copyEntryWithProgress = async (sourcePath, destinationPath, isDirectory, onBytes, signal) => {
  throwIfCancelled(signal);
  if (nativeTransferEnabled() && nativeToolUsable('rsync')) {
    const stats = await fs.lstat(sourcePath);
    try {
      if (stats.isDirectory()) {
        // rsync copies the directory itself when the source lacks a trailing
        // slash; the contract is to copy its contents into the target directory
        // instead. A file, or a link, is written by rsync at the target path
        // itself, which its callers hand over fresh.
        await ensureDir(destinationPath);
        await copyWithNativeRsync(
          `${sourcePath}${path.sep}`,
          `${destinationPath}${path.sep}`,
          onBytes,
          signal
        );
      } else {
        // A single file goes to a fresh hidden path: written there directly, so a
        // stop leaves nothing but what the in-flight journal names.
        await copyWithNativeRsync(sourcePath, destinationPath, onBytes, signal, { inPlace: true });
      }
      return stats.isDirectory() ? null : stats.size;
    } catch (error) {
      // Only when nothing was written. Anything else is a real failure and the
      // caller is the one who should hear about it.
      if (signal?.aborted || !nativeToolIsUnusable(error)) throw error;
      recordUnusableNativeTool('rsync', error);
    }
  }
  if (!isDirectory) {
    const stats = await fs.lstat(sourcePath);
    if (stats.isSymbolicLink()) {
      await copySymbolicLink(sourcePath, destinationPath);
      return 0;
    }
    await copyFileWithProgress(sourcePath, destinationPath, stats.mode, onBytes, signal);
    return stats.size;
  }

  await ensureDir(destinationPath);
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });
  let copiedBytes = 0;
  for (const entry of entries) {
    throwIfCancelled(signal);
    const src = path.join(sourcePath, entry.name);
    const dest = path.join(destinationPath, entry.name);
    copiedBytes += await copyEntryWithProgress(src, dest, entry.isDirectory(), onBytes, signal);
  }
  return copiedBytes;
};

/**
 * Copy an entry into `stagingPath`, hidden beside where it goes, and once it is
 * whole put it under `desiredName` in `directory`, or the first free name after
 * it. Answers the size copied and the name and path it took.
 *
 * Nothing holds the entry's name while it is written: the placement takes the
 * name by an operation that fails when it is held — a link for a file, a new
 * folder renamed over for a folder — so whatever arrived under it meanwhile is
 * kept, and the copy takes the next name.
 *
 * The hidden entry is recorded before it is created, so a stop half-way leaves
 * a record the next start removes it by. However the copy fails or is
 * cancelled, that hidden entry is removed, and only that: nobody else knows its
 * name, and nothing under a visible name is ever touched here.
 */
const copyIntoPlace = async ({
  sourcePath,
  stagingPath,
  directory,
  desiredName,
  entryIsDirectory,
  holdsFolderSize,
  onBytes,
  signal,
}) => {
  throwIfCancelled(signal);
  const inFlight = trackInFlight(stagingPath, 'staging-copy');
  const hold = holdsFolderSize ? folderSizeHooks.holdHiddenDirectory(stagingPath) : null;
  try {
    const size = await copyEntryWithProgress(
      sourcePath,
      stagingPath,
      entryIsDirectory,
      onBytes,
      signal
    );
    throwIfCancelled(signal);
    const placed = await placeWithoutOverwrite(stagingPath, directory, desiredName);
    return { size, placed };
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    hold?.release();
    inFlight.release();
  }
};

/**
 * Move an entry under `desiredName` in `directory`, or the first free name
 * after it, reporting progress, and answer the size moved and the name and path
 * it took.
 *
 * On one filesystem the entry is placed directly, never replacing what holds a
 * name: a file is linked under it and its old name removed, a folder renamed
 * over a new empty folder that refuses the rename once something is put inside.
 * It is instant, so the whole size is reported at once. Across devices (EXDEV)
 * the move becomes a copy under a hidden name, placed once whole, and only then
 * is the source removed. `onLanded` hears of the name as soon as the entry is
 * whole under it: from then on a failure, or a cancellation while the source is
 * removed, must never take that copy away, since it may be the only whole one.
 */
const moveIntoPlace = async ({
  sourcePath,
  stagingPath,
  directory,
  desiredName,
  entryIsDirectory,
  holdsFolderSize,
  size,
  onBytes,
  signal,
  onLanded,
}) => {
  throwIfCancelled(signal);
  let placed = null;
  try {
    placed = await placeWithoutOverwrite(sourcePath, directory, desiredName);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
  }
  if (placed) {
    await onLanded?.(placed);
    if (typeof onBytes === 'function' && size > 0) onBytes(size);
    return { size, placed };
  }

  const copied = await copyIntoPlace({
    sourcePath,
    stagingPath,
    directory,
    desiredName,
    entryIsDirectory,
    holdsFolderSize,
    onBytes,
    signal,
  });
  await onLanded?.(copied.placed);
  if (shouldRemoveNatively(entryIsDirectory)) await removeWithNativeRm(sourcePath, signal);
  else await fs.rm(sourcePath, { recursive: entryIsDirectory, force: true });
  return copied;
};

// Phase 1: authorize + resolve every item. Recursive directory-size walks are
// deliberately avoided here: a large copy used to read every source file once
// for progress, then read it all again to copy. Indexed directory sizes give a
// determinate bar in O(1); otherwise the UI uses its indeterminate state while
// the copy starts immediately.
const prepareTransfer = async (items, destination, operation, options = {}) => {
  const { signal } = options;
  throwIfCancelled(signal);
  if (!Array.isArray(items) || items.length === 0) {
    // The shape of the request, not the state of the server: a caller that
    // sends nothing to move is told so, rather than being answered 500 and
    // logged as an unexpected failure that says the server broke.
    throw new ValidationError('At least one item is required.');
  }

  const destinationRelative = normalizeRelativePath(destination);

  // Prevent copying/moving items directly to the root path
  if (!destinationRelative || destinationRelative.trim() === '') {
    throw new ValidationError(
      'Cannot copy or move items to the root path. Please select a specific volume or folder first.'
    );
  }

  const context = {
    user: options.user || null,
    guestSession: options.guestSession || null,
  };

  const {
    allowed: destAllowed,
    accessInfo: destAccess,
    resolved: destResolved,
  } = await authorizeAndResolve(context, destinationRelative, ACTIONS.read);
  if (!destAllowed || !destResolved) {
    throw new ForbiddenError(destAccess?.denialReason || 'Destination path is not writable.');
  }

  const { absolutePath: destinationAbsolute } = destResolved;
  const folderSizeLookup = await getFolderSizeLookup();

  const destinationStats = await fs.stat(destinationAbsolute).catch(() => null);
  if (!destinationStats?.isDirectory()) {
    throw new ValidationError('Destination path must be an existing directory.');
  }

  const plans = [];
  let totalBytes = 0;
  let hasUnknownSize = false;

  for (const item of items) {
    throwIfCancelled(signal);
    const sourceCombined = combineRelativePath(item.path || '', item.name);
    const {
      allowed: srcAllowed,
      accessInfo: srcAccess,
      resolved: srcResolved,
    } = await authorizeAndResolve(context, sourceCombined, ACTIONS.read);
    if (!srcAllowed || !srcResolved) {
      throw new ForbiddenError(
        srcAccess?.denialReason || `Source path not accessible: ${sourceCombined}`
      );
    }

    const { relativePath: sourceRelative, absolutePath: sourceAbsolute } = srcResolved;

    if (!(await pathExists(sourceAbsolute))) {
      throw new NotFoundError(`Source path not found: ${sourceRelative}`);
    }

    if (operation === 'move') {
      const { allowed: deleteAllowed, accessInfo: deleteAccess } = await authorizePath(
        context,
        sourceCombined,
        ACTIONS.delete
      );
      if (!deleteAllowed) {
        throw new ForbiddenError(deleteAccess?.denialReason || 'Cannot move items from this path.');
      }
    }

    const stats = await fs.stat(sourceAbsolute);
    const isDirectory = stats.isDirectory();
    // The destination cannot be the top level, and neither can what is carried
    // from it: a volume is a mount, and moving one out of the list is the same
    // loss as deleting it (nxzai/NextExplorer#409).
    assertNotTopLevelEntry(item.path || '', operation === 'move' ? 'moved' : 'copied', isDirectory);
    const sourceParent = normalizeRelativePath(path.dirname(sourceRelative));

    if (
      isDirectory &&
      (destinationAbsolute === sourceAbsolute ||
        destinationAbsolute.startsWith(`${sourceAbsolute}${path.sep}`))
    ) {
      throw new ValidationError('Cannot copy or move a folder into itself.');
    }

    if (operation === 'move' && destinationRelative === sourceParent) {
      plans.push({ sourceRelative, skipped: true });
      continue;
    }

    const destinationAction = isDirectory ? ACTIONS.createFolder : ACTIONS.createFile;
    const { allowed: createAllowed, accessInfo: createAccess } = await authorizePath(
      context,
      destinationRelative,
      destinationAction
    );
    if (!createAllowed) {
      throw new ForbiddenError(
        createAccess?.denialReason || 'Cannot create items in the destination path.'
      );
    }

    // A copied directory may contain files as well as folders. Do not let the
    // directory permission become a way around the file creation restriction.
    if (isDirectory) {
      const { allowed: filesAllowed, accessInfo: filesAccess } = await authorizePath(
        context,
        destinationRelative,
        ACTIONS.createFile
      );
      if (!filesAllowed) {
        throw new ForbiddenError(
          filesAccess?.denialReason || 'Cannot create files in the destination path.'
        );
      }
    }

    // The name the item lands under is joined onto the destination, which is
    // the only directory authorized above. Taken from the request as it came,
    // `../x` or `../../x` wrote beside or above it — out of a read-only parent,
    // out of a share into the volume — and `.nextexplorer` planted a zone name.
    // A new name has to be a name; without one, the item keeps the name it has
    // on disk, not the one the request spelled.
    const desiredName =
      item.newName === undefined || item.newName === null || item.newName === ''
        ? path.basename(sourceAbsolute)
        : ensureValidName(item.newName);

    const size = isDirectory ? indexedDirectorySize(folderSizeLookup, sourceAbsolute) : stats.size;
    if (Number.isFinite(size)) totalBytes += size;
    else hasUnknownSize = true;

    plans.push({
      sourceAbsolute,
      sourceRelative,
      isDirectory,
      size,
      desiredName,
    });
  }

  return {
    destinationRelative,
    destinationAbsolute,
    plans,
    totalBytes: hasUnknownSize ? 0 : totalBytes,
    totalItems: plans.filter((plan) => !plan.skipped).length,
  };
};

// Phase 2: perform the copy/move for each prepared plan, reporting progress via
// onProgress({ copiedBytes, totalBytes, currentName }). Runs after the response
// has switched to streaming mode, so an error here is surfaced in the stream.
const executeTransfer = async (prep, operation, onProgress, options = {}) => {
  const { destinationRelative, destinationAbsolute, plans, totalBytes } = prep;
  const { signal } = options;

  throwIfCancelled(signal);
  const destinationStats = await fs.stat(destinationAbsolute).catch(() => null);
  if (!destinationStats?.isDirectory()) {
    throw new NotFoundError('Destination path no longer exists.');
  }

  const results = [];
  let copiedBytes = 0;
  let lastEmit = 0;
  let currentName = '';
  let nativePercent = null;
  let activeTarget = null;
  let activeWriteOperation = null;
  const transferredDirectories = [];

  const emit = (force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_THROTTLE_MS) return;
    lastEmit = now;
    onProgress({
      copiedBytes,
      totalBytes,
      currentName,
      ...(nativePercent != null ? { percent: nativePercent } : {}),
    });
  };

  const onBytes = (delta) => {
    const wasAtStart = copiedBytes === 0;
    copiedBytes += delta;
    // Show the first byte immediately, then throttle the steady stream of
    // updates. Besides making the UI feel responsive, this lets an operation
    // become cancellable as soon as data starts moving.
    emit(wasAtStart);
  };

  try {
    for (const plan of plans) {
      throwIfCancelled(signal);
      if (plan.skipped) {
        results.push({ from: plan.sourceRelative, to: plan.sourceRelative, skipped: true });
        continue;
      }

      // What lands at the destination is the entry itself: a rename moves a
      // link as a link, and both engines copy one as a link.
      const entryIsDirectory = (await fs.lstat(plan.sourceAbsolute)).isDirectory();
      // Nothing is visible under the entry's name until it is whole there. A
      // copy is written under a hidden name beside it and put in place once
      // whole; a move is put in place directly. Either way the name is taken
      // by an operation that fails when it is held, so whatever arrived under
      // it meanwhile — another copy, a file saved over SMB — is kept, and the
      // entry takes "name (1)". A name held from the start by a visible
      // placeholder let others write into it while the copy ran.
      const stagingPath = stagingPathIn(destinationAbsolute);
      // `landedAt` once the entry is whole under its name: from then on
      // nothing removes it.
      const target = { isDirectory: plan.isDirectory, landedAt: null };
      activeTarget = target;
      const writeOperation = registerWriteOperation(
        plan.sourceAbsolute,
        stagingPath,
        signal,
        plan.desiredName
      );
      activeWriteOperation = writeOperation;
      currentName = plan.desiredName;
      nativePercent = null;
      emit(true);

      const copiedBeforePlan = copiedBytes;
      const onCopyProgress = (progress) => {
        if (typeof progress === 'number') {
          onBytes(progress);
          return;
        }
        nativePercent = Number.isFinite(progress?.percent) ? progress.percent : null;
        if (Number.isFinite(plan.size) && nativePercent != null) {
          copiedBytes = copiedBeforePlan + (plan.size * nativePercent) / 100;
        }
        emit(true);
      };

      const land = async (placed) => {
        target.landedAt = placed.path;
        writeOperation.retarget(placed.path);
        if (placed.name !== currentName) {
          currentName = placed.name;
          emit(true);
        }
        if (plan.isDirectory) {
          // The index entry is made under the name the folder landed at, and
          // held until the scan after the whole operation, so an on-view
          // refresh cannot publish a size for it meanwhile.
          await folderSizeHooks.beginDirectoryTransfer(placed.path);
        }
      };

      const placement = {
        sourcePath: plan.sourceAbsolute,
        stagingPath,
        directory: destinationAbsolute,
        desiredName: plan.desiredName,
        entryIsDirectory,
        holdsFolderSize: plan.isDirectory,
        onBytes: onCopyProgress,
        signal: writeOperation.signal,
      };

      if (operation === 'copy') {
        const copied = await copyIntoPlace(placement);
        await land(copied.placed);
        await folderSizeHooks.onEntryCopied(target.landedAt, {
          isDirectory: plan.isDirectory,
          size: copied.size ?? plan.size,
          sourceAbsolutePath: plan.sourceAbsolute,
          directoryTransferPrepared: plan.isDirectory,
        });
      } else if (operation === 'move') {
        const moved = await moveIntoPlace({ ...placement, size: plan.size, onLanded: land });
        await folderSizeHooks.onEntryMoved(plan.sourceAbsolute, target.landedAt, {
          isDirectory: plan.isDirectory,
          size: moved.size ?? plan.size,
          directoryTransferPrepared: plan.isDirectory,
        });
      } else {
        throw new ValidationError(`Unsupported operation: ${operation}`);
      }

      const targetAbsolute = target.landedAt;
      const targetRelative = combineRelativePath(
        destinationRelative,
        path.basename(targetAbsolute)
      );
      if (plan.isDirectory) transferredDirectories.push(targetAbsolute);

      // A move takes the folder's bindings with it — favorites, shares, recent
      // destinations, per-folder preferences. A copy leaves the original where
      // it is, so its bindings stay put and the copy starts with none.
      if (operation === 'move') {
        await pathBindings.movePath(plan.sourceRelative, targetRelative);
        // And the histories, whose versions stay where they were kept: even to
        // another volume, nothing is copied for them. A copy starts with none.
        await require('./versions/lifecycle').onMoved(plan.sourceAbsolute, targetAbsolute);
      }

      results.push({ from: plan.sourceRelative, to: targetRelative });
      activeWriteOperation.finish();
      activeWriteOperation = null;
      activeTarget = null;
    }

    // Snap to 100% once every entry is done when the total was known before
    // starting. Unknown directory totals intentionally stay indeterminate.
    if (totalBytes > 0) copiedBytes = totalBytes;
    emit(true);

    // Rebuild copied/moved directory indexes only after the complete operation
    // has finished writing. This avoids expensive disk scans competing with the
    // transfer and makes the eventual size authoritative.
    folderSizeHooks.refreshTransferredDirectories(transferredDirectories);

    return { destination: destinationRelative, items: results };
  } catch (error) {
    try {
      // An entry that had not landed left nothing under a visible name: its
      // hidden copy was removed where it failed or was cancelled, and it never
      // had an index entry. One that had landed stays whole where it is, even
      // when what followed failed or was cancelled — a move across disks may
      // already have removed part of its source — so its index entry is
      // released and scanned rather than left locked until the next restart.
      if (activeTarget?.landedAt && activeTarget.isDirectory) {
        folderSizeHooks.refreshTransferredDirectories([activeTarget.landedAt]);
      }
      // Completed entries remain after a cancellation and still need their final
      // directory-size scan.
      folderSizeHooks.refreshTransferredDirectories(transferredDirectories);
    } finally {
      // A deletion waiting on this write must always be released, even if one
      // of the optional folder-size hooks fails during transfer cleanup.
      activeWriteOperation?.finish();
    }
    throw error;
  }
};

const getShareSourceTarget = (resolved, includeChildren = false) => {
  if (!resolved) return null;

  if (resolved.userVolume) {
    const sourcePath = resolved.innerRelativePath
      ? `${resolved.userVolume.id}/${resolved.innerRelativePath}`
      : resolved.userVolume.id;
    return {
      sourceSpace: 'user_volume',
      sourcePath,
      includeChildren,
    };
  }

  return {
    sourceSpace: resolved.space || 'volume',
    sourcePath: resolved.innerRelativePath || resolved.relativePath || '',
    includeChildren,
  };
};

/**
 * Entries handled at once.
 *
 * Removals are independent and each one is mostly latency, not work: waiting
 * for them one at a time leaves the storage idle in between. A bind-mounted
 * volume measured ~3.7 ms per unlink where a native filesystem needs 0.06 ms,
 * and that gap is exactly what overlapping recovers.
 *
 * Sixteen is a compromise: high enough to hide that latency, low enough not
 * to bury a filesystem that answers quickly. BULK_DELETE_CONCURRENCY tunes it
 * for storage that behaves differently.
 */
// Keep the default aligned with the CPU capacity available to the container.
// The frontend deliberately sends delete batches one at a time, so this is the
// real upper bound rather than one of several multiplicative limits.
const DEFAULT_DELETE_CONCURRENCY = Math.max(
  1,
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
);
const DELETE_CONCURRENCY =
  env.BULK_DELETE_CONCURRENCY > 0 ? env.BULK_DELETE_CONCURRENCY : DEFAULT_DELETE_CONCURRENCY;

const resolveDeleteTargets = async (items = [], context, options = {}) => {
  if (!Array.isArray(items) || items.length === 0) {
    // Same as the transfer above: nothing to delete is a malformed request.
    throw new ValidationError('At least one item is required.');
  }

  const includeStats = options.includeStats !== false;
  const includeShareDescendants = Boolean(options.includeShareDescendants);
  const targets = new Array(items.length);

  const resolveOne = async (item, index) => {
    const combined = combineRelativePath(item.path || '', item.name);
    const { allowed, accessInfo, resolved } = await authorizeAndResolve(
      context,
      combined,
      ACTIONS.delete
    );
    if (!allowed || !resolved) {
      throw new ForbiddenError(accessInfo?.denialReason || 'Cannot delete items from this path.');
    }

    const { relativePath, absolutePath } = resolved;
    // One stat, not an existence probe followed by a stat: stat already answers
    // both questions, and on network storage each of those is a round trip.
    let stats = null;
    if (includeStats) {
      try {
        stats = await fs.stat(absolutePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const exists = includeStats ? stats !== null : null;
    const isDirectory = stats ? stats.isDirectory() : item?.kind === 'directory';

    // A volume is a mount, not a folder in it: deleting one from here would
    // take the whole of somebody's data with it (nxzai/NextExplorer#409).
    // Asked of the disk rather than of the caller, which says what it likes —
    // and only at the top, where the extra look costs nothing.
    if (isTopLevelEntry(item.path || '')) {
      const onDisk = stats || (await fs.stat(absolutePath).catch(() => null));
      assertNotTopLevelEntry(item.path || '', 'deleted', onDisk?.isDirectory() === true);
    }

    targets[index] = {
      item,
      relativePath,
      absolutePath,
      // Where it was reached through, and the share when it was one: the
      // trash records whose folder or share a deletion came from.
      space: resolved.space,
      shareInfo: resolved.shareInfo || null,
      exists,
      stats,
      isDirectory,
      // The delete-impact endpoint must include shares nested below a folder,
      // but it does not need a filesystem stat just to determine that. Looking
      // below a regular file is harmless (there cannot be matching children),
      // and avoids an avoidable disk round trip before every confirmation.
      shareSourceTarget: getShareSourceTarget(
        resolved,
        includeShareDescendants ? true : isDirectory
      ),
    };
  };

  // Same reasoning as the removals: each item costs an authorization check and
  // a stat, and on network storage those are round trips worth overlapping.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(DELETE_CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await resolveOne(items[index], index);
      }
    })
  );

  return targets;
};

const getDeleteImpact = async (items = [], options = {}) => {
  const context = {
    user: options.user || null,
    guestSession: options.guestSession || null,
  };
  const targets = await resolveDeleteTargets(items, context, {
    includeStats: false,
    includeShareDescendants: true,
  });
  const shares = await getSharesForSourceTargets(
    targets.map((target) => target.shareSourceTarget).filter(Boolean)
  );
  // Into the trash or gone for good, per item, so the confirmation can say
  // which before anyone presses the button — and, for each, how many share
  // links it carries: switched off and kept in the trash, or deleted with it.
  const trashPlan = await trash.describeTargets(targets);
  const sharesByTarget = await getSharesBySourceTarget(
    targets.map((target) => target.shareSourceTarget).filter(Boolean)
  );
  // And, for anything that is not coming back, the history it takes with it.
  // Only for those: into the trash a file keeps its versions and gets them
  // back when it is restored, so there is nothing to warn about.
  const versionLifecycle = require('./versions/lifecycle');
  trashPlan.items = await Promise.all(
    trashPlan.items.map(async (entry, index) => {
      const target = targets[index] || {};
      const linked = target.shareSourceTarget
        ? sharesByTarget.get(shareTargetKey(target.shareSourceTarget))
        : null;
      const withShares = { ...entry, shareCount: linked ? linked.length : 0 };
      if (entry.disposition !== 'permanent' || !target.absolutePath) return withShares;

      const history = await versionLifecycle.countUnder(target.absolutePath);
      return history.versions > 0
        ? { ...withShares, versionCount: history.versions, versionBytes: history.bytes }
        : withShares;
    })
  );

  return {
    shareCount: shares.length,
    shares,
    trash: trashPlan,
  };
};

const deleteItems = async (items = [], options = {}) => {
  const context = {
    user: options.user || null,
    guestSession: options.guestSession || null,
  };
  // The route may have resolved (and authorized) the targets already, so the
  // work is not repeated just to stream the result.
  const targets = options.targets || (await resolveDeleteTargets(items, context));

  // Into the trash unless the caller asked for a permanent deletion, or the
  // trash is switched off. Asked once for the whole selection.
  const trashSettings = options.permanent === true ? null : await getTrashSettings();
  const useTrash = Boolean(trashSettings?.enabled);
  const budgetFor = useTrash ? trash.budgetResolver(trashSettings) : null;

  // One database pass for the whole selection instead of one per file.
  const sharesByTarget = await getSharesBySourceTarget(
    targets.map((target) => target.shareSourceTarget).filter(Boolean)
  );

  // Indexed rather than appended: the removals finish out of order, but the
  // caller is answered in the order it asked.
  const results = new Array(targets.length);
  let completedItems = 0;

  const reportProgress = (target, relativePath) => {
    completedItems += 1;
    options.onProgress?.({
      completedItems,
      totalItems: targets.length,
      currentName: target.item?.name || relativePath,
      percent: Math.round((completedItems / targets.length) * 100),
    });
  };

  const removeOne = async (target, index) => {
    throwIfCancelled(options.signal);
    const { relativePath, absolutePath, exists, stats, isDirectory, shareSourceTarget } = target;
    const affectedShares = shareSourceTarget
      ? sharesByTarget.get(shareTargetKey(shareSourceTarget)) || []
      : [];

    if (!exists) {
      const deletedShareCount = await deleteSharesByIds(affectedShares.map((share) => share.id));
      results[index] = {
        path: relativePath,
        status: 'missing',
        ...(deletedShareCount > 0 ? { deletedShareCount } : {}),
      };
      reportProgress(target, relativePath);
      return;
    }

    const deletedEntryStats = stats || (await fs.stat(absolutePath));
    // A copy may still be writing its hidden entry inside this folder, or be
    // finishing an entry that has just landed under this name. Stop the writer
    // and wait for its cleanup before removing the tree.
    await cancelWritesTargeting(absolutePath);
    const isDirectoryEntry = isDirectory || deletedEntryStats.isDirectory();
    let trashItemId = null;
    // A cancelled copy removes only its hidden entry, but the entry asked for
    // may still have gone meanwhile. Then there is nothing left to put in the
    // trash, and the deletion finishes as it always did.
    if (useTrash && (await pathExists(absolutePath))) {
      const outcome = await trash.trashTarget(target, context, { budgetFor });
      if (outcome.status === 'missing') {
        results[index] = { path: relativePath, status: 'missing' };
        reportProgress(target, relativePath);
        return;
      }
      if (outcome.status !== 'trashed') {
        // Never turned into a permanent deletion here: the entry stays where
        // it is, and the person is asked whether to delete it for good.
        results[index] = {
          path: relativePath,
          status: 'kept',
          reason: outcome.reason,
          ...(outcome.reason === 'too-large'
            ? { size: outcome.size, budgetBytes: outcome.budgetBytes }
            : {}),
        };
        reportProgress(target, relativePath);
        return;
      }
      trashItemId = outcome.item.id;
      if (!isDirectoryEntry) scheduleThumbnailRemoval(absolutePath);
    } else if (shouldRemoveNatively(isDirectoryEntry) && nativeToolUsable('rm')) {
      try {
        await removeWithNativeRm(absolutePath, options.signal);
      } catch (error) {
        if (options.signal?.aborted || !nativeToolIsUnusable(error)) throw error;
        recordUnusableNativeTool('rm', error);
        await fs.rm(absolutePath, { recursive: true, force: true });
      }
    } else if (isDirectoryEntry) {
      await fs.rm(absolutePath, { recursive: true, force: true });
    } else {
      // The type is already known from the stat above; fs.rm would lstat again
      // just to decide what it is.
      await fs.unlink(absolutePath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      scheduleThumbnailRemoval(absolutePath);
    }
    folderSizeHooks.onEntryDeleted(absolutePath, {
      isDirectory: isDirectoryEntry,
      size: deletedEntryStats.size,
    });
    // Deleted for good, the history goes with it; into the trash, it went along.
    // What it took is carried back so the deletion can be written down whole:
    // one file on screen can be ten earlier copies of it on disk.
    let versionsTaken = null;
    if (!trashItemId) {
      versionsTaken = await require('./versions/lifecycle').onDeleted(absolutePath);
    }
    // In the trash, a share is switched off but kept with the item, so a restore
    // can bring it back; deleted for good, it goes for good.
    if (trashItemId) {
      await trash.suspendShares(
        trashItemId,
        shareSourceTarget,
        affectedShares.map((share) => share.id)
      );
    }
    const deletedShareCount = await deleteSharesByIds(affectedShares.map((share) => share.id));
    // Favorites, recent destinations and per-folder preferences, for every user
    // who had them — not just whoever pressed delete.
    const removedFavoriteCount = await pathBindings.forgetPath(relativePath, {
      includeChildren: isDirectoryEntry,
    });
    results[index] = {
      path: relativePath,
      status: trashItemId ? 'trashed' : 'deleted',
      ...(trashItemId ? { trashItemId } : {}),
      ...(deletedShareCount > 0 ? { deletedShareCount } : {}),
      ...(removedFavoriteCount > 0 ? { removedFavoriteCount } : {}),
      ...(versionsTaken?.versions > 0
        ? { versionsPurged: versionsTaken.versions, versionBytesPurged: versionsTaken.bytes }
        : {}),
    };
    reportProgress(target, relativePath);
  };

  let next = 0;
  const workers = Array.from({ length: Math.min(DELETE_CONCURRENCY, targets.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= targets.length) return;
      await removeOne(targets[index], index);
    }
  });

  await Promise.all(workers);

  return results;
};

/**
 * A transfer in one call, checked and then carried out.
 *
 * The two halves exist because a transfer reports as it goes and can be
 * stopped: the route checks first, so a refusal is an ordinary HTTP error, and
 * only then opens the stream. Everything that does not need to watch — the
 * trash putting something back, a test, a script — wants the one call, and the
 * answer it has always had.
 */
const transferItems = async (items, destination, operation, options = {}) => {
  const prep = await prepareTransfer(items, destination, operation, options);
  const result = await executeTransfer(prep, operation, () => {}, options);
  return { destination: prep.destinationRelative, ...result };
};

module.exports = {
  transferItems,
  prepareTransfer,
  executeTransfer,
  createCancellationError,
  getDeleteImpact,
  resolveDeleteTargets,
  deleteItems,
  shouldRemoveNatively,
  nativeTransferEnabled,
  nativeToolIsUnusable,
  getDiagnosticsSnapshot,
  // Exported for tests: the copy path is chosen inside a spawned process, so
  // the decision to retry is what can be checked without one.
  isPermissionPreservationFailure,
  copyWithNativeRsync,
  // Where a path is, as share links name it: the trash points a restored
  // share at the place its content went back to.
  getShareSourceTarget,
  // The trash restores across disks with the same copy a transfer uses:
  // permissions kept, links copied as links, progress reported, cancellable.
  copyEntryWithProgress,
};
