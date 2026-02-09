import { describe, it, expect, afterEach } from 'vitest';
import { clearModuleCache, overrideEnv } from '../helpers/env-test-utils.js';

const requireFreshConfig = () => {
  clearModuleCache('src/config/env');
  clearModuleCache('src/config/index');
  // eslint-disable-next-line global-require
  return require('../../src/config/index');
};

describe('Editor config', () => {
  let restoreEnv;

  afterEach(() => {
    if (restoreEnv) {
      restoreEnv();
      restoreEnv = null;
    }
  });

  it('defaults EDITOR_MAX_FILESIZE to 2 MiB', () => {
    restoreEnv = overrideEnv({
      EDITOR_MAX_FILESIZE: undefined,
      EDITOR_EXTENSIONS: undefined,
    });

    const config = requireFreshConfig();
    expect(config.editor.maxFileSizeBytes).toBe(2 * 1024 * 1024);
  });

  it('parses EDITOR_MAX_FILESIZE units (base 1024)', () => {
    restoreEnv = overrideEnv({
      EDITOR_MAX_FILESIZE: '3M',
    });

    const config = requireFreshConfig();
    expect(config.editor.maxFileSizeBytes).toBe(3 * 1024 * 1024);
  });

  it('normalizes EDITOR_EXTENSIONS (trim, lowercase, optional leading dot)', () => {
    restoreEnv = overrideEnv({
      EDITOR_EXTENSIONS: ' .Toml, .PROTO ,graphql  ',
    });

    const config = requireFreshConfig();
    expect(config.editor.extensions).toEqual(['toml', 'proto', 'graphql']);
  });
});

