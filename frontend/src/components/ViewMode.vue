
<script setup>
import { AlignSpaceAroundVertical20Regular } from '@vicons/fluent';
import { useSettingsStore } from '@/stores/settings'
import {
  Squares2X2Icon,
  ListBulletIcon,
  Cog8ToothIcon
} from '@heroicons/vue/24/outline'

const settings = useSettingsStore()

</script>

<template>

<div class="flex gap-1 ml-auto">

<button @click="settings.listView" class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
  :class="{ 'dark:bg-zinc-700 dark:bg-opacity-70': settings.view == 'list' }">
  <ListBulletIcon class="w-6" />
</button>

<button @click="settings.tabView" class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
  :class="{ 'dark:bg-zinc-700 dark:bg-opacity-70': settings.view == 'tab' }">
  <AlignSpaceAroundVertical20Regular class="w-6" />
</button>

<button @click="settings.gridView" class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600"
  :class="{ 'dark:bg-zinc-700 dark:bg-opacity-70': settings.view == 'grid' }">
  <Squares2X2Icon class="w-6" />
</button>


<button class="ml-4">
  <Cog8ToothIcon class="w-6" />
</button>
</div>

</template>