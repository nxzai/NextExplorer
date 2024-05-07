import { createRouter, createWebHistory } from 'vue-router'
import FolderView from '@/views/FolderView.vue'


const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/browse',
      name: 'home',
      component: FolderView
    },
    {
      path: '/browse/:path',
      name: 'browse',
      component: FolderView
    },
    {
      path: '/editor/:path',
      name: 'editor',
      component: FolderView
    }
  ]
})

export default router
