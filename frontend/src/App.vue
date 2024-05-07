<script setup>
import { RouterView } from 'vue-router'
import HeaderLogo from '@/components/HeaderLogo.vue';
import FavMenu from '@/components/FavMenu.vue';
import VolMenu from '@/components/VolMenu.vue';

import { useSettingsStore } from '@/stores/settings'


const settings = useSettingsStore()
</script>

<template>
  <div class="flex font-light grow">

    <aside class="w-[230px] bg-nextgray-200 dark:bg-nextgray-700 p-6 px-5 shrink-0">
      <HeaderLogo/>
      <FavMenu/>
      <VolMenu/>
    </aside>

    <main class="flex flex-col content-start h-screen p-6 dark:bg-opacity-95 grow dark:bg-neutral-800">
      <router-view></router-view>
    </main>
  </div>

</template>

