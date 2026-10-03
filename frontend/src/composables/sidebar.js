import { ref, watch } from 'vue';
import { useEventListener, useMediaQuery, useStorage } from '@vueuse/core';

/**
 * The sidebar: how wide it is, and whether it is showing on a narrow screen.
 *
 * One of these for the window rather than one per screen, because that is what
 * it is — a pair of tabs side by side has one sidebar between them, and the
 * toolbar above a pane has to be able to open it. Held here rather than in the
 * layout it used to live in: the panes outlived that layout, and so does this.
 *
 * A module-level singleton on purpose. A composable that built fresh refs for
 * every caller would give the toolbar one `isOpen` and the sidebar another, and
 * the button would open nothing.
 */
const MIN_WIDTH = 200;
const MAX_WIDTH = 460;

const width = useStorage('browser-aside-width', 230);
const isOpen = ref(false);
let wired = false;

export const useSidebar = () => {
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const open = () => {
    isOpen.value = true;
  };
  const close = () => {
    isOpen.value = false;
  };
  const toggle = () => {
    isOpen.value = !isOpen.value;
  };

  if (!wired) {
    wired = true;

    // A window that has become wide has no overlay to close.
    watch(isDesktop, (desktop) => {
      if (desktop) close();
    });

    // What is under the overlay must not scroll while the overlay is over it.
    watch(isOpen, (showing) => {
      document.body.classList.toggle('overflow-hidden', showing && !isDesktop.value);
    });

    useEventListener(window, 'keydown', (event) => {
      if (event.key === 'Escape' && isOpen.value) close();
    });
  }

  /**
   * Dragging the edge, which is the width somebody chose rather than a setting
   * they went looking for.
   */
  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  const onResizeStart = (event) => {
    dragging = true;
    startX = event.clientX;
    startWidth = width.value;
    document.body.classList.add('select-none');
  };

  useEventListener(window, 'pointermove', (event) => {
    if (!dragging) return;
    width.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + event.clientX - startX));
    event.preventDefault();
  });

  useEventListener(window, 'pointerup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('select-none');
  });

  return { width, isOpen, isDesktop, open, close, toggle, onResizeStart };
};
