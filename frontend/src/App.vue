<script setup>
import { defineAsyncComponent } from 'vue';
import { RouterView } from 'vue-router';
import { useConfigErrorGate } from '@/composables/useConfigErrorGate';

const ConfigErrorScreen = defineAsyncComponent(() => import('@/components/ConfigErrorScreen.vue'));
const { configError } = useConfigErrorGate();
</script>

<template>
  <ConfigErrorScreen
    v-if="configError"
    :mode="configError.mode"
    :expected-origin="configError.expectedOrigin"
    :request-origin="configError.requestOrigin"
  />
  <router-view v-else></router-view>
</template>
