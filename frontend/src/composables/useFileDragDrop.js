import { ref } from 'vue';
import { useFileStore } from '@/stores/fileStore';
import { moveItems, normalizePath } from '@/api';
import { useInputMode } from '@/composables/useInputMode';
import { setMoveDragImage } from '@/utils/dragImage';

/**
 * Composable for handling file and folder drag and drop operations.
 * Desktop only - will not work on touch devices.
 */
export function useFileDragDrop() {
  const fileStore = useFileStore();
  const { isTouchDevice } = useInputMode();
  const isDraggingOver = ref(false);
  const dragOverTargetKey = ref('');

  const DRAG_TYPE = 'application/json';

  const setDragOverKey = (key) => {
    const normalizedKey = key || '';
    dragOverTargetKey.value = normalizedKey;
    isDraggingOver.value = Boolean(normalizedKey);
  };

  const clearDragOverKey = () => setDragOverKey('');

  const isMoveItemsDrag = (event) => {
    if (!canDragDrop()) return false;
    const types = event?.dataTransfer?.types;
    return Boolean(types) && Array.from(types).includes(DRAG_TYPE);
  };

  const readDraggedItems = (event) => {
    const raw = event?.dataTransfer?.getData(DRAG_TYPE);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const getFolderKey = (folder) =>
    folder?.name ? `${normalizePath(folder.path || '')}::${folder.name}` : '';

  const serializeItems = (items) =>
    (Array.isArray(items) ? items : [])
      .filter((item) => item && item.name && item.kind !== 'volume')
      .map((item) => ({
        name: item.name,
        path: normalizePath(item.path || ''),
        kind: item.kind,
      }));

  const resolveFolderDestination = (targetFolder) => {
    if (!targetFolder || !targetFolder.name) {
      return normalizePath(fileStore.currentPath || '');
    }

    const parent = normalizePath(targetFolder.path || '');
    const combined = parent ? `${parent}/${targetFolder.name}` : targetFolder.name;
    return normalizePath(combined);
  };

  /**
   * Check if drag and drop should be enabled (desktop only)
   */
  const canDragDrop = () => {
    return !isTouchDevice.value;
  };

  const isPointerOutsideCurrentTarget = (event) => {
    const rect = event?.currentTarget?.getBoundingClientRect?.();
    if (!rect) return true;
    const x = event.clientX;
    const y = event.clientY;
    return x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
  };

  const getItemFullPath = (item) =>
    normalizePath(item?.path ? `${item.path}/${item.name}` : item?.name || '');

  const canMoveIntoDestination = (draggedItems, destination) => {
    const normalizedDestination = normalizePath(destination || '');
    if (!normalizedDestination) return false;

    // No-op moves: everything already in destination directory.
    const isNoop = draggedItems.every(
      (item) => normalizePath(item?.path || '') === normalizedDestination
    );
    if (isNoop) return false;

    // Prevent dropping a folder into itself or its descendants.
    for (const item of draggedItems) {
      if (item?.kind !== 'directory') continue;
      const itemPath = getItemFullPath(item);
      if (!itemPath) continue;
      if (itemPath === normalizedDestination) return false;
      if (normalizedDestination.startsWith(`${itemPath}/`)) return false;
    }

    return true;
  };

  const moveDraggedItems = async (draggedItems, destination) => {
    const normalizedDestination = normalizePath(destination || '');
    if (!normalizedDestination) return;

    const movePayload = serializeItems(draggedItems);
    if (movePayload.length === 0) return;

    await moveItems(movePayload, normalizedDestination);
    await fileStore.fetchPathItems(fileStore.currentPath);
  };

  const handleDragOverKey = (event, targetKey) => {
    if (!isMoveItemsDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverKey(targetKey);
  };

  const handleDragLeaveKey = (event, targetKey) => {
    if (!canDragDrop()) return;
    if (!targetKey || dragOverTargetKey.value !== targetKey) return;
    if (isPointerOutsideCurrentTarget(event)) {
      clearDragOverKey();
    }
  };

  const handleDropToDestination = async (event, destinationPath) => {
    if (!isMoveItemsDrag(event)) return;

    event.preventDefault();
    event.stopPropagation();
    clearDragOverKey();

    const draggedItems = readDraggedItems(event);
    if (!draggedItems || draggedItems.length === 0) return;

    const destination = normalizePath(destinationPath || '');
    if (!canMoveIntoDestination(draggedItems, destination)) return;

    try {
      await moveDraggedItems(draggedItems, destination);
    } catch (error) {
      console.error('Failed to move items:', error);
    }
  };

  /**
   * Handle drag start on a file/folder item
   * @param {DragEvent} event - The drag event
   * @param {Object} item - The item being dragged
   */
  const handleDragStart = (event, item) => {
    if (!canDragDrop()) {
      event.preventDefault();
      return;
    }

    // Determine which items to drag
    // If the item is selected, drag all selected items
    // Otherwise, drag just this item
    const selectedItems = fileStore.selectedItems || [];
    const isSelected = selectedItems.some(
      (selected) => selected.name === item.name && selected.path === item.path
    );

    const itemsToDrag = isSelected && selectedItems.length > 0 ? selectedItems : [item];

    // Store the items being dragged in dataTransfer
    const dragData = JSON.stringify(itemsToDrag);
    event.dataTransfer.setData(DRAG_TYPE, dragData);
    event.dataTransfer.effectAllowed = 'move';

    // Create custom drag image with badge
    setMoveDragImage(event, itemsToDrag, item);
  };

  /**
   * Handle drag over a folder (potential drop target)
   * @param {DragEvent} event - The drag event
   * @param {Object} targetFolder - The folder being hovered over
   */
  const handleDragOver = (event, targetFolder) => {
    handleDragOverKey(event, getFolderKey(targetFolder));
  };

  /**
   * Handle drag leave a folder
   * @param {DragEvent} event - The drag event
   * @param {Object} targetFolder - The folder being left
   */
  const handleDragLeave = (event, targetFolder) => {
    handleDragLeaveKey(event, getFolderKey(targetFolder));
  };

  /**
   * Handle drop on a folder
   * @param {DragEvent} event - The drag event
   * @param {Object} targetFolder - The folder to drop into
   */
  const handleDrop = async (event, targetFolder) => {
    return handleDropToDestination(event, resolveFolderDestination(targetFolder));
  };

  /**
   * Handle drag over a generic destination path (e.g. favorites, breadcrumb, volumes)
   * @param {DragEvent} event - The drag event
   * @param {string} destinationPath - Destination directory path
   * @param {string} targetKey - Unique key for hover state
   */
  const handleDragOverPath = (event, destinationPath, targetKey) => {
    const destination = normalizePath(destinationPath || '');
    if (!destination) return;
    handleDragOverKey(event, targetKey || destination);
  };

  const handleDragLeavePath = (event, targetKey) => {
    handleDragLeaveKey(event, targetKey || '');
  };

  const handleDropPath = async (event, destinationPath) => {
    return handleDropToDestination(event, destinationPath);
  };

  /**
   * Check if a folder is currently being dragged over
   * @param {Object} folder - The folder to check
   * @returns {boolean} True if this folder is the drag target
   */
  const isDragTarget = (folder) => {
    const key = getFolderKey(folder);
    if (!key) return false;
    return dragOverTargetKey.value === key;
  };

  const isDragTargetKey = (targetKey) => {
    if (!targetKey) return false;
    return dragOverTargetKey.value === targetKey;
  };

  return {
    isDraggingOver,
    canDragDrop,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragOverPath,
    handleDragLeavePath,
    handleDropPath,
    isDragTarget,
    isDragTargetKey,
  };
}
