import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The API tokens page.
 *
 * One thing here is unlike the rest of the settings: the value of a new token
 * exists on this page and nowhere else, for as long as it is on screen. So
 * what is held below is mostly about that value — that it is shown, that the
 * page says it will not be shown again, that revoking the token takes it off
 * the screen, and that nothing else ever puts it back.
 */

const api = vi.hoisted(() => ({
  listApiTokens: vi.fn(),
  createApiToken: vi.fn(),
  renameApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));

/**
 * What the application asks, in its own dialog rather than the browser's box: the
 * server's address and port at the top of a question about somebody's token was the
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

const SettingsApiTokens = (await import('./SettingsApiTokens.vue')).default;

const SECRET = 'nxe_0123456789abcdef_' + 'v'.repeat(43);

const BACKUP = {
  id: '0123456789abcdef',
  name: 'Backup script',
  scope: 'read',
  createdAt: '2026-09-01T10:00:00.000Z',
  expiresAt: null,
  lastUsedAt: null,
  lastUsedIp: null,
};
const SYNC = {
  id: 'fedcba9876543210',
  name: 'Sync',
  scope: 'write',
  createdAt: '2026-09-02T10:00:00.000Z',
  expiresAt: '2026-12-02T10:00:00.000Z',
  lastUsedAt: '2026-09-15T08:30:00.000Z',
  lastUsedIp: '192.168.1.7',
};

const open = async (tokens = []) => {
  api.listApiTokens.mockResolvedValue({ tokens });
  const wrapper = mount(SettingsApiTokens, { global: { mocks: { $t: (key) => key } } });
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  auth.store.currentUser = { provider: 'local' };
  api.listApiTokens.mockReset();
  api.createApiToken.mockReset();
  api.renameApiToken.mockReset();
  api.revokeApiToken.mockReset();
});

describe('the API tokens page', () => {
  it('says so when there are none', async () => {
    const wrapper = await open();
    expect(wrapper.find('[data-test="tokens-none"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test="token"]')).toHaveLength(0);
  });

  it('shows what each token is, what it may do and when it was last used', async () => {
    const wrapper = await open([BACKUP, SYNC]);
    const rows = wrapper.findAll('[data-test="token"]');
    expect(rows).toHaveLength(2);

    expect(rows[0].text()).toContain('Backup script');
    expect(rows[0].text()).toContain('settings.apiTokens.scopeRead');
    expect(rows[0].text()).toContain('settings.apiTokens.neverUsed');
    expect(rows[0].text()).toContain('settings.apiTokens.neverExpires');

    expect(rows[1].text()).toContain('settings.apiTokens.scopeWrite');
    // The address is part of the answer to "is this still mine?".
    expect(rows[1].text()).toContain('192.168.1.7');
    expect(rows[1].text()).toContain('settings.apiTokens.expiresOn');
  });

  it('shows the value once, with the header to put it in', async () => {
    const wrapper = await open();
    api.createApiToken.mockResolvedValue({ token: BACKUP, secret: SECRET });
    api.listApiTokens.mockResolvedValue({ tokens: [BACKUP] });

    await wrapper.find('[data-test="token-name"]').setValue('Backup script');
    await wrapper.find('[data-test="token-password"]').setValue('secret123');
    await wrapper.find('[data-test="token-create"]').trigger('click');
    await flushPromises();

    expect(api.createApiToken).toHaveBeenCalledWith({
      name: 'Backup script',
      scope: 'read',
      expiresInDays: null,
      password: 'secret123',
    });

    expect(wrapper.find('[data-test="token-secret"]').text()).toBe(SECRET);
    expect(wrapper.find('[data-test="token-example"]').text()).toContain(`Bearer ${SECRET}`);
    expect(wrapper.find('[data-test="token-issued"]').text()).toContain(
      'settings.apiTokens.shownOnce'
    );

    // The password is not left in the form behind it.
    expect(wrapper.find('[data-test="token-password"]').element.value).toBe('');
  });

  it('carries the scope and the expiry that were chosen', async () => {
    const wrapper = await open();
    api.createApiToken.mockResolvedValue({ token: SYNC, secret: SECRET });

    await wrapper.find('[data-test="token-scope"]').setValue('write');
    await wrapper.find('[data-test="token-expiry"]').setValue('90');
    await wrapper.find('[data-test="token-create"]').trigger('click');
    await flushPromises();

    expect(api.createApiToken).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'write', expiresInDays: 90 })
    );
  });

  it('asks for no password from an account that has none', async () => {
    auth.store.currentUser = { provider: 'oidc' };
    const wrapper = await open();
    expect(wrapper.find('[data-test="token-password"]').exists()).toBe(false);

    api.createApiToken.mockResolvedValue({ token: BACKUP, secret: SECRET });
    await wrapper.find('[data-test="token-create"]').trigger('click');
    await flushPromises();
    expect(api.createApiToken).toHaveBeenCalledWith(
      expect.objectContaining({ password: undefined })
    );
  });

  it('says why a token could not be issued, and shows no value', async () => {
    const wrapper = await open();
    api.createApiToken.mockRejectedValue(new Error('That password is not right.'));

    await wrapper.find('[data-test="token-create"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-test="tokens-error"]').text()).toBe('That password is not right.');
    expect(wrapper.find('[data-test="token-issued"]').exists()).toBe(false);
  });

  it('takes the value off the screen when that token is revoked', async () => {
    const wrapper = await open();
    api.createApiToken.mockResolvedValue({ token: BACKUP, secret: SECRET });
    api.listApiTokens.mockResolvedValue({ tokens: [BACKUP] });
    await wrapper.find('[data-test="token-create"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="token-secret"]').exists()).toBe(true);

    asked.ask.mockResolvedValue(true);
    api.revokeApiToken.mockResolvedValue(undefined);
    api.listApiTokens.mockResolvedValue({ tokens: [] });

    await wrapper.find('[data-test="token-revoke"]').trigger('click');
    await flushPromises();

    expect(api.revokeApiToken).toHaveBeenCalledWith(BACKUP.id);
    expect(wrapper.find('[data-test="token-secret"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="tokens-none"]').exists()).toBe(true);
  });

  it('asks before revoking, and does nothing when the answer is no', async () => {
    const wrapper = await open([BACKUP]);
    asked.ask.mockResolvedValue(false);

    await wrapper.find('[data-test="token-revoke"]').trigger('click');
    await flushPromises();

    expect(api.revokeApiToken).not.toHaveBeenCalled();
    expect(wrapper.findAll('[data-test="token"]')).toHaveLength(1);
  });

  it('renames one, and leaves it alone when the prompt is cancelled', async () => {
    const wrapper = await open([BACKUP]);

    asked.askFor.mockResolvedValue(null);
    await wrapper.find('[data-test="token-rename"]').trigger('click');
    await flushPromises();
    expect(api.renameApiToken).not.toHaveBeenCalled();

    asked.askFor.mockResolvedValue('  Nightly backup  ');
    api.renameApiToken.mockResolvedValue({ token: { ...BACKUP, name: 'Nightly backup' } });
    api.listApiTokens.mockResolvedValue({ tokens: [{ ...BACKUP, name: 'Nightly backup' }] });

    await wrapper.find('[data-test="token-rename"]').trigger('click');
    await flushPromises();

    expect(api.renameApiToken).toHaveBeenCalledWith(BACKUP.id, 'Nightly backup');
    expect(wrapper.find('[data-test="token"]').text()).toContain('Nightly backup');
  });

  it('says what no token can do, whoever holds it', async () => {
    const wrapper = await open();
    expect(wrapper.find('[data-test="tokens-limits"]').text()).toBe('settings.apiTokens.limits');
  });
});
