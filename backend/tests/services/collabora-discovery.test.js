import { describe, it, expect } from 'vitest';
import { parseDiscoveryXml } from '../../src/services/collaboraDiscoveryService.js';

describe('Collabora Discovery Service', () => {
  describe('parseDiscoveryXml', () => {
    it('should extract actions by extension and decode urlsrc', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <wopi-discovery>
          <net-zone name="external-https">
            <app name="writer">
              <action name="edit" ext="docx" urlsrc="https://office.example.com/loleaflet/123/loleaflet.html?WOPISrc="/>
              <action name="view" ext="docx" urlsrc="https://office.example.com/loleaflet/123/loleaflet.html?permission=readonly&amp;WOPISrc="/>
              <action name="edit" ext="ODT" urlsrc="https://office.example.com/loleaflet/123/loleaflet.html?foo=bar&amp;WOPISrc="/>
            </app>
          </net-zone>
        </wopi-discovery>`;

      const map = parseDiscoveryXml(xml);

      expect(map).toBeInstanceOf(Map);

      const docx = map.get('docx');
      expect(docx).toBeDefined();
      expect(docx.edit).toBe(
        'https://office.example.com/loleaflet/123/loleaflet.html?WOPISrc='
      );
      expect(docx.view).toBe(
        'https://office.example.com/loleaflet/123/loleaflet.html?permission=readonly&WOPISrc='
      );

      const odt = map.get('odt');
      expect(odt).toBeDefined();
      expect(odt.edit).toBe(
        'https://office.example.com/loleaflet/123/loleaflet.html?foo=bar&WOPISrc='
      );
    });
  });
});
