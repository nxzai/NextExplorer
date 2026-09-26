# FAQ

## What do I need before installing?

- Docker Engine 24+ and Docker Compose v2.
- Host folders to mount under `/mnt`, persistent storage for `/config` (back it up), and for `/cache` (no backup needed, but it holds the search index and folder sizes).
- Optional environment variables for your preferred authentication, reverse proxy, and feature toggles; see the [Environment Reference](../configuration/environment) for the full list.

## How do I unlock the workspace after first setup?

The Setup screen creates the first admin (unless you bootstrap one via `AUTH_ADMIN_EMAIL`/`AUTH_ADMIN_PASSWORD`). Once the workspace password is set, use that login to add local users or configure OIDC. Admin-only settings live under Settings → Admin.

## Where do I troubleshoot deployment issues?

Check the [Troubleshooting](./troubleshooting) page for proxy/CORS tips, session secret advice, volume permissions, and thumbnail/search behavior.

## How can I keep my deployment updated?

The app stores persistent state in the `/config` bind mount. Back up `/config` — `app.db`, with its `app.db-wal` or with the container stopped, `logos/` and `session-secret` — before updating. Run `docker compose pull` and `docker compose up -d` to refresh the image, then verify volumes and settings in the UI.

## Who handles metadata and search indexing?

Thumbnails, RAW previews, sessions and `index.db` — the search index and folder sizes — live in `/cache`. You can clear or recreate this mount without losing settings; everyone is signed out and the indexes are rebuilt. If thumbnails aren't appearing, ensure FFmpeg/ffprobe are available (provided in the official image) and `FFMPEG_PATH`/`FFPROBE_PATH` point to valid binaries.

## How do I add support for custom file types in the editor?

The inline editor supports 50+ file types by default (txt, md, json, js, ts, py, yml, html, css, and many more). To add support for additional file extensions at runtime, set the `EDITOR_EXTENSIONS` environment variable with a comma-separated list:

```yaml
environment:
  - EDITOR_EXTENSIONS=toml,proto,graphql,dockerfile,makefile
```

Custom extensions are **added to** the default list (they don't replace it), and changes take effect on container restart—no frontend rebuild required.

If you need to edit larger files in the inline editor, set `EDITOR_MAX_FILESIZE` (defaults to `2M`):

```yaml
environment:
  - EDITOR_MAX_FILESIZE=10M
```

That is the only setting to change. Saving sends the file back through a JSON
request body, so `MAX_JSON_BODY_SIZE` has to stay above what the editor opens —
it rises on its own to carry it, and says so in the log.

The exception is where you have set `MAX_JSON_BODY_SIZE` yourself. A ceiling
you chose is never raised behind your back: the editor is lowered to what that
ceiling can carry instead, with a warning naming both values. If you want to
edit large files _and_ keep a body ceiling, set the ceiling to a little over
twice the file size you want to open.

See the [Environment Reference](../configuration/environment#editor) for details.

## The editor says my text file is binary

It used to say that about any file written in UTF-16, which is most text
produced on Windows: PowerShell's `Out-File` wrote UTF-16LE by default until
PowerShell 6, and Notepad still offers it as "Unicode". In UTF-16 every ASCII
character is stored with a zero byte beside it, and a zero byte is what the
binary test looks for.

Files are now read in whatever they are written in — UTF-8, UTF-16LE or
UTF-16BE, with or without a byte-order mark — and saved back in the same
encoding, so a file a script reads with a fixed encoding keeps working.

If a file you believe is text is still refused, check what it actually starts
with:

```bash
head -c 16 /path/to/file.txt | xxd
```

`ef bb bf` is UTF-8 with a mark, `ff fe` is UTF-16LE, `fe ff` is UTF-16BE.
Anything else with zero bytes early in the file really is binary.
