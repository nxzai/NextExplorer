import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

/**
 * Collabora and a document's history.
 *
 * Collabora keeps no history of its own here: its File > Revision history entry
 * asks the page, and NextExplorer answers with the Versions panel. So what
 * matters is that only the editor can ask — any window of the page can post a
 * message — that an earlier version opens to be read and never to be edited,
 * and that a restore made in the panel does not leave the frame showing what it
 * replaced.
 */

const fetchCollaboraConfig = vi.fn();
const searchUsersForMention = vi.fn();
/**
 * Closing goes through the session this document was opened in — `api.close` —
 * and not through whatever the window happens to be showing: with tabs there are
 * several documents alive at once, and an editor in a background tab asked to
 * close must not close the one in front.
 */
const closePreview = vi.fn();
const panel = vi.hoisted(() => ({ store: null }));

vi.mock('@/api', () => ({
  fetchCollaboraConfig: (...args) => fetchCollaboraConfig(...args),
  searchUsersForMention: (...args) => searchUsersForMention(...args),
  normalizePath: (value) => String(value || '').replace(/^\/+|\/+$/g, ''),
}));
vi.mock('@/stores/versionsPanel', async () => {
  const { reactive } = await import('vue');
  panel.store = reactive({ restored: 0, relativePath: '', openPath: vi.fn() });
  return { useVersionsPanelStore: () => panel.store };
});
vi.mock('@/utils/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), warning: vi.fn() },
}));

const CollaboraPreview = (await import('./CollaboraPreview.vue')).default;
const logger = (await import('@/utils/logger')).default;

const EDITOR_ORIGIN = 'https://collabora.example.com';
const URL_SRC = `${EDITOR_ORIGIN}/browser/dist/cool.html?WOPISrc=x`;
const REPORT = { name: 'report.docx', path: 'Docs' };

let wrapper = null;
// The preview manager's, and read by the preview host: what the page draws
// around this frame is decided through it.
let previewState = {};

