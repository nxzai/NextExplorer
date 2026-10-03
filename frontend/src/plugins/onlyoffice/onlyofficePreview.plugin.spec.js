import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ONLYOFFICE plugin decides two things the editor component cannot.
 *
 * Which documents it opens. When both office editors are configured, each of
 * them claiming the same file would leave the choice to registration order, so
 * exactly one of them has to answer: the one the user prefers.
 *
 * And what happens on the way out. The close hook is the last chance to save
 * what was typed since the last automatic save. It has to name the file as it
 * is called now — it may have been renamed from the editor's title bar — must
 * not hold the preview open behind a slow Document Server, and must end the
 * editing session whether the save went through or not, or the document stays
 * marked as being edited.
 *
 * It closes two ways, and they have to agree: a panel closing over a folder,
 * which can wait between the save and the close, and a browser tab being shut,
 * which cannot wait for anything. Both end at the same request, which is what
 * makes them the same close.
 */

const endOnlyOfficeSession = vi.fn();
const features = { onlyofficeEnabled: true, collaboraEnabled: false };
const settings = { officeEditorPreference: 'onlyoffice' };

vi.mock('@/api', () => ({
  endOnlyOfficeSession: (...args) => endOnlyOfficeSession(...args),
}));
vi.mock('@/stores/features', () => ({ useFeaturesStore: () => features }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: () => settings }));

import { onlyofficePreviewPlugin } from './onlyofficePreview';
import { collaboraPreviewPlugin } from '@/plugins/collabora/collaboraPreview';

