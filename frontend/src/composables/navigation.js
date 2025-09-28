import { useRouter, useRoute } from 'vue-router';
import { withViewTransition } from '@/utils';
import { isEditableExtension } from '@/config/editor';
import { isPreviewableImage, isPreviewableVideo } from '@/config/media';
import { usePreviewStore } from '@/stores/previewStore';
import { useTabStore } from '@/stores/tabStore';
import { normalizePath } from '@/api';

const buildPathFromRoute = (route) => {
  const param = route.params.path;
  if (Array.isArray(param)) {
    return param.join('/');
  }
  return param || '';
};

const joinPaths = (base, segment) => {
  const parts = [];
  if (base) {
    parts.push(base);
  }
  if (segment) {
    parts.push(segment);
  }
  return normalizePath(parts.join('/'));
};

const resolveBrowseDestination = (path) => {
  const normalized = normalizePath(path || '');
  return normalized ? `/browse/${normalized}` : '/browse/';
};

export function useNavigation() {
  const router = useRouter();
  const route = useRoute();
  const previewStore = usePreviewStore();
  const tabStore = useTabStore();

  const currentRoutePath = () => buildPathFromRoute(route);

  const getActiveTabId = () => tabStore.activeTabId || tabStore.activeTab?.id || null;

  const pushBrowsePath = (path, options = {}) => {
    const destination = resolveBrowseDestination(path);
    const navState = { ...(options.state || {}) };
    const tabId = options.tabId || getActiveTabId();
    if (tabId) {
      navState.tabId = tabId;
    }

    const payload = { path: destination, state: navState };

    if (options.replace) {
      router.replace(payload);
    } else {
      router.push(payload);
    }
  };

  const openItem = withViewTransition((item) => {
    if (!item) return;

    const extensionFromKind = typeof item.kind === 'string' ? item.kind.toLowerCase() : '';
    const extensionFromName = typeof item.name === 'string' && item.name.includes('.')
      ? item.name.split('.').pop().toLowerCase()
      : '';

    if (item.kind === 'volume') {
      pushBrowsePath(item.name);
      return;
    }

    if (item.kind === 'directory') {
      const newPath = joinPaths(currentRoutePath(), item.name);
      pushBrowsePath(newPath);
      return;
    }

    if (isEditableExtension(extensionFromKind) || isEditableExtension(extensionFromName)) {
      const basePath = item.path ? `${item.path}/${item.name}` : item.name;
      const fileToEdit = basePath.replace(/^\/+/, '');
      router.push({ path: `/editor/${fileToEdit}` });
      return;
    }

    const shouldPreview =
      isPreviewableImage(extensionFromKind)
      || isPreviewableVideo(extensionFromKind)
      || isPreviewableImage(extensionFromName)
      || isPreviewableVideo(extensionFromName);

    if (shouldPreview) {
      previewStore.open(item);
    }
  });

  const openItemInNewTab = withViewTransition((item) => {
    if (!item) return;

    if (item.kind !== 'directory' && item.kind !== 'volume') {
      openItem(item);
      return;
    }

    const targetPath = item.kind === 'volume'
      ? normalizePath(item.name)
      : joinPaths(currentRoutePath(), item.name);

    const newTab = tabStore.openTab(targetPath, { allowDuplicate: true });
    pushBrowsePath(targetPath, { tabId: newTab.id });
  });

  const openBreadcrumb = withViewTransition((path) => {
    pushBrowsePath(path);
  });

  const goNext = withViewTransition(() => router.go(1));

  const goPrev = withViewTransition(() => router.go(-1));

  const goUp = withViewTransition(() => {
    const current = currentRoutePath();
    if (!current) {
      return;
    }

    const segments = current.split('/').filter(Boolean);
    if (segments.length === 0) {
      pushBrowsePath('');
      return;
    }

    segments.pop();
    pushBrowsePath(segments.join('/'));
  });

  return {
    openItem,
    openItemInNewTab,
    openBreadcrumb,
    goNext,
    goPrev,
    goUp,
  };
}
