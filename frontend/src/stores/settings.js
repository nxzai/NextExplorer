import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useDark, useMediaQuery, useStorage, useToggle } from '@vueuse/core';

export const useSettingsStore = defineStore('counter', () => {
  
  const view = ref('grid')
  const gridView=()=>{view.value = 'grid'}
  const listView=()=>{view.value = 'list'}
  const tabView=()=>{view.value = 'tab'}

  const isDark = useDark({ disableTransition: false });
  const toggleDark = useToggle(isDark);

  const sortBy = ref('name')

  const setSortBy = (value) => {
    sortBy.value = value
  }

  return { 
    view, 
    gridView, 
    listView,
    tabView,
    isDark,
    toggleDark,
    sortBy,
    setSortBy
  }
})
