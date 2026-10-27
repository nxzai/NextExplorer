import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

/**
 * The screen that makes and unmakes administrators.
 *
 * 119 statements at 10.53%. Everything here changes who may do what on the
 * server: granting the admin role, taking it away, resetting somebody's
 * password, deleting an account. Two of the rules are the sort that only show
 * up the day they are missing — an administrator deleting their own account and
 * locking everybody out of the settings, and a role change that adds "admin" to
 * a list rather than replacing it, so revoking it later removes one copy of
 * two.
 */

const api = vi.hoisted(() => ({
  fetchUsers: vi.fn(async () => ({ users: [] })),
  updateUser: vi.fn(async () => ({})),
  updateUserRoles: vi.fn(async () => ({})),
  createUser: vi.fn(async () => ({})),
  adminSetUserPassword: vi.fn(async () => ({})),
  deleteUser: vi.fn(async () => ({})),
  unlockUser: vi.fn(async () => ({})),
}));

vi.mock('@/api', () => ({
  fetchUsers: (...args) => api.fetchUsers(...args),
  updateUser: (...args) => api.updateUser(...args),
  updateUserRoles: (...args) => api.updateUserRoles(...args),
  createUser: (...args) => api.createUser(...args),
  adminSetUserPassword: (...args) => api.adminSetUserPassword(...args),
  deleteUser: (...args) => api.deleteUser(...args),
  unlockUser: (...args) => api.unlockUser(...args),
}));

const auth = vi.hoisted(() => ({ store: null }));
vi.mock('@/stores/auth', async () => {
  const { reactive } = await import('vue');
  auth.store = reactive({ currentUser: { id: 'me', username: 'moi' } });
  return { useAuthStore: () => auth.store };
});

vi.mock('vue-i18n', async (importOriginal) => ({
  ...(await importOriginal()),
  useI18n: () => ({ t: (key) => key }),
}));

vi.mock('./components/UserList.vue', () => ({
  default: { name: 'UserListStub', render: () => null },
}));
vi.mock('./components/UserDetail.vue', () => ({
  default: { name: 'UserDetailStub', render: () => null },
}));

/**
 * The three things the browser used to answer for, answered by the application.
 *
 * `alert`, `prompt` and `confirm` put the server's address and port at the top of every
 * message and question on this screen, and stopped the page until they were dismissed.
 * The harness below keeps its shape — what was said, what was typed, what was
 * answered — and only the place they now come from has changed.
 */
const notifications = vi.hoisted(() => ({ addNotification: vi.fn() }));
vi.mock('@/stores/notifications', () => ({ useNotificationsStore: () => notifications }));

const asked = vi.hoisted(() => ({ ask: vi.fn(), askFor: vi.fn() }));
vi.mock('@/composables/useAsk', () => ({ useAsk: () => asked }));

const AdminUsers = (await import('./AdminUsers.vue')).default;

const ALICE = { id: 'u1', username: 'alice', email: 'alice@example.com', roles: [] };
const BOB = { id: 'u2', username: 'bob', email: 'bob@example.com', roles: ['admin'] };

let wrapper = null;
let alerts = [];
let prompted = null;
let confirmed = true;

/** Passing null leaves whatever the test has already told `fetchUsers` to do. */
const mountAdmin = async (users = [ALICE, BOB]) => {
  if (users) api.fetchUsers.mockResolvedValue({ users });
  wrapper = mount(AdminUsers, { global: { mocks: { $t: (key) => key } } });
  await flushPromises();
  return wrapper.vm;
};

