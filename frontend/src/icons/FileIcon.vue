<script setup>
import TxtIcon from './files/txt-icon.vue';
import DirectoryIcon from './files/directory-icon.vue';
import CodeIcon from './files/code-icon.vue';

const props = defineProps(['item'])


</script>

<template>
    <DirectoryIcon v-if="props.item.kind==='directory'"/>
    <CodeIcon v-else-if="['json', 'vue'].includes(props.item.kind)"/>

    <div v-else-if="item.thumbnail" class="flex items-center justify-center"><img :src="'http://localhost:3000'+item.thumbnail"></img></div>
    
    <TxtIcon v-else/>
    
</template>