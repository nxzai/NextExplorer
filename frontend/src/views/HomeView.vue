<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useSettingsStore } from '@/stores/settings'
import FileObject from '@/components/FileObject.vue';
import { browse } from '@/api';

const settings = useSettingsStore()
const router = useRoute()
const resources = ref(null)

onMounted(async()=>{
  const path = router.path;
  resources.value = await browse(path);
})


</script>

<template>
    
    <div :class="settings.view === 'grid' ? 'grid grid-cols-[repeat(auto-fill,6rem)] gap-2' : 'flex flex-col gap-2'">
      <div v-for="item in resources" :key="item.name">
        <FileObject :item="item" :view="settings.view"/>
      </div>
    </div>

</template>
<!-- 
<script>
export default {
  data() {
    return {
      files: [
        { name: "Document.pdf" },
        { name: "Image.png" },
        { name: "Presentation.pptx" },
        // Add more files as needed
      ],
      view: 'list' // Default view
    };
  },
  methods: {
    toggleView() {
      this.view = this.view === 'list' ? 'grid' : 'list';
    }
  }
};
</script>

<style scoped>
/* Scoped styles if necessary */
</style> -->
