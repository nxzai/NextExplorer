import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every catalogue says every key English says, and nothing English no longer
 * says. That is rare and it does not hold by itself: a
 * key added to the English file and forgotten elsewhere shows the key name on
 * screen to everyone who reads another language, and a key removed from
 * English but left behind is dead weight nobody will ever find.
 *
 * The audit measured this by hand. Measuring it by hand is how it drifts.
 */

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'locales');

const flatten = (object, prefix = '', into = {}) => {
  for (const [key, value] of Object.entries(object)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, into);
    else into[full] = value;
  }
  return into;
};

const read = (locale) =>
  flatten(JSON.parse(fs.readFileSync(path.join(localesDir, `${locale}.json`), 'utf8')));

const locales = fs
  .readdirSync(localesDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => name.replace('.json', ''));

const english = read('en');
const others = locales.filter((locale) => locale !== 'en');

describe('the translation catalogues', () => {
  it('has more than one language to keep aligned', () => {
    expect(locales).toContain('en');
    expect(others.length).toBeGreaterThan(5);
  });

  it.each(others)('%s says everything English says', (locale) => {
    const missing = Object.keys(english).filter((key) => !(key in read(locale)));

    expect(missing).toEqual([]);
  });

  it.each(others)('%s says nothing English no longer says', (locale) => {
    const orphaned = Object.keys(read(locale)).filter((key) => !(key in english));

    expect(orphaned).toEqual([]);
  });

  /**
   * A placeholder dropped in translation renders as nothing where a number
   * belonged; one invented renders as literal braces. Either is the failure
   * people report as "the message is broken".
   *
   * Compared as a set of names and not as a count: vue-i18n separates plural
   * forms with `|`, and how many a language has is the language's business —
   * Chinese has one where English has two, Polish and Russian have three. A
   * test that counted `{minutes}` across the whole string called all three of
   * those wrong, which was the test being wrong.
   */
  it.each(others)('%s uses the same placeholders English does', (locale) => {
    const catalogue = read(locale);
    const namesIn = (text) =>
      typeof text === 'string'
        ? [...new Set(text.match(/\{[a-zA-Z0-9_]+\}/g) || [])].sort().join(',')
        : '';

    const differing = Object.keys(english).filter((key) => {
      const expected = namesIn(english[key]);
      return expected !== '' && namesIn(catalogue[key]) !== expected;
    });

    expect(differing).toEqual([]);
  });

  /**
   * The set above is taken over the whole string, so it cannot see a
   * placeholder dropped from one plural form while another form keeps it:
   * "In {count} day | In a few days" passes, and every count above one reads
   * without its number. Checked form by form instead, for the placeholders
   * every English form carries — a name only one English form uses is that
   * form's business.
   */
  it.each(others)('%s keeps in every plural form what every English form carries', (locale) => {
    const catalogue = read(locale);
    const names = (text) => new Set(String(text).match(/\{[a-zA-Z0-9_]+\}/g) || []);

    const differing = Object.keys(english).filter((key) => {
      if (typeof english[key] !== 'string' || !english[key].includes(' | ')) return false;
      if (typeof catalogue[key] !== 'string') return false;
      const englishForms = english[key].split(' | ').map(names);
      const inEveryForm = [...englishForms[0]].filter((name) =>
        englishForms.every((set) => set.has(name))
      );
      return catalogue[key]
        .split(' | ')
        .some((form) => inEveryForm.some((name) => !names(form).has(name)));
    });

    expect(differing).toEqual([]);
  });

  /**
   * How many forms a plural has is the language's business, but for the
   * languages that choose between the same two forms English does, a form
   * lost is a sentence that says "1 days" or "2 day". Chinese and Korean have
   * one form, Polish and Russian three; Hindi is left out until its catalogue
   * is looked at, since it gives some plurals a single form.
   */
  const TWO_FORM_LANGUAGES = ['de', 'es', 'fr', 'gl', 'it', 'nl', 'pt-BR', 'ro', 'sv'];

  it.each(others.filter((locale) => TWO_FORM_LANGUAGES.includes(locale)))(
    '%s gives every plural as many forms as English',
    (locale) => {
      const catalogue = read(locale);
      const formsOf = (text) => String(text).split(' | ').length;

      const differing = Object.keys(english).filter(
        (key) =>
          typeof english[key] === 'string' &&
          english[key].includes(' | ') &&
          typeof catalogue[key] === 'string' &&
          formsOf(catalogue[key]) !== formsOf(english[key])
      );

      expect(differing).toEqual([]);
    }
  );
});
