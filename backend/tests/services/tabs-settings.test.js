import { describe, it, expect } from 'vitest';
import settingsService from '../../src/services/settingsService.js';

const { sanitizeTabs, TAB_LIMIT_CHOICES, DEFAULT_TAB_LIMIT } = settingsService;

/**
 * How many tabs a row may hold.
 *
 * A row of tabs that never scrolls has to stop somewhere: past a certain number
 * they are too narrow to read, and a strip that scrolls hides the very tabs
 * somebody opened. The number is an administrator's, and it is a handful of
 * choices rather than a free number — nobody browses twenty folders at once and
 * can still tell them apart.
 *
 * Anything else falls back to the default rather than being refused: a value this
 * does not recognise is a client that has drifted, and a settings page that will
 * not save is worse than one that saves the number it can stand behind.
 */
describe('how many tabs a row may hold', () => {
  it('is ten when nobody has said', () => {
    expect(sanitizeTabs()).toEqual({ maxOpen: DEFAULT_TAB_LIMIT });
    expect(sanitizeTabs({})).toEqual({ maxOpen: DEFAULT_TAB_LIMIT });
    expect(sanitizeTabs(null)).toEqual({ maxOpen: DEFAULT_TAB_LIMIT });
  });

  it('keeps each of the choices on offer', () => {
    for (const choice of TAB_LIMIT_CHOICES) {
      expect(sanitizeTabs({ maxOpen: choice })).toEqual({ maxOpen: choice });
    }
  });

  it('reads a number written as text, which is what a form sends', () => {
    expect(sanitizeTabs({ maxOpen: '15' })).toEqual({ maxOpen: 15 });
  });

  /** Not a refusal: a value nobody offers is answered with the one on offer. */
  it('falls back for anything that is not one of them', () => {
    for (const asked of [0, 1, 7, 21, 1000, -5, 'lots', null, undefined, {}, []]) {
      expect(sanitizeTabs({ maxOpen: asked })).toEqual({ maxOpen: DEFAULT_TAB_LIMIT });
    }
  });

  it('offers four, in the order a settings page would list them', () => {
    expect(TAB_LIMIT_CHOICES).toEqual([5, 10, 15, 20]);
    expect(TAB_LIMIT_CHOICES).toContain(DEFAULT_TAB_LIMIT);
  });
});
