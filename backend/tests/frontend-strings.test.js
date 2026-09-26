import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every string a screen asks for is one the catalogue has.
 *
 * A screen that arrives without its strings shows its own keys —
 * `settings.about.tools.title` where a heading belongs — and nothing fails:
 * the build succeeds, the page renders, and the words are missing. It is the
 * one defect a batch of screens can ship with and pass every other gate, and
 * it has happened: the About page's list of optional tools was ported with no
 * catalogue entries at all.
 *
 * English is the one checked. The others are missing-translation fallbacks by
 * design — a key absent there falls back to English, which is a reader seeing
 * the wrong language rather than a key.
 */

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'src');
const LOCALES = path.join(FRONTEND, 'i18n', 'locales');
const CATALOGUE = path.join(LOCALES, 'en.json');

/** `t('a.b')`, `$t('a.b')`, `te('a.b')` — the literal calls, which is all that can be checked. */
const KEY_CALL = /(?<![\w$])\$?te?\(\s*'([A-Za-z][\w.-]*)'/g;

const sourcesUnder = (directory) => {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'locales') continue;
      found.push(...sourcesUnder(full));
    } else if (/\.(vue|js)$/.test(entry.name) && !entry.name.endsWith('.spec.js')) {
      found.push(full);
    }
  }
  return found;
};

const has = (catalogue, key) => {
  let node = catalogue;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false;
    node = node[part];
  }
  return typeof node === 'string' || typeof node === 'object';
};

describe('the strings the interface asks for', () => {
  it('are all in the English catalogue', () => {
    const catalogue = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
    const missing = new Set();

    for (const file of sourcesUnder(FRONTEND)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const [, key] of source.matchAll(KEY_CALL)) {
        // A key is a path with a dot in it; a bare word is some other `t(...)`.
        if (!key.includes('.')) continue;
        // `t('settings.categories.' + name)` — a prefix being built, not a key.
        if (key.endsWith('.')) continue;
        if (!has(catalogue, key)) {
          missing.add(`${key}  (${path.relative(FRONTEND, file)})`);
        }
      }
    }

    expect([...missing].sort()).toEqual([]);
  });
});

/** Every key in a catalogue, as dotted paths, so two catalogues can be compared. */
const pathsIn = (node, prefix = '') =>
  Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' ? pathsIn(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  );

const read = (locale) => JSON.parse(fs.readFileSync(path.join(LOCALES, `${locale}.json`), 'utf8'));

const at = (catalogue, key) => key.split('.').reduce((node, part) => node?.[part], catalogue);

/** `{name}`, `{0}` — what vue-i18n will substitute, and what a translation must keep. */
const placeholdersIn = (value) =>
  new Set(typeof value === 'string' ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]) : []);

const locales = fs
  .readdirSync(LOCALES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace(/\.json$/, ''))
  .filter((locale) => locale !== 'en');

/**
 * The catalogues, held to each other.
 *
 * A key added in English and nowhere else falls back to English, which is a
 * reader seeing the wrong language — quieter than a raw key and just as wrong. A
 * key left behind in one catalogue after it was renamed in English is dead weight
 * nobody will ever see again. And a translation that drops a placeholder loses
 * whatever it stood for: `{count} items` translated without `{count}` says
 * "items", with the number silently gone.
 *
 * Asserted here rather than in a frontend suite because this is where the runner
 * that CI executes lives, and a test nothing runs holds nothing.
 */
describe('the translation catalogues', () => {
  it('has more than one language to keep aligned', () => {
    expect(locales.length).toBeGreaterThan(1);
  });

  it('ships every English key in every language', () => {
    const english = pathsIn(JSON.parse(fs.readFileSync(CATALOGUE, 'utf8')));
    const missing = [];

    for (const locale of locales) {
      const theirs = new Set(pathsIn(read(locale)));
      for (const key of english) if (!theirs.has(key)) missing.push(`${locale}: ${key}`);
    }

    expect(missing).toEqual([]);
  });

  it('defines no key English does not', () => {
    const english = new Set(pathsIn(JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'))));
    const extra = [];

    for (const locale of locales) {
      for (const key of pathsIn(read(locale)))
        if (!english.has(key)) extra.push(`${locale}: ${key}`);
    }

    expect(extra).toEqual([]);
  });

  it('keeps the placeholders the English string had', () => {
    const english = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
    const keys = pathsIn(english);
    const lost = [];

    for (const locale of locales) {
      const theirs = read(locale);
      for (const key of keys) {
        const wanted = placeholdersIn(at(english, key));
        if (!wanted.size) continue;
        const got = placeholdersIn(at(theirs, key));
        const dropped = [...wanted].filter((name) => !got.has(name));
        if (dropped.length) lost.push(`${locale}: ${key} lost {${dropped.join('}, {')}}`);
      }
    }

    expect(lost).toEqual([]);
  });
});
