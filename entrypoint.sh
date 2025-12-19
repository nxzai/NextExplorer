#!/bin/bash
set -e

# Provide sensible defaults to avoid surprises on first run.
PUID=${PUID:-1000}
PGID=${PGID:-1000}

CONFIG_DIR=${CONFIG_DIR:-/config}
CACHE_DIR=${CACHE_DIR:-/cache}

ensure_dir() {
  mkdir -p "$1"
}

# Ensure the base appuser exists before attempting modifications.
if ! id appuser >/dev/null 2>&1; then
  echo "ERROR: Expected user 'appuser' to be present in the image."
  exit 1
fi

CURRENT_UID=$(id -u appuser)
CURRENT_GID=$(id -g appuser)

# Update user/group IDs only when they differ from the requested values.
if [ "$CURRENT_UID" != "$PUID" ] || [ "$CURRENT_GID" != "$PGID" ]; then
  echo "INFO: Updating appuser UID:GID from ${CURRENT_UID}:${CURRENT_GID} to ${PUID}:${PGID}"
  groupmod -o -g "$PGID" appuser
  usermod -o -u "$PUID" appuser
fi

# Guarantee every host-facing directory exists before touching it.
ensure_dir "/app"
ensure_dir "$CONFIG_DIR"
ensure_dir "$CACHE_DIR"
ensure_dir "${CACHE_DIR}/thumbnails"
ensure_dir "${CONFIG_DIR}/extensions"
ensure_dir "${CONFIG_DIR}/extensions/icons"
ensure_dir "${CONFIG_DIR}/extensions/brand"

# Fix ownership on key directories that map to host volumes.
for path in "$CONFIG_DIR" "$CACHE_DIR"; do
  if [ -e "$path" ]; then
    chown -R appuser:appuser "$path"
  fi
done

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

DEMO_MODE="${DEMO_MODE:-false}"
SAMPLE_URL="${SAMPLE_URL:-https://github.com/vikramsoni2/nextExplorer/releases/download/v2.0.0/samples.zip}"
SAMPLES_DIR="${SAMPLES_DIR:-/tmp/Samples}"
SAMPLES_MOUNT="${SAMPLES_MOUNT:-/mnt/Samples}"

if is_true "$DEMO_MODE"; then
  echo "INFO: DEMO_MODE enabled; seeding demo samples into ${SAMPLES_DIR} and exposing as ${SAMPLES_MOUNT} (read-only)"

  mkdir -p "$SAMPLES_DIR" "$SAMPLES_MOUNT"

  if command -v npm >/dev/null 2>&1; then
    SAMPLE_URL="$SAMPLE_URL" SAMPLES_DIR="$SAMPLES_DIR" npm run --silent download_samples
  else
    SAMPLE_URL="$SAMPLE_URL" SAMPLES_DIR="$SAMPLES_DIR" node /app/src/scripts/downloadSamples.js
  fi

  if command -v mountpoint >/dev/null 2>&1 && mountpoint -q "$SAMPLES_MOUNT"; then
    echo "INFO: ${SAMPLES_MOUNT} is already a mountpoint; skipping bind mount"
  else
    if mount --bind "$SAMPLES_DIR" "$SAMPLES_MOUNT" 2>/dev/null; then
      mount -o remount,bind,ro "$SAMPLES_MOUNT"
    else
      echo "WARN: Unable to bind-mount ${SAMPLES_DIR} to ${SAMPLES_MOUNT} (missing CAP_SYS_ADMIN?); falling back to symlink"
      rm -rf "$SAMPLES_MOUNT"
      ln -s "$SAMPLES_DIR" "$SAMPLES_MOUNT"
    fi
  fi
fi

echo "INFO: Launching process as appuser (${PUID}:${PGID})"
exec gosu appuser "$@"
