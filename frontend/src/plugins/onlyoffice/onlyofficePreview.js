import { useFeaturesStore } from '@/stores/features';
import { useSettingsStore } from '@/stores/settings';
import { endOnlyOfficeSession } from '@/api';

const CLOSE_REQUEST_GRACE_MS = 450;

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const DEFAULT_EXTS = [
  'docx',
  'doc',
  'odt',
  'rtf',
  'xlsx',
  'xls',
  'ods',
  'csv',
  'pptx',
  'ppt',
  'odp',
];
export const onlyofficePreviewPlugin = (extensions) => ({
  id: 'onlyoffice-editor',
  label: 'ONLYOFFICE',
  priority: 50,
  // Render with minimal chrome in the overlay host
  minimalHeader: true,
  // This one has a real wait after its component is on screen — a document server
  // to reach, a session to be given, a file to load into an iframe — so it says
  // when it is really there rather than letting the tab claim it already is.
  reportsReady: true,
  // Can open an earlier version of a document, to be read (`item.versionId`).
  supportsVersions: true,

  match: (context) => {
    const ext = String(context.extension || '').toLowerCase();
    const list = Array.isArray(extensions) && extensions.length > 0 ? extensions : DEFAULT_EXTS;

    if (!list.includes(ext)) return false;

    const featuresStore = useFeaturesStore();
    const hasBothEditors = Boolean(
      featuresStore.onlyofficeEnabled && featuresStore.collaboraEnabled
    );
    if (!hasBothEditors) return true;

    const settingsStore = useSettingsStore();
    return settingsStore.officeEditorPreference !== 'collabora';
  },

  component: () => import('./OnlyOfficePreview.vue'),

  /**
   * Leaving the document: flush what the editor holds, then end the session.
   *
   * Wait only for NextExplorer to accept the flush, never for Document Server
   * to assemble and download the document. That makes the request reliable
   * without making the editor visibly wait for a status-6 callback.
   *
   * `unloading` is the same closing, from a tab that is going away. There is
   * one synchronous moment and no way to wait between two requests, so the
   * order moves to the server: one beacon to `/session-end`, which flushes and
   * then closes. Either way the server is left holding the same thing — the
   * editing session gone, a last save queued, and the advisory "being edited"
   * standing until Document Server says the document was let go.
   */
  onBeforeClose: async (context, { unloading = false } = {}) => {
    const sessionId = context?.previewState?.forceSaveSessionId;
    // The document may have been renamed from the editor's title bar, in which
    // case the context still names the file the preview was opened on.
    const filePath = context?.previewState?.documentPath || context?.filePath;
    if (!filePath || !sessionId) return;

    if (unloading) {
      void endOnlyOfficeSession(filePath, { sessionId, beacon: true });
      return;
    }

    // The component coalesces this with an automatic save already in flight,
    // which is why it is asked rather than the endpoint being called directly.
    const request = context.previewState.requestForceSave?.({ reason: 'close' });
    if (request) {
      await Promise.race([Promise.resolve(request).catch(() => {}), wait(CLOSE_REQUEST_GRACE_MS)]);
    }
    // Queues the flush itself when the component had none to give, and
    // coalesces with the one above when it did.
    void endOnlyOfficeSession(filePath, { sessionId }).catch(() => {});
  },

  actions: (context) => [
    {
      id: 'download',
      label: 'Download',
      run: () => context.api.download(),
    },
  ],
});
