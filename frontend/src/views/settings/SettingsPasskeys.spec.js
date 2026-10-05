import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The passkeys page.
 *
 * The interesting cases are the ones where nothing can work: a browser without
 * passkeys, a page over plain http, an account that signs in somewhere else.
 * Each has to say so rather than offer a button that opens a dialog and then
 * fails — and the page has to carry the password through to the removal, which
 * is the one thing here that changes how somebody gets in.
 */

const api = vi.hoisted(() => ({
  listPasskeys: vi.fn(),
  createPasskey: vi.fn(),
  renamePasskey: vi.fn(),
  deletePasskey: vi.fn(),
  passkeysSupported: vi.fn(() => true),
}));

/**
 * What the application asks, in its own dialog rather than the browser's box: the
 * server's address and port at the top of a question about somebody's passkey was the
 * whole reason for the change. Answers with a promise, as the real one does.
 */
const asked = vi.hoisted(() => ({ ask: vi.fn(async () => true), askFor: vi.fn(async () => null) }));
vi.mock('@/composables/useAsk', () => ({ useAsk: () => asked }));

vi.mock('@/api', () => api);

const auth = vi.hoisted(() => ({ store: { currentUser: { provider: 'local' } } }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth.store }));

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({
    t: (key, values) =>
      values && typeof values === 'object' ? `${key}:${Object.values(values).join(',')}` : key,
  }),
}));

const SettingsPasskeys = (await import('./SettingsPasskeys.vue')).default;

const YELLOW = {
  id: 'pk-1',
  name: 'The yellow key',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: null,
  backedUp: false,
  transports: ['usb'],
};
const PHONE = {
  id: 'pk-2',
  name: 'Phone',
  createdAt: '2026-09-02T10:00:00.000Z',
  lastUsedAt: '2026-09-15T08:30:00.000Z',
  backedUp: true,
  transports: ['internal', 'hybrid'],
};

const open = async (passkeys = []) => {
  api.listPasskeys.mockResolvedValue({ passkeys });
  const wrapper = mount(SettingsPasskeys, { global: { mocks: { $t: (key) => key } } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  auth.store.currentUser = { provider: 'local' };
  api.listPasskeys.mockReset();
  api.createPasskey.mockReset();
  api.renamePasskey.mockReset();
  api.deletePasskey.mockReset();
  api.passkeysSupported.mockReset();
  api.passkeysSupported.mockReturnValue(true);
});

describe('what the page shows', () => {
  it('says there are none, and offers to add one', async () => {
    const wrapper = await open();

    expect(wrapper.find('[data-test="passkeys-none"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="passkey-add"]').exists()).toBe(true);
  });

  it('lists the ones there are, with when they were last used', async () => {
    const wrapper = await open([YELLOW, PHONE]);

    const rows = wrapper.findAll('[data-test="passkey"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('The yellow key');
    expect(rows[0].text()).toContain('settings.passkeys.neverUsed');
    expect(rows[1].text()).toContain('settings.passkeys.lastUsed');
    expect(rows[1].text()).toContain('settings.passkeys.synced');
  });

  it('asks for the password only when there is something to remove', async () => {
    expect((await open()).find('[data-test="passkey-password"]').exists()).toBe(false);
    expect((await open([YELLOW])).find('[data-test="passkey-password"]').exists()).toBe(true);
  });

  it('says why nothing can be added when the page is not secure', async () => {
    api.passkeysSupported.mockReturnValue(false);

    const wrapper = await open([YELLOW]);

    expect(wrapper.find('[data-test="passkeys-unavailable"]').exists()).toBe(true);
    // The ones already there are still listed and can still be taken away.
    expect(wrapper.find('[data-test="passkey-add"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test="passkey"]')).toHaveLength(1);
  });

  it('sends an account from the identity provider elsewhere', async () => {
    auth.store.currentUser = { provider: 'oidc' };

    const wrapper = await open();

    expect(wrapper.text()).toContain('settings.passkeys.notLocalUser');
    expect(wrapper.find('[data-test="passkey-add"]').exists()).toBe(false);
    expect(api.listPasskeys).not.toHaveBeenCalled();
  });

  it('says so when the list cannot be read', async () => {
    api.listPasskeys.mockRejectedValue(new Error('the database is elsewhere'));
    const wrapper = mount(SettingsPasskeys, { global: { mocks: { $t: (key) => key } } });
    await flushPromises();

    expect(wrapper.find('[data-test="passkeys-error"]').text()).toContain(
      'the database is elsewhere'
    );
  });
});

describe('adding one', () => {
  it('passes the name that was typed, and reads the list again', async () => {
    const wrapper = await open();
    api.createPasskey.mockResolvedValue({ passkey: { ...YELLOW } });
    api.listPasskeys.mockResolvedValue({ passkeys: [YELLOW] });

    await wrapper.find('[data-test="passkey-name"]').setValue('  The yellow key  ');
    await wrapper.find('[data-test="passkey-add"]').trigger('click');
    await flushPromises();

    expect(api.createPasskey).toHaveBeenCalledWith({ name: 'The yellow key' });
    expect(wrapper.findAll('[data-test="passkey"]')).toHaveLength(1);
    expect(wrapper.find('[data-test="passkeys-success"]').text()).toContain(
      'settings.passkeys.added'
    );
    expect(wrapper.find('[data-test="passkey-name"]').element.value).toBe('');
  });

  it('leaves the naming to the server when nothing was typed', async () => {
    const wrapper = await open();
    api.createPasskey.mockResolvedValue({ passkey: { ...YELLOW, name: 'Passkey 1' } });

    await wrapper.find('[data-test="passkey-add"]').trigger('click');
    await flushPromises();

    expect(api.createPasskey).toHaveBeenCalledWith({ name: undefined });
  });

  it('tells a cancelled ceremony from a failure', async () => {
    const wrapper = await open();
    const refusal = new Error('not allowed');
    refusal.name = 'NotAllowedError';
    api.createPasskey.mockRejectedValue(refusal);

    await wrapper.find('[data-test="passkey-add"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="passkeys-error"]').text()).toContain(
      'settings.passkeys.cancelled'
    );
  });

  it('says plainly when this device already holds one for the account', async () => {
    const wrapper = await open();
    const refusal = new Error('already registered');
    refusal.name = 'InvalidStateError';
    api.createPasskey.mockRejectedValue(refusal);

    await wrapper.find('[data-test="passkey-add"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="passkeys-error"]').text()).toContain(
      'settings.passkeys.alreadyHere'
    );
  });
});

