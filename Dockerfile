# ---------------------------------------------------------------------------
# Base: Alpine with Node.js
# ---------------------------------------------------------------------------
FROM node:24.21-alpine3.24 AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# Stage 1: Backend production dependencies
#
# Native modules (node-pty, better-sqlite3) need compilation on Alpine musl.
# Build tools are installed here and NOT carried into the final image.
# ---------------------------------------------------------------------------
FROM base AS backend_deps
ENV NODE_ENV=production
WORKDIR /app

# Build toolchain for native modules — only lives in this stage.
RUN apk add --no-cache python3 make g++ linux-headers

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY docs/package.json docs/package.json
RUN npm ci --omit=dev --workspace backend && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2: Frontend build (dev dependencies, discarded after build)
# ---------------------------------------------------------------------------
FROM base AS frontend_build
ENV NODE_ENV=development
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY docs/package.json docs/package.json
RUN npm ci --workspace frontend
COPY frontend/ ./frontend/
RUN npm run -w frontend build -- --sourcemap false

# ---------------------------------------------------------------------------
# Stage 3: Final runtime image — no compilers, no build tools
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# Create the baseline app user; UID/GID may be mutated at runtime via entrypoint.sh.
# Alpine uses busybox addgroup/adduser instead of Debian's groupadd/useradd.
RUN addgroup -S appuser && \
    adduser -S -G appuser -s /bin/bash appuser

# Runtime packages only.
#
# Core (always installed):
#   ffmpeg          – video thumbnail extraction & software transcoding
#   gosu            – UID/GID remapping in entrypoint
#   ripgrep         – fast file-content search
#   imagemagick     – HEIC → PNG thumbnail conversion
#   openssh-client  – optional SSH remote access (terminal only)
#   unzip           – demo mode sample extraction (downloadSamples.js)
#   bash            – entrypoint.sh is a bash script
#   shadow          – provides usermod/groupmod for UID/GID remapping
#   curl            – For terminal users
#
# Optional (see INCLUDE_RAW / INCLUDE_VAAPI build args below):
#   perl            – required by exiftool-vendored for RAW image previews
#   libva           – core VA-API runtime (includes libva-drm)
#   mesa-va-gallium – Mesa VA-API GPU drivers (pulls Mesa + LLVM, ~80 MB)


# Optional feature stacks — toggled at build time. Defaults keep the FULL image
# byte-for-byte identical to before.
#   INCLUDE_RAW=false    drops perl + the exiftool-vendored node module: removes
#                        RAW-photo previews only (normal EXIF still works via exifr).
#   INCLUDE_VAAPI=false  drops libva + mesa-va-gallium (Mesa + LLVM, ~80 MB): ffmpeg
#                        still decodes video in software. VA-API is opt-in anyway,
#                        used only when FFMPEG_HWACCEL is set with a GPU passed in.
ARG INCLUDE_RAW=true
ARG INCLUDE_VAAPI=true

RUN apk add --no-cache \
      ffmpeg \
      gosu \
      ripgrep \
      rsync \
      p7zip \
      poppler-utils \
      imagemagick \
      openssh-client \
      unzip \
      bash \
      shadow \
      curl \
  && if [ "$INCLUDE_RAW" = "true" ]; then apk add --no-cache perl; fi \
  && if [ "$INCLUDE_VAAPI" = "true" ]; then apk add --no-cache libva mesa-va-gallium; fi \
  && rm -rf /tmp/* /var/cache/apk/*

WORKDIR /app

# Make git metadata available at runtime for backend /api/features endpoint.
ARG GIT_COMMIT=""
ARG GIT_BRANCH=""
ARG REPO_URL=""
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV REPO_URL=${REPO_URL}

# Bring in backend production node_modules (pre-compiled for Alpine musl).
# Build tools from backend_deps stage are NOT included — only the output.
COPY --from=backend_deps /app/node_modules ./node_modules
COPY --from=backend_deps /app/package.json ./

# When RAW support is disabled, drop the vendored ExifTool (~20 MB) from the
# runtime node_modules. rawPreviewService.js already degrades gracefully when the
# module is absent (the require is wrapped in try/catch).
RUN if [ "$INCLUDE_RAW" != "true" ]; then \
      rm -rf node_modules/exiftool-vendored node_modules/exiftool-vendored.pl; \
    fi

# Copy backend source and healthcheck.
COPY backend/src ./src
COPY docker/healthcheck.js ./healthcheck.js

# Copy built frontend assets.
RUN mkdir -p src/public
COPY --from=frontend_build /app/frontend/dist/ ./src/public/

# Ensure the runtime user can read/traverse the app source tree
# (host checkouts may have restrictive umasks like 077).
RUN chmod -R a+rX /app/src

# Bootstrap entrypoint script responsible for dynamic user mapping.
COPY docker/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/config", "/cache"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD [ "node", "healthcheck.js" ]

EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "src/server.js"]
