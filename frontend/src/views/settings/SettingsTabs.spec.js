import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * How many tabs a row may hold, for everybody on this installation.
 *
 * The strip never scrolls: a row that scrolls hides the very tabs somebody
 * opened, and tabs that keep shrinking stop being readable. So the row stops
 * instead, and where it stops is the one decision this page asks for — a handful
 * of numbers rather than a free one, because a box that takes any number then has
 * to argue about it.
 */

const features = { maxTabs: 10 };
const save = vi.fn(async () => {});

vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));
vi.mock('@/stores/appSettings', () => ({ useAppSettings: () => ({ save }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

import SettingsTabs from './SettingsTabs.vue';

let wrapper = null;

const show = () => {
  wrapper = mount(SettingsTabs);
  return wrapper;
};

const chooser = () => wrapper.get('[data-testid="tabs-max-open"]');

beforeEach(() => {
  features.maxTabs = 10;
  save.mockClear();
  save.mockResolvedValue(undefined);
});

describe('the number of tabs a row may hold', () => {
  it('offers four, and shows the one in force', () => {
    show();

    expect(
      chooser()
        .findAll('option')
        .map((option) => option.text())
    ).toEqual(['5', '10', '15', '20']);
    expect(chooser().element.value).toBe('10');
  });

  it('saves the one chosen, and shows it straight away', async () => {
    show();

    await chooser().setValue('15');
    await flushPromises();

    expect(save).toHaveBeenCalledWith({ tabs: { maxOpen: 15 } });
    expect(features.maxTabs).toBe(15);
  });

  /** Nothing to save, and nothing to say: the choice was already in force. */
  it('saves nothing when the same number is chosen again', async () => {
    show();

    await chooser().setValue('10');
    await flushPromises();

    expect(save).not.toHaveBeenCalled();
  });

  /**
   * A refusal leaves the number where it was rather than where the page hoped:
   * a settings page that shows a value the server never took is a page that lies.
   */
  it('leaves the number alone when the server refuses', async () => {
    save.mockRejectedValue(new Error('nope'));
    show();

    await chooser().setValue('20');
    await flushPromises();

    expect(features.maxTabs).toBe(10);
  });
});
