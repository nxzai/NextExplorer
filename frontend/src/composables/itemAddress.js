import { folderRoute } from '@/utils/folderRoute';
import { documentRoute } from '@/utils/documentRoute';
import { isEditableExtension } from '@/config/editor';
import { usePreviewManager } from '@/plugins/preview/manager';
import { useAppSettings } from '@/stores/appSettings';
import { useTabsStore } from '@/stores/tabs';

// Kept beside the markdown preview plugin's own list, which matches the same
// two extensions.
const MARKDOWN_EXTENSIONS = ['md', 'markdown'];

/**
 * Where an entry in a listing lives, as an address.
 *
 * This decision was written inside `openItem`, where it served one caller: the
 * account that had asked for documents to open in a browser tab. Three callers
 * want it now — that one, the middle mouse button, and the menu entry that opens
 * something in a tab of this application — and a decision made in three places is
 * a decision that will disagree with itself. So it is one function, and the three
 * of them ask it.
 *
 * Answers null for an entry that has nowhere of its own: a file with no preview
 * and no editor, which is a download rather than a place.
 */
export function useItemAddress() {
  const previewManager = usePreviewManager();
  const appSettings = useAppSettings();

  const addressFor = (item, { currentPath = '' } = {}) => {
    if (!item) return null;

    const kind = typeof item.kind === 'string' ? item.kind : '';
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name && kind !== 'personal') return null;

    if (kind === 'volume') return folderRoute(name);
    if (kind === 'personal') return folderRoute('personal');
    if (kind === 'directory') return folderRoute(currentPath ? `${currentPath}/${name}` : name);

    const extensionFromKind = kind.toLowerCase();
    const extensionFromName = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

    // Markdown is the one kind of file with both a preview and an editor, so it
    // is the only one where opening it is a choice this account has made.
    const opensInEditor =
      appSettings.userSettings?.markdownOpensInEditor &&
      (MARKDOWN_EXTENSIONS.includes(extensionFromKind) ||
        MARKDOWN_EXTENSIONS.includes(extensionFromName));

    const basePath = item.path ? `${item.path}/${name}` : name;
    const fullPath = basePath.replace(/^\/+/, '');
    const editable =
      isEditableExtension(extensionFromKind) || isEditableExtension(extensionFromName);

    // Asked once: matching a plugin builds a context and walks the list.
    const previewable = !opensInEditor && Boolean(previewManager.findPlugin(item));
    if (previewable) return documentRoute(fullPath);
    if (opensInEditor || editable) {
      return { path: `/editor/${fullPath.split('/').map(encodeURIComponent).join('/')}` };
    }
    return null;
  };

  return { addressFor };
}

/**
 * An entry in a listing, opened in a tab behind.
 *
 * Here rather than beside `openPlaceInTab`, which answers the same question for
 * a favourite or a volume: this one needs an address worked out, and working one
 * out reaches for the preview manager — which reaches for the router. A file in
 * the sidebar that only wanted to open a folder was pulling all of it into every
 * screen that draws one.
 *
 * Behind, and marked `own` so a document opened in it can close it again.
 * Answers false for an entry with nowhere of its own — a file with neither a
 * preview nor an editor is a download, not somewhere to be — and with tabs off,
 * which leaves the ordinary gesture to do what it has always done.
 */
export function useOpenItemInTab() {
  const openItemInTab = (item, currentPath = '') => {
    const tabs = useTabsStore();
    if (!tabs.enabled) return false;
    const target = useItemAddress().addressFor(item, { currentPath });
    if (!target?.path) return false;
    const tab = tabs.open(target.path, { activate: false, own: true });
    if (!tab) return false;

    // And got ready while the reader is still on the listing. This is the gesture
    // people actually use — the middle button, or the modifier, on a row — and the
    // first version of the warming reached only the entry in the menu, because that
    // was the one road that happened to go through `tabNavigation`.
    void import('@/composables/tabWarmup')
      .then(({ warmInBackground }) => warmInBackground([{ ...tab }]))
      .catch(() => {});
    return true;
  };

  return { openItemInTab };
}
