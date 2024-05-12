

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

const fileInput = ref(null);
const files = ref([]);
const acceptsDirectories = ref(true);


function handleDragOver(event) {
  event.dataTransfer.dropEffect = 'copy';
}

function handleDrop(event) {
  if (event.dataTransfer.items) {
    processItems(event.dataTransfer.items);
  } else {
    files.value = Array.from(event.dataTransfer.files);
  }
}

function handleFiles(event) {
  if (acceptsDirectories.value) {
    processItems(event.target.files);
  } else {
    files.value = Array.from(event.target.files);
  }
}

async function processItems(items) {
  const newFiles = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i].webkitGetAsEntry();
    if (item) {
      if (item.isFile) {
        await item.file(file => {
          newFiles.push(file);
        });
      } else if (item.isDirectory) {
        traverseDirectory(item, newFiles);
      }
    }
  }
  console.log(newFiles)
  files.value = newFiles;
}

function traverseDirectory(item, accumulator) {
  const reader = item.createReader();
  reader.readEntries(async entries => {
    for (const entry of entries) {
      if (entry.isFile) {
        await entry.file(file => {
          accumulator.push(file);
        });
      } else if (entry.isDirectory) {
        traverseDirectory(entry, accumulator);
      }
    }
  });
}
</script>
<template>
  <div 
    class="dropzone"
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
  >
    Drop files or directories here
    <input 
      ref="fileInput" 
      type="file" 
      class="hidden" 
      @change="handleFiles" 
      multiple 
      :webkitdirectory="acceptsDirectories"
      :directory="acceptsDirectories"
      :mozdirectory="acceptsDirectories"
    />
  </div>
  <div v-for="file in files" :key="file.name">
    {{ file.name }} 
    </div>  
</template>
<style>
.dropzone {
  border: 2px dashed #ccc;
  padding: 20px;
  text-align: center;
  margin: 10px;
  cursor: pointer;
}

.hidden {
  display: none;
}
</style>
