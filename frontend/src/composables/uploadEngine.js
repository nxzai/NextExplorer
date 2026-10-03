import { markRaw } from 'vue';
import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import Tus from '@uppy/tus';
import { useUppyStore } from '@/stores/uppyStore';
import { useFileStore } from '@/stores/fileStore';
import { useNotificationsStore } from '@/stores/notifications';
import { useAppSettings } from '@/stores/appSettings';
import { useVolumeUsageStore } from '@/stores/volumeUsage';
import { useFolderSizeStore } from '@/stores/folderSize';
import { useOperationTasksStore } from '@/stores/operationTasks';
import { apiBase, normalizePath, reserveFolderUploadTarget } from '@/api';
import {
  directUploadEndpoint,
  folderUploadParts,
  uploadPermission,
  uploadBlockedMessage,
} from './uploadTarget';
import { isDisallowedUpload } from '@/utils/uploads';
// The fallback ladder lives in utils so it can be tested without Uppy, a Pinia
// store and a browser around it.
import { nextFallbackMiB } from '@/utils/uploadFallback';
// So is the mode decision, for the same reason.
import {
  isInFallbackChunked,
  isLargeUpload,
  isWatchingDirectUploads,
  resolveUploadMode,
} from '@/utils/uploadMode';
import {
  createErrorNotifier,
  createUploadBatchId,
  getUploadFallbackMiB,
  resetUploadFallback,
  writeUploadFallbackMiB,
} from './uploadCommon';

/**
 * The part of uploading that is Uppy: the instance, its two uploaders, and
 * every decision taken on its events.
 *
 * Loaded when an upload is about to happen — a picker opened, a file dragged
 * over the page — rather than with the page, which is what it was: a few
 * hundred kilobytes on every first load for something most visits never do.
 * `fileUploader.js` asks for it, once, and hands it files only after this
 * has returned, so nothing reaches the network before every handler below is
 * in place: the reservation of a dropped folder's name, the choice between a
 * direct upload and TUS, the watchdog on a stalled one.
 *
 * One instance for the application, as before. It is torn down by whoever
 * owns the uploads — the layout — and not by the dialog that happened to ask
 * for it first.
 */
