import { useKeyboardShortcuts } from '@/composables/keyboardShortcuts';

export function useClipboardShortcuts() {
  return useKeyboardShortcuts({ clipboard: true, spotlight: false, view: false });
}
