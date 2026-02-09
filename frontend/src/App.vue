<script setup>
import { RouterView } from 'vue-router';
import ConfigErrorScreen from '@/components/ConfigErrorScreen.vue';
</script>

<template>
  <ConfigErrorScreen>
    <router-view></router-view>
  </ConfigErrorScreen>
</template>
