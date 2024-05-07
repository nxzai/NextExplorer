

<template>
  <div>
    <h1>File Editor</h1>
    <textarea v-model="fileContent" rows="20" cols="70"></textarea>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';

// Reference for file content
const fileContent = ref('');

// Access route parameters
const route = useRoute();

// Function to fetch file content from the backend
const fetchFileContent = async () => {
  const { path } = route.params;
  try {
    const response = await axios.get(`/api/files/${path}`);  // Adjust URL according to your backend API
    fileContent.value = response.data;
  } catch (error) {
    console.error('Failed to fetch file content:', error);
    fileContent.value = 'Error loading file content.';
  }
};

// Fetch content when the component is mounted
onMounted(fetchFileContent);
</script>

<style scoped>
textarea {
  font-family: 'Courier New', Courier, monospace; /* Better readability for code */
  width: 100%; /* Take full container width */
}
</style>
