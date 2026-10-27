import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { setupTestEnv } from '../helpers/env-test-utils.js';

const MODULES = [
  'src/services/settingsService',
  'src/services/db',
  'src/routes/settings',
  'src/middleware/errorHandler',
];

/**
 * The route, not the service underneath it.
 *
 * A preference used to have to be listed in two places — sanitised in the
 * service and allowed in the route — and a key present in one but not the other
 * was accepted by the API, silently dropped, and answered with its previous
 * value. The client applied that answer, so the switch flicked itself back off.
 * Testing setUserSetting directly could not see it: the route was the half that
 * was missing.
 */
const buildContext = async () => {
  const envContext = await setupTestEnv({ tag: 'settings-route-test-', modules: MODULES });
  const settingsService = envContext.requireFresh('src/services/settingsService');
  const settingsRoutes = envContext.requireFresh('src/routes/settings');
  const { errorHandler } = envContext.requireFresh('src/middleware/errorHandler');

  const dbService = envContext.requireFresh('src/services/db');
  const db = await dbService.getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, email_verified, username, display_name, roles, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('user-1', 'user-1@example.com', 1, 'user-1', 'User 1', '["user"]', now, now);

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', email: 'user-1@example.com', roles: ['user'] };
    next();
  });
  app.use('/api', settingsRoutes);
  app.use(errorHandler);

  return { envContext, app, settingsService };
};

// A value that is different from every default, so "it came back" cannot be
// confused with "it was already like that".
const NON_DEFAULT = {
  showHiddenFiles: true,
  showThumbnails: false,
  showSidebarFavorites: false,
  showSidebarShares: false,
  showSidebarTools: false,
  markdownOpensInEditor: true,
  documentsOpenInNewTab: true,
  // On by default, so off is the value that has to survive a round trip.
  showVersionMarks: false,
  defaultShareExpiration: { value: 3, unit: 'days' },
  skipHome: true,
  defaultView: 'list',
  // Null by default, which means "follow the browser".
  locale: 'nl',
  // `zip` by default, which is what every version before this one did.
  downloadMode: 'separate',
  // Off by default: tabs change the shape of every screen, so nobody gets them
  // without asking.
  browseInTabs: true,
  // Off by default: a double click is also how somebody with a trackpad ends up
  // clicking twice, and a tab closing under them is a surprise nobody asked for.
  closeTabsOnDoubleClick: true,
  reopenTabs: true,
  // On by default: a tab opened in the background is opened in order not to wait
  // for it. Turned off by whoever would rather nothing were prepared in advance.
  preloadBackgroundTabs: false,
};

