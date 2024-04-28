<script setup>
import TxtIcon from './files/txt-icon.vue';
import DirectoryIcon from './files/directory-icon.vue';
import CodeIcon from './files/code-icon.vue';

const props = defineProps(['kind'])

</script>

<template>
    <DirectoryIcon v-if="props.kind==='directory'"/>
    <CodeIcon v-else-if="['json', 'vue'].includes(props.kind)"/>
    <TxtIcon v-else/>
    
</template>