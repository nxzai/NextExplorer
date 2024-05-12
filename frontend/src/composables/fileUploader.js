import { ref, onMounted, onBeforeUnmount } from "vue";

import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';

import { useDropZone } from '@vueuse/core'


const defaultDialogOptions = {
  multiple: true,
  accept: '*',
};

export function useFileUploader({...options}) {

  const inputRef = ref(null);
  const files = ref([]);


  const uppy = new Uppy({
    debug: true,
    autoProceed: false,
  });

  uppy.use(XHRUpload, {
    endpoint: 'http://localhost:3000/api/upload', // your server endpoint
    formData: true,
    fieldName: 'files',
    bundle: true,
  });

  onMounted(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.className = "hidden";
    document.body.appendChild(input);
    inputRef.value = input;
  });

  onBeforeUnmount(() => {
    inputRef.value?.remove();
    uppy.close();
  });

  function openDialog(opts) {
    return new Promise((resolve) => {
      if (!inputRef.value) {
        return;
      }
      files.value = [];

      const options = { ...defaultDialogOptions, ...opts };
      inputRef.value.accept = options.accept;
      inputRef.value.multiple = options.multiple;
      
      console.log(options.directory)
      if (options.directory) {
        inputRef.value.webkitdirectory = !!options.directory;  
        inputRef.value.directory = !!options.directory;       
        inputRef.value.mozdirectory = !!options.directory;
      }
      else {
        inputRef.value.webkitdirectory = false;  
        inputRef.value.directory = false;       
        inputRef.value.mozdirectory = false;
      }

      inputRef.value.onchange = (e) => {
        if (options.directory) {
          // Process directory files
          const items = Array.from(e.target.files);
          const directories = {};
          items.forEach(file => {
            const path = file.webkitRelativePath.split('/');
            const dir = path[0];
            if (!directories[dir]) {
              directories[dir] = [];
            }
            directories[dir].push(file);
          });
          files.value = directories;
        } else {
          // Process individual files
          files.value = Array.from(e.target.files);
        }
        resolve();
      };

      inputRef.value.click();
    });
  }
  

  function process() {

    if (Array.isArray(files.value)) {
      // Handle the case where it's directly an array
      files.value.forEach(file => uppy.addFile({
        name: file.name,
        type: file.type,
        data: file,
        meta: {
          relativePath: file.webkitRelativePath || file.name, // handle folders or individual files
        }
      }));
    } else if (typeof files.value === 'object') {
      // Handle the case where it's an object of arrays
      Object.keys(files.value).forEach(key => {
        if (Array.isArray(files.value[key])) {
          console.log(`Processing list at key: ${key}`);
          files.value[key].forEach(file => uppy.addFile({
            name: file.name,
            type: file.type,
            data: file,
            meta: {
              relativePath: file.webkitRelativePath || file.name, // handle folders or individual files
            }
          }));
        } else {
          console.warn(`Expected an array at key: ${key}, but found:`, files.value[key]);
        }
      });
    } else {
      console.error('Unexpected data type for files.value:', files.value);
    }









    console.log(files.value)

    // files.value.forEach(file => uppy.addFile({
    //   name: file.name,
    //   type: file.type,
    //   data: file,
    //   meta: {
    //     relativePath: file.webkitRelativePath || file.name, // handle folders or individual files
    //   }
    // }));

    uppy.upload().then(result => {
      console.log('Successful uploads:', result.successful);
      console.log('Failed uploads:', result.failed);
    }).catch(error => {
      console.error('Upload error:', error);
    });

  }

  return {
    files,
    openDialog,
    process
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