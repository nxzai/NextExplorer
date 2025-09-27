<script setup>
import { computed, ref } from 'vue'
import { useDraggable } from '@vueuse/core'
import { PauseIcon, XMarkIcon } from '@heroicons/vue/24/outline';
import { useUppyStore } from '@/stores/uppyStore'
import { formatBytes } from '@/utils';
const uppyStore = useUppyStore()

const el = ref(null)

// `style` will be a helper computed for `left: ?px; top: ?px;`
const { x, y, style } = useDraggable(el, {
  initialValue: { x: 400, y: 400 },
  preventDefault: true,
})


/*
uppyStore.state.files looks like this 
[
  {"uppy-img/9501/mp4-2v-1e-video/mp4-img/9501/mp4-2v-1e-21594174-1758034388670":{
    "source":"",
    "id":"uppy-img/9501/mp4-2v-1e-video/mp4-img/9501/mp4-2v-1e-21594174-1758034388670",
    "name":"IMG_9501.mp4",
    "extension":"mp4",
    "meta":{
      "relativePath":"IMG_9501.mp4",
      "name":"IMG_9501.mp4",
      "type":"video/mp4",
      "uploadTo":"Projects"
    },
    "type":"video/mp4",
    "data":"[object File]",
    "progress":{
      "uploadStarted":1759011067795,
      "uploadComplete":false,
      "percentage":21,
      "bytesUploaded":4620158.343919781,
      "bytesTotal":21594174
    },
    "size":21594174,
    "isGhost":false,
    "isRemote":false,
    "remote":"",
    "preview":"__vue_devtool_undefined__"
  },
  "uppy-img/9501/mov-2v-1e-video/quicktime-img/9501/mov-2v-1e-86916075-1758034262331":{
    "source":"",
    "id":"uppy-img/9501/mov-2v-1e-video/quicktime-img/9501/mov-2v-1e-86916075-1758034262331",
    "name":"IMG_9501.MOV",
    "extension":"MOV",
    "meta":{
      "relativePath":"IMG_9501.MOV",
      "name":"IMG_9501.MOV",
      "type":"video/quicktime",
      "uploadTo":"Projects"
    },
    "type":"video/quicktime",
    "data":"[object File]",
    "progress":{
      "uploadStarted":1759011133463,
      "uploadComplete":false,
      "percentage":2,
      "bytesUploaded":1327094.5639498732,
      "bytesTotal":86916075
    },
    "size":86916075,
    "isGhost":false,
    "isRemote":false,
    "remote":"",
    "preview":"__vue_devtool_undefined__"}
  }
]
*/

const progress = computed(() => uppyStore.state.totalProgress)

const uploadInProgress = computed(() => Object.keys(uppyStore.state.currentUploads).length > 0)

const totalBytes = computed(() => Object.values(uppyStore.state.files)
    .filter(file => !file.progress.uploadComplete) // Filter files where upload isn't complete
    .reduce((acc, file) => acc + file.progress.bytesTotal, 0)  )

const uploadedBytes = computed(() => Object.values(uppyStore.state.files)
    .filter(file => !file.progress.uploadComplete) // Filter files where upload isn't complete
    .reduce((acc, file) => acc + file.progress.bytesUploaded, 0)
)



</script>
<template>
  <div v-if="uploadInProgress" ref="el" class="fixed p-6 bg-neutral-100 dark:bg-zinc-900 shadow-lg min-w-[500px] rounded-xl
  border border-neutral-200 d dark:border-none
  " :style="style">
    <h3 class="text-xl font-extrabold mb-3">{{progress}}% complete</h3>
    <div class="text-md flex items-center gap-2">
      <div>Uploading 2 items to <span class="text-sky-600 dark:text-sky-300">Photos</span></div>
      <button @click="uppyStore.uppy.pauseAll()" class="ml-auto"> <PauseIcon class="w-6 h-6" /></button>
      <button @click="uppyStore.uppy.cancelAll({ reason: 'user' })"><XMarkIcon class="w-6 h-6" /></button>
    </div>
    <div class="my-2">
      <div class="bg-zinc-300 dark:bg-zinc-700 h-2 rounded-full">
        <div class="bg-sky-500 h-2 rounded-full" :style="`width: ${progress}%`"></div>
      </div>
    </div>
    <div class="flex items-center justify-between">
      <div>About 16 min remaining</div>
      <div class="text-sm">{{ formatBytes(uploadedBytes) }} / {{ formatBytes(totalBytes) }}</div>
    </div>
    
  </div>
</template>