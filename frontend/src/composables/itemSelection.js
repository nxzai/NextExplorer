import { useRouter, useRoute } from 'vue-router';
import { ref } from 'vue';
import { useNavStore } from '@/stores/navStore';

export function useSelection() {

  const navStore = useNavStore();

  const isSelected = (item) => navStore.selectedItems.some(i => i.name === item.name );

  const toggleSelection = (item) => {
    const index = navStore.selectedItems.findIndex(i => i.name === item.name);
    if (index === -1) {
      navStore.selectedItems.push(item);
    } else {
      navStore.selectedItems.splice(index, 1);
    }
  };

  // const selectRange = (item) => {
  //   const startIndex = navStore.getCurrentPathItems.findIndex(i => i.name === navStore.selectedItems[0].name);
  //   const endIndex = navStore.getCurrentPathItems.findIndex(i => i.name === item.name);
  //   const [start, end] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  //   navStore.selectedItems = navStore.getCurrentPathItems.slice(start, end + 1);
  // };

  const selectRange = (item) => {
    const currentItems = navStore.getCurrentPathItems;
    const selectedItems = navStore.selectedItems;
  
    // Find the index of the clicked item
    const endIndex = currentItems.findIndex(i => i.name === item.name);
  
    // Find the highest index of currently selected items
    const selectedIndices = selectedItems.map(i => currentItems.findIndex(ci => ci.name === i.name));
    const highestSelectedIndex = Math.max(...selectedIndices);
  
    // Determine the start index
    const startIndex = endIndex < highestSelectedIndex ? highestSelectedIndex : selectedIndices[0];
  
    // Determine the range
    const [start, end] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
  
    // Update the selected items
    navStore.selectedItems = currentItems.slice(start, end + 1);
  };
  

  const clearSelection = () => {
    navStore.selectedItems = [];
  };

  const handleSelection = (item, event) => {
    console.log(item)
    if (event.ctrlKey || event.metaKey) {
      // Control/Command + Click
      toggleSelection(item);
    } else if (event.shiftKey && navStore.selectedItems.length > 0) {
      // Shift + Click
      selectRange(item);
    } else {
      // Single Click
      clearSelection();
      toggleSelection(item);
    }
  };


  return {
    isSelected,
    handleSelection,
  }
}