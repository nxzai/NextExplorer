import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Back and forward, in this tab rather than in the window.
 *
 * A window's history is the window's: with six tabs open, pressing Back took the
 * reader to whatever address they last looked at — in whichever tab that was —
 * and left the tab they were in pointing somewhere it had never been. Each tab
 * keeps its own trail now, and these two buttons walk it.
 *
 * With tabs off there is one place and one trail, and it is the browser's, so
 * nothing changes: the buttons are the browser's Back and Forward, and both stay
 * live because a browser will not say whether there is anywhere to go.
 */

const push = vi.fn();
const back = vi.fn();
const forward = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push, back, forward, resolve: (to) => ({ href: `#${to.path}` }) }),
  useRoute: () => ({ params: { path: 'Notes' } }),
}));

vi.mock('@/utils', () => ({ withViewTransition: (fn) => fn }));
vi.mock('@/plugins/preview/manager', () => ({
  usePreviewManager: () => ({ open: vi.fn(), findPlugin: vi.fn() }),
}));
vi.mock('@/stores/appSettings', () => ({ useAppSettings: () => ({ userSettings: {} }) }));
vi.mock('@/config/editor', () => ({ isEditableExtension: () => false }));

const tabs = vi.hoisted(() => ({
  enabled: true,
  activeId: 'tab-1',
  back: vi.fn(() => ({ id: 'tab-1', path: '/browse/Docs' })),
  forward: vi.fn(() => ({ id: 'tab-1', path: '/browse/Docs/2026' })),
  canGoBack: vi.fn(() => true),
  canGoForward: vi.fn(() => false),
}));
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => tabs }));

import { useNavigation } from './navigation';

beforeEach(() => {
  push.mockClear();
  back.mockClear();
  forward.mockClear();
  tabs.enabled = true;
  tabs.activeId = 'tab-1';
  tabs.back.mockClear().mockReturnValue({ id: 'tab-1', path: '/browse/Docs' });
  tabs.forward.mockClear().mockReturnValue({ id: 'tab-1', path: '/browse/Docs/2026' });
  tabs.canGoBack.mockClear().mockReturnValue(true);
  tabs.canGoForward.mockClear().mockReturnValue(false);
});

describe('with tabs on', () => {
  it('walks this tab back, and goes where that tab now says it is', () => {
    useNavigation().goPrev();

    expect(tabs.back).toHaveBeenCalledWith('tab-1');
    expect(push).toHaveBeenCalledWith('/browse/Docs');
    // Never the window's own history, which belongs to no tab in particular.
    expect(back).not.toHaveBeenCalled();
  });

  it('walks it forward the same way', () => {
    useNavigation().goNext();

    expect(tabs.forward).toHaveBeenCalledWith('tab-1');
    expect(push).toHaveBeenCalledWith('/browse/Docs/2026');
    expect(forward).not.toHaveBeenCalled();
  });

  /** Nothing behind it in *this* tab means nothing happens, not somebody else's. */
  it('goes nowhere when this tab has nowhere behind it', () => {
    tabs.back.mockReturnValue(null);

    useNavigation().goPrev();

    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it('says which way there is anywhere to go, so the buttons can show it', () => {
    const { canGoPrev, canGoNext } = useNavigation();

    expect(canGoPrev.value).toBe(true);
    expect(canGoNext.value).toBe(false);
  });
});

describe('with tabs off', () => {
  beforeEach(() => {
    tabs.enabled = false;
  });

  it('is the browser’s own history, as it has always been', () => {
    const navigation = useNavigation();

    navigation.goPrev();
    navigation.goNext();

    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
    expect(tabs.back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  /** A browser will not say whether there is anywhere to go, so neither do we. */
  it('leaves both buttons live, because nothing can answer', () => {
    const { canGoPrev, canGoNext } = useNavigation();

    expect(canGoPrev.value).toBe(true);
    expect(canGoNext.value).toBe(true);
  });
});
