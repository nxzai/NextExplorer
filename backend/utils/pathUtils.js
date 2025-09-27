const path = require('path');
const { directories } = require('../config/index');
const { pathExists } = require('./fsUtils');

const normalizeRelativePath = (relativePath = '') => {
  if (!relativePath || relativePath === '/') {
    return '';
  }

  const normalized = path
    .normalize(relativePath.replace(/\\/g, '/'))
    .replace(/^[\\/]+/, '');

  if (normalized === '.') {
    return '';
  }

  if (normalized === '..' || normalized.startsWith('..' + path.sep)) {
    throw new Error('Invalid path. Traversal outside the volume root is not allowed.');
  }

  return normalized;
};

const resolveVolumePath = (relativePath = '') => {
  const safeRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(directories.volume, safeRelativePath);

  if (absolutePath !== directories.volume && !absolutePath.startsWith(directories.volumeWithSep)) {
    throw new Error('Resolved path is outside the configured volume root.');
  }

  return absolutePath;
};

const combineRelativePath = (parent = '', name = '') => {
  const normalizedParent = normalizeRelativePath(parent);
  const combined = path.posix.join(normalizedParent, name);
  return normalizeRelativePath(combined);
};

const splitName = (name) => {
  const extension = path.extname(name);
  const base = extension ? name.slice(0, -extension.length) : name;
  return { base, extension };
};

const findAvailableName = async (directory, desiredName) => {
  let candidate = desiredName;
  let counter = 1;

  while (await pathExists(path.join(directory, candidate))) {
    const { base, extension } = splitName(desiredName);
    candidate = `${base} (${counter})${extension}`;
    counter += 1;
  }

  return candidate;
};

const resolveItemPaths = (item = {}) => {
  if (!item || typeof item.name !== 'string') {
    throw new Error('Each item must include a name.');
  }

  const parentPath = item.path || '';
  const relativePath = combineRelativePath(parentPath, item.name);
  const absolutePath = resolveVolumePath(relativePath);

  return { relativePath, absolutePath };
};

module.exports = {
  normalizeRelativePath,
  resolveVolumePath,
  combineRelativePath,
  splitName,
  findAvailableName,
  resolveItemPaths,
};