beforeEach(() => {
  Object.assign(features, { onlyofficeEnabled: true, collaboraEnabled: false });
  settings.officeEditorPreference = 'onlyoffice';
  endOnlyOfficeSession.mockReset();
  endOnlyOfficeSession.mockResolvedValue({ ended: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('which documents ONLYOFFICE opens', () => {
  it('opens the formats the server lists, whatever the case of the extension', () => {
    const plugin = onlyofficePreviewPlugin(['docx', 'xlsx']);

    expect(plugin.match({ extension: 'DOCX' })).toBe(true);
    expect(plugin.match({ extension: 'xlsx' })).toBe(true);
    // Known to ONLYOFFICE, but not offered by this server.
    expect(plugin.match({ extension: 'pptx' })).toBe(false);
    expect(plugin.match({ extension: '' })).toBe(false);
  });

  it('falls back to the office formats when the server lists none', () => {
    for (const extensions of [undefined, []]) {
      const plugin = onlyofficePreviewPlugin(extensions);

      for (const extension of ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'ods', 'csv', 'pptx', 'odp']) {
        expect(plugin.match({ extension })).toBe(true);
      }
      // Plain text is left to the text editor, and a PDF to the PDF viewer.
      expect(plugin.match({ extension: 'txt' })).toBe(false);
      expect(plugin.match({ extension: 'pdf' })).toBe(false);
    }
  });

  it('opens its formats whatever the preference when it is the only editor configured', () => {
    settings.officeEditorPreference = 'collabora';

    expect(onlyofficePreviewPlugin().match({ extension: 'docx' })).toBe(true);
  });

  it('shares documents with Collabora so that exactly one editor claims each, the one preferred', () => {
    Object.assign(features, { onlyofficeEnabled: true, collaboraEnabled: true });
    const onlyoffice = onlyofficePreviewPlugin();
    const collabora = collaboraPreviewPlugin();

    for (const preference of ['onlyoffice', 'collabora', undefined]) {
      settings.officeEditorPreference = preference;
      const claims = {
        onlyoffice: onlyoffice.match({ extension: 'docx' }),
        collabora: collabora.match({ extension: 'docx' }),
      };

      // No preference recorded yet keeps ONLYOFFICE, as before Collabora existed.
      expect(claims).toEqual({
        onlyoffice: preference !== 'collabora',
        collabora: preference === 'collabora',
      });
    }
  });
});

describe('closing ONLYOFFICE', () => {
  const RENAMED = 'Docs/Report final.docx';

  const contextFor = (previewState) => ({ filePath: 'Docs/report.docx', previewState });

  it('saves and ends the session under the name the document has now', async () => {
    const requestForceSave = vi.fn(() => Promise.resolve({ queued: true }));
    const context = contextFor({
      forceSaveSessionId: 'session-1',
      documentPath: RENAMED,
      requestForceSave,
    });

    await onlyofficePreviewPlugin().onBeforeClose(context);

    // The editor's own request, so that it cancels the pending automatic save
    // and is never sent alongside one already in flight.
    expect(requestForceSave).toHaveBeenCalledWith({ reason: 'close' });
    expect(endOnlyOfficeSession).toHaveBeenCalledWith(RENAMED, { sessionId: 'session-1' });
  });

  it('leaves the save to the server when the editor offers none of its own', async () => {
    const context = contextFor({ forceSaveSessionId: 'session-1', documentPath: RENAMED });

    await onlyofficePreviewPlugin().onBeforeClose(context);

    // One request, which flushes and then ends — there is nothing here to
    // coalesce with, so the server queues the last save itself.
    expect(endOnlyOfficeSession).toHaveBeenCalledTimes(1);
    expect(endOnlyOfficeSession).toHaveBeenCalledWith(RENAMED, { sessionId: 'session-1' });
  });

  it('names the file the preview was opened on when the document was never renamed', async () => {
    await onlyofficePreviewPlugin().onBeforeClose(contextFor({ forceSaveSessionId: 'session-1' }));

    expect(endOnlyOfficeSession).toHaveBeenCalledWith('Docs/report.docx', {
      sessionId: 'session-1',
    });
  });

  it('waits for a save that hangs no longer than its grace period, then ends the session', async () => {
    vi.useFakeTimers();
    const context = contextFor({
      forceSaveSessionId: 'session-1',
      documentPath: RENAMED,
      requestForceSave: () => new Promise(() => {}),
    });

    let closed = false;
    void onlyofficePreviewPlugin()
      .onBeforeClose(context)
      .then(() => {
        closed = true;
      });

    await vi.advanceTimersByTimeAsync(449);
    expect(closed).toBe(false);
    expect(endOnlyOfficeSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toBe(true);
    expect(endOnlyOfficeSession).toHaveBeenCalledWith(RENAMED, { sessionId: 'session-1' });
  });

  it('lets the preview close as soon as the save is accepted, without sitting out the grace period', async () => {
    vi.useFakeTimers();
    const context = contextFor({
      forceSaveSessionId: 'session-1',
      requestForceSave: () => Promise.resolve({ queued: true }),
    });

    // No timer is advanced: only the accepted save can settle the hook.
    await expect(onlyofficePreviewPlugin().onBeforeClose(context)).resolves.toBeUndefined();
    expect(endOnlyOfficeSession).toHaveBeenCalledTimes(1);
  });

  it('ends the session even when the save fails, and still lets the preview close', async () => {
    const context = contextFor({
      forceSaveSessionId: 'session-1',
      requestForceSave: vi.fn().mockRejectedValue(new Error('Document Server unreachable')),
    });

    await expect(onlyofficePreviewPlugin().onBeforeClose(context)).resolves.toBeUndefined();
    expect(context.previewState.requestForceSave).toHaveBeenCalled();
    expect(endOnlyOfficeSession).toHaveBeenCalledWith('Docs/report.docx', {
      sessionId: 'session-1',
    });
  });

  it('does not surface a session that could not be ended', async () => {
    endOnlyOfficeSession.mockRejectedValue(new Error('offline'));
    const context = contextFor({ forceSaveSessionId: 'session-1' });

    await expect(onlyofficePreviewPlugin().onBeforeClose(context)).resolves.toBeUndefined();
    expect(endOnlyOfficeSession).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a preview that never had an editing session', async () => {
    const plugin = onlyofficePreviewPlugin();

    await plugin.onBeforeClose(contextFor({}));
    await plugin.onBeforeClose({ previewState: { forceSaveSessionId: 'session-1' } });

    expect(endOnlyOfficeSession).not.toHaveBeenCalled();
  });
});

describe('closing the tab ONLYOFFICE was open in', () => {
  const contextFor = (previewState) => ({ filePath: 'Docs/report.docx', previewState });

  it('sends one request, as a beacon, and waits for nothing', () => {
    const requestForceSave = vi.fn(() => new Promise(() => {}));
    const context = contextFor({ forceSaveSessionId: 'session-1', requestForceSave });

    // Deliberately not awaited: a page being unloaded runs this handler and
    // then stops existing. Anything this hook left for a later turn of the
    // event loop would never be sent, which is why the save is not asked for
    // here and the server is told to do both instead.
    onlyofficePreviewPlugin().onBeforeClose(context, { unloading: true });

    expect(requestForceSave).not.toHaveBeenCalled();
    expect(endOnlyOfficeSession).toHaveBeenCalledTimes(1);
    expect(endOnlyOfficeSession).toHaveBeenCalledWith('Docs/report.docx', {
      sessionId: 'session-1',
      beacon: true,
    });
  });

  it('ends the same session, at the same endpoint, as closing the panel does', async () => {
    const plugin = onlyofficePreviewPlugin();

    await plugin.onBeforeClose(contextFor({ forceSaveSessionId: 'session-1' }));
    const [panelPath, panelOptions] = endOnlyOfficeSession.mock.calls.at(-1);

    plugin.onBeforeClose(contextFor({ forceSaveSessionId: 'session-1' }), { unloading: true });
    const [tabPath, tabOptions] = endOnlyOfficeSession.mock.calls.at(-1);

    // The same document and the same session, so the server is left holding
    // the same thing. Only how the request travels differs, and it has to.
    expect(tabPath).toBe(panelPath);
    expect(tabOptions.sessionId).toBe(panelOptions.sessionId);
    expect(tabOptions.beacon).toBe(true);
    expect(panelOptions.beacon).toBeUndefined();
  });

  it('sends nothing for a tab that had no editing session', () => {
    onlyofficePreviewPlugin().onBeforeClose(contextFor({}), { unloading: true });
    expect(endOnlyOfficeSession).not.toHaveBeenCalled();
  });
});
