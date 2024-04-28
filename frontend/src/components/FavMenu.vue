<script setup>
import { PhotoIcon, ComputerDesktopIcon, MusicalNoteIcon, FolderArrowDownIcon } from '@heroicons/vue/24/outline'
</script>

<template>
    <div>
        <h4 class="py-[6px] text-sm text-neutral-400 font-medium">Quick access</h4>
        <div class="flex items-center gap-3 px-3 py-[6px] rounded-lg hover:bg-nextgray-300 dark:hover:bg-zinc-700"><ComputerDesktopIcon class="h-5"/> Desktop</div>
        <div class="flex items-center gap-3 px-3 py-[6px] rounded-lg hover:bg-nextgray-300 dark:hover:bg-zinc-700"><MusicalNoteIcon class="h-5"/> Music</div>
        <div class="flex items-center gap-3 px-3 py-[6px] rounded-lg hover:bg-nextgray-300 dark:hover:bg-zinc-700"><PhotoIcon class="h-5"/> Pictures</div>
        <div class="flex items-center gap-3 px-3 py-[6px] rounded-lg hover:bg-nextgray-300 dark:hover:bg-zinc-700"><FolderArrowDownIcon class="h-5"/> Downloads</div>
    </div>
</template>