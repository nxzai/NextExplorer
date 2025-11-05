export const isMac = typeof navigator !== 'undefined'
  ? /Mac|iPhone|iPod|iPad/.test(navigator.platform || '')
  : false;

export const modKeyLabel = isMac ? '⌘' : 'Ctrl';

