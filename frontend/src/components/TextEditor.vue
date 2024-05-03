<script setup>
import { ref, defineComponent } from 'vue';

// Load component
import CodeMirror from 'vue-codemirror6';

// CodeMirror extensions
// import { javascript as js } from '@codemirror/lang-javascript';
import {oneDark} from '@codemirror/theme-one-dark';
/** text */
const value = ref('this is a test');

/** Dark mode **/
const dark = ref(
  window.matchMedia('(prefers-color-scheme: dark)').matches
);


// const lang = js();


</script>

<template>
  <code-mirror
    v-model="value"
    basic
    :extensions=[oneDark]
    :dark="dark"
  />
</template>