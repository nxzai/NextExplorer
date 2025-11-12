const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const readline = require('readline');

const { normalizeRelativePath, resolveVolumePath } = require('../utils/pathUtils');
const { pathExists } = require('../utils/fsUtils');
const { excludedFiles, search: searchConfig } = require('../config/index');
const { getPermissionForPath } = require('../services/accessControlService');
const logger = require('../utils/logger');

const router = express.Router();

// Constants
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build']);
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const CONTENT_FALLBACK_MAX_SIZE = searchConfig?.maxFileSizeBytes > 0 
  ? searchConfig.maxFileSizeBytes 
  : 5 * 1024 * 1024;

// Utilities
const toLimit = (value, def = DEFAULT_LIMIT) => {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0) ? Math.min(n, MAX_LIMIT) : def;
};

const isDirectory = async (p) => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

const hasRipgrep = () => new Promise((resolve) => {
  const child = spawn('rg', ['--version']);
  child.on('error', () => resolve(false));
  child.on('exit', (code) => resolve(code === 0));
});

// Search implementations
const buildRipgrepArgs = () => ['-g', '!.git', '-g', '!node_modules', '-g', '!dist', '-g', '!build'];

const normalizePath = (p, relBasePath) => {
  const normalized = p.replace(/\\/g, '/');
  return relBasePath ? path.posix.join(relBasePath, normalized) : normalized;
};

const shouldIgnore = (name) => IGNORED_DIRS.has(name) || excludedFiles.includes(name);

const extractDirMatches = (fullPath, needle) => {
  const dirs = new Set();
  const dirPath = path.posix.dirname(fullPath);
  
  if (dirPath && dirPath !== '.') {
    const parts = dirPath.split('/');
    let acc = '';
    
    for (const part of parts) {
      if (!part || shouldIgnore(part)) continue;
      acc = acc ? `${acc}/${part}` : part;
      if (part.toLowerCase().includes(needle)) dirs.add(acc);
    }
  }
  
  return dirs;
};

const shouldIncludeResult = async (rel) => {
  const name = path.posix.basename(rel);
  if (excludedFiles.includes(name)) return false;
  if (await getPermissionForPath(rel) === 'hidden') return false;
  return true;
};

const formatResult = (rel, kind, line, lineNumber) => {
  const parent = path.posix.dirname(rel);
  const item = { 
    name: path.posix.basename(rel), 
    path: parent === '.' ? '' : parent, 
    kind 
  };
  
  if (line != null) {
    item.matchLine = line;
    if (Number.isFinite(lineNumber)) item.matchLineNumber = lineNumber;
  }
  
  return item;
};

// OPTIMIZED: Stream results as they come in
async function* generateRipgrepResults(baseAbsPath, relBasePath, term, deep = true) {
  const globArgs = buildRipgrepArgs();
  const needle = term.toLowerCase();
  const seenPaths = new Set();
  const dirSet = new Set();

  // Phase 1 & 2: Stream file list and yield directory/filename matches immediately
  const fileListProcess = spawn('rg', 
    ['--files', '--hidden', '--no-messages', ...globArgs], 
    { cwd: baseAbsPath }
  );

  const rl = readline.createInterface({
    input: fileListProcess.stdout,
    crlfDelay: Infinity
  });

  // Process lines as they arrive
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fullRel = normalizePath(trimmed, relBasePath);
    
    // Extract and yield directory matches immediately
    for (const dirPath of extractDirMatches(fullRel, needle)) {
      if (!dirSet.has(dirPath) && !seenPaths.has(dirPath)) {
        dirSet.add(dirPath);
        seenPaths.add(dirPath);
        if (await shouldIncludeResult(dirPath)) {
          yield formatResult(dirPath, 'dir');
        }
      }
    }

    // Check filename match and yield immediately
    const baseName = path.posix.basename(fullRel).toLowerCase();
    if (baseName.includes(needle) && !seenPaths.has(fullRel)) {
      seenPaths.add(fullRel);
      if (await shouldIncludeResult(fullRel)) {
        yield formatResult(fullRel, 'file');
      }
    }
  }

  // Phase 3: Stream content matches
  if (!deep) return;

  const contentArgs = [
    '-n', '-H', '--no-heading', '--hidden', '--no-messages', 
    '--smart-case', '-F', term, '.', '-m', '1', ...globArgs
  ];
  if (searchConfig?.maxFileSize) {
    contentArgs.unshift('--max-filesize', searchConfig.maxFileSize);
  }

  const contentProcess = spawn('rg', contentArgs, { cwd: baseAbsPath });
  const contentRl = readline.createInterface({
    input: contentProcess.stdout,
    crlfDelay: Infinity
  });

  for await (const line of contentRl) {
    const text = line.trim();
    if (!text) continue;
    
    const [filePath, lineNum, ...rest] = text.split(':');
    if (!lineNum || !rest.length) continue;
    
    const ln = Number(lineNum);
    if (!Number.isFinite(ln)) continue;
    
    const rel = normalizePath(filePath, relBasePath);
    if (seenPaths.has(rel)) continue;
    
    seenPaths.add(rel);
    if (await shouldIncludeResult(rel)) {
      yield formatResult(rel, 'file', rest.join(':'), ln);
    }
  }
}

