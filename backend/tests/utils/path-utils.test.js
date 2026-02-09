import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { setupTestEnv } from '../helpers/env-test-utils.js';

let envContext;
let pathUtils;

beforeAll(async () => {
  envContext = await setupTestEnv({
    tag: 'path-utils-test-',
    modules: ['src/utils/pathUtils'],
  });
  pathUtils = envContext.requireFresh('src/utils/pathUtils');
});

afterAll(async () => {
  await envContext.cleanup();
});

describe('Path Utilities', () => {
  describe('normalizeRelativePath', () => {
    it('should normalize slashes and reject traversal', () => {
      expect(pathUtils.normalizeRelativePath('folder//nested')).toBe('folder/nested');
      expect(pathUtils.normalizeRelativePath('/')).toBe('');
      expect(pathUtils.normalizeRelativePath('')).toBe('');
      expect(pathUtils.normalizeRelativePath('./foo/../bar')).toBe('bar');
      expect(() => pathUtils.normalizeRelativePath('..')).toThrow(/Invalid path/);
    });
  });

  describe('resolveVolumePath', () => {
    it('should protect volume root boundaries', () => {
      const resolved = pathUtils.resolveVolumePath('photo/jpg');
      expect(resolved).toBe(path.resolve(envContext.volumeDir, 'photo/jpg'));
      expect(() => pathUtils.resolveVolumePath('../outside')).toThrow(/outside/);
    });
  });

  describe('combineRelativePath and splitName', () => {
    it('should combine paths correctly', () => {
      expect(pathUtils.combineRelativePath('a//b', 'file.txt')).toBe('a/b/file.txt');
    });

    it('should split names correctly', () => {
      const { base, extension } = pathUtils.splitName('archive.tar.gz');
      expect(base).toBe('archive.tar');
      expect(extension).toBe('.gz');

      const noExt = pathUtils.splitName('README');
      expect(noExt.base).toBe('README');
      expect(noExt.extension).toBe('');
    });
  });

  describe('ensureValidName', () => {
    it('should reject invalid names', () => {
      expect(pathUtils.ensureValidName('Default')).toBe('Default');
      expect(() => pathUtils.ensureValidName('')).toThrow(/Name cannot be empty/);
      expect(() => pathUtils.ensureValidName('bad/name')).toThrow(/path separators/);
      expect(() => pathUtils.ensureValidName('..')).toThrow(/not allowed/);
    });
  });

  describe('findAvailableName and findAvailableFolderName', () => {
    it('should avoid collisions', async () => {
      const filePath = path.join(envContext.volumeDir, 'duplicate.txt');
      await fsPromises.writeFile(filePath, 'data');

      const nextName = await pathUtils.findAvailableName(envContext.volumeDir, 'duplicate.txt');
      expect(nextName).toBe('duplicate (1).txt');

      const firstName = await pathUtils.findAvailableName(envContext.volumeDir, 'new.txt');
      expect(firstName).toBe('new.txt');

      await fsPromises.mkdir(path.join(envContext.volumeDir, 'Untitled Folder'));
      const folderName = await pathUtils.findAvailableFolderName(envContext.volumeDir);
      expect(folderName).toBe('Untitled Folder 2');
    });
  });

  describe('getUserFolderName', () => {
    it('should default to stable id-first ordering', () => {
      const name = pathUtils.getUserFolderName({
        id: '11111111-2222-3333-4444-555555555555',
        username: 'alice',
        email: 'alice@example.com',
      });
      expect(name).toBe('11111111-2222-3333-4444-555555555555');
    });

    it('should respect USER_FOLDER_NAME_ORDER', async () => {
      const customEnv = await setupTestEnv({
        tag: 'path-utils-user-folder-order-',
        modules: ['src/utils/pathUtils'],
        env: {
          USER_FOLDER_NAME_ORDER: 'username,id',
        },
      });

      try {
        const customPathUtils = customEnv.requireFresh('src/utils/pathUtils');

        const fromUsername = customPathUtils.getUserFolderName({
          id: '11111111-2222-3333-4444-555555555555',
          username: 'alice',
          email: 'alice@example.com',
        });
        expect(fromUsername).toBe('alice');

        const fallsBackToId = customPathUtils.getUserFolderName({
          id: '11111111-2222-3333-4444-555555555555',
          username: 'bad/name',
          email: 'alice@example.com',
        });
        expect(fallsBackToId).toBe('11111111-2222-3333-4444-555555555555');
      } finally {
        await customEnv.cleanup();
      }
    });
  });

  describe('resolveItemPaths', () => {
    it('should return normalized relative and absolute paths', async () => {
      const item = { name: 'file.txt', path: 'docs/reports' };
      const resolved = await pathUtils.resolveItemPaths(item);

      expect(resolved.relativePath).toBe('docs/reports/file.txt');
      expect(resolved.absolutePath).toBe(
        path.resolve(envContext.volumeDir, 'docs/reports/file.txt')
      );
    });
  });
});
