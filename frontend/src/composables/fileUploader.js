import { ref, onMounted, onBeforeUnmount, markRaw } from 'vue';
import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import { useUppyStore } from '@/stores/uppyStore';
import { useFileStore } from '@/stores/fileStore';
import { useNotificationsStore } from '@/stores/notifications';
import { apiBase, normalizePath } from '@/api';
import { isDisallowedUpload } from '@/utils/uploads';
import DropTarget from '@uppy/drop-target';

export function useFileUploader() {
  // Filtering is centralized in utils/uploads
  const uppyStore = useUppyStore();
  const fileStore = useFileStore();
  const notificationsStore = useNotificationsStore();
  const inputRef = ref(null);
  const files = ref([]);

  let lastNotifyAt = 0;
  let lastNotifyHeading = '';

  const canUploadToCurrentPath = () => {
    const access = fileStore.currentPathData;
    if (!access) {
      // If share metadata hasn't loaded yet, fail closed to avoid accidental uploads.
      return !String(fileStore.currentPath || '').startsWith('share/');
    }
    return access.canUpload !== false;
  };

  const uploadBlockedMessage = () => {
    const access = fileStore.currentPathData;
    if (!access && String(fileStore.currentPath || '').startsWith('share/')) {
      return 'Share is still loading. Please try again in a moment.';
    }
    if (access?.shareInfo?.accessMode === 'readonly') {
      return 'This share is read-only. Uploads are disabled.';
    }
    return 'You do not have permission to upload to this location.';
  };

  const notifyErrorOnce = (heading, extra = {}) => {
    const now = Date.now();
    if (heading === lastNotifyHeading && now - lastNotifyAt < 1500) return;
    lastNotifyAt = now;
    lastNotifyHeading = heading;
    notificationsStore.addNotification({ type: 'error', heading, ...extra });
  };

  // Ensure a single Uppy instance app-wide
  let uppy = uppyStore.uppy;
  const createdHere = ref(false);

  if (!uppy) {
    uppy = new Uppy({
      debug: true,
      autoProceed: true,
      store: uppyStore,
    });

    uppy.use(XHRUpload, {
      endpoint: `${apiBase}/api/upload`,
      formData: true,
      fieldName: 'filedata',
      bundle: false,
      responseType: 'json',
      // Uppy v5 expects `allowedMetaFields` to be `true` (all) or an explicit list.
      // `null` results in *no* metadata being sent, which breaks `uploadTo`/`relativePath`.
      allowedMetaFields: true,
      withCredentials: true,
    });

    // Cookies carry auth; no token headers
    uppy.on('file-added', (file) => {
      if (!canUploadToCurrentPath()) {
        uppy.removeFile?.(file.id);
        notifyErrorOnce(uploadBlockedMessage(), { durationMs: 5000 });
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

      uppy.setFileMeta(file.id, {
        uploadTo: normalizePath(fileStore.currentPath || ''),
        relativePath: inferredRelativePath,
      });
    });

    uppy.on('upload', (_uploadID, batchFiles) => {
      // Safety net: if permissions changed after files were queued, cancel *only* when the
      // batch is targeting the currently-viewed path (avoids canceling uploads after navigation).
      const current = normalizePath(fileStore.currentPath || '');
      const files = Array.isArray(batchFiles) ? batchFiles : [];
      const targetsCurrentPath =
        files.length > 0 &&
        files.every((f) => normalizePath(f?.meta?.uploadTo || '') === current);

      if (!targetsCurrentPath) return;
      if (canUploadToCurrentPath()) return;

      try {
        uppy.cancelAll?.();
      } catch (_) {
        /* noop */
      }
      notifyErrorOnce(uploadBlockedMessage(), { durationMs: 5000 });
    });

    uppy.on('upload-success', () => {
      fileStore.fetchPathItems(fileStore.currentPath).catch(() => {});
    });

    uppy.on('upload-error', (_file, error, response) => {
      const body = response?.body;
      const nested = body && typeof body === 'object' ? body?.error : null;
      const nestedObj = nested && typeof nested === 'object' ? nested : null;

      const heading =
        nestedObj?.message ||
        (typeof nested === 'string' ? nested : '') ||
        error?.message ||
        'Upload failed';

      notifyErrorOnce(heading, {
        body:
          nestedObj?.details !== undefined && nestedObj?.details !== null
            ? JSON.stringify(nestedObj.details)
            : '',
        requestId: nestedObj?.requestId || null,
        statusCode: nestedObj?.statusCode ?? response?.status,
      });
      // Keep UI in sync in case some files partially uploaded.
      if (fileStore.currentPath) {
        fileStore.fetchPathItems(fileStore.currentPath).catch(() => {});
      }
    });

    uppy.on('error', (error) => {
      const message = error?.message || 'Upload error';
      notifyErrorOnce(message);
    });

    // Uppy v5 uses private class fields; if it gets wrapped in a Vue Proxy (reactive store),
    // method calls will throw "Cannot read from private field". Keep it raw.
    uppyStore.uppy = markRaw(uppy);
    createdHere.value = true;
  }

  function uppyFile(file) {
    return {
      name: file.name,
      type: file.type,
      data: file,
    };
  }

  function setDialogAttributes(options) {
    inputRef.value.accept = options.accept;
    inputRef.value.multiple = options.multiple;
    inputRef.value.webkitdirectory = !!options.directory;
    inputRef.value.directory = !!options.directory;
    inputRef.value.mozdirectory = !!options.directory;
  }

  function openDialog(opts) {
    const defaultDialogOptions = {
      multiple: true,
      accept: '*',
    };

    if (!canUploadToCurrentPath()) {
      notifyErrorOnce(uploadBlockedMessage(), { durationMs: 5000 });
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      if (!inputRef.value) {
        notificationsStore.addNotification({
          type: 'error',
          heading: 'File picker is not ready yet. Please try again.',
          durationMs: 3000,
        });
        resolve();
        return;
      }

      files.value = [];
      const options = { ...defaultDialogOptions, ...opts };

      setDialogAttributes(options);

      inputRef.value.onchange = (e) => {
        const selectedFiles = Array.from(e.target.files || []).filter(
          (file) => !isDisallowedUpload(file.name)
        );

        files.value = selectedFiles.map((file) => uppyFile(file));
        files.value.forEach((file) => uppy.addFile(file));

        // Reset the input so the same file can be selected again if needed
        e.target.value = '';
        resolve();
      };

      inputRef.value.click();
    });
  }

  onMounted(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'hidden';
    document.body.appendChild(input);
    inputRef.value = input;
  });

  onBeforeUnmount(() => {
    inputRef.value?.remove();
    // Only close the singleton if we created it here
    if (createdHere.value) {
      // Uppy v5 uses `destroy()`. Older versions had `close()` in some setups.
      uppy.destroy?.();
      uppy.close?.();
      if (uppyStore.uppy === uppy) {
        uppyStore.uppy = null;
      }
    }
  });

  return {
    files,
    openDialog,
  };
}

// Attach/detach Uppy DropTarget plugin to a given element ref
export function useUppyDropTarget(targetRef) {
  const uppyStore = useUppyStore();

  onMounted(() => {
    const el = targetRef && 'value' in targetRef ? targetRef.value : null;
    const uppy = uppyStore.uppy;
    if (el && uppy) {
      try {
        const existing = uppy.getPlugin && uppy.getPlugin('DropTarget');
        if (existing) uppy.removePlugin(existing);
        uppy.use(DropTarget, { target: el });
      } catch (_) {
        // ignore if plugin cannot be mounted
      }
    }
  });

  onBeforeUnmount(() => {
    const uppy = uppyStore.uppy;
    if (uppy) {
      const plugin = uppy.getPlugin && uppy.getPlugin('DropTarget');
      if (plugin) uppy.removePlugin(plugin);
    }
  });
}
