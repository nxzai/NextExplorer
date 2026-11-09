import { describe, it, expect, afterEach, vi } from 'vitest';

import { detectLocale, supportedLocaleOptions } from './index';

/**
 * Which language the application opens in for somebody who has never chosen
 * one.
 *
 * A language tag is case-insensitive by specification, and this was the one
 * place that treated it otherwise: browsers report `zh-cn`, the bundle is
 * called `zh-CN`, and compared as written those never match — so a Chinese
 * browser was never detected as Chinese, nor a Taiwanese one as Taiwanese.
 * Found by a contributor adding pt-BR, who hit it as `pt-br`.
 */

const CODES = supportedLocaleOptions.map(({ code }) => code);

const browser = (languages) => {
  vi.stubGlobal('navigator', { languages, language: languages[0] });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the language a visitor lands in', () => {
  it('matches a tag whatever case the browser reports it in', () => {
    browser(['zh-cn']);
    expect(detectLocale(CODES)).toBe('zh-CN');

    browser(['ZH-TW']);
    expect(detectLocale(CODES)).toBe('zh-TW');

    browser(['pt-br']);
    expect(detectLocale(CODES)).toBe('pt-BR');
  });

  /** Dutch, from nxzai/NextExplorer#387 and #388: offered, and found from any region. */
  it('opens in Dutch for a browser set to Dutch, whatever the region', () => {
    expect(CODES).toContain('nl');

    browser(['nl-BE']);
    expect(detectLocale(CODES)).toBe('nl');

    browser(['nl-NL', 'en']);
    expect(detectLocale(CODES)).toBe('nl');
  });

  it('opens in Galician for a browser set to Galician, whatever the region', () => {
    expect(CODES).toContain('gl');

    browser(['gl-ES']);
    expect(detectLocale(CODES)).toBe('gl');

    browser(['gl', 'es']);
    expect(detectLocale(CODES)).toBe('gl');
  });

  it('takes the language when the region is one nobody has translated', () => {
    browser(['fr-CA']);

    expect(detectLocale(CODES)).toBe('fr');
  });

  /**
   * The order of `navigator.languages` is the visitor's own ranking. A later
   * entry that happens to be supported must not win over an earlier one.
   */
  it('respects the order the browser lists them in', () => {
    browser(['de-AT', 'fr', 'en']);

    expect(detectLocale(CODES)).toBe('de');
  });

  it('falls back to English when it recognises nothing', () => {
    browser(['xx-YY', 'zz']);

    expect(detectLocale(CODES)).toBe('en');
  });

  it('prefers a language that was chosen over one the browser reports', () => {
    vi.stubGlobal('navigator', { languages: ['de'], language: 'de' });
    vi.stubGlobal('localStorage', { getItem: () => 'ru', setItem: () => {} });

    expect(detectLocale(CODES)).toBe('ru');
  });

  it('matches a remembered choice whatever case it was stored in', () => {
    vi.stubGlobal('navigator', { languages: ['de'], language: 'de' });
    vi.stubGlobal('localStorage', { getItem: () => 'zh-cn', setItem: () => {} });

    expect(detectLocale(CODES)).toBe('zh-CN');
  });

  it('ignores a remembered choice for a language that no longer exists', () => {
    vi.stubGlobal('navigator', { languages: ['fr'], language: 'fr' });
    vi.stubGlobal('localStorage', { getItem: () => 'klingon', setItem: () => {} });

    expect(detectLocale(CODES)).toBe('fr');
  });
});