describe('PATCH /api/settings — user preferences', () => {
  it('saves the markdown preference and reads it back', async () => {
    const { envContext, app } = await buildContext();
    try {
      const saved = await request(app)
        .patch('/api/settings')
        .send({ user: { markdownOpensInEditor: true } })
        .expect(200);

      // The response is what the client applies to its own state, so the value
      // has to be in it — not merely stored somewhere.
      expect(saved.body.user?.markdownOpensInEditor).toBe(true);

      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user.markdownOpensInEditor).toBe(true);
    } finally {
      await envContext.cleanup();
    }
  });

  // Every writable preference, so the next one added is covered without anyone
  // having to remember to write a test for it.
  it('saves and reads back every writable preference', async () => {
    const { envContext, app, settingsService } = await buildContext();
    try {
      const writable = [...settingsService.WRITABLE_USER_SETTINGS];

      // Guard against the list and this test drifting apart.
      for (const key of writable) {
        expect(NON_DEFAULT, `add ${key} to NON_DEFAULT`).toHaveProperty(key);
      }

      const payload = Object.fromEntries(writable.map((key) => [key, NON_DEFAULT[key]]));
      const saved = await request(app).patch('/api/settings').send({ user: payload }).expect(200);

      for (const key of writable) {
        expect(saved.body.user?.[key], `${key} missing from the response`).toEqual(
          NON_DEFAULT[key]
        );
      }

      const reread = await request(app).get('/api/settings').expect(200);
      for (const key of writable) {
        expect(reread.body.user[key], `${key} was not persisted`).toEqual(NON_DEFAULT[key]);
      }
    } finally {
      await envContext.cleanup();
    }
  });

  /**
   * A default expiry that is not one used to be stored as no default: minus
   * three weeks sent from the page removed the default the person had, and the
   * page then showed an empty field.
   */
  it.each([
    [{ value: -3, unit: 'weeks' }],
    [{ value: 0, unit: 'days' }],
    [{ value: 3, unit: 'years' }],
    [5],
    ['soon'],
  ])('leaves the default share expiry as it was when sent %j', async (sent) => {
    const { envContext, app } = await buildContext();
    try {
      await request(app)
        .patch('/api/settings')
        .send({ user: { defaultShareExpiration: { value: 3, unit: 'days' } } })
        .expect(200);

      const saved = await request(app)
        .patch('/api/settings')
        .send({ user: { defaultShareExpiration: sent } })
        .expect(200);

      expect(saved.body.user.defaultShareExpiration).toEqual({ value: 3, unit: 'days' });
      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user.defaultShareExpiration).toEqual({ value: 3, unit: 'days' });
    } finally {
      await envContext.cleanup();
    }
  });

  it('removes the default share expiry when sent null', async () => {
    const { envContext, app } = await buildContext();
    try {
      await request(app)
        .patch('/api/settings')
        .send({ user: { defaultShareExpiration: { value: 3, unit: 'days' } } })
        .expect(200);

      await request(app)
        .patch('/api/settings')
        .send({ user: { defaultShareExpiration: null } })
        .expect(200);

      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user.defaultShareExpiration).toBeNull();
    } finally {
      await envContext.cleanup();
    }
  });

  /**
   * A switch used to be `Boolean(whatever came)`, which has an opinion about
   * everything: `'false'` — what a form field, a query string or a shell
   * client sends — was true, and `0` was false. Either way the preference was
   * set to something nobody had chosen, and answered as though they had.
   *
   * Each case stores the opposite of what the coercion would have made of the
   * value, so "it stayed" cannot be confused with "it was already like that".
   */
  it.each([
    ['showHiddenFiles', 'false', false],
    ['showThumbnails', 0, true],
    ['showSidebarFavorites', 'no', false],
    ['markdownOpensInEditor', '', true],
    ['skipHome', 0, true],
  ])('leaves %s as it was when sent %j', async (key, sent, stored) => {
    const { envContext, app } = await buildContext();
    try {
      await request(app)
        .patch('/api/settings')
        .send({ user: { [key]: stored } })
        .expect(200);

      const saved = await request(app)
        .patch('/api/settings')
        .send({ user: { [key]: sent } })
        .expect(200);

      expect(saved.body.user[key]).toBe(stored);
      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user[key]).toBe(stored);
    } finally {
      await envContext.cleanup();
    }
  });

  /**
   * The same reasoning as the view mode below: a word that is not one of the two
   * ways a selection can leave is refused, so a typo cannot quietly put an
   * account back on the archive it had just moved away from.
   */
  it('leaves the download mode as it was when sent a word there is no such thing as', async () => {
    const { envContext, app } = await buildContext();
    try {
      await request(app)
        .patch('/api/settings')
        .send({ user: { downloadMode: 'separate' } })
        .expect(200);

      const saved = await request(app)
        .patch('/api/settings')
        .send({ user: { downloadMode: 'tarball' } })
        .expect(200);

      expect(saved.body.user.downloadMode).toBe('separate');
      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user.downloadMode).toBe('separate');
    } finally {
      await envContext.cleanup();
    }
  });

  /**
   * A view mode we do not have used to become null, and null is a value here:
   * the built-in default. One unknown word therefore put every folder back to
   * the built-in view rather than being refused.
   */
  it('leaves the default view as it was when sent a mode there is no such thing as', async () => {
    const { envContext, app } = await buildContext();
    try {
      await request(app)
        .patch('/api/settings')
        .send({ user: { defaultView: 'list' } })
        .expect(200);

      const saved = await request(app)
        .patch('/api/settings')
        .send({ user: { defaultView: 'mosaic' } })
        .expect(200);

      expect(saved.body.user.defaultView).toBe('list');
      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user.defaultView).toBe('list');
    } finally {
      await envContext.cleanup();
    }
  });

  it('still takes null for the default view, which is the built-in one', async () => {
    const { envContext, app } = await buildContext();
    try {
      await request(app)
        .patch('/api/settings')
        .send({ user: { defaultView: 'list' } })
        .expect(200);

      await request(app)
        .patch('/api/settings')
        .send({ user: { defaultView: null } })
        .expect(200);

      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user.defaultView).toBeNull();
    } finally {
      await envContext.cleanup();
    }
  });

  /**
   * The language an account reads in, which is the account's and not the
   * browser's: the only other way to choose one is the picker on the sign-in
   * page, which writes into the browser and is never seen again once somebody
   * is signed in (nxzai/NextExplorer discussion #408).
   */
  describe('the language', () => {
    it('follows the browser until an account says otherwise', async () => {
      const { envContext, app } = await buildContext();
      try {
        const fresh = await request(app).get('/api/settings').expect(200);
        expect(fresh.body.user.locale ?? null).toBeNull();

        const saved = await request(app)
          .patch('/api/settings')
          .send({ user: { locale: 'pt-BR' } })
          .expect(200);
        expect(saved.body.user.locale).toBe('pt-BR');

        const back = await request(app)
          .patch('/api/settings')
          .send({ user: { locale: null } })
          .expect(200);
        expect(back.body.user.locale).toBeNull();
      } finally {
        await envContext.cleanup();
      }
    });

    /**
     * Refused rather than read as "follow the browser": a value that is not a
     * language tag is a mistake, and turning it into the default would put the
     * choice back where it was with nothing to show for it.
     */
    it.each([['not a language'], ['en_US!'], [42], [{ code: 'fr' }], [['fr']]])(
      'leaves the language as it was when sent %j',
      async (sent) => {
        const { envContext, app } = await buildContext();
        try {
          await request(app)
            .patch('/api/settings')
            .send({ user: { locale: 'nl' } })
            .expect(200);

          const saved = await request(app)
            .patch('/api/settings')
            .send({ user: { locale: sent } })
            .expect(200);

          expect(saved.body.user.locale).toBe('nl');
        } finally {
          await envContext.cleanup();
        }
      }
    );
  });

  it('ignores a key that is not a user preference', async () => {
    const { envContext, app } = await buildContext();
    try {
      await request(app)
        .patch('/api/settings')
        .send({ user: { notASetting: 'x' } })
        .expect(200);

      const reread = await request(app).get('/api/settings').expect(200);
      expect(reread.body.user.notASetting).toBeUndefined();
    } finally {
      await envContext.cleanup();
    }
  });
});
