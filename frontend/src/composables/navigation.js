import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { withViewTransition } from '@/utils';
import { folderRoute } from '@/utils/folderRoute';
import { isEditableExtension } from '@/config/editor';
import { usePreviewManager } from '@/plugins/preview/manager';
import { useAppSettings } from '@/stores/appSettings';
import { useItemAddress } from '@/composables/itemAddress';
import { useTabsStore } from '@/stores/tabs';

// Kept beside the markdown preview plugin's own list, which matches the same
// two extensions.
const MARKDOWN_EXTENSIONS = ['md', 'markdown'];

export function useNavigation() {
  const router = useRouter();
  const route = useRoute();
  const previewManager = usePreviewManager();
  const appSettings = useAppSettings();
  const { addressFor } = useItemAddress();

  const navigate = withViewTransition((to) => router.push(to));

  /**
   * Back and forward, in this tab rather than in the window.
   *
   * A window's history is the window's: pressing Back with six tabs open took the
   * reader to whatever address they last looked at, in whichever tab that was, and
   * left the tab they were in pointing somewhere it had never been. With tabs on,
   * each tab keeps its own trail and these two walk it — which is what somebody
   * pressing Back in a tab is asking for.
   *
   * With tabs off there is one place and one trail, and it is the browser's, so
   * these are what they have always been.
   */
  const stepInTab = (which) => {
    const tabs = useTabsStore();
    if (!tabs.enabled) return null;
    return tabs[which](tabs.activeId);
  };

  const goPrev = withViewTransition(() => {
    const tabs = useTabsStore();
    if (!tabs.enabled) {
      router.back();
      return;
    }
    const stepped = stepInTab('back');
    if (stepped) void router.push(stepped.path);
  });

  const goNext = withViewTransition(() => {
    const tabs = useTabsStore();
    if (!tabs.enabled) {
      router.forward();
      return;
    }
    const stepped = stepInTab('forward');
    if (stepped) void router.push(stepped.path);
  });

  /**
   * Whether there is anywhere that way to go.
   *
   * Only answerable with tabs on: the browser's own history cannot be read, so
   * with tabs off both buttons stay live, as they always have.
   */
  const canGoPrev = computed(() => {
    const tabs = useTabsStore();
    return !tabs.enabled || tabs.canGoBack(tabs.activeId);
  });

  const canGoNext = computed(() => {
    const tabs = useTabsStore();
    return !tabs.enabled || tabs.canGoForward(tabs.activeId);
  });

  const openItem = (item) => {
    if (!item) return;

    const kind = typeof item.kind === 'string' ? item.kind : '';
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name && kind !== 'personal') return;
    const currentPath =
      typeof route.params.path === 'string'
        ? route.params.path
        : Array.isArray(route.params.path)
          ? route.params.path.join('/')
          : '';

    if (kind === 'volume') {
      navigate(folderRoute(name));
      return;
    }
    if (kind === 'personal') {
      navigate(folderRoute('personal'));
      return;
    }
    if (kind === 'directory') {
      const newPath = currentPath ? `${currentPath}/${name}` : name;
      navigate(folderRoute(newPath));
      return;
    }

    const extensionFromKind = kind.toLowerCase();
    const extensionFromName = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

    // Markdown is the one kind of file that has both a preview and an editor,
    // so it is the only one where opening it is a choice. Whoever mostly writes
    // markdown was going through the preview and clicking Edit every time
    // (#347); this sends them straight where they were heading. Everything else
    // keeps preview-first: an image or a video has no editor to go to.
    const opensInEditor =
      appSettings.userSettings?.markdownOpensInEditor &&
      (MARKDOWN_EXTENSIONS.includes(extensionFromKind) ||
        MARKDOWN_EXTENSIONS.includes(extensionFromName));

    const basePath = item.path ? `${item.path}/${name}` : name;
    const fullPath = basePath.replace(/^\/+/, '');
    const editable =
      isEditableExtension(extensionFromKind) || isEditableExtension(extensionFromName);

    // A tab of its own, when that is what this account asked for.
    //
    // One decision for every kind of file rather than one per plugin: a
    // spreadsheet and a photograph open the same way, because a preference that
    // holds for some files and not others is a preference nobody can predict.
    // Both addresses already exist — `/open` for anything with a preview,
    // `/editor` for anything the text editor opens — so this hands one of them to
    // whoever provides the tabs.
    //
    // Which is now a choice. With `browseInTabs` on, this application has tabs of
    // its own, and a document belongs in one of those: a tab beside the folder it
    // came from, where the same window still holds the clipboard and the
    // transfers. With it off, the browser provides them as it always did.
    //
    // With tabs on, a document is always taken to its address rather than opened
    // over the folder. The panel it opens in is `fixed` and lives in the body: it
    // would stay on screen while somebody moved to another tab, a document sitting
    // over a folder it has nothing to do with. At an address it is the tab's
    // content, and leaving the tab closes it because leaving the route does.
    //
    // Which tab is then the reader's usual choice: `documentsOpenInNewTab` means
    // one of ours rather than one of the browser's, and without it the tab they are
    // in becomes the document.
    const tabsOn = appSettings.userSettings?.browseInTabs === true;
    const inNewTab = appSettings.userSettings?.documentsOpenInNewTab === true;

    if (tabsOn || inNewTab) {
      const target = addressFor(item, { currentPath });

      if (target) {
        if (tabsOn) {
          // The store is asked for only when there is a tab to open in it: reaching
          // for it to find out would build it on every screen that opens a file.
          if (inNewTab) {
            const tab = useTabsStore().open(target.path, { own: true });
            if (tab) navigate({ path: tab.path });
          } else {
            navigate(target);
          }
          return;
        }
        // `noopener` because the page opened must not be able to reach back
        // into this one through `window.opener`.
        window.open(router.resolve(target).href, '_blank', 'noopener');
        return;
      }
    }

    // Files: try preview first (no view transition – avoids double animations)
    if (!opensInEditor && previewManager.open(item)) {
      return;
    }

    if (editable) {
      // Encode each segment for editor path
      const encodedPath = fullPath.split('/').map(encodeURIComponent).join('/');
      navigate({ path: `/editor/${encodedPath}` });
    }
  };

  const openBreadcrumb = (path) => {
    if (path === 'share') {
      navigate({ name: 'SharedWithMe' });
      return;
    }
    if (!path) {
      navigate({ name: 'HomeView' });
      return;
    }
    navigate(folderRoute(path));
  };

  const goUp = () => {
    const currentPath =
      typeof route.params.path === 'string'
        ? route.params.path
        : Array.isArray(route.params.path)
          ? route.params.path.join('/')
          : '';
    const segments = currentPath.split('/').filter(Boolean);
    if (segments.length === 0) return;

    segments.pop();
    const newPath = segments.join('/');
    if (newPath) {
      navigate(folderRoute(newPath));
      return;
    }
    navigate({ name: 'HomeView' });
  };

  return {
    openItem,
    openBreadcrumb,
    goNext,
    goPrev,
    goUp,
    canGoPrev,
    canGoNext,
  };
}
