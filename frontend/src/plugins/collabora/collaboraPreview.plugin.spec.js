import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which documents Collabora opens.
 *
 * Its own formats when it is the only office editor configured; when ONLYOFFICE
 * is configured too, only if the user chose Collabora. Were both editors to
 * claim a document, the one opened would depend on registration order rather
 * than on the preference. The pairing of the two is held in the ONLYOFFICE
 * plugin's spec.
 */

const features = { onlyofficeEnabled: false, collaboraEnabled: true };
const settings = { officeEditorPreference: 'onlyoffice' };

vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => settings }));

import { collaboraPreviewPlugin } from './collaboraPreview';

beforeEach(() => {
  Object.assign(features, { onlyofficeEnabled: false, collaboraEnabled: true });
  settings.officeEditorPreference = 'onlyoffice';
});

describe('which documents Collabora opens', () => {
  it('opens the formats the server lists, whatever the case of the extension', () => {
    const plugin = collaboraPreviewPlugin(['odt']);

    expect(plugin.match({ extension: 'ODT' })).toBe(true);
    expect(plugin.match({ extension: 'docx' })).toBe(false);
    expect(plugin.match({})).toBe(false);
  });

  it('falls back to the office formats, plain text included, when the server lists none', () => {
    for (const extensions of [undefined, []]) {
      const plugin = collaboraPreviewPlugin(extensions);

      for (const extension of ['docx', 'odt', 'txt', 'xlsx', 'csv', 'pptx', 'odp']) {
        expect(plugin.match({ extension })).toBe(true);
      }
      expect(plugin.match({ extension: 'pdf' })).toBe(false);
    }
  });

  it('opens its formats whatever the preference when it is the only editor configured', () => {
    // A preference left over from when ONLYOFFICE was configured.
    settings.officeEditorPreference = 'onlyoffice';

    expect(collaboraPreviewPlugin().match({ extension: 'docx' })).toBe(true);
  });

  it('leaves documents to ONLYOFFICE, when both are configured, unless Collabora is preferred', () => {
    features.onlyofficeEnabled = true;
    const plugin = collaboraPreviewPlugin();

    expect(plugin.match({ extension: 'docx' })).toBe(false);
    settings.officeEditorPreference = undefined;
    expect(plugin.match({ extension: 'docx' })).toBe(false);
    settings.officeEditorPreference = 'collabora';
    expect(plugin.match({ extension: 'docx' })).toBe(true);
    // The preference never widens the formats.
    expect(plugin.match({ extension: 'pdf' })).toBe(false);
  });
});
