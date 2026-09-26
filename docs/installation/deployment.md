# Deployment

Deploy nextExplorer via Docker Compose for reproducible self-hosted workflows. This guide outlines the folders, networking, and procedures you’ll rely on for production-ready setups.

## Prerequisites

- **Docker Engine 24+ and Docker Compose v2** (or later). The official image depends on modern orchestration features.
- **Host directories** for data volumes, `/config`, and `/cache` (make sure the Docker user can read/write these paths). `/cache` can be left out, but it holds the search index and the folder sizes: without a persistent mount, every new container reads the volumes again to rebuild them.
- **TLS-capable reverse proxy** if you need HTTPS, custom domains, or sticky sessions.

## Image variants

Two images are published, on both registries:

| Tag                          | Contains                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `latest`, `3.11.0`           | Everything, including hardware video acceleration (VA-API) and RAW photo support |
| `latest-lean`, `3.11.0-lean` | The same application without VA-API or RAW — a considerably smaller image        |

Take the full image unless you know you need neither: VA-API only helps where the host exposes a render device to the container, and RAW support only matters if you keep camera files. Both variants are built for `linux/amd64` and `linux/arm64`.

```
ghcr.io/cerede2000/explorer:latest
ghcr.io/cerede2000/explorer:latest-lean
```

They are also on Docker Hub under the same tags.

`latest` and `latest-lean` follow `main`, so a fix reaches them without waiting
for a release. Every build is also published under the version in
`package.json` — `3.11.0`, `3.11.0-lean` — republished for as long as that
version is current, and left alone once the next one is cut.

Only the last two versions stay published: on Docker Hub the older one is
removed as the next is published, and on GHCR a weekly job does the same. Pin a
version you intend to keep running and move it forward deliberately rather than
expecting an old tag to still be there.

## Host folder layout

| Purpose                       | Container path                                | Notes                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accounts, shares, settings    | `/config`                                     | Holds `app.db`, `logos/` and `session-secret`. The folder to back up — see [Backups](/admin/guide#backups-persistence).                                                              |
| Thumbnails, sessions, indexes | `/cache`                                      | Regenerable and needs no backup, but mount it persistently: it holds `index.db`, the search index and folder sizes, and deleting it signs everyone out and reads every volume again. |
| Browsable data                | `/mnt/Label`                                  | Each mount appears as a top-level volume with the given label.                                                                                                                       |
| Personal user data (optional) | `/srv/users` (or any path set as `USER_ROOT`) | When `USER_DIR_ENABLED=true`, each authenticated user gets their own private folder inside this root.                                                                                |

## Production compose example

```yaml
services:
  nextexplorer:
    image: ghcr.io/cerede2000/explorer:latest
    container_name: nextexplorer
    restart: unless-stopped
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - PUBLIC_URL=https://files.example.com
      - SESSION_SECRET=please-change-me
      - PUID=1000
      - PGID=1000
      # Enable per-user "My Files" home folders
      - USER_DIR_ENABLED=true
      - USER_ROOT=/srv/nextexplorer/users
    volumes:
      - /srv/nextexplorer/config:/config
      - /srv/nextexplorer/cache:/cache
      - /srv/data/Projects:/mnt/Projects
      - /srv/data/Media:/mnt/Media
      # Personal home folders (one subfolder per user)
      - /srv/nextexplorer/users:/srv/nextexplorer/users
```

- `PUBLIC_URL` informs the backend's cookie settings, CORS, and default OIDC callback (see `backend/src/config/env.js`).
- `SESSION_SECRET` sets the session secret yourself. Without it, one is generated at the first start and kept in `/config/session-secret`, so sessions survive restarts all the same; set it when several replicas share the sessions.
- Optional first-run bootstrap: set `AUTH_ADMIN_EMAIL` and `AUTH_ADMIN_PASSWORD` to auto-create the first local admin on startup (skips the setup wizard).

## Launching and validating

1. Run `docker compose up -d` from the folder containing your Compose file.
2. Visit `http://localhost:3000` (or your `PUBLIC_URL`) and sign in (or, if you didn’t set `AUTH_ADMIN_*`, finish the setup wizard to create the first local admin).
3. Revisit Settings to adjust thumbnails, access control, and users.
4. Confirm each `Label` shows up in the sidebar and that you can browse/upload files.

## Managing updates

```bash
docker compose pull
docker compose up -d
```

- Persistent state (`app.db`, `logos/`, `session-secret`) stays inside `/config`. Back it up before upgrading, with the container stopped or together with `app.db-wal`.
- Installations that started on 1.1.7 or earlier kept `app.db` in `/cache`. Nothing moves it any more: copy it to `/config` by hand before upgrading such an installation; the server warns at start when it finds such a file there. Links named `app.db`, `app-config.json` or `extensions` left in `/cache` by 1.1.8 to 2.0.2 are unused and can be deleted.

## Monitoring & logs

- Use `LOG_LEVEL`, `DEBUG`, and `ENABLE_HTTP_LOGGING` (from `backend/src/config/env.js`) to tune logging verbosity.
- The container writes logs to stdout/stderr; stitch them together with your orchestrator (Docker logs, systemd, etc.).
