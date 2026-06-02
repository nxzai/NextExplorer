import { useRouter, useRoute } from 'vue-router';
import { withViewTransition } from '@/utils';
import { isEditableExtension } from '@/config/editor';
import { usePreviewManager } from '@/plugins/preview/manager';
import { pathParamToString, toPathSegments } from '@/api/http';

export function useNavigation() {
  const router = useRouter();
  const route = useRoute();
  const previewManager = usePreviewManager();

  const navigate = withViewTransition((to) => router.push(to));
  const goPrev = withViewTransition(() => router.back());
  const goNext = withViewTransition(() => router.forward());

  const openItem = (item) => {
    if (!item) return;

    const kind = typeof item.kind === 'string' ? item.kind : '';
    const name = typeof item.name === 'string' ? item.name : '';
    if (!name && kind !== 'personal') return;
    const currentPath = pathParamToString(route.params.path);

    if (kind === 'volume') {
      navigate({ name: 'FolderView', params: { path: [name] } });
      return;
    }
    if (kind === 'personal') {
      navigate({ name: 'FolderView', params: { path: ['personal'] } });
      return;
    }
    if (kind === 'directory') {
      const segments = toPathSegments(currentPath);
      segments.push(name);
      navigate({ name: 'FolderView', params: { path: segments } });
      return;
    }

    // Files: try preview first (no view transition – avoids double animations)
    if (previewManager.open(item)) {
      return;
    }

    const extensionFromKind = kind.toLowerCase();
    const extensionFromName = name.includes('.') ? name.split('.').pop().toLowerCase() : '';

    if (isEditableExtension(extensionFromKind) || isEditableExtension(extensionFromName)) {
      const basePath = item.path ? `${item.path}/${name}` : name;
      const fileToEdit = basePath.replace(/^\/+/, '');
      // Encode each segment for editor path
      const encodedPath = fileToEdit.split('/').map(encodeURIComponent).join('/');
      navigate({ path: `/editor/${encodedPath}` });
      return;
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
    navigate({ name: 'FolderView', params: { path: toPathSegments(path) } });
  };

  const goUp = () => {
    const segments = toPathSegments(route.params.path);
    if (segments.length === 0) return;

    segments.pop();
    if (segments.length > 0) {
      navigate({ name: 'FolderView', params: { path: segments } });
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
  };
}
