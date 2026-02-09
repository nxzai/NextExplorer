const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../config');
const loggingConfig = require('../config/logging');

let printed = false;

function readRootPackageJson() {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatBool(value) {
  return value ? 'ON' : 'OFF';
}

function compactUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return url;
  }
}

function safeShortCommit(commit) {
  if (!commit || typeof commit !== 'string') return null;
  return commit.trim().slice(0, 8) || null;
}

function asciiLogoLines() {
  return [
    ' _   _           _   ______            _                       ',
    '| \\ | |         | | |  ____|          | |                      ',
    '|  \\| | _____  _| |_| |__  __  ___ __ | | ___  _ __ ___ _ __   ',
    "| . ` |/ _ \\ \\/ / __|  __| \\ \\/ / '_ \\| |/ _ \\| '__/ _ \\ '__|  ",
    '| |\\  |  __/>  <| |_| |____ >  <| |_) | | (_) | | |  __/ |     ',
    '\\_| \\_/\\___/_/\\_\\\\__|______/_/\\_\\ .__/|_|\\___/|_|  \\___|_|     ',
    '                                | |                            ',
    '                                |_|                            ',
  ];
}

function buildBannerText({ listenHost, listenPort }) {
  const pkg = readRootPackageJson();
  const version = pkg?.version || null;
  const name = pkg?.name || 'next-explorer';
  const commit = safeShortCommit(process.env.GIT_COMMIT);
  const branch = process.env.GIT_BRANCH || null;

  const publicUrl = config?.public?.url || null;
  const publicOrigin = config?.public?.origin || compactUrl(publicUrl);
  const uiUrl = publicUrl || (listenPort ? `http://localhost:${listenPort}` : null);
  const apiUrl = uiUrl ? `${uiUrl.replace(/\/$/, '')}/api` : null;

  const onlyOfficeUrl = compactUrl(config?.onlyoffice?.serverUrl);
  const collaboraUrl = compactUrl(config?.collabora?.url);

  const authEnabled = config?.auth?.enabled !== false;
  const authMode = config?.auth?.mode || 'both';
  const oidcEnabled = Boolean(config?.auth?.oidc?.enabled);
  const oidcIssuer = config?.auth?.oidc?.issuer || null;

  const sharesEnabled = config?.shares?.enabled !== false;

  const lines = [];
  const hr = '='.repeat(60);

  lines.push(hr);
  lines.push(...asciiLogoLines());
  lines.push('');

  const titleParts = [];
  titleParts.push('NextExplorer');
  if (version) titleParts.push(`v${version}`);
  if (commit) titleParts.push(`(${commit}${branch ? `:${branch}` : ''})`);
  lines.push(` ${titleParts.join(' ')}`);

  lines.push('-'.repeat(60));
  lines.push(` Time:        ${new Date().toISOString()}`);
  lines.push(` Node:        ${process.version}`);
  lines.push(` Host:        ${os.hostname()}`);
  lines.push(` Env:         ${process.env.NODE_ENV || 'development'}`);
  lines.push(` Log Level:   ${loggingConfig.level}`);
  lines.push(` Listen:      ${listenHost}:${listenPort}`);
  if (publicOrigin) lines.push(` Public URL:  ${publicOrigin}`);
  if (uiUrl) lines.push(` Web UI:      ${uiUrl}`);
  if (apiUrl) lines.push(` API Base:    ${apiUrl}`);
  lines.push(' Health:      /healthz');
  lines.push(' Features:    /api/features');
  lines.push(` Config Dir:  ${config?.directories?.config || '/config'}`);
  lines.push(` Cache Dir:   ${config?.directories?.cache || '/cache'}`);
  lines.push(` Volume Root: ${config?.directories?.volume || '/mnt'}`);
  lines.push(
    ` Auth:        ${formatBool(authEnabled)} (mode=${authMode})  OIDC: ${formatBool(
      oidcEnabled
    )}${oidcIssuer ? ` (issuer=${oidcIssuer})` : ''}`
  );
  lines.push(` Shares:      ${formatBool(sharesEnabled)}`);
  if (onlyOfficeUrl || collaboraUrl) {
    lines.push(
      ` Editors:     ${onlyOfficeUrl ? `OnlyOffice=${onlyOfficeUrl}` : ''}${
        onlyOfficeUrl && collaboraUrl ? '  ' : ''
      }${collaboraUrl ? `Collabora=${collaboraUrl}` : ''}`.trimEnd()
    );
  }
  lines.push(hr);
  lines.push('');

  return { lines, meta: { name, version, commit, branch } };
}

function printStartupBanner({ listenHost, listenPort } = {}) {
  if (printed) return;
  printed = true;

  const host = listenHost || '0.0.0.0';
  const port = listenPort || config?.port || process.env.PORT || 3000;
  const { lines } = buildBannerText({ listenHost: host, listenPort: port });

  // Use stdout directly so the banner stays readable even when structured JSON logging is enabled.
  process.stdout.write(lines.join('\n'));
}

module.exports = {
  printStartupBanner,
};
