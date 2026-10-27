import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

/**
 * The Terminal entry in the sidebar.
 *
 * An ordinary click opens a terminal *here* — beside the folder, in this tab,
 * where it has always been. It was briefly the other way round, opening a tab of
 * its own every time, and that is not what asking for a terminal means: the
 * reader wanted a shell, not somewhere else to be.
 *
 * A tab of its own is a separate decision and is said the way every other "open
 * this somewhere else" is said in this application — command, or control, or the
 * middle button. One rule, whatever is being opened.
 *
 * Where the shell starts is the same question either way: the folder on screen,
 * or nowhere in particular on the home page.
 */

const terminalStore = { toggleIn: vi.fn(), isOpenIn: vi.fn(() => false) };
vi.mock('@/stores/terminal', () => ({ useTerminalStore: () => terminalStore }));

const appTabs = { enabled: true, activeId: 'tab-1' };
const openInTab = vi.fn(() => ({ id: 'tab-2' }));
vi.mock('@/composables/tabNavigation', () => ({
  useTabNavigation: () => ({
    get tabs() {
      return appTabs;
    },
    open: (...args) => openInTab(...args),
  }),
}));

const auth = { currentUser: { roles: ['admin'] } };
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }));

const fileStore = { currentPath: 'Docs/2026' };
vi.mock('@/stores/fileStore', () => ({ useFileStore: () => fileStore }));

const route = { name: 'FolderView' };
vi.mock('vue-router', () => ({ useRoute: () => route }));

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

import TerminalMenu from './TerminalMenu.vue';

const show = () => mount(TerminalMenu, { global: { mocks: { $t: (key) => key } } });
const terminalButton = (wrapper) =>
  wrapper.findAll('button').find((button) => button.text().includes('terminal'));

beforeEach(() => {
  terminalStore.toggleIn.mockClear();
  openInTab.mockClear();
  appTabs.enabled = true;
  appTabs.activeId = 'tab-1';
  auth.currentUser = { roles: ['admin'] };
  fileStore.currentPath = 'Docs/2026';
  route.name = 'FolderView';
});

describe('opening a terminal from the sidebar', () => {
  it('opens one in this tab, on the folder on screen', async () => {
    const wrapper = show();

    await terminalButton(wrapper).trigger('click');

    expect(terminalStore.toggleIn).toHaveBeenCalledWith('tab-1', 'Docs/2026');
    expect(openInTab).not.toHaveBeenCalled();
  });

  it('opens one in this tab with tabs turned off as well', async () => {
    appTabs.enabled = false;
    const wrapper = show();

    await terminalButton(wrapper).trigger('click');

    expect(terminalStore.toggleIn).toHaveBeenCalledWith('tab-1', 'Docs/2026');
  });

  it('starts nowhere in particular from the home page', async () => {
    route.name = 'HomeView';
    const wrapper = show();

    await terminalButton(wrapper).trigger('click');

    expect(terminalStore.toggleIn).toHaveBeenCalledWith('tab-1', '');
  });

  /** The same rule as a folder, a favourite or a file: command, or control. */
  it('takes a tab of its own when the reader asks for one, and nothing else does', async () => {
    const wrapper = show();

    await terminalButton(wrapper).trigger('click', { metaKey: true });

    expect(openInTab).toHaveBeenCalledWith('/terminal/Docs/2026', { behind: true, own: true });
    expect(terminalStore.toggleIn).not.toHaveBeenCalled();
  });

  it('takes one on control too, which is the same gesture off a Mac', async () => {
    const wrapper = show();

    await terminalButton(wrapper).trigger('click', { ctrlKey: true });

    expect(openInTab).toHaveBeenCalledWith('/terminal/Docs/2026', { behind: true, own: true });
  });

  it('takes one on the middle button, which is the same gesture again', async () => {
    const wrapper = show();

    await terminalButton(wrapper).trigger('auxclick', { button: 1 });

    expect(openInTab).toHaveBeenCalledWith('/terminal/Docs/2026', { behind: true, own: true });
    expect(terminalStore.toggleIn).not.toHaveBeenCalled();
  });

  /**
   * With tabs off there is nowhere else to open it, so the modifier falls back
   * to what the plain click does rather than doing nothing at all.
   */
  it('opens one here when it is asked for a tab and there are none', async () => {
    appTabs.enabled = false;
    const wrapper = show();

    await terminalButton(wrapper).trigger('click', { metaKey: true });

    expect(openInTab).not.toHaveBeenCalled();
    expect(terminalStore.toggleIn).toHaveBeenCalledWith('tab-1', 'Docs/2026');
  });

  it('writes a folder holding a space the way an address is written', async () => {
    fileStore.currentPath = 'Docs/data set';
    const wrapper = show();

    await terminalButton(wrapper).trigger('click', { metaKey: true });

    expect(openInTab).toHaveBeenCalledWith('/terminal/Docs/data%20set', {
      behind: true,
      own: true,
    });
  });

  /** A terminal is an administrator's, whichever way it is shown. */
  it('is not offered to anybody else', () => {
    auth.currentUser = { roles: ['user'] };
    const wrapper = show();

    expect(terminalButton(wrapper)).toBeUndefined();
  });
});
