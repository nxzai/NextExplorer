<script setup>
import {
  InformationCircleIcon
} from '@heroicons/vue/24/outline'
import { onMounted } from 'vue';


onMounted(() => {
  console.log('MenuItemInfo.vue mounted')

  document.getElementById('btn-download').addEventListener('click', async () => {
    try {
        const dirHandle = await window.showDirectoryPicker();
        const newDirHandle = await dirHandle.getDirectoryHandle('NewDirectory', { create: true });
        const fileHandle = await newDirHandle.getFileHandle('NewFile.txt', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write('Hello, world!');
        await writable.close();

        alert('New directory and file created successfully!');
    } catch (error) {
        console.error('Error:', error);
    }
  });
})



</script>
<template>

  <div class="flex gap-1 items-center">
    <button id="btn-download"
    class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600">
      <InformationCircleIcon class="w-6" />
    </button>
  </div>

</template>