import { ref } from 'vue';
import { config, mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// The catalogue is mocked away below, and with it the `$t` the plugin installs.
config.global.mocks = { ...config.global.mocks, $t: (key) => key };

const configError = ref(null);
const dismissConfigWarning = vi.fn(() => {
  if (configError.value?.mode === 'mismatch') {
    configError.value = null;
  }
});

vi.mock('@/composables/useConfigErrorGate', () => ({
  useConfigErrorGate: () => ({
    configError,
    dismissConfigWarning,
  }),
}));

vi.mock('@/components/ConfigWarningNotice.vue', () => ({
  default: {
    props: ['expectedOrigin', 'requestOrigin'],
    emits: ['dismiss'],
    template:
      '<div data-test="config-warning">PUBLIC_URL warning<button aria-label="Dismiss warning" @click="$emit(\'dismiss\')">Dismiss</button></div>',
  },
}));

// The account's language is the settings store's business, and this spec is
// about the configuration gate: what belongs here is that the shell asks for
// it at all, which the test at the bottom checks.
const accountLanguage = vi.fn();
vi.mock('@/composables/useAccountLanguage', () => ({
  useAccountLanguage: () => accountLanguage(),
}));

// The tabs follow the address from the shell, for the same reason the language is
// applied there: it has to hold across every screen and outlive the route changes
// between them. Mocked here because this spec is about the configuration gate;
// that the shell asks for it at all is checked below.
const tabRouteSync = vi.fn();
vi.mock('@/composables/tabNavigation', () => ({
  useTabRouteSync: () => tabRouteSync(),
  // Reached by what the chrome draws; the gestures it carries are held in its
  // own place.
  useTabNavigation: () => ({
    tabs: appTabs,
    visible: { value: false },
    activate: vi.fn(),
    open: vi.fn(),
    openHome: vi.fn(),
    close: vi.fn(),
    closeOthers: vi.fn(),
    closeAll: vi.fn(),
  }),
}));

vi.mock('@/components/TabStrip.vue', () => ({
  default: { template: '<div data-test="tab-strip-stub"></div>' },
}));

// Every tab's open document, mounted here and only here: it has to outlive the
// pages, or bringing a folder tab forward and going back would rebuild whatever
// was open. Stubbed because this spec is about the configuration gate; that the
// shell mounts it, once, is checked below.
const previewHost = vi.fn();
/**
 * Every open shell, mounted here and only here — for the same reason the documents
 * are: `/browse` and `/terminal` are two route records, so a host inside the browser
 * layout was destroyed whenever the reader crossed between them, and an unmounted
 * terminal is a killed shell.
 */
const terminals = vi.hoisted(() => ({
  terminalEnabled: false,
  openIds: [],
  // Asked by whatever the chrome reaches for; this spec says nothing about it.
  ensureLoaded: () => Promise.resolve(),
}));
vi.mock('@/stores/features', () => ({ useFeaturesStore: () => terminals }));
vi.mock('@/stores/terminal', () => ({ useTerminalStore: () => terminals }));
// Marked as a module so Vue's async resolution reads it as one rather than asking the
// mock for exports it does not have.
vi.mock('@/components/TerminalHost.vue', () => ({
  __esModule: true,
  default: { template: '<div data-test="terminal-host-stub"></div>' },
}));

vi.mock('@/plugins/preview/PreviewHost.vue', () => ({
  default: {
    setup: () => previewHost(),
    template: '<div data-test="preview-host-stub"></div>',
  },
}));

// Whatever the application is asking, mounted here and only here, for the same reason
// the documents are: the screens that ask are the ones on their way out. Stubbed, and
// that the shell mounts it is checked below.
const askDialog = vi.fn();
vi.mock('@/components/AskDialog.vue', () => ({
  default: {
    setup: () => askDialog(),
    template: '<div data-test="ask-dialog-stub"></div>',
  },
}));

vi.mock('@/components/ConfigErrorScreen.vue', () => ({
  default: {
    props: ['mode', 'expectedOrigin', 'requestOrigin'],
    template: '<div data-test="config-error">This app isn’t configured correctly.</div>',
  },
}));

/**
 * The window's own chrome, which the shell now draws: the sidebar, the bar above
 * a pane, the panes themselves and the dialogs that belong to the window rather
 * than to a page. All stubbed — each is held in its own place, and what this
 * spec is about is that the shell asks for the singletons once.
 */
const chrome = [
  'WindowSidebar',
  'WindowBar',
  'TabPane',
  'ExplorerContextMenu',
  'ClipboardProgress',
  'InfoPanel',
  'VersionsPanel',
  'SpotlightSearch',
  'FavoriteEditDialog',
  'DestinationPickerDialog',
  'OnlyOfficeTransferConfirm',
  'SeparateDownloadConfirm',
  'NotificationToastContainer',
  'NotificationPanel',
];
// Stubbed by name rather than by module, because `vi.mock` is hoisted to the top
// of the file and a loop of them never sees the loop variable.
config.global.stubs = Object.fromEntries(
  chrome.map((name) => [name, { name, template: `<div data-test="${name}-stub"><slot /></div>` }])
);

vi.mock('vue-router', () => ({
  // Traversed rather than swallowed: the shell draws the window's chrome inside
  // this slot, so a stub that rendered nothing would hide everything below it.
  RouterView: {
    template:
      '<div data-test="router-view"><slot :Component="null" :route="{ fullPath: \'/browse/\' }" /></div>',
  },
  useRoute: () => ({ path: '/browse/', fullPath: '/browse/', params: {}, query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), resolve: () => ({ matched: [] }) }),
  // Mocking a router means mocking what builds one: the application's own router
  // module is pulled in by what the chrome reaches for.
  createRouter: () => ({ beforeEach: vi.fn(), afterEach: vi.fn(), resolve: vi.fn() }),
  createWebHistory: () => ({}),
  RouterLink: { template: '<a><slot /></a>' },
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key, te: () => false }),
  // Mocking the catalogue means mocking what builds it: the chrome below pulls in
  // the module that does.
  createI18n: () => ({ install: () => {}, global: { t: (key) => key } }),
}));

