import { onKeyStroke } from '@vueuse/core'
import { useFileActions } from '@/composables/fileActions'

export function useClipboardShortcuts() {
  const actions = useFileActions();
  const shouldIgnore = (e) => actions.shouldIgnoreHotkeyEvent(e);

  onKeyStroke('x', (e) => {
    if (shouldIgnore(e)) return;
    if (!actions.canCut.value) return;
    e.preventDefault();
    e.stopPropagation();
    actions.runCut();
  }, { dedupe: true, eventName: 'keydown', target: window });

  onKeyStroke('c', (e) => {
    if (shouldIgnore(e)) return;
    if (!actions.canCopy.value) return;
    e.preventDefault();
    e.stopPropagation();
    actions.runCopy();
  }, { dedupe: true, eventName: 'keydown', target: window });

  onKeyStroke('v', async (e) => {
    if (shouldIgnore(e)) return;
    if (!actions.canPaste.value) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      await actions.runPasteIntoCurrent();
    } catch (err) {
      // Surface errors to console only; UI can handle feedback separately
      console.error('Paste failed', err);
    }
  }, { dedupe: true, eventName: 'keydown', target: window });
}
