import { useRouter, useRoute } from 'vue-router';

export function useNavigation() {
    
  const router = useRouter()
  const route = useRoute()

  const openItem = (item)=>{

      console.log(item.kind)

      if(item.kind==='directory'){
          const newPath = route.params.path ? `${route.params.path}/${item.name}` : item.name;
          router.push({ path: `/browse/${newPath}` });
      }
      
      if(item.kind==='json'){
        const fileToEdit = `${item.path}/${item.name}`;
        router.push({ path: `/editor/${fileToEdit}` });
      }


  }

  const openBreadcrumb = (path)=>{
    router.push({ path: `/browse/${path}` });
  } 

  

  return {
    openItem,
    openBreadcrumb
  }
}




// const goForward = ()=>{
  //   router.go(1);
  // }

  // const goBackward = ()=>{
  //   router.go(-1);
  // }

  // const goUpward = ()=>{
  //   const path = route.params.path.split('/');
  //   path.pop();
  //   const new_path = path.join('/');
  //   router.push({ name: 'browse', params: {path: new_path} });
  // }

  // const canGoForward = ()=>{

  //   //check in router object if the route can go forward.
  //   return router.currentRoute.value.meta.canGoForward;
    

  // }