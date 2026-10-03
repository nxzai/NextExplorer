import { describe, expect, it, vi } from 'vitest';
import { loadAccountSettings } from './settingsGuard';

/**
 * The settings a signed-in account's pages read, asked for by the guard.
 *
 * Whether the router calls this on the share path is held by the browser test
 * that opens a document from inside a share with "open in a tab" chosen — the
 * failure this exists for, and one that only shows on the real build.
 */

const stores = (isAuthenticated, ensureLoaded = vi.fn(async () => {})) => ({
  auth: { isAuthenticated },
  appSettings: { ensureLoaded },
});

describe('the settings of the account that is signed in', () => {
  it('are loaded before the page that reads them', async () => {
    const signedIn = stores(true);
    await loadAccountSettings(signedIn);
    expect(signedIn.appSettings.ensureLoaded).toHaveBeenCalledTimes(1);
  });

  // A visitor holding only a link has no settings of their own, and the
  // branding everybody sees is loaded at start.
  it('are not asked for on behalf of nobody', async () => {
    const visitor = stores(false);
    await loadAccountSettings(visitor);
    expect(visitor.appSettings.ensureLoaded).not.toHaveBeenCalled();
  });

  it('do not stop the navigation when they cannot be read', async () => {
    const failing = stores(
      true,
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await expect(loadAccountSettings(failing)).resolves.toBeUndefined();
  });
});
