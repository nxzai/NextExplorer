<script setup>
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()

import {SortDescending} from '@vicons/tabler'

import {SortByAlphaOutlined} from '@vicons/material'
</script>

<template>

  <div class="ml-auto">
    <button @click="settings.listView" class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
    :class="{ 'dark:bg-zinc-700 dark:bg-opacity-70': settings.view == 'list' }">
    <SortByAlphaOutlined class="w-6" />
  </button>
  </div>
  


  <!-- <div class="flex items-center gap-2">
    <label for="sort">
      <SortDescending class="h-6"/>

    </label>
    <select id="sort" v-model="settings.sortBy" class="  border border-neutral-300 dark:border-neutral-700 rounded-md">
      <option value="name">Name</option>
      <option value="size">Size</option>
      <option value="date">Date</option>
    </select>
  </div> -->
</template>