export const createUploadEngine = async () => {
  const uppyStore = useUppyStore();
  const fileStore = useFileStore();
  const notificationsStore = useNotificationsStore();
  const appSettings = useAppSettings();
  const volumeUsageStore = useVolumeUsageStore();
  const folderSizeStore = useFolderSizeStore();
  const operationTasksStore = useOperationTasksStore();
  const uploadTaskIds = new Map();
  const folderReservationByBatch = new Map();
  const notifyErrorOnce = createErrorNotifier(notificationsStore);

  let uppy = null;
  let uploadPluginMode = null;
  let uploadViewRefreshTimer = null;

  // Multer starts the file storage callback as soon as it receives the binary
  // part. Multipart metadata can legally arrive afterwards, so keep routing
  // data in the request URL where Express has it before the stream is opened.
  const reserveFolderUploadPaths = async (fileIDs) => {
    const groups = new Map();

    (Array.isArray(fileIDs) ? fileIDs : []).forEach((fileId) => {
      const file = uppy?.getFile?.(fileId);
      const parts = folderUploadParts(file);
      if (!file || !parts || file.meta?.resolvedRelativePath) return;

      const uploadTo = normalizePath(file.meta?.uploadTo || fileStore.currentPath || '');
      const uploadBatchId = file.meta?.uploadBatchId || createUploadBatchId();
      const key = `${uploadTo}\u0000${uploadBatchId}\u0000${parts[0]}`;
      if (!groups.has(key))
        groups.set(key, { uploadTo, uploadBatchId, sourceRoot: parts[0], files: [] });
      groups.get(key).files.push({ file, parts });
    });

    for (const [key, group] of groups) {
      let reservation = folderReservationByBatch.get(key);
      if (!reservation) {
        reservation = reserveFolderUploadTarget(group.uploadTo, group.sourceRoot);
        folderReservationByBatch.set(key, reservation);
      }

      const response = await reservation;
      const targetRoot = response?.targetRoot;
      if (!targetRoot) throw new Error('The server did not reserve a destination folder.');

      group.files.forEach(({ file, parts }) => {
        uppy.setFileMeta(file.id, {
          ...(file.meta || {}),
          uploadBatchId: group.uploadBatchId,
          resolvedRelativePath: [targetRoot, ...parts.slice(1)].join('/'),
        });
      });
    }
  };

  const releaseFolderReservations = (batchFiles = []) => {
    (Array.isArray(batchFiles) ? batchFiles : []).forEach((file) => {
      const parts = folderUploadParts(file);
      const uploadTo = normalizePath(file?.meta?.uploadTo || '');
      const uploadBatchId = file?.meta?.uploadBatchId;
      if (!parts || !uploadBatchId) return;
      folderReservationByBatch.delete(`${uploadTo}\u0000${uploadBatchId}\u0000${parts[0]}`);
    });
  };

  // A folder upload emits one success event per file. Wait for a short quiet
  // period so those events produce one listing refresh instead of repeatedly
  // aborting the preceding browse request.
  //
  // `refresh` rather than a fetch of the same path: this is the folder already on
  // screen being read again, not somebody walking into it. A fetch clears what is
  // selected, and this one lands the better part of a second after the upload —
  // long enough for the reader to have chosen a file in the meantime and watched
  // the choice disappear under them.
  const scheduleUploadViewRefresh = (delayMs = 700) => {
    if (uploadViewRefreshTimer) clearTimeout(uploadViewRefreshTimer);
    uploadViewRefreshTimer = setTimeout(() => {
      uploadViewRefreshTimer = null;
      fileStore.refresh().catch(() => {});
      volumeUsageStore.scheduleRefresh();
      folderSizeStore.scheduleRefresh();
    }, delayMs);
  };

  /** The decision and its reason together, from one rule rather than two. */
  const currentUploadPermission = () =>
    uploadPermission(fileStore.currentPathData, fileStore.currentPath);

  const canUploadToCurrentPath = () => currentUploadPermission().allowed;

  const blockedMessage = () => uploadBlockedMessage(currentUploadPermission().reason);

  // Chunk sizes tried on fallback (largest first, near the value that works
  // manually). Each PATCH stays well under a typical reverse-proxy body limit.
  // A direct upload that makes no progress for this long is treated as stalled.
  // A reverse proxy that silently stops reading an over-limit body never errors,
  // so a stall is the only signal we get for that case. Also used as the XHR
  // progress-timeout so Uppy emits `upload-stalled` on the same deadline.
  const DIRECT_STALL_MS = 20000;

  const readFallbackMiB = getUploadFallbackMiB;
  const writeFallbackMiB = writeUploadFallbackMiB;
  const clearFallbackMiB = resetUploadFallback;

  const getUploadSettings = () => resolveUploadMode(appSettings.state?.uploads, readFallbackMiB());

  // Auto-fallback modes (auto on, admin hasn't force-enabled chunking):
  //  - "direct":  no size learned yet  → uploads go out as a single XHR
  //  - "chunked": a size is remembered → uploads go through TUS
  const inDirectMode = () => isWatchingDirectUploads(appSettings.state?.uploads, readFallbackMiB());
  const inFallbackChunkedMode = () =>
    isInFallbackChunked(appSettings.state?.uploads, readFallbackMiB());
  const isLargeFile = isLargeUpload;

  const removeUploadPlugin = (id) => {
    const plugin = uppy?.getPlugin?.(id);
    if (plugin) {
      uppy.removePlugin(plugin);
    }
  };

  const removeCompletedUploadFiles = () => {
    const currentFiles = typeof uppy?.getFiles === 'function' ? uppy.getFiles() : [];
    currentFiles.forEach((file) => {
      if (!file?.id || file?.progress?.uploadComplete !== true) return;
      removeUploadFile(file);
    });
  };

  const finishUploadTask = (fileId) => {
    if (uploadTaskIds.size <= 1) stopWatchingFinalization();
    const operationId = uploadTaskIds.get(fileId);
    if (!operationId) return;
    uploadTaskIds.delete(fileId);
    operationTasksStore.finishOperation(operationId);
  };

  const removeUploadFile = (file) => {
    if (!file?.id) return;
    finishUploadTask(file.id);
    try {
      uppy.removeFile(file.id);
    } catch (_) {
      /* noop */
    }
  };

  const startUploadTask = (file, destination) => {
    if (!file?.id || uploadTaskIds.has(file.id)) return;
    const operationId = operationTasksStore.startOperation({
      type: 'upload',
      name: file.name || file.data?.name || '',
      destination,
      itemCount: 1,
      totalBytes: Number(file.size) || 0,
      copiedBytes: 0,
      cancellable: true,
      cancel: () => {
        removeUploadFile(file);
        scheduleUploadViewRefresh(100);
      },
      // A chunked upload can be held and picked up again: the bytes already sent
      // stay sent. A direct one cannot — there is nothing to pick up from — so it
      // is not offered. A file that falls back to chunks is added again under a
      // new id, and the task it starts then says so on its own.
      pausable: uploadPluginMode === 'tus',
      pause: () => uppy.pauseResume(file.id),
      resume: () => uppy.pauseResume(file.id),
    });
    uploadTaskIds.set(file.id, operationId);
  };

  const updateUploadTask = (file, progress) => {
    const operationId = uploadTaskIds.get(file?.id);
    if (!operationId) return;
    const totalBytes = Number(progress?.bytesTotal) || Number(file?.size) || 0;
    const uploadedBytes = Number(progress?.bytesUploaded) || 0;
    operationTasksStore.updateOperation(operationId, {
      totalBytes,
      copiedBytes: Math.min(uploadedBytes, totalBytes || Number.POSITIVE_INFINITY),
    });

    // Every byte is out, but the server may still be writing the file where it
    // belongs — a copy, whenever the upload cache and the destination volume are
    // separate filesystems. Nothing more will arrive on this progress event, so
    // from here the server is the only one who knows how far along it is.
    if (totalBytes > 0 && uploadedBytes >= totalBytes) watchFinalization();
  };

  // Ask only while something is waiting on it, and stop as soon as the server
  // has nothing left to report.
  const FINALIZATION_POLL_MS = 750;
  let finalizationTimer = null;

  const stopWatchingFinalization = () => {
    if (finalizationTimer) clearTimeout(finalizationTimer);
    finalizationTimer = null;
  };

  const applyFinalization = (items) => {
    const byName = new Map(items.map((item) => [item.name, item]));

    uploadTaskIds.forEach((operationId, fileId) => {
      const file = uppy?.getFile?.(fileId);
      const name = file?.name || '';
      const item = byName.get(name);
      if (!item) return;

      operationTasksStore.updateOperation(operationId, {
        finalizing: true,
        finalizedBytes: Number(item.copiedBytes) || 0,
        finalizedTotalBytes: Number(item.totalBytes) || 0,
      });
    });
  };

  const watchFinalization = () => {
    if (finalizationTimer || uploadTaskIds.size === 0) return;

    finalizationTimer = setTimeout(async () => {
      finalizationTimer = null;
      if (uploadTaskIds.size === 0) return;

      let items = [];
      try {
        const response = await fetch(`${apiBase}/api/upload/finalizations`, {
          credentials: 'include',
        });
        if (response.ok) items = (await response.json())?.items || [];
      } catch (_) {
        // A dropped poll says nothing about the upload itself; try again.
      }

      applyFinalization(Array.isArray(items) ? items : []);
      if (uploadTaskIds.size > 0) watchFinalization();
    }, FINALIZATION_POLL_MS);
  };

  const getTusErrorStatus = (error) => {
    if (typeof error?.originalResponse?.getStatus === 'function') {
      return error.originalResponse.getStatus();
    }
    return null;
  };

  /**
   * The reason the server gave when every byte arrived but the file could not
   * be put in its folder, or '' when it gave none.
   *
   * Nothing is gained by trying again. A retry asks for the offset first, the
   * offset is complete, and before the server said otherwise the client took
   * that as an upload that had succeeded; falling back to smaller chunks would
   * send the whole file again into the same failure.
   */
  const getFinalizeError = (error) => {
    const raw = error?.originalResponse?.getHeader?.('Upload-Finalize-Error');
    if (!raw) return '';
    try {
      return decodeURIComponent(raw);
    } catch (_) {
      return String(raw);
    }
  };

  const isNetworkUploadError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
      error instanceof TypeError ||
      message.includes('network error') ||
      message.includes('failed to fetch') ||
      // Safari's fetch says "Load failed" where Chrome says "Failed to fetch",
      // and tus-js-client quotes it inside its own message. Anchored on a word
      // boundary because a plain "Upload failed" is not a network diagnosis:
      // matching it would replace whatever the server said with a sentence
      // about the connection.
      /(?:^|[^a-z])load failed/.test(message) ||
      message.includes('networkerror') ||
      message.includes('unexpected response while uploading chunk') ||
      message.includes('unexpected response while creating upload')
    );
  };

  const configureUploadPlugin = () => {
    if (!uppy) return;

    const uploadSettings = getUploadSettings();
    const nextMode = uploadSettings.chunkedEnabled ? 'tus' : 'xhr';

    if (uploadPluginMode === nextMode) {
      if (nextMode === 'tus') {
        uppy.getPlugin('Tus')?.setOptions?.({
          chunkSize: uploadSettings.chunkSizeBytes,
        });
      }
      return;
    }

    removeUploadPlugin('XHRUpload');
    removeUploadPlugin('Tus');

    if (nextMode === 'tus') {
      uppy.use(Tus, {
        endpoint: `${apiBase}/api/upload/tus`,
        chunkSize: uploadSettings.chunkSizeBytes,
        allowedMetaFields: [
          'name',
          'type',
          'uploadTo',
          'relativePath',
          'resolvedRelativePath',
          'uploadBatchId',
        ],
        removeFingerprintOnSuccess: true,
        storeFingerprintForResuming: false,
        // Resume a dropped chunk a few times before giving up. The browser File is
        // disk-backed and @tus/server resumes from the last stored offset, so a
        // retry re-sends only the unacknowledged bytes — not the whole file, and
        // nothing is held in memory. Without this a single transient drop
        // ("server connection was lost") kills a whole large-chunk upload.
        retryDelays: [0, 1000, 3000, 5000, 10000],
        onShouldRetry: (error, _retryAttempt, _options, next) => {
          if (getFinalizeError(error)) return false; // received, but not placed — see above
          const status = getTusErrorStatus(error);
          if (status === 507) return false; // storage full — retrying won't help
          if (status && status >= 400 && status < 500) return false; // auth / permission / too large
          if (isNetworkUploadError(error)) return true; // transient drop — resume from the offset
          return next(error);
        },
        withCredentials: true,
      });
    } else {
      uppy.use(XHRUpload, {
        endpoint: directUploadEndpoint,
        formData: true,
        fieldName: 'filedata',
        bundle: false,
        responseType: 'json',
        // Uppy v5 expects `allowedMetaFields` to be `true` (all) or an explicit list.
        // `null` results in *no* metadata being sent, which breaks `uploadTo`/`relativePath`.
        allowedMetaFields: true,
        withCredentials: true,
        // Uppy's fetcher retries a failed request up to 3x by default, re-sending
        // the ENTIRE (possibly multi-GB) body each time. Against a proxy body-size
        // limit that just repeats a doomed upload and buries the chunked fallback
        // behind minutes of re-uploading. Fail on the FIRST error so auto-fallback
        // can switch to TUS immediately (TUS is our resilience mechanism, and it
        // resumes from the last stored offset rather than re-sending the file).
        shouldRetry: () => false,
        // Emit `upload-stalled` after this long with no progress, so a silently
        // stalled body (proxy stopped reading, no error) is caught quickly.
        timeout: DIRECT_STALL_MS,
      });
    }

    uploadPluginMode = nextMode;
  };

  // Pick the next chunk size to try. First fallback (no size learned yet): the
  // largest ladder step below where the direct upload got cut off (a hint at the
  // proxy limit), else the largest. Otherwise step down to the next smaller size.
  const nextLadderMiB = (observedBytes) => nextFallbackMiB(readFallbackMiB(), observedBytes);

  // Restart a file as a FRESH chunked (TUS) upload — identical to the working
  // manual chunked path (a page load with chunking configured), which is why it
  // is reliable where a mid-flight plugin swap + retryUpload was not: the swap
  // happens while Uppy is idle (after the failed/stalled batch settles), then a
  // brand-new file is added and uploaded by the freshly-installed TUS plugin.
  // Returns true if a restart was scheduled (caller suppresses the error),
  // false if we exhausted the ladder and gave up.
  const restarting = new Set();
  const restartAsChunked = (file, observedBytes) => {
    if (!file?.id) return false;
    if (restarting.has(file.id)) return true;

    const nextMiB = nextLadderMiB(observedBytes);
    if (!nextMiB) {
      // Even the smallest chunk failed → not a body-size problem. Revert to
      // direct so a future upload isn't stuck in chunked mode, and let the error
      // surface to the user.
      clearFallbackMiB();
      return false;
    }

    restarting.add(file.id);
    writeFallbackMiB(nextMiB);
    const originalMeta = file.meta ? { ...file.meta } : {};
    const descriptor = { name: file.name, type: file.type, data: file.data, meta: originalMeta };
    // Defer until Uppy has settled the current (failed/stalled) batch, so the
    // plugin swap runs on an idle instance — the reliable path.
    setTimeout(() => {
      try {
        removeUploadFile(file); // aborts the in-flight XHR if it is still hanging
        configureUploadPlugin(); // now TUS with the chosen chunk size
        const newId = uppy.addFile(descriptor); // autoProceed re-uploads via TUS
        // file-added rewrites uploadTo/relativePath from the current path; restore
        // the original target in case the user navigated during the upload.
        if (newId) uppy.setFileMeta(newId, originalMeta);
      } catch (err) {
        console.error('Auto-fallback restart failed', err);
        restarting.delete(file.id);
      }
    }, 0);
    return true;
  };

  // A large upload failed or stalled. Decide whether/how to fall back to chunks.
  //  - direct mode  → switch this origin to chunked (learn a size)
  //  - chunked mode → step the ladder down (the current size also failed)
  // Skip errors chunking can't fix (auth / permission / storage full).
  const handleUploadFailure = (file, status, observedBytes) => {
    if (!file?.data || !isLargeFile(file)) return false;
    if (status === 401 || status === 403 || status === 507) return false;
    if (inDirectMode() || inFallbackChunkedMode()) {
      return restartAsChunked(file, observedBytes);
    }
    return false;
  };

  // Stall watchdog: a proxy that silently stops reading an over-limit body never
  // errors, so a timer trips the fallback when a DIRECT upload freezes. Armed at
  // upload start (so even a 0-byte stall is caught) and cleared on `complete`.
  const progressAt = new Map(); // fileId -> { bytes, at }
  let watchdogTimer = null;
  const clearFallbackTracking = () => {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    progressAt.clear();
    restarting.clear();
  };
  const startWatchdog = () => {
    if (watchdogTimer || !inDirectMode()) return;
    watchdogTimer = setInterval(() => {
      const list = typeof uppy?.getFiles === 'function' ? uppy.getFiles() : [];
      const active = list.filter((f) => !f?.progress?.uploadComplete && isLargeFile(f));
      // Nothing left to watch, or we've already switched to chunked — stop the
      // timer (a pending restart is already scheduled and guarded independently).
      if (active.length === 0 || !inDirectMode()) {
        clearFallbackTracking();
        return;
      }
      const now = Date.now();
      for (const f of active) {
        const tracked = progressAt.get(f.id);
        if (tracked && now - tracked.at > DIRECT_STALL_MS) {
          progressAt.delete(f.id);
          if (restartAsChunked(f, tracked.bytes)) break;
        }
      }
    }, 5000);
  };
  const trackProgress = (file, progress) => {
    const bytes = Number(progress?.bytesUploaded) || 0;
    const prev = progressAt.get(file.id);
    // Only advance the timestamp when bytes actually grow, so a freeze is caught.
    if (!prev || bytes > prev.bytes) progressAt.set(file.id, { bytes, at: Date.now() });
  };
  // Arm the watchdog when a direct-mode batch starts (seed each large file's
  // progress clock now, so a stall that never emits a progress event is caught).
  const armFallbackWatchdog = (batchFiles) => {
    if (!inDirectMode()) return;
    const now = Date.now();
    (Array.isArray(batchFiles) ? batchFiles : []).forEach((f) => {
      if (isLargeFile(f) && !progressAt.has(f.id)) progressAt.set(f.id, { bytes: 0, at: now });
    });
    startWatchdog();
  };

  uppy = new Uppy({
    debug: import.meta.env.DEV,
    autoProceed: true,
    store: uppyStore,
  });

  configureUploadPlugin();

  // DropTarget bypasses the native folder picker. Give every dropped folder
  // a common batch id, then reserve its destination in the preprocessor below
  // before XHRUpload or Tus is allowed to start sending bytes.
  uppy.on('files-added', (addedFiles) => {
    const batchId = createUploadBatchId();
    (Array.isArray(addedFiles) ? addedFiles : []).forEach((file) => {
      const parts = folderUploadParts(file);
      if (parts && !file.meta?.uploadBatchId) {
        uppy.setFileMeta(file.id, { ...(file.meta || {}), uploadBatchId: batchId });
      }
    });
  });

  uppy.addPreProcessor(reserveFolderUploadPaths);

  // Cookies carry auth; no token headers
  uppy.on('file-added', (file) => {
    if (!canUploadToCurrentPath()) {
      uppy.removeFile?.(file.id);
      notifyErrorOnce(blockedMessage(), { durationMs: 5000 });
      return;
    }

    if (isDisallowedUpload(file?.name)) {
      uppy.removeFile?.(file.id);
      return;
    }

    // Ensure server always receives a usable relativePath, even for drag-and-drop
    const inferredRelativePath =
      file?.meta?.relativePath ||
      file?.data?.webkitRelativePath ||
      file?.name ||
      (file?.data && file?.data.name) ||
      '';

    // Some rare DnD sources may miss name; prefer data.name if present
    if (!file?.name && file?.data?.name && typeof uppy.setFileName === 'function') {
      try {
        uppy.setFileName(file.id, file.data.name);
      } catch (_) {
        /* noop */
      }
    }

    const uploadTo = normalizePath(fileStore.currentPath || '');
    uppy.setFileMeta(file.id, {
      ...(file.meta || {}),
      uploadTo,
      relativePath: inferredRelativePath,
      // Uppy stringifies every field listed in `allowedMetaFields`, carried by
      // the file or not, so a field left unset reaches the server as the
      // literal "undefined". Only folder uploads fill this one in.
      resolvedRelativePath: file?.meta?.resolvedRelativePath || '',
    });
    startUploadTask(file, uploadTo);
  });

  uppy.on('upload', (_uploadID, batchFiles) => {
    const files = Array.isArray(batchFiles) ? batchFiles : [];

    // Safety net: if permissions changed after files were queued, cancel *only* when the
    // batch is targeting the currently-viewed path (avoids canceling uploads after navigation).
    const current = normalizePath(fileStore.currentPath || '');
    const targetsCurrentPath =
      files.length > 0 && files.every((f) => normalizePath(f?.meta?.uploadTo || '') === current);

    if (targetsCurrentPath && !canUploadToCurrentPath()) {
      try {
        uppy.cancelAll?.();
      } catch (_) {
        /* noop */
      }
      files.forEach((file) => finishUploadTask(file.id));
      notifyErrorOnce(blockedMessage(), { durationMs: 5000 });
      return;
    }

    // Uploads are proceeding — start the stall watchdog for direct-mode uploads.
    armFallbackWatchdog(files);
  });

  uppy.on('upload-progress', (file, progress) => {
    trackProgress(file, progress);
    updateUploadTask(file, progress);
  });

  // XHRUpload emits this after `timeout` ms with no progress — the only signal
  // for a body a proxy silently stopped reading. Switch to chunks immediately.
  uppy.on('upload-stalled', (_error, files) => {
    if (!inDirectMode()) return;
    (Array.isArray(files) ? files : []).forEach((file) => {
      if (isLargeFile(file)) {
        restartAsChunked(file, Number(file?.progress?.bytesUploaded) || 0);
      }
    });
  });

  uppy.on('upload-success', (file) => {
    finishUploadTask(file?.id);
    scheduleUploadViewRefresh();
  });

  uppy.on('complete', (result) => {
    clearFallbackTracking();
    const successfulFiles = Array.isArray(result?.successful) ? result.successful : [];
    const failedFiles = Array.isArray(result?.failed) ? result.failed : [];
    releaseFolderReservations([...successfulFiles, ...failedFiles]);
    [...successfulFiles, ...failedFiles].forEach(removeUploadFile);
    scheduleUploadViewRefresh(100);
  });

  uppy.on('cancel-all', () => folderReservationByBatch.clear());

  uppy.on('upload-error', (file, error, response) => {
    // A large direct upload that failed (proxy body-size rejection, network
    // drop, or a chunked attempt whose size still failed): fall back to chunks
    // / step the ladder down and retry instead of surfacing the error.
    const status = getTusErrorStatus(error) ?? response?.status ?? null;
    const finalizeError = getFinalizeError(error);
    if (
      !finalizeError &&
      handleUploadFailure(file, status, Number(file?.progress?.bytesUploaded) || 0)
    ) {
      return;
    }

    const body = response?.body;
    const nested = body && typeof body === 'object' ? body?.error : null;
    const nestedObj = nested && typeof nested === 'object' ? nested : null;
    // A failed PATCH reads like a dropped connection to the check below, and
    // the server's reason is the whole point here.
    const networkError = !finalizeError && isNetworkUploadError(error);

    const rawHeading =
      finalizeError ||
      nestedObj?.message ||
      (typeof nested === 'string' ? nested : '') ||
      error?.message ||
      'Upload failed';
    const heading = networkError
      ? 'Upload interrupted because the server connection was lost.'
      : rawHeading;
    const bodyText = networkError
      ? 'The transfer was stopped. Check the network connection and retry the upload.'
      : nestedObj?.details !== undefined && nestedObj?.details !== null
        ? JSON.stringify(nestedObj.details)
        : '';

    notifyErrorOnce(heading, {
      body: bodyText,
      requestId: nestedObj?.requestId || null,
      statusCode: nestedObj?.statusCode ?? response?.status,
      dedupeKey: `upload-error:${heading}`,
      dedupeMs: 15000,
    });
    setTimeout(() => removeUploadFile(file), 0);
    // Keep UI in sync in case some files partially uploaded.
    scheduleUploadViewRefresh(100);
  });

  uppy.on('error', (error) => {
    // Uppy core re-emits every per-file `upload-error` here as a user-facing
    // "Failed to upload <name>" error (isUserFacing). Those are already owned by
    // our `upload-error` handler above — which stays SILENT when it auto-falls
    // back to chunks and only shows a toast on a genuine, final failure. So
    // skip them here to avoid a leaked toast during a (successful) fallback and
    // a duplicate toast on a real failure. Only surface generic (non-per-file)
    // Uppy errors.
    if (error?.isUserFacing) return;
    const message = isNetworkUploadError(error)
      ? 'Upload interrupted because the server connection was lost.'
      : error?.message || 'Upload error';
    notifyErrorOnce(message, {
      dedupeKey: `uppy-error:${message}`,
      dedupeMs: 15000,
    });
  });

  // Uppy v5 uses private class fields; if it gets wrapped in a Vue Proxy (reactive store),
  // method calls will throw "Cannot read from private field". Keep it raw.
  uppyStore.uppy = markRaw(uppy);

  /** Files chosen in the picker, as `{ name, type, data, meta }`. */
  const addPickedFiles = (descriptors) => {
    removeCompletedUploadFiles();
    configureUploadPlugin();
    (Array.isArray(descriptors) ? descriptors : []).forEach((descriptor) =>
      uppy.addFile(descriptor)
    );
  };

  /**
   * Files dropped onto the page, as `getDroppedFiles` hands them over — each
   * with the path it had inside a dropped folder. Added the way Uppy's own
   * DropTarget adds them, which is what did it before.
   */
  const addDroppedFiles = (files) => {
    configureUploadPlugin();
    const descriptors = (Array.isArray(files) ? files : []).map((file) => ({
      source: 'DropTarget',
      name: file.name,
      type: file.type,
      data: file,
      meta: {
        // path of the file relative to the ancestor directory the user selected.
        // e.g. 'docs/Old Prague/airbnb.pdf'
        relativePath: file.relativePath || null,
      },
    }));
    try {
      uppy.addFiles(descriptors);
    } catch (err) {
      uppy.log(err);
    }
  };

  const destroy = () => {
    if (uploadViewRefreshTimer) clearTimeout(uploadViewRefreshTimer);
    stopWatchingFinalization();
    clearFallbackTracking();
    Array.from(uploadTaskIds.keys()).forEach(finishUploadTask);
    // Uppy v5 uses `destroy()`. Older versions had `close()` in some setups.
    uppy.destroy?.();
    uppy.close?.();
    if (uppyStore.uppy === uppy) {
      uppyStore.uppy = null;
    }
  };

  // The upload mode depends on the settings: chosen again once they are in,
  // as the layout used to on mounting.
  try {
    await appSettings.ensureLoaded();
  } catch (_) {
    // Keep upload available with safe defaults if settings cannot be loaded.
  }
  configureUploadPlugin();

  return { uppy, configure: configureUploadPlugin, addPickedFiles, addDroppedFiles, destroy };
};
