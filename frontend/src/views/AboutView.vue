<template>
  <div class="about">
    <h1>This is an about page</h1>



    <div class="flex items-center gap-1">
      <button 
      class="box-border px-4 py-[6px] mb-4 text-white rounded-lg font bg-zinc-900 hover:bg-opacity-90 active:bg-opacity-80"
    >
      Toggle View
    </button>
    <button 
      class="box-border  px-4 py-[5px] mb-4  rounded-lg font border border-zinc-900 bg-zinc-200 bg-opacity-0 hover:bg-opacity-50 active:bg-opacity-100"
    >
      Toggle View
    </button>
    </div>
    
  </div>
</template>

<style>
@media (min-width: 1024px) {
  .about {
    min-height: 100vh;
    display: flex;
    align-items: center;
  }
}
</style>
