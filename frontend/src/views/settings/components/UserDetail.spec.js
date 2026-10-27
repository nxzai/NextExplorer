import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The two things the browser used to answer for: the question before a volume is taken
 * away, and the message when it could not be. Both belong to the application now.
 */
const notifications = vi.hoisted(() => ({ addNotification: vi.fn() }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: () => notifications }));

const asked = vi.hoisted(() => ({ ask: vi.fn(async () => true), askFor: vi.fn() }));
vi.mock('@/composables/useAsk', () => ({ useAsk: () => asked }));

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    locale: { value: 'en' },
  }),
}));
vi.mock('@/api', () => ({
  fetchUserVolumes: vi.fn(async () => ({ volumes: [] })),
  removeUserVolume: vi.fn(async () => ({})),
}));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ currentUser: { id: 'me' } }) }));
vi.mock('@/stores/features', () => ({
  useFeaturesStore: () => ({ userVolumesEnabled: false, ensureLoaded: vi.fn() }),
}));
vi.mock('./VolumeAssignModal.vue', () => ({
  default: { name: 'VolumeAssignStub', render: () => null },
}));

const UserDetail = (await import('./UserDetail.vue')).default;

/**
 * An account's security settings, where a lock left by failed sign-ins can now
 * be seen and released. Until this, releasing one meant waiting for it to run
 * out, or deleting a row from the database.
 */

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

const ALICE = {
  id: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  roles: [],
  authMethods: [{ method: 'local_password' }],
  lockedUntil: null,
};

let wrapper;

afterEach(() => {
  wrapper?.unmount();
});

const openSecurity = async (user) => {
  wrapper = mount(UserDetail, { props: { user } });
  await flushPromises();
  const tab = wrapper
    .findAll('button')
    .find((b) => b.text() === 'settings.userDetails.securityTab');
  await tab.trigger('click');
  return wrapper;
};

describe('the sign-in lock of a locked account', () => {
  it('says the account is locked, and when it frees itself', async () => {
    const until = inMinutes(9);
    await openSecurity({ ...ALICE, lockedUntil: until });

    const card = wrapper.find('[data-test="sign-in-lock"]');

    expect(card.exists()).toBe(true);
    expect(card.text()).toContain(
      `settings.userDetails.lockedHint:${JSON.stringify({ time: timeOf(until) })}`
    );
  });

  it('offers to release it, and asks for that account', async () => {
    const user = { ...ALICE, lockedUntil: inMinutes(9) };
    await openSecurity(user);

    await wrapper.find('[data-test="unlock"]').trigger('click');

    expect(wrapper.emitted('unlock')).toEqual([[user]]);
  });
});

describe('the sign-in lock of an account that is not locked', () => {
  it('says so, and offers nothing to release', async () => {
    await openSecurity(ALICE);

    const card = wrapper.find('[data-test="sign-in-lock"]');

    expect(card.text()).toContain('settings.userDetails.notLockedHint');
    expect(wrapper.find('[data-test="unlock"]').exists()).toBe(false);
  });

  it('treats a lock that has already run out as no lock', async () => {
    await openSecurity({ ...ALICE, lockedUntil: inMinutes(-2) });

    expect(wrapper.find('[data-test="unlock"]').exists()).toBe(false);
  });
});
