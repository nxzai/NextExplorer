<script setup>
import FileIcon from '@/icons/FileIcon.vue';
import { useRouter, useRoute } from 'vue-router';
import { formatBytes } from '@/utils';
import {useNavigation} from '@/composables/navigation';

const props = defineProps(['item', 'view'])

const {openItem} = useNavigation()

</script>

<template>

    <div 
    v-if="props.view==='grid'"
    @click="openItem(item)"
    class="flex flex-col items-center gap-2 p-4 rounded-md cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700">
        <FileIcon 
        :kind="props.item.kind" 
        class="h-16 shrink-0"/> 
        <div class="text-sm text-center break-all line-clamp-2">{{ props.item.name }}</div>
    </div>


    <div 
    v-if="props.view==='tab'"
    @click="openItem(item)"
    class="flex gap-2 p-4 rounded-md cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700">
        <FileIcon 
        :kind="props.item.kind" 
        class="h-10 shrink-0"/> 
        <div>
            <div class="text-sm break-all line-clamp-2">{{ props.item.name }}</div>
            <p class="text-xs text-stone-500">
                {{ formatBytes(props.item.size) }}
            </p>  
        </div>
    </div>


    <div 
    v-if="props.view==='list'"
    @click="openItem(item)"
    class="flex items-center gap-2 p-2 px-4 rounded-md cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700">
        <FileIcon 
        :kind="props.item.kind" 
        class="h-5 shrink-0"/> 
        <div class="text-sm text-center break-all line-clamp-1">{{ props.item.name }}</div>
        <div v-if="props.item.kind==='directory'">
            ---
        </div>
        <div v-else>
            {{ formatBytes(props.item.size) }}
        </div>
    </div>

</template>