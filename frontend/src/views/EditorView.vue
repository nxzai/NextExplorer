

<template>
  <div>
    <h1>File Editor</h1>

    <code-mirror
    v-model="fileContent"
    basic
    :extensions=[oneDark]
    :dark="true"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';
import CodeMirror from 'vue-codemirror6';
import {oneDark} from '@codemirror/theme-one-dark';

// Reference for file content
const fileContent = ref('');

// Access route parameters
const route = useRoute();

// const fetchFileContent = async () => {
//   const { path } = route.params;

//   console.log("path is", path)
//   try {
//     const response = await axios.post('http://localhost:3000/api/editor', { path });  // Adjust URL according to your backend API
//     fileContent.value = response.data;
//   } catch (error) {
//     console.error('Failed to fetch file content:', error);
//     fileContent.value = 'Error loading file content.';
//   }
// };


const fetchFileContent = async () => {
  const { path } = route.params;

  console.log("path is", path);
  try {
    const response = await fetch('http://localhost:3000/api/editor', {
      method: 'POST', // Specify the method
      headers: {
        'Content-Type': 'application/json', // Set content type to JSON
      },
      body: JSON.stringify({ path }) // Convert JavaScript object to JSON string
    });

    if (!response.ok) { // Check if the HTTP status code is not successful
      throw new Error('Failed to fetch file content');
    }

    const data = await response.json(); // Parse JSON response into JavaScript object
    fileContent.value = data.content;
  } catch (error) {
    console.error('Failed to fetch file content:', error);
    fileContent.value = 'Error loading file content.';
  }
};


// Fetch content when the component is mounted
onMounted(fetchFileContent);
</script>

