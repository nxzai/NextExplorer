// imagePreview.js
import { isPreviewableImage } from '@/config/media';

/**
 * Image preview plugin using the shared media gallery.
 */
export const imagePreviewPlugin = () => ({
  id: 'core-image-preview',
  label: 'Image Preview',
  priority: 20,
  standalone: true,

  match: (context) => {
    return isPreviewableImage(context.extension);
  },

  component: () => import('../preview/MediaPreview.vue'),
});
