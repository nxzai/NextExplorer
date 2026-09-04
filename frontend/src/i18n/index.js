import { createI18n } from 'vue-i18n';

const localeModules = import.meta.glob('./locales/*.json', { eager: true });

const messages = Object.fromEntries(
  Object.entries(localeModules).map(([path, mod]) => {
    const match = path.match(/\.\/locales\/(.*)\.json$/);
    if (!match) return [path, mod?.default ?? mod];
    return [match[1], mod?.default ?? mod];
  })
);

const preferredLocaleOrder = [
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ko',
  'pl',
  'pt-BR',
  'ro',
  'ru',
  'sv',
  'zh-CN',
  'zh-TW',
];

export const supportedLocaleOptions = [
  ...preferredLocaleOrder.filter((code) => Object.prototype.hasOwnProperty.call(messages, code)),
  ...Object.keys(messages)
    .filter((code) => !preferredLocaleOrder.includes(code))
    .sort(),
].map((code) => ({ code }));

export const supportedLocales = supportedLocaleOptions.map(({ code }) => code);

function detectLocale(supportedLocales) {
  // Match a user preference to a supported locale code, ignoring case
  // (e.g. `pt-br` from navigator.languages vs `pt-BR` in the bundle).
  const matchLocale = (pref) =>
    supportedLocales.find(
      (code) => code.toLowerCase() === String(pref).toLowerCase()
    );
  try {
    const saved = localStorage.getItem('locale');
    if (saved && matchLocale(saved)) return matchLocale(saved);
  } catch (_) {
    // Ignore localStorage errors (e.g., in private browsing mode)
  }

  const prefs =
    typeof navigator !== 'undefined' &&
    Array.isArray(navigator.languages) &&
    navigator.languages.length
      ? navigator.languages
      : [typeof navigator !== 'undefined' ? navigator.language : 'en'];

  const normalized = prefs
    .filter(Boolean)
    .map((l) => l.toLowerCase())
    .filter(Boolean);

  for (const p of normalized) {
    const base = p.split('-')[0];
    const hit = matchLocale(p) || matchLocale(base);
    if (hit) return hit;
  }

  return 'en';
}

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(supportedLocales),
  fallbackLocale: 'en',
  messages,
});

export default i18n;
