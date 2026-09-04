import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaPreview from './MediaPreview.vue';

const media = [
  { name: 'first.jpg', kind: 'jpg', path: 'Test' },
  { name: 'clip.mp4', kind: 'mp4', path: 'Test' },
  { name: 'last.png', kind: 'png', path: 'Test' },
];

let pause;

beforeEach(() => {
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const createWrapper = (item = media[0]) => {
  const api = {
    close: vi.fn(),
    download: vi.fn(),
    getPreviewUrl: (target) => `/api/preview/${target.name}`,
    getSiblings: () => media,
  };

  const wrapper = mount(MediaPreview, {
    props: {
      item,
      extension: item.kind,
      filePath: `${item.path}/${item.name}`,
      previewUrl: api.getPreviewUrl(item),
      api,
    },
  });

  return { api, wrapper };
};

const swipe = async (wrapper, startX, startY, endX, endY) => {
  const preview = wrapper.get('[data-test="media-preview"]');
  await preview.trigger('touchstart', {
    changedTouches: [
      {
        clientX: startX,
        clientY: startY,
        identifier: 1,
      },
    ],
  });
  await preview.trigger('touchend', {
    changedTouches: [
      {
        clientX: endX,
        clientY: endY,
        identifier: 1,
      },
    ],
  });
};

describe('MediaPreview', () => {
  it('navigates between images and videos with horizontal swipes', async () => {
    const { wrapper } = createWrapper();

    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');

    await swipe(wrapper, 260, 120, 120, 120);
    expect(wrapper.get('video').exists()).toBe(true);
    expect(wrapper.get('source').attributes('src')).toBe('/api/preview/clip.mp4');

    await swipe(wrapper, 120, 120, 280, 120);
    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');
  });

  it('does not navigate for vertical or short touch gestures', async () => {
    const { wrapper } = createWrapper();

    await swipe(wrapper, 200, 100, 220, 240);
    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');

    await swipe(wrapper, 200, 100, 170, 100);
    expect(wrapper.get('img').attributes('src')).toBe('/api/preview/first.jpg');
  });

  it('downloads the media currently shown after swiping', async () => {
    const { api, wrapper } = createWrapper();

    await swipe(wrapper, 260, 120, 120, 120);
    await wrapper.get('button[aria-label="Download media"]').trigger('click');

    expect(api.download).toHaveBeenCalledWith(media[1]);
  });

  it('pauses video playback when switching media or closing the preview', async () => {
    const { wrapper: switchingWrapper } = createWrapper(media[1]);

    await swipe(switchingWrapper, 260, 120, 120, 120);
    expect(pause).toHaveBeenCalledTimes(1);

    switchingWrapper.unmount();

    const { wrapper: closingWrapper } = createWrapper(media[1]);
    closingWrapper.unmount();

    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('keeps native video arrow-key controls available', () => {
    const { wrapper } = createWrapper(media[1]);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    });

    wrapper.get('video').element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.get('source').attributes('src')).toBe('/api/preview/clip.mp4');
  });
});
