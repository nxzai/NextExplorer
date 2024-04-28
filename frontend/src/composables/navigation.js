import FileIcon from '@/icons/FileIcon.vue';
import { useRouter, useRoute } from 'vue-router';
import { formatBytes } from '@/utils';

export function useNavigation() {
    
  const router = useRouter()
  const route = useRoute()

  const openItem = (item)=>{
      if(item.kind==='directory'){
          const new_path = route.params.path ? `${route.params.path}/${item.name}` : item.name;
          router.push({ name: 'browse', params: {path: new_path} });
      }


  }

  const openBreadcrumb = (path)=>{
    router.push({ name: 'browse', params: {path: path} });
  } 


  return {
    openItem,
    openBreadcrumb
  }
}