async function* generateFallbackResults(baseAbsPath, relBasePath, term, deep = true) {
  const seenPaths = new Set();
  const needle = term.toLowerCase();

  // Yield results immediately as we find them
  const walk = async function* (dirAbs, dirRel) {
    const dirents = await fs.readdir(dirAbs, { withFileTypes: true });
    
    for (const d of dirents) {
      if (shouldIgnore(d.name)) continue;
      
      const abs = path.join(dirAbs, d.name);
      const rel = dirRel ? path.posix.join(dirRel, d.name) : d.name;

      if (d.isDirectory()) {
        if (d.name.toLowerCase().includes(needle) && !seenPaths.has(rel)) {
          seenPaths.add(rel);
          if (await shouldIncludeResult(rel)) {
            yield formatResult(rel, 'dir');
          }
        }
        yield* walk(abs, rel);
      } else if (d.isFile()) {
        if (d.name.toLowerCase().includes(needle) && !seenPaths.has(rel)) {
          seenPaths.add(rel);
          if (await shouldIncludeResult(rel)) {
            yield formatResult(rel, 'file');
          }
        } else if (deep && !seenPaths.has(rel)) {
          try {
            const st = await fs.stat(abs);
            if (st.size <= CONTENT_FALLBACK_MAX_SIZE) {
              const content = await fs.readFile(abs, 'utf8');
              const lower = content.toLowerCase();
              const idx = lower.indexOf(needle);
              
              if (idx !== -1) {
                const lineNumber = (content.slice(0, idx).match(/\n/g)?.length ?? 0) + 1;
                const matchedLine = content.split(/\r?\n/)[lineNumber - 1] || '';
                seenPaths.add(rel);
                if (await shouldIncludeResult(rel)) {
                  yield formatResult(rel, 'file', matchedLine, lineNumber);
                }
              }
            }
          } catch {
            // Ignore read/encoding errors
          }
        }
      }
    }
  };

  yield* walk(baseAbsPath, relBasePath);
}

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Search term (q) is required.' });

    const relBase = normalizeRelativePath(req.query.path || '');
    const baseAbs = resolveVolumePath(relBase);

    if (!(await pathExists(baseAbs))) {
      return res.status(404).json({ error: 'Base path not found.' });
    }
    if (!(await isDirectory(baseAbs))) {
      return res.status(400).json({ error: 'Search base path must be a directory.' });
    }

    const limit = toLimit(req.query.limit);
    const ripgrepAllowed = searchConfig?.ripgrep !== false;
    const useRipgrep = ripgrepAllowed && await hasRipgrep();
    const deepEnabled = searchConfig?.deep !== false;

    const generator = useRipgrep 
      ? generateRipgrepResults(baseAbs, relBase, q, deepEnabled)
      : generateFallbackResults(baseAbs, relBase, q, deepEnabled);

    const items = [];
    for await (const item of generator) {
      items.push(item);
      if (items.length >= limit) break; 
    }

    res.json({ items });
  } catch (error) {
    logger.error({ err: error }, 'Search failed');
    res.status(500).json({ error: 'Search failed.' });
  }
});

module.exports = router;