const mountOn = async (item = REPORT) => {
  previewState = {};
  wrapper = mount(CollaboraPreview, {
    props: {
      item,
      extension: 'docx',
      filePath: 'Docs/report.docx',
      previewUrl: '',
      previewState,
      api: { close: (...args) => closePreview(...args) },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const frameWindow = () => wrapper.find('iframe').element.contentWindow;

const post = async (data, source) => {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify(data),
      origin: EDITOR_ORIGIN,
      source,
    })
  );
  await flushPromises();
};

// What the preview posts to the frame, read back from the frame itself, with
// the origin each message was addressed to.
const watchFrame = () => vi.spyOn(frameWindow(), 'postMessage').mockImplementation(() => {});
const sentTo = (spy) =>
  spy.mock.calls.map(([message, targetOrigin]) => ({ ...JSON.parse(message), targetOrigin }));

beforeEach(() => {
  fetchCollaboraConfig.mockReset();
  fetchCollaboraConfig.mockResolvedValue({ urlSrc: URL_SRC });
  searchUsersForMention.mockReset();
  searchUsersForMention.mockResolvedValue([]);
  closePreview.mockReset();
  for (const log of Object.values(logger)) log.mockClear();
  if (panel.store) {
    Object.assign(panel.store, { restored: 0, relativePath: '' });
    panel.store.openPath.mockClear();
  }
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('the revision history', () => {
  it('opens the document for editing', async () => {
    await mountOn();

    expect(fetchCollaboraConfig).toHaveBeenCalledWith('Docs/report.docx', 'edit');
  });

  it('opens the Versions panel on the document when the editor asks for it', async () => {
    await mountOn();

    await post({ MessageId: 'UI_FileVersions', Values: {} }, frameWindow());

    expect(panel.store.openPath).toHaveBeenCalledWith('Docs/report.docx');
  });

  it('ignores the same message from any other window of the page', async () => {
    await mountOn();

    await post({ MessageId: 'UI_FileVersions', Values: {} }, window);

    expect(panel.store.openPath).not.toHaveBeenCalled();
  });
});

describe('an earlier version', () => {
  it('opens to be read, by its id, and offers no history of its own', async () => {
    await mountOn({ ...REPORT, versionId: 'v-older-0000000001' });

    expect(fetchCollaboraConfig).toHaveBeenCalledWith('Docs/report.docx', 'view', {
      versionId: 'v-older-0000000001',
    });

    await post({ MessageId: 'UI_FileVersions', Values: {} }, frameWindow());
    expect(panel.store.openPath).not.toHaveBeenCalled();
  });
});

describe('a restore made in the Versions panel', () => {
  it('opens this document again, and leaves the others alone', async () => {
    await mountOn();
    expect(fetchCollaboraConfig).toHaveBeenCalledTimes(1);

    panel.store.relativePath = 'Docs/other.docx';
    panel.store.restored += 1;
    await flushPromises();
    expect(fetchCollaboraConfig).toHaveBeenCalledTimes(1);

    panel.store.relativePath = 'Docs/report.docx';
    panel.store.restored += 1;
    await flushPromises();
    expect(fetchCollaboraConfig).toHaveBeenCalledTimes(2);
  });

  it('leaves an earlier version as it is', async () => {
    await mountOn({ ...REPORT, versionId: 'v-older-0000000001' });

    panel.store.relativePath = 'Docs/report.docx';
    panel.store.restored += 1;
    await flushPromises();

    expect(fetchCollaboraConfig).toHaveBeenCalledTimes(1);
  });
});

/**
 * Collabora sends nothing of what the page asks until the page has answered its
 * ready signal: without `Host_PostmessageReady` the history entry and the
 * mentions never reach NextExplorer. What the page sends is addressed to the
 * editor's origin, taken from the frame's address — never to any window that
 * happens to be listening.
 */
describe('talking to the editor frame', () => {
  it('answers the ready signal, and only that one, addressed to the editor origin', async () => {
    await mountOn();
    const spy = watchFrame();

    await post(
      { MessageId: 'App_LoadingStatus', Values: { Status: 'Document_Loaded' } },
      frameWindow()
    );
    expect(spy).not.toHaveBeenCalled();

    await post(
      { MessageId: 'App_LoadingStatus', Values: { Status: 'Frame_Ready' } },
      frameWindow()
    );

    expect(sentTo(spy)).toEqual([
      expect.objectContaining({
        MessageId: 'Host_PostmessageReady',
        Values: {},
        targetOrigin: EDITOR_ORIGIN,
      }),
    ]);
  });
});

/**
 * Leaving the document.
 *
 * The editor fills the screen, so until it says it is up the page floats a
 * close button over it — for the document that never opens, which would
 * otherwise leave no way out at all. Once the editor draws its own, in its own
 * toolbar, the floating one has to go, and pressing the editor's has to leave
 * the same way the page's own button does (nxzai/NextExplorer#303).
 */
describe('leaving the document', () => {
  it('takes the page’s close button away once the editor draws its own', async () => {
    await mountOn();
    expect(previewState.hasNativeClose).toBe(false);

    await post(
      { MessageId: 'App_LoadingStatus', Values: { Status: 'Document_Loaded' } },
      frameWindow()
    );

    expect(previewState.hasNativeClose).toBe(true);
  });

  it('keeps it while the frame is up but the document is not', async () => {
    await mountOn();

    await post(
      { MessageId: 'App_LoadingStatus', Values: { Status: 'Frame_Ready' } },
      frameWindow()
    );

    expect(previewState.hasNativeClose).toBe(false);
  });

  it('believes no other window of the page saying a document has loaded', async () => {
    await mountOn();

    await post({ MessageId: 'App_LoadingStatus', Values: { Status: 'Document_Loaded' } }, window);

    expect(previewState.hasNativeClose).toBe(false);
  });

  it('puts it back when the frame goes to another document', async () => {
    await mountOn();
    await post(
      { MessageId: 'App_LoadingStatus', Values: { Status: 'Document_Loaded' } },
      frameWindow()
    );

    await wrapper.setProps({ filePath: 'Docs/other.docx' });
    await flushPromises();

    expect(previewState.hasNativeClose).toBe(false);
  });

  it('closes the document when the editor’s own button is pressed', async () => {
    await mountOn();

    await post({ MessageId: 'UI_Close', Values: { EverModified: true } }, frameWindow());

    expect(closePreview).toHaveBeenCalledTimes(1);
  });

  it('is not closed by any other window of the page saying so', async () => {
    await mountOn();

    await post({ MessageId: 'UI_Close', Values: {} }, window);

    expect(closePreview).not.toHaveBeenCalled();
  });
});

/**
 * An @ typed in a comment: Collabora sends what follows it and waits for the
 * list to offer. The search takes the text without the @, which no name
 * contains, and the list has to be in Collabora's own shape or the popup shows
 * nobody.
 */
describe('mentions in comments', () => {
  it('answers an @ with the people found, in the shape Collabora lists them', async () => {
    // As /api/users/search answers.
    searchUsersForMention.mockResolvedValue([
      { UserId: 'u1', UserFriendlyName: 'Alice Martin', UserEmail: 'alice@example.com' },
      { UserId: 'u2', UserFriendlyName: 'alfred', UserEmail: 'alfred@example.com' },
    ]);
    await mountOn();
    const spy = watchFrame();

    await post(
      { MessageId: 'UI_Mention', Values: { type: 'autocomplete', text: '@al' } },
      frameWindow()
    );

    expect(searchUsersForMention).toHaveBeenCalledWith('al');
    expect(sentTo(spy)).toEqual([
      expect.objectContaining({
        MessageId: 'Action_Mention',
        targetOrigin: EDITOR_ORIGIN,
        Values: {
          list: [
            { username: 'u1', profile: '', label: 'Alice Martin' },
            { username: 'u2', profile: '', label: 'alfred' },
          ],
        },
      }),
    ]);
  });

  it('sends no list when the search failed, and records why', async () => {
    const failure = new Error('Authentication required');
    searchUsersForMention.mockRejectedValue(failure);
    await mountOn();
    const spy = watchFrame();

    await post(
      { MessageId: 'UI_Mention', Values: { type: 'autocomplete', text: '@al' } },
      frameWindow()
    );

    expect(searchUsersForMention).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure },
      '[Collabora] Failed to search users'
    );
  });
});

/**
 * A document that will not open has to say why. Without it the preview shows
 * a loading line forever, or a frame pointed at nothing.
 */
describe('a document that will not open', () => {
  it('shows why, instead of the frame', async () => {
    fetchCollaboraConfig.mockRejectedValue(new Error('Collabora is not configured on the server.'));
    await mountOn();

    expect(fetchCollaboraConfig).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toBe('Collabora is not configured on the server.');
    expect(wrapper.find('iframe').exists()).toBe(false);
  });

  it('shows an error when the server gives no address for the frame', async () => {
    fetchCollaboraConfig.mockResolvedValue({});
    await mountOn();

    expect(wrapper.text()).toBe('Missing Collabora iframe URL.');
    expect(wrapper.find('iframe').exists()).toBe(false);
  });
});

describe('another document in the same preview', () => {
  it('opens the new path in the frame', async () => {
    const budget = `${EDITOR_ORIGIN}/browser/dist/cool.html?WOPISrc=budget`;
    fetchCollaboraConfig
      .mockResolvedValueOnce({ urlSrc: URL_SRC })
      .mockResolvedValueOnce({ urlSrc: budget });
    await mountOn();
    expect(wrapper.find('iframe').attributes('src')).toBe(URL_SRC);

    await wrapper.setProps({ filePath: 'Docs/budget.xlsx' });
    await flushPromises();

    expect(fetchCollaboraConfig).toHaveBeenLastCalledWith('Docs/budget.xlsx', 'edit');
    expect(wrapper.find('iframe').attributes('src')).toBe(budget);
  });
});
