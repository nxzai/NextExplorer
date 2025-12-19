#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");

const DEFAULT_SAMPLE_URL =
  "https://github.com/vikramsoni2/nextExplorer/releases/download/v2.0.0/samples.zip";

function requireEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function emptyDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
}

async function downloadToFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  if (!response.body) throw new Error(`No response body when downloading ${url}`);

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const writable = fs.createWriteStream(filePath);
  await pipeline(Readable.fromWeb(response.body), writable);
}

async function removeMacJunk(rootDir) {
  await fsp.rm(path.join(rootDir, "__MACOSX"), { recursive: true, force: true });

  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let dirents;
    try {
      dirents = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      const fullPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (dirent.name === ".DS_Store" || dirent.name.startsWith("._")) {
        await fsp.rm(fullPath, { force: true });
      }
    }
  }
}

async function chmodReadOnlyRecursive(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) continue;

    if (stat.isDirectory()) {
      await fsp.chmod(current, 0o555);
      let dirents;
      try {
        dirents = await fsp.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        stack.push(path.join(current, dirent.name));
      }
    } else if (stat.isFile()) {
      await fsp.chmod(current, 0o444);
    }
  }
}

async function main() {
  const sampleUrl = requireEnv("SAMPLE_URL", DEFAULT_SAMPLE_URL);
  const samplesDir = requireEnv("SAMPLES_DIR", "/tmp/Samples");
  const tmpDir = process.env.SAMPLES_TMP_DIR || "/tmp/demo-seed";
  const zipPath = process.env.SAMPLES_ZIP_PATH || path.join(tmpDir, "samples.zip");

  console.log(`INFO: Downloading samples from ${sampleUrl}`);
  await emptyDir(tmpDir);
  await emptyDir(samplesDir);

  await downloadToFile(sampleUrl, zipPath);

  console.log(`INFO: Extracting ${zipPath} to ${samplesDir}`);
  const unzip = spawnSync("unzip", ["-q", zipPath, "-d", samplesDir], { stdio: "inherit" });
  if (unzip.error) throw unzip.error;
  if (unzip.status !== 0) throw new Error(`unzip failed with exit code ${unzip.status}`);

  await removeMacJunk(samplesDir);
  await chmodReadOnlyRecursive(samplesDir);

  console.log("INFO: Demo samples ready.");
}

main().catch((err) => {
  console.error("ERROR: downloadSamples failed:", err);
  process.exit(1);
});
