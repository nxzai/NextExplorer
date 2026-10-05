import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { createRouter, createWebHashHistory, RouterView } from 'vue-router';

// The application's stylesheet, without which none of this is what the browser
// actually lays out — and, more to the point, without which the fade that this
// fixture exists to provoke does not exist.
import '../src/assets/main.css';
import en from '../src/i18n/locales/en.json';
import PreviewHost from '../src/plugins/preview/PreviewHost.vue';
import DocumentView from '../src/views/DocumentView.vue';
import { useTabRouteSync } from '../src/composables/tabNavigation';
import { usePreviewManager } from '../src/plugins/preview/manager';
import { useTabsStore } from '../src/stores/tabs';
import { useAppSettings } from '../src/stores/appSettings';

/**
 * A viewer that takes its own element out of the page, in a real browser.
 *
 * ONLYOFFICE does this: the Document Server's script is handed an element and
 * replaces it with an `iframe`, so the node Vue believes it owns is no longer in
 * the document. Everything that goes wrong afterwards goes wrong inside Vue's
 * patch — it looks for that node's parent and finds none — and none of it can be
 * seen in a unit test, because jsdom reports no transition support: a leave that
 * a real browser spreads over two hundred milliseconds happens there at once, so
 * the shutting document is never still in the page while the next is built.
 *
 * Hence a fixture. The page is driven from the spec through the functions on
 * `window`, and everything the page throws is collected on `window.thrown`.
 */

window.thrown = [];
// What the page said to the console, which is where the Document Server's script
// explains itself — "Skip loading. Instance already exists" above all.
window.logged = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    window.logged.push(`${level}: ${args.map((one) => String(one)).join(' ')}`);
    original(...args);
  };
}
window.addEventListener('error', (event) => window.thrown.push(String(event.message)));
window.addEventListener('unhandledrejection', (event) =>
  window.thrown.push(String(event.reason?.message || event.reason))
);
// The stack as well, for the probe: the dev server serves this unminified, which
// is the only place the frames have names.
window.stacks = [];
window.addEventListener('unhandledrejection', (event) =>
  window.stacks.push(String(event.reason?.stack || ''))
);

/**
 * The server this page answers for itself.
 *
 * Everything the real ONLYOFFICE preview asks of the backend, answered here, so
 * the component under test is the real one — its own `v-if` chain, its own
 * `editorId` churn, its own teleported dialogs — and the only thing standing in
 * for the Document Server is the script at `docs-server/`, which does what that
 * script does: it takes the element it is handed out of the page.
 */
const onlyofficeConfig = (path) => ({
  documentServerUrl: `${window.location.origin}/e2e/docs-server/`,
  forceSaveSessionId: 'session-1',
  config: {
    document: { key: path, title: path.split('/').pop(), fileType: 'docx', url: 'about:blank' },
    documentType: 'word',
    editorConfig: { lang: 'en', mode: 'edit' },
  },
});

const answers = [
  [/\/api\/onlyoffice\/config/, (body) => onlyofficeConfig(body?.path || 'Docs/report.docx')],
  [/\/api\/onlyoffice\/session/, () => ({ active: true })],
  [/\/api\/onlyoffice\//, () => ({})],
  [/\/api\/features/, () => ({ versionsEnabled: false, onlyofficeEnabled: true })],
  [/\/api\//, () => ({})],
];

const realFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const match = answers.find(([pattern]) => pattern.test(url));
  if (!match) return realFetch(input, init);
  let body;
  try {
    body = init.body ? JSON.parse(init.body) : null;
  } catch {
    body = null;
  }
  return Promise.resolve(
    new Response(JSON.stringify(match[1](body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
};

/**
 * The page the application really puts around a document.
 *
 * The host on its own was not enough to say the whole truth: in the application a
 * document lives at an address, so bringing a tab forward unmounts one page and
 * mounts another, and it is `views/DocumentView.vue` that decides whether the
 * document it was showing goes with it. Everything below is that arrangement —
 * the router, the page, and the watcher that keeps the tabs and the address in
 * step — so what is measured here is what a reader gets.
 */
const Folder = { render: () => h('div', { class: 'folder' }, 'a folder listing') };

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/browse/' },
    { path: '/browse/:path(.*)*', name: 'FolderView', component: Folder },
    { path: '/open/:path(.*)*', name: 'DocumentView', component: DocumentView },
  ],
});

const pinia = createPinia();
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const Shell = {
  setup() {
    useTabRouteSync();
    return () => h('div', null, [h(RouterView), h(PreviewHost)]);
  },
};
const app = createApp(Shell);
app.config.errorHandler = (error, instance, info) => {
  window.thrown.push(String(error?.message || error));
  window.stacks.push(`${info}\n${error?.stack || ''}`);
};
app.use(pinia).use(i18n).use(router).mount('#app');

const manager = usePreviewManager(pinia);
const tabs = useTabsStore(pinia);

manager.register({
  id: 'onlyoffice',
  minimalHeader: true,
  match: () => true,
  component: () => import('../src/plugins/onlyoffice/OnlyOfficePreview.vue'),
});

// The settings the application would have read by now: tabs on, and known to be.
const appSettings = useAppSettings(pinia);
appSettings.userSettings = { ...(appSettings.userSettings || {}), browseInTabs: true };
appSettings.loaded = true;
tabs.setEnabled(true);

// Two tabs, so a document can be opened in one while another is in front. Made
// once however many times this module is evaluated: the dev server can hand the
// same module to the page twice, and a second pass would open a third tab.
if (tabs.count < 2) tabs.open('/browse/Second', { activate: false });
const ids = tabs.tabs.map((tab) => tab.id);

/**
 * Bringing a tab forward, the way the application does it: the store says which
 * tab is in front, and the address follows — which is what unmounts one page and
 * mounts another.
 */
window.goToTab = async (which) => {
  const tab = tabs.activate(ids[which]);
  if (tab) await router.push(tab.path).catch(() => {});
};

/** Opening a document *at its address*, as a double click in a listing does. */
window.openDocumentAtItsAddress = async (which, name) => {
  const tab = tabs.activate(ids[which]);
  if (!tab) return;
  tab.own = true;
  await router.push(`/open/Docs/${name}`).catch(() => {});
};

window.tabsOpen = () => ids.length;
window.openDocument = (which, name) =>
  manager.openIn(ids[which], { name, path: 'Docs', kind: 'docx' });
window.closeDocument = (which) => manager.closeIn(ids[which]);
window.activateTab = (which) => tabs.activate(ids[which]);
window.closeTab = (which) => tabs.close(ids[which]);
window.moveTab = (which, to) => tabs.move(ids[which], to);
window.newTab = () => {
  const made = tabs.open('/browse/Another', { activate: false });
  ids.push(made.id);
  return ids.length - 1;
};
window.frames_ = () => document.querySelectorAll('iframe[data-document]').length;
// What the manager and the tabs actually hold, for a probe that needs to see the
// moment a session goes.
window.sessionsNow = () =>
  manager.surfaces.map((surface) => ({
    key: surface.key,
    open: surface.session.isOpen.value,
    file: surface.session.item.value?.filePath ?? null,
  }));
window.tabsNow = () =>
  tabs.tabs.map((tab) => ({ id: tab.id, path: tab.path, active: tab.id === tabs.activeId }));
