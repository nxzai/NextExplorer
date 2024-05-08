<script setup>
import { RouterView } from 'vue-router'
import HeaderLogo from '@/components/HeaderLogo.vue';
import FavMenu from '@/components/FavMenu.vue';
import VolMenu from '@/components/VolMenu.vue';

import { useSettingsStore } from '@/stores/settings'


const settings = useSettingsStore()
</script>

<template>
  <div class="relative flex w-full h-full">

    <aside class="w-[230px] bg-nextgray-200 dark:bg-nextgray-700 p-6 px-5 shrink-0">
      <HeaderLogo/>
      <FavMenu/>
      <VolMenu/>
    </aside>

    <main class="p-6 overflow-scroll grow dark:bg-opacity-95 dark:bg-neutral-800">
      <router-view></router-view>
    </main>
  </div>
</template>

