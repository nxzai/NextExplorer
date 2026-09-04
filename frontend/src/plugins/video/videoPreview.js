import { isPreviewableVideo } from '@/config/media';
import logger from '@/utils/logger';

/**
 * Video preview plugin using the shared media gallery.
 */
export const videoPreviewPlugin = () => ({
  // Required fields
  id: 'core-video-preview',
  label: 'Video Preview',

  // Optional configuration
  priority: 10,
  standalone: true,

  // Match function - receives simple context
  match: (context) => {
    return isPreviewableVideo(context.extension);
  },

  // Component loader - can be sync or async
  component: () => import('../preview/MediaPreview.vue'),

  actions: (context) => [
    {
      id: 'download',
      label: 'Download',
      run: () => context.api.download(),
    },
  ],

  // Optional lifecycle hooks
  onOpen: (context) => {
    logger.debug('Opening video', context.item.name);
  },

  onClose: (context) => {
    logger.debug('Closing video', context.item.name);
  },
});