// The panes come from the tabs store; one tab, one pane, which is what a window
// with nothing arranged looks like.
const appTabs = vi.hoisted(() => ({
  tabs: [{ id: 'tab-1', kind: 'folder', path: '/browse/' }],
  activeId: 'tab-1',
  panes: ['tab-1'],
  isSplit: false,
}));
vi.mock('@/stores/tabs', () => ({ useTabsStore: () => appTabs }));
vi.mock('@/stores/appSettings', () => ({
  useAppSettings: () => ({
    state: { branding: { appName: 'nextExplorer', appLogoUrl: '', showPoweredBy: false } },
    userSettings: {},
  }),
}));
vi.mock('@/stores/fileStore', () => ({ useFileStore: () => ({ currentPathData: null }) }));
vi.mock('@/composables/sidebar', () => ({
  useSidebar: () => ({
    width: { value: 230 },
    isOpen: { value: false },
    isDesktop: { value: true },
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
    onResizeStart: vi.fn(),
  }),
}));
vi.mock('@/composables/fileUploader', () => ({ useFileUploader: vi.fn() }));
vi.mock('@/composables/keyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/composables/usePageTitle', () => ({ usePageTitle: vi.fn() }));

import App from '@/App.vue';

describe('App config error handling', () => {
  beforeEach(() => {
    // The shell reaches for stores of its own now — the panes, the branding, the
    // folder a page title is made from.
    setActivePinia(createPinia());
    configError.value = null;
    dismissConfigWarning.mockClear();
    accountLanguage.mockClear();
    tabRouteSync.mockClear();
    previewHost.mockClear();
    askDialog.mockClear();
  });

  /**
   * Asked for by the shell and nowhere else, so it holds for every screen —
   * a folder, a document, the editor — and outlives the route changes between
   * them (nxzai/NextExplorer discussion #408).
   */
  it('puts the account’s language on screen', () => {
    mount(App, { global: { stubs: { RouterView: true } } });

    expect(accountLanguage).toHaveBeenCalledTimes(1);
  });

  /**
   * Once, and from the shell: the strip is only drawn where a tab can be, and the
   * tabs have to keep up with the address wherever it goes. Asked for in a screen
   * instead, every folder row that wanted the middle-button gesture would have
   * installed another copy of the same watcher.
   */
  it('has the tabs follow the address, once', () => {
    mount(App, { global: { stubs: { RouterView: true } } });

    expect(tabRouteSync).toHaveBeenCalledTimes(1);
  });

  /**
   * Here rather than in the pages that show documents, and that is the point:
   * a surface mounted by a page is built when that page is and thrown away when
   * it is, so bringing a folder tab forward and coming back re-opened an
   * ONLYOFFICE document from nothing — new connection, no cursor, no undo.
   */
  it('keeps every tab’s document in one place, mounted once', () => {
    const wrapper = mount(App, { global: { stubs: { RouterView: true } } });

    expect(previewHost).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('[data-test="preview-host-stub"]')).toHaveLength(1);
  });

  /**
   * And whatever the application is asking, in the same one place and for the same
   * reason: a dialog belonging to a page would leave with the page that is asking to
   * be allowed to leave.
   */
  it('keeps the question the application asks in one place too', () => {
    const wrapper = mount(App, { global: { stubs: { RouterView: true } } });

    expect(askDialog).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll('[data-test="ask-dialog-stub"]')).toHaveLength(1);
  });

  /**
   * And every open shell, in that same one place.
   *
   * A host inside the browser layout was destroyed whenever the reader crossed between
   * `/browse` and `/terminal` — two route records, two layout instances — and every
   * shell went with it: coming back to a terminal tab found a new one, with the slide
   * from the right playing again and what had been typed gone.
   */
  it('keeps every open shell in one place too', async () => {
    terminals.terminalEnabled = true;
    terminals.openIds = ['tab-1'];

    const wrapper = mount(App, { global: { stubs: { RouterView: true } } });
    await flushPromises();

    expect(wrapper.findAll('[data-test="terminal-host-stub"]')).toHaveLength(1);
    terminals.terminalEnabled = false;
    terminals.openIds = [];
  });

  /** And nothing at all when no shell is open: xterm is carried in only when asked. */
  it('draws no shell host when nothing has asked for one', () => {
    const wrapper = mount(App, { global: { stubs: { RouterView: true } } });

    expect(wrapper.find('[data-test="terminal-host-stub"]').exists()).toBe(false);
  });

  it('shows a dismissible warning for PUBLIC_URL mismatches without blocking the router', async () => {
    configError.value = {
      mode: 'mismatch',
      expectedOrigin: 'https://files.example.com',
      requestOrigin: 'https://alt.example.com',
    };

    const wrapper = mount(App);

    await flushPromises();

    // What is behind the warning is still drawn: the window's chrome, with a pane
    // in it. A blocking error replaces all of that; a mismatch only says so.
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="TabPane-stub"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('PUBLIC_URL warning');

    await wrapper.get('button[aria-label="Dismiss warning"]').trigger('click');
    await flushPromises();
    await flushPromises();

    expect(dismissConfigWarning).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('PUBLIC_URL warning');
  });

  it('blocks the router when server settings cannot be loaded', async () => {
    configError.value = {
      mode: 'error',
      expectedOrigin: '',
      requestOrigin: 'https://alt.example.com',
    };

    const wrapper = mount(App, {
      global: {
        stubs: {
          RouterView: {
            template: '<div data-test="router-view">router content</div>',
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('This app isn’t configured correctly.');
    expect(wrapper.find('[data-test="router-view"]').exists()).toBe(false);
  });
});
