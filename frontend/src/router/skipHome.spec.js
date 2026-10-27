import { describe, it, expect, vi } from 'vitest';

import { skipHomeDestination } from './skipHome';

/**
 * The home page is the one place a visitor can always get to, so every step of
 * this falls back to showing it rather than to an error. That is the part with
 * no test and the part that matters: a feature flag that will not load must not
 * turn the dashboard into a blank screen.
 */

const context = ({ preference, deploymentDefault = false, volumes = [], failing = {} } = {}) => ({
  appSettings: { userSettings: preference === undefined ? {} : { skipHome: preference } },
  featuresStore: {
    skipHome: deploymentDefault,
    ensureLoaded: failing.features
      ? vi.fn(async () => {
          throw new Error('flags unavailable');
        })
      : vi.fn(async () => {}),
  },
  getVolumes: failing.volumes
    ? vi.fn(async () => {
        throw new Error('volumes unavailable');
      })
    : vi.fn(async () => volumes),
});

const VOLUMES = [
  { name: 'Media', path: 'Media' },
  { name: 'Docs', path: 'Docs' },
];

describe('whether to skip the home page at all', () => {
  it('does not, when neither the person nor the deployment asked', async () => {
    expect(await skipHomeDestination(context({ volumes: VOLUMES }))).toBeNull();
  });

  it('does, when the deployment asked', async () => {
    const destination = await skipHomeDestination(
      context({ deploymentDefault: true, volumes: VOLUMES })
    );

    expect(destination).toEqual({ path: '/browse/Media' });
  });

  /**
   * `false` is an answer, not an absent one. Falling through to the
   * deployment's default on an explicit `false` overrides somebody who went
   * into settings and turned it off.
   */
  it('respects a person who turned it off, even where the deployment turns it on', async () => {
    const destination = await skipHomeDestination(
      context({ preference: false, deploymentDefault: true, volumes: VOLUMES })
    );

    expect(destination).toBeNull();
  });

  it('respects a person who turned it on, where the deployment does not', async () => {
    const destination = await skipHomeDestination(
      context({ preference: true, deploymentDefault: false, volumes: VOLUMES })
    );

    expect(destination).toMatchObject({ path: '/browse/Media' });
  });
});

describe('when something will not answer', () => {
  it('shows the home page when the flags cannot be read', async () => {
    const ctx = context({ deploymentDefault: false, failing: { features: true } });

    expect(await skipHomeDestination(ctx)).toBeNull();
  });

  it('shows the home page when the volumes cannot be listed', async () => {
    const ctx = context({ deploymentDefault: true, failing: { volumes: true } });

    expect(await skipHomeDestination(ctx)).toBeNull();
  });

  it('shows the home page when there are no volumes to jump into', async () => {
    expect(await skipHomeDestination(context({ deploymentDefault: true, volumes: [] }))).toBeNull();
  });

  it('shows the home page when the first volume has no path', async () => {
    const ctx = context({ deploymentDefault: true, volumes: [{ name: 'Broken' }] });

    expect(await skipHomeDestination(ctx)).toBeNull();
  });

  it('shows the home page when the volume list is not a list', async () => {
    const ctx = context({ deploymentDefault: true });
    ctx.getVolumes = vi.fn(async () => ({ volumes: [] }));

    expect(await skipHomeDestination(ctx)).toBeNull();
  });
});
