/**
 * Creates and sets a custom drag image for file/folder move operations.
 * Kept as a small, DOM-only helper to avoid bloating composables/components.
 */
export const setMoveDragImage = (event, items, primaryItem) => {
  const safeItems = Array.isArray(items) ? items : [];
  const count = safeItems.length;
  if (!event?.dataTransfer || !primaryItem || !count) return;

  const dragImage = document.createElement('div');
  dragImage.className = 'file-drag-image';

  const stack = document.createElement('div');
  stack.className = 'file-drag-stack';
  const stackDepth = Math.min(count, 3);

  let iconNode = null;
  const sourceEl = event.currentTarget;
  if (sourceEl) {
    const foundIcon = sourceEl.querySelector('svg') || sourceEl.querySelector('.bg-contain');
    if (foundIcon) {
      iconNode = foundIcon.cloneNode(true);
      iconNode.style.width = '24px';
      iconNode.style.height = '24px';
      iconNode.classList.remove('w-full', 'h-full', 'w-16', 'h-16', 'w-6', 'h-6');
    }
  }

  for (let i = 0; i < stackDepth; i++) {
    const card = document.createElement('div');
    card.className = 'file-drag-card';

    const offset = (stackDepth - 1 - i) * 8;
    card.style.marginLeft = `${offset}px`;
    card.style.marginTop = `${offset}px`;
    card.style.zIndex = i + 1;

    const iconContainer = document.createElement('div');
    iconContainer.className = 'flex shrink-0 items-center justify-center w-6 h-6';
    if (iconNode) {
      iconContainer.appendChild(iconNode.cloneNode(true));
    } else {
      iconContainer.innerHTML = '<div class="w-4 h-4 bg-gray-400 rounded"></div>';
    }
    card.appendChild(iconContainer);

    const label = document.createElement('span');
    label.className = 'truncate text-sm font-medium';
    label.textContent =
      i === stackDepth - 1
        ? primaryItem.name
        : safeItems[i] && safeItems[i].name
          ? safeItems[i].name
          : primaryItem.name;
    card.appendChild(label);

    stack.appendChild(card);
  }

  dragImage.appendChild(stack);

  const badge = document.createElement('div');
  badge.className = 'file-drag-badge';
  badge.textContent = String(count);
  dragImage.appendChild(badge);

  document.body.appendChild(dragImage);
  event.dataTransfer.setDragImage(dragImage, -10, 10);

  setTimeout(() => {
    document.body.removeChild(dragImage);
  }, 100);
};

