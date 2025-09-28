import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import XHRUpload from '@uppy/xhr-upload';
import { useUppyStore } from '@/stores/uppyStore';
import {useFileStore} from '@/stores/fileStore';
import { apiBase, normalizePath, getUploadConfig } from '@/api';
import { useAuthStore } from '@/stores/auth';

const UPLOAD_METHODS = {
  TUS: 'tus',
  MULTER: 'multer',
};

const DEFAULT_UPLOAD_METHOD = UPLOAD_METHODS.TUS;

const ENDPOINT_DEFAULTS = {
  [UPLOAD_METHODS.TUS]: '/api/uploads/tus',
  [UPLOAD_METHODS.MULTER]: '/api/upload',
};

export function useFileUploader() {

  const disallowedFiles = ['.DS_Store', 'thumbs.db'];
  const uppyStore = useUppyStore();
  const fileStore = useFileStore();
  const authStore = useAuthStore();
  const inputRef = ref(null);
  const files = ref([]);

  const uppy = new Uppy({
    debug: true,
    autoProceed: true,
    store: uppyStore,
  });

  let activePluginId = null;
  let currentUploadMethod = null;

  const buildEndpointUrl = (method, config) => {
    const endpoints = config?.endpoints || {};
    const configuredPath = endpoints[method];
    const fallbackPath = ENDPOINT_DEFAULTS[method] || ENDPOINT_DEFAULTS[DEFAULT_UPLOAD_METHOD];
    const pathToUse = typeof configuredPath === 'string' && configuredPath.trim()
      ? configuredPath
      : fallbackPath;
    const normalizedPath = pathToUse.startsWith('/') ? pathToUse : `/${pathToUse}`;
    if (!apiBase) {
      return normalizedPath;
    }
    return `${apiBase}${normalizedPath}`;
  };

  const pluginDefinitions = {
    [UPLOAD_METHODS.TUS]: {
      plugin: Tus,
      pluginId: 'Tus',
      buildOptions: (config) => ({
        endpoint: buildEndpointUrl(UPLOAD_METHODS.TUS, config),
        retryDelays: [0, 1000, 3000, 5000],
        allowedMetaFields: null,
        headers: {},
      }),
    },
    [UPLOAD_METHODS.MULTER]: {
      plugin: XHRUpload,
      pluginId: 'XHRUpload',
      buildOptions: (config) => ({
        endpoint: buildEndpointUrl(UPLOAD_METHODS.MULTER, config),
        formData: true,
        fieldName: 'filedata',
        bundle: false,
        allowedMetaFields: null,
        headers: {},
      }),
    },
  };

  const applyAuthHeaders = (token) => {
    if (!activePluginId) {
      return;
    }

    const plugin = uppy.getPlugin(activePluginId);
    if (!plugin) {
      return;
    }

    plugin.setOptions({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  const resolveConfiguredMethod = (config) => {
    if (!config || typeof config !== 'object') {
      return DEFAULT_UPLOAD_METHOD;
    }

    const rawMethod = typeof config.method === 'string' ? config.method.toLowerCase() : '';
    const isSupported = Object.values(UPLOAD_METHODS).includes(rawMethod);

    if (config.enabled && typeof config.enabled === 'object') {
      if (isSupported && config.enabled[rawMethod] === true) {
        return rawMethod;
      }

      const fallbackEntry = Object.entries(config.enabled)
        .find((entry) => entry[1] === true && Object.values(UPLOAD_METHODS).includes(entry[0]));

      if (!isSupported && fallbackEntry) {
        return fallbackEntry[0];
      }
    }

    return isSupported ? rawMethod : DEFAULT_UPLOAD_METHOD;
  };

  const configureUploadPlugin = (method, config) => {
    const selectedMethod = Object.values(UPLOAD_METHODS).includes(method)
      ? method
      : DEFAULT_UPLOAD_METHOD;

    if (currentUploadMethod === selectedMethod) {
      applyAuthHeaders(authStore.token);
      return;
    }

    if (activePluginId) {
      const existing = uppy.getPlugin(activePluginId);
      if (existing) {
        uppy.removePlugin(existing);
      }
      activePluginId = null;
    }

    const definition = pluginDefinitions[selectedMethod];
    if (!definition) {
      return;
    }

    const options = definition.buildOptions(config);
    uppy.use(definition.plugin, options);

    activePluginId = definition.pluginId;
    currentUploadMethod = selectedMethod;

    applyAuthHeaders(authStore.token);
  };

  const loadUploadMethod = async () => {
    try {
      const config = await getUploadConfig();
      const method = resolveConfiguredMethod(config);
      configureUploadPlugin(method, config);
    } catch (error) {
      console.warn('Failed to load upload configuration; falling back to default uploader.', error);
      configureUploadPlugin(DEFAULT_UPLOAD_METHOD);
    }
  };

  watch(
    () => authStore.token,
    (token) => {
      applyAuthHeaders(token);
    },
    { immediate: true },
  );

  uppy.on('file-added', (file) => {
    uppy.setFileMeta(file.id, {
      uploadTo: normalizePath(fileStore.currentPath || ''),
    });
  });

  uppy.on('upload-success', () => {
    console.log("upload-success")
    fileStore.fetchPathItems(fileStore.currentPath)
  });


  function uppyFile(file) {
    return {
      name: file.name,
      type: file.type,
      data: file,
      meta: {
        relativePath: file.webkitRelativePath || file.name,
      }
    }
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

    return new Promise((resolve) => {
      if (!inputRef.value) return;

      files.value = [];
      const options = { ...defaultDialogOptions, ...opts };
      
      setDialogAttributes(options);

      inputRef.value.onchange = (e) => {
        const selectedFiles = Array.from(e.target.files || []).filter(
          (file) => !disallowedFiles.includes(file.name)
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
  

  // function process() {

  //   if (Array.isArray(files.value)) {
  //     // Handle the case where it's directly an array
  //     files.value.forEach(file => uppy.addFile(file));

  //   } else if (typeof files.value === 'object') {
  //     // Handle the case where it's an object of arrays
  //     Object.keys(files.value).forEach(key => {
  //       if (Array.isArray(files.value[key])) {
  //         console.log(`Processing list at key: ${key}`);
  //         files.value[key].forEach(file => uppy.addFile(file));
  //       } else {
  //         console.warn(`Expected an array at key: ${key}, but found:`, files.value[key]);
  //       }
  //     });
  //   } else {
  //     console.error('Unexpected data type for files.value:', files.value);
  //   }

  //   uppy.upload().then(result => {
  //     console.log(' uploads:', result);
  //     console.log('Successful uploads:', result.successful);
  //     console.log('Failed uploads:', result.failed);
  //   }).catch(error => {
  //     console.error('Upload error:', error);
  //   });

  // }

  onMounted(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.className = "hidden";
    document.body.appendChild(input);
    inputRef.value = input;
    loadUploadMethod();
  });

  onBeforeUnmount(() => {
    inputRef.value?.remove();
    uppy.close();
  });

  uppyStore.uppy = uppy;

  return {
    files,
    openDialog
  }

}



  // function onDrop(droppedFiles) {
  //   // each droppedFile to files array
  //   files.value.push(...droppedFiles)
  //   console.log(droppedFiles)
  // }


  
  // const { isOverDropZone } = useDropZone(dropzoneRef, {
  //   onDrop,
  // })



  // console.log(options)
