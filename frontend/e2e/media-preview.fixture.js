import { createApp } from 'vue';
import MediaPreview from '../src/plugins/preview/MediaPreview.vue';

const media = [
  { name: 'first.jpg', kind: 'jpg', path: 'Test' },
  { name: 'clip.mp4', kind: 'mp4', path: 'Test' },
  { name: 'last.png', kind: 'png', path: 'Test' },
];

const previewUrls = {
  'first.jpg':
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  'clip.mp4': 'data:video/mp4;base64,',
  'last.png':
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
};

const item = media[0];

createApp(MediaPreview, {
  item,
  extension: item.kind,
  filePath: `${item.path}/${item.name}`,
  previewUrl: previewUrls[item.name],
  api: {
    close: () => {},
    download: () => {},
    getPreviewUrl: (target) => previewUrls[target.name],
    getSiblings: () => media,
  },
}).mount('#app');
