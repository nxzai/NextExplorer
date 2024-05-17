import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { browse } from '@/api';

export const useNavStore = defineStore('navStore', () => {
  // State
  const currentPath = ref(null);
  const currentPathItems = ref([]);

  // Getters
  const getCurrentPath = computed(() => currentPath.value);

  // Actions
  function setCurrentPath(path) {
    console.log('setCurrentPath', path);
    currentPath.value = path;
  }

  async function fetchPathItems(path) {
    if(path) currentPath.value = path;
    currentPathItems.value = await browse(currentPath.value);
    return currentPathItems
  }

  return {
    currentPath,
    getCurrentPath,
    setCurrentPath,
    currentPathItems,
    fetchPathItems
  };
});