describe('taking one away', () => {
  it('sends the password that was typed', async () => {
    const wrapper = await open([YELLOW, PHONE]);
    api.deletePasskey.mockResolvedValue(undefined);
    api.listPasskeys.mockResolvedValue({ passkeys: [PHONE] });

    await wrapper.find('[data-test="passkey-password"]').setValue('secret123');
    await wrapper.findAll('[data-test="passkey-remove"]')[0].trigger('click');
    await flushPromises();

    expect(api.deletePasskey).toHaveBeenCalledWith('pk-1', 'secret123');
    expect(wrapper.findAll('[data-test="passkey"]')).toHaveLength(1);
  });

  it('keeps the list as it is when the server refuses', async () => {
    const wrapper = await open([YELLOW]);
    api.deletePasskey.mockRejectedValue(new Error('That password is not right.'));

    await wrapper.find('[data-test="passkey-remove"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="passkeys-error"]').text()).toContain(
      'That password is not right.'
    );
    expect(wrapper.findAll('[data-test="passkey"]')).toHaveLength(1);
  });
});

describe('renaming one', () => {
  it('sends the new name, trimmed', async () => {
    const wrapper = await open([YELLOW]);
    api.renamePasskey.mockResolvedValue({ passkey: { ...YELLOW, name: 'Desk key' } });
    asked.askFor.mockResolvedValue('  Desk key  ');

    await wrapper.find('[data-test="passkey-rename"]').trigger('click');
    await flushPromises();

    expect(api.renamePasskey).toHaveBeenCalledWith('pk-1', 'Desk key');
  });

  it('does nothing at all when the prompt is dismissed', async () => {
    const wrapper = await open([YELLOW]);
    asked.askFor.mockResolvedValue(null);

    await wrapper.find('[data-test="passkey-rename"]').trigger('click');
    await flushPromises();

    expect(api.renamePasskey).not.toHaveBeenCalled();
  });
});
