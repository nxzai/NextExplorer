

<template>
  <h1>File Editor</h1>
  <div class="overflow-scroll h-[300px] w-full">
   

    <code-mirror
    
    v-model="fileContent"
    basic
    :extensions=[oneDark]
    :dark="true"
    :lang="lang"
    />
    
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';
import CodeMirror from 'vue-codemirror6';
import {oneDark} from '@codemirror/theme-one-dark';
import { markdown as md } from '@codemirror/lang-markdown';

const route = useRoute();
const lang = md();
const fileContent = ref('');

const fetchFileContent = async () => {
  const { path } = route.params;
  try {
    const response = await axios.post('http://localhost:3000/api/editor', { path });
    fileContent.value = response.data.content;
  } catch (error) {
    console.error('Failed to fetch file content:', error);
    fileContent.value = 'Error loading file content.';
  }
};

onMounted(fetchFileContent);
</script>