beforeEach(() => {
  alerts = [];
  prompted = null;
  confirmed = true;
  notifications.addNotification.mockImplementation(({ heading }) => alerts.push(heading));
  asked.askFor.mockImplementation(async () => prompted);
  asked.ask.mockImplementation(async () => confirmed);
  Object.values(api).forEach((fn) => fn.mockClear());
  api.fetchUsers.mockResolvedValue({ users: [] });
  api.updateUser.mockResolvedValue({});
  api.updateUserRoles.mockResolvedValue({});
  api.createUser.mockResolvedValue({});
  api.adminSetUserPassword.mockResolvedValue({});
  api.deleteUser.mockResolvedValue({});
  api.unlockUser.mockResolvedValue({});
  if (auth.store) auth.store.currentUser = { id: 'me', username: 'moi' };
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('reading the list of accounts', () => {
  it('reads it on arrival', async () => {
    const view = await mountAdmin();

    expect(api.fetchUsers).toHaveBeenCalled();
    expect(view.users.map((user) => user.username)).toEqual(['alice', 'bob']);
  });

  it('says why it could not', async () => {
    api.fetchUsers.mockRejectedValue(new Error('Not an administrator'));

    const view = await mountAdmin(null);

    expect(view.errorMsg).toBe('Not an administrator');
    expect(view.loading).toBe(false);
  });

  it('treats an answer holding no list as an empty one', async () => {
    api.fetchUsers.mockResolvedValue({});

    const view = await mountAdmin(null);

    expect(view.users).toEqual([]);
  });

  /** Otherwise the panel keeps showing an account that no longer exists. */
  it('drops the open account when the list comes back without it', async () => {
    const view = await mountAdmin();
    view.selectedUser = ALICE;

    api.fetchUsers.mockResolvedValue({ users: [BOB] });
    await view.loadUsers();

    expect(view.selectedUser).toBeNull();
  });

  it('refreshes the open account from the list it just read', async () => {
    const view = await mountAdmin();
    view.selectedUser = ALICE;

    api.fetchUsers.mockResolvedValue({ users: [{ ...ALICE, username: 'alice2' }] });
    await view.loadUsers();

    expect(view.selectedUser.username).toBe('alice2');
  });
});

describe('granting and revoking the admin role', () => {
  it('adds the role to whatever the account already had', async () => {
    const view = await mountAdmin();
    const editor = { ...ALICE, roles: ['editor'] };
    api.updateUserRoles.mockResolvedValue({ user: { ...editor, roles: ['editor', 'admin'] } });

    await view.handleMakeAdmin(editor);

    expect(api.updateUserRoles).toHaveBeenCalledWith('u1', ['editor', 'admin']);
  });

  /**
   * Roles are sent as the whole list. Granting twice would leave "admin" in it
   * twice, and revoking — which filters it out — would then remove both copies
   * or neither depending on how it is written.
   */
  it('does not add the role an account already has a second time', async () => {
    const view = await mountAdmin();

    await view.handleMakeAdmin(BOB);

    expect(api.updateUserRoles).toHaveBeenCalledWith('u2', ['admin']);
  });

  it('takes the role away, keeping the others', async () => {
    const view = await mountAdmin();

    await view.handleRevokeAdmin({ ...BOB, roles: ['admin', 'editor'] });

    expect(api.updateUserRoles).toHaveBeenCalledWith('u2', ['editor']);
  });

  it('puts the answer back into the list', async () => {
    const view = await mountAdmin();
    api.updateUserRoles.mockResolvedValue({ user: { ...ALICE, roles: ['admin'] } });

    await view.handleMakeAdmin(ALICE);

    expect(view.users.find((user) => user.id === 'u1').roles).toEqual(['admin']);
  });

  it('puts it into the open panel too', async () => {
    const view = await mountAdmin();
    view.selectedUser = ALICE;
    api.updateUserRoles.mockResolvedValue({ user: { ...ALICE, roles: ['admin'] } });

    await view.handleMakeAdmin(ALICE);

    expect(view.selectedUser.roles).toEqual(['admin']);
  });

  it('leaves the panel alone when it is showing somebody else', async () => {
    const view = await mountAdmin();
    view.selectedUser = BOB;
    api.updateUserRoles.mockResolvedValue({ user: { ...ALICE, roles: ['admin'] } });

    await view.handleMakeAdmin(ALICE);

    expect(view.selectedUser.id).toBe('u2');
  });

  it('says why a role change was refused', async () => {
    api.updateUserRoles.mockRejectedValue(new Error('Last administrator'));
    const view = await mountAdmin();

    await view.handleRevokeAdmin(BOB);

    expect(alerts).toContain('Last administrator');
  });
});

describe('deleting an account', () => {
  /** An administrator deleting themselves locks everybody out of this screen. */
  it('refuses to delete the account doing the deleting', async () => {
    auth.store.currentUser = { id: 'u1', username: 'alice' };
    const view = await mountAdmin();

    await view.handleDeleteUser(ALICE);

    expect(api.deleteUser).not.toHaveBeenCalled();
    expect(alerts).toContain('settings.users.cannotDeleteSelf');
  });

  it('asks first', async () => {
    confirmed = false;
    const view = await mountAdmin();

    await view.handleDeleteUser(ALICE);

    expect(api.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes it once the answer is yes', async () => {
    const view = await mountAdmin();

    await view.handleDeleteUser(ALICE);

    expect(api.deleteUser).toHaveBeenCalledWith('u1');
  });

  it('takes it out of the list and closes the panel', async () => {
    const view = await mountAdmin();
    view.selectedUser = ALICE;

    await view.handleDeleteUser(ALICE);

    expect(view.users.map((user) => user.id)).toEqual(['u2']);
    expect(view.selectedUser).toBeNull();
  });

  /** A refused deletion must not leave the list pretending it happened. */
  it('leaves the list alone when the server refused', async () => {
    api.deleteUser.mockRejectedValue(new Error('User owns active shares'));
    const view = await mountAdmin();

    await view.handleDeleteUser(ALICE);

    expect(view.users).toHaveLength(2);
    expect(alerts).toContain('User owns active shares');
  });
});

describe('resetting somebody"s password', () => {
  it('sets the one that was typed', async () => {
    prompted = 'nouveau-mot-de-passe';
    const view = await mountAdmin();

    await view.handleResetPassword(ALICE);

    expect(api.adminSetUserPassword).toHaveBeenCalledWith('u1', 'nouveau-mot-de-passe');
  });

  it('does nothing when the question was dismissed', async () => {
    prompted = null;
    const view = await mountAdmin();

    await view.handleResetPassword(ALICE);

    expect(api.adminSetUserPassword).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(0);
  });

  /** An empty answer is an answer, and it is too short. */
  it('refuses one that is too short, rather than setting it', async () => {
    prompted = '12345';
    const view = await mountAdmin();

    await view.handleResetPassword(ALICE);

    expect(api.adminSetUserPassword).not.toHaveBeenCalled();
    expect(alerts).toContain('errors.passwordMin');
  });

  it('reads the list back, so the account shows it now has a password', async () => {
    prompted = 'nouveau-mot-de-passe';
    const view = await mountAdmin();
    api.fetchUsers.mockClear();

    await view.handleResetPassword(ALICE);
    await flushPromises();

    expect(api.fetchUsers).toHaveBeenCalled();
  });

  it('says why it was refused', async () => {
    prompted = 'nouveau-mot-de-passe';
    api.adminSetUserPassword.mockRejectedValue(new Error('Password too common'));
    const view = await mountAdmin();

    await view.handleResetPassword(ALICE);

    expect(alerts).toContain('Password too common');
  });
});

describe('creating an account', () => {
  const fill = (view, values = {}) => {
    Object.assign(view, {
      newEmail: 'nouvelle@example.com',
      newPassword: 'motdepasse',
      newUsername: '',
      newIsAdmin: false,
      ...values,
    });
  };

  it('creates it with what was typed', async () => {
    const view = await mountAdmin();
    fill(view, { newUsername: 'nouvelle' });
    api.createUser.mockResolvedValue({ user: { id: 'u3', username: 'nouvelle' } });

    await view.handleCreate();

    expect(api.createUser).toHaveBeenCalledWith({
      email: 'nouvelle@example.com',
      username: 'nouvelle',
      password: 'motdepasse',
      roles: [],
    });
  });

  /** Nobody wants to type their address and then type half of it again. */
  it('makes a username out of the address when none was given', async () => {
    const view = await mountAdmin();
    fill(view);

    await view.handleCreate();

    expect(api.createUser.mock.calls[0][0].username).toBe('nouvelle');
  });

  it('makes an administrator when that was ticked', async () => {
    const view = await mountAdmin();
    fill(view, { newIsAdmin: true });

    await view.handleCreate();

    expect(api.createUser.mock.calls[0][0].roles).toEqual(['admin']);
  });

  it('asks for an address before sending anything', async () => {
    const view = await mountAdmin();
    fill(view, { newEmail: '   ' });

    await view.handleCreate();

    expect(api.createUser).not.toHaveBeenCalled();
    expect(alerts).toContain('errors.emailRequired');
  });

  it('asks for a password long enough to be one', async () => {
    const view = await mountAdmin();
    fill(view, { newPassword: '12345' });

    await view.handleCreate();

    expect(api.createUser).not.toHaveBeenCalled();
    expect(alerts).toContain('errors.passwordMin');
  });

  it('adds the new account to the list and shuts the form', async () => {
    const view = await mountAdmin();
    view.showCreateModal = true;
    fill(view);
    api.createUser.mockResolvedValue({ user: { id: 'u3', username: 'nouvelle' } });

    await view.handleCreate();

    expect(view.users.map((user) => user.id)).toEqual(['u1', 'u2', 'u3']);
    expect(view.showCreateModal).toBe(false);
  });

  it('leaves the form open, saying why, when it was refused', async () => {
    api.createUser.mockRejectedValue(new Error('Email already registered'));
    const view = await mountAdmin();
    view.showCreateModal = true;
    fill(view);

    await view.handleCreate();

    expect(view.showCreateModal).toBe(true);
    expect(alerts).toContain('Email already registered');
    expect(view.creating).toBe(false);
  });

  /** A form reopened still holding the last attempt is how a typo is repeated. */
  it('opens empty, whatever the last attempt left behind', async () => {
    const view = await mountAdmin();
    fill(view, { newIsAdmin: true });

    view.openCreateModal();

    expect(view.newEmail).toBe('');
    expect(view.newPassword).toBe('');
    expect(view.newUsername).toBe('');
    expect(view.newIsAdmin).toBe(false);
    expect(view.showCreateModal).toBe(true);
  });
});

describe('editing an account', () => {
  it('sends the fields that were changed', async () => {
    const view = await mountAdmin();

    await view.handleUpdateUser({
      id: 'u1',
      email: 'alice@ailleurs.com',
      username: 'alice',
      displayName: 'Alice A.',
    });

    expect(api.updateUser).toHaveBeenCalledWith('u1', {
      email: 'alice@ailleurs.com',
      username: 'alice',
      displayName: 'Alice A.',
    });
  });

  it('shows what the server actually saved', async () => {
    const view = await mountAdmin();
    view.selectedUser = ALICE;
    api.updateUser.mockResolvedValue({ user: { ...ALICE, displayName: 'Alice A.' } });

    await view.handleUpdateUser({ id: 'u1', email: ALICE.email, username: 'alice' });

    expect(view.users.find((user) => user.id === 'u1').displayName).toBe('Alice A.');
    expect(view.selectedUser.displayName).toBe('Alice A.');
  });

  it('says why it was refused, and stops looking busy', async () => {
    api.updateUser.mockRejectedValue(new Error('Username already taken'));
    const view = await mountAdmin();

    await view.handleUpdateUser({ id: 'u1', email: ALICE.email, username: 'bob' });

    expect(alerts).toContain('Username already taken');
    expect(view.saving).toBe(false);
  });
});

describe('moving between the list and one account', () => {
  it('opens the one that was clicked', async () => {
    const view = await mountAdmin();

    view.handleSelectUser(ALICE);

    expect(view.selectedUser.id).toBe('u1');
  });

  it('goes back to the list', async () => {
    const view = await mountAdmin();
    view.handleSelectUser(ALICE);

    view.handleBack();

    expect(view.selectedUser).toBeNull();
  });
});

/**
 * Releasing an account locked by failed sign-ins, before its lock runs out.
 * The screen must show the account as free the moment the server agrees — and
 * only then: a refused release that cleared the badge anyway would tell an
 * administrator a person can sign in when they still cannot.
 */
describe('releasing a sign-in lock', () => {
  const LOCKED = { ...ALICE, lockedUntil: new Date(Date.now() + 10 * 60_000).toISOString() };

  it('asks the server to release that account', async () => {
    const view = await mountAdmin([LOCKED, BOB]);

    await view.handleUnlock(LOCKED);

    expect(api.unlockUser).toHaveBeenCalledWith('u1');
  });

  it('shows the account as free, in the list and in the open panel', async () => {
    const view = await mountAdmin([LOCKED, BOB]);
    view.selectedUser = LOCKED;

    await view.handleUnlock(LOCKED);

    expect(view.users.find((user) => user.id === 'u1').lockedUntil).toBeNull();
    expect(view.selectedUser.lockedUntil).toBeNull();
  });

  it('keeps the lock shown, and says why, when the server refuses', async () => {
    const view = await mountAdmin([LOCKED, BOB]);
    api.unlockUser.mockRejectedValue(new Error('Admin access required.'));

    await view.handleUnlock(LOCKED);

    expect(alerts).toContain('Admin access required.');
    expect(view.users.find((user) => user.id === 'u1').lockedUntil).toBe(LOCKED.lockedUntil);
  });

  /** The handler is only half of it: the account panel has to reach it. */
  it('is what the account panel calls when asked to release', async () => {
    const view = await mountAdmin([LOCKED, BOB]);
    view.selectedUser = LOCKED;
    await flushPromises();

    wrapper.findComponent({ name: 'UserDetailStub' }).vm.$emit('unlock', LOCKED);
    await flushPromises();

    expect(api.unlockUser).toHaveBeenCalledWith('u1');
  });
});
