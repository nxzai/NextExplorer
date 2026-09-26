# Reverse Proxy & Networking

When exposing nextExplorer on a custom domain, a reverse proxy keeps the UI secure behind TLS while forwarding requests to the container. Use this guide to align `PUBLIC_URL`, trusted proxies, and CORS behavior.

## Key environment variables

| Variable                             | Purpose                                                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                         | External URL (no trailing slash) used to set cookies, determine OIDC callbacks, and drive CORS defaults. Example: `https://files.example.com`.                                                                                            |
| `INTERNAL_URL`                       | Optional comma-separated LAN origins. They are accepted by CORS and can each complete OIDC login without redirecting through `PUBLIC_URL`.                                                                                                |
| `TRUST_PROXY`                        | Controls Express’s trust level; accepts `false`, a number (hops), or lists such as `loopback,uniquelocal`. If unset and `PUBLIC_URL` exists, defaults to `loopback,uniquelocal`. (`backend/config/trustProxy.js` documents this mapping.) |
| `CORS_ORIGIN(S)` / `ALLOWED_ORIGINS` | Explicit CORS origins when they differ from `PUBLIC_URL`. Defaults to the origin of `PUBLIC_URL` when provided.                                                                                                                           |

## HTTPS with a Let's Encrypt certificate

NextExplorer does not terminate TLS itself, and does not read a certificate
from disk. A Let's Encrypt certificate lasts a few months at most and has to be
renewed before it runs out, and a server that reads the file once at start goes
on serving the old one until somebody restarts it. A reverse proxy asks for the
certificate, renews it on time, redirects port 80 to 443 and speaks HTTP/2 —
all of it without the application knowing — so that is the way to serve it over
HTTPS.

Two proxies that do all of this on their own are shown below: Traefik, which
reads its routes from Docker labels, and Caddy, which needs two lines. Both
assume:

- a DNS record for `files.example.com` pointing at the machine;
- ports **80** and **443** reachable from the internet — Let's Encrypt checks
  that you own the name through them, at every renewal;
- `PUBLIC_URL=https://files.example.com` on NextExplorer, which is what makes
  its cookies `Secure` and its links point at the right place.

NextExplorer is not published on a port of its own in either example: the
proxy reaches it over the Compose network, and nothing else should. With
`PUBLIC_URL` set, `TRUST_PROXY` defaults to `loopback,uniquelocal`, which
believes a proxy on a Docker network and nobody on the internet — nothing to
set for the addresses in the [activity log](#the-address-that-gets-recorded)
to be the visitors' own.

### Traefik

```yaml
services:
  traefik:
    image: traefik:v3.7
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entryPoints.web.address=:80
      - --entryPoints.web.http.redirections.entryPoint.to=websecure
      - --entryPoints.web.http.redirections.entryPoint.scheme=https
      - --entryPoints.websecure.address=:443
      # Traefik gives a request 60 seconds to arrive, body included, and then
      # cuts it: a large file sent in one request is refused half-way. 0 is no
      # limit, which is what NextExplorer itself applies (HTTP_TIMEOUT).
      - --entryPoints.websecure.transport.respondingTimeouts.readTimeout=0
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.letsencrypt.acme.email=you@example.com
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./letsencrypt:/letsencrypt
      - /var/run/docker.sock:/var/run/docker.sock:ro

  nextexplorer:
    image: ghcr.io/cerede2000/explorer:latest
    restart: unless-stopped
    environment:
      - PUBLIC_URL=https://files.example.com
    volumes:
      - /srv/nextexplorer/config:/config
      - /srv/nextexplorer/cache:/cache
      - /srv/data/Projects:/mnt/Projects
    labels:
      - traefik.enable=true
      - traefik.http.routers.nextexplorer.rule=Host(`files.example.com`)
      - traefik.http.routers.nextexplorer.entrypoints=websecure
      - traefik.http.routers.nextexplorer.tls.certresolver=letsencrypt
      - traefik.http.services.nextexplorer.loadbalancer.server.port=3000
```

`./letsencrypt/acme.json` holds the account and the certificates; keep it, or
every restart asks Let's Encrypt again and runs into its rate limits. While
trying things out, add
`--certificatesresolvers.letsencrypt.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory`
to use the staging service, whose certificates browsers do not trust but whose
limits are far wider — and remove it, with `acme.json`, once it works.

### Caddy

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
      - '443:443/udp'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

  nextexplorer:
    image: ghcr.io/cerede2000/explorer:latest
    restart: unless-stopped
    environment:
      - PUBLIC_URL=https://files.example.com
    volumes:
      - /srv/nextexplorer/config:/config
      - /srv/nextexplorer/cache:/cache
      - /srv/data/Projects:/mnt/Projects

volumes:
  caddy_data:
  caddy_config:
```

With this `Caddyfile` beside it:

```
{
	email you@example.com
}

files.example.com {
	reverse_proxy nextexplorer:3000
}
```

A site address with a domain name is all Caddy needs to ask Let's Encrypt for
the certificate, renew it and redirect port 80 to 443. `caddy_data` holds the
certificates and must outlive the container, for the same reason as Traefik's
`acme.json`.

### What NextExplorer asks of the proxy, and where each stands

| What                                                         | Traefik                                              | Caddy                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------- |
| Large uploads in one request                                 | cut at 60 s unless `readTimeout` is raised, as above | no limit on reading a body, and no size limit                     |
| Progress of a copy, a move, a deletion — streamed as it goes | sent as it comes                                     | sent as it comes: a response of unknown length is flushed at once |
| The terminal, over a WebSocket at `/api/terminal`            | nothing to set                                       | nothing to set                                                    |
| `X-Forwarded-For`, `-Proto`, `-Host`                         | sent                                                 | sent                                                              |

A proxy that does limit the size of a request — Cloudflare's, at 100 MB on the
free plan — is what chunked uploads are for: turn them on in **Settings →
Uploads**, or let the automatic fallback find a size that passes

To check the result: `https://files.example.com/healthz` answers
`{"status":"ok"}` through the proxy, the browser shows the certificate as
issued by Let's Encrypt, and `http://files.example.com` lands on the `https`
address.

## Sample Nginx Proxy Manager block

- Point `files.example.com` to the container’s internal `3000` port.
- Enable WebSockets and preserve `X-Forwarded-*` headers (usually automatic).
- Terminate TLS at the proxy; nextExplorer marks cookies as `Secure` whenever `PUBLIC_URL` uses `https`.

## Trusted Proxy notes

- Default when `PUBLIC_URL` is set: `loopback,uniquelocal`, which trusts local or private Docker networks without opening up to the public internet.
- Override with values such as `1` (trust one hop) or CIDRs (`10.0.0.0/8,172.16.0.0/12`).
- Avoid `TRUST_PROXY=true` alone; the entrypoint maps it to `loopback,uniquelocal` for safety.

## The address that gets recorded

The activity log, share access counters and the server's own warnings all
write down one address per request, and which one that is depends entirely on
this page.

- **No proxy.** Whoever opened the socket. In a container that is often not the
  person: a connection made from the Docker host itself, or relayed by Docker's
  userland proxy — which is every connection on Docker Desktop — arrives from
  the bridge (`172.17.0.1`, `172.18.0.1`). From another machine on the LAN to a
  published port on Linux, the real address survives. Nothing in the
  application can recover an address the kernel already replaced; that is a
  Docker networking matter, not a setting here.
- **Behind a proxy.** `TRUST_PROXY` decides whether the address the proxy
  announces is believed. `loopback` alone is not enough when the proxy is
  another container: it speaks from the bridge network, so use
  `loopback,uniquelocal` or the proxy's own CIDR.
- **A chain is read from the right**, and stops at the first hop that is not
  trusted — a hop nobody vouches for could have written everything to its left.
  Trust one proxy and three appear in the chain, and what you get is the third
  one, not the person.
- **`CF-Connecting-IP` wins where Cloudflare is in front**, then
  `X-Forwarded-For`, then `X-Real-IP` (nginx's own example configuration sends
  that one and not the first). `True-Client-IP` is read as well.
- **A Cloudflare tunnel only helps when it carries HTTP.** A public hostname
  route goes through Cloudflare's edge, which adds `CF-Connecting-IP`, so the
  person is named. A private network route — reaching the machine through WARP
  by its own address and port — forwards raw TCP: there is no HTTP for a header
  to be added to, the origin sees `cloudflared` itself, and nothing on this
  page recovers an address that never arrived.
- **Never trust a proxy that is not yours.** With `TRUST_PROXY` set, anybody who
  can reach the port directly can choose what the log says about them.

When a proxy announces a client and nothing here believes it, the server says
so once in its own log, naming the address it was told and the one it is
recording instead — the alternative is a log where every line says
`172.18.0.1` and nothing anywhere says why.

To settle it from a browser rather than from the logs, an administrator can
open `/api/activity/address`. It answers with the address that would be
recorded, the machine at the other end of the socket, whether that machine is
believed, the rule in force — which is also how to see that `TRUST_PROXY` never
reached the process — and every forwarding header that arrived. An empty list
of headers is the answer to the hardest version of the question: nobody
announced a client, so there is nothing to believe.

## CORS & headers

- Set `CORS_ORIGINS`/`ALLOWED_ORIGINS` when the app is accessed from multiple domains.
- For a full walkthrough (including `PUBLIC_URL` and origin mismatch behavior), see [Fixing CORS errors](/reference/cors).
- Ensure the proxy forwards `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-For` so the backend derives the correct `PUBLIC_URL` origin and TLS state.

## Networking health checklist

- Proxy has TLS termination and forwards headers. Without headers, session cookies may appear as `Insecure`.
- POST, PUT, DELETE operations work through the proxy; test with uploads and metadata edits.
- If using OIDC with `INTERNAL_URL`, register `${PUBLIC_URL}/callback` and every `<INTERNAL_URL>/callback` with the IdP. The browser returns to the exact configured origin where login started.

## Troubleshooting proxies

| Symptom                                  | Fix                                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORS errors                              | Add the proxy domain to `CORS_ORIGINS` or set `PUBLIC_URL`.                                                                                                                            |
| Sessions drop                            | Confirm `TRUST_PROXY` lets Express read `X-Forwarded-Proto` and `COOKIE` is not stripped.                                                                                              |
| Redirect URI mismatch (OIDC)             | Register `${PUBLIC_URL}/callback` and each configured internal `<origin>/callback` with the IdP.                                                                                       |
| Every logged address is the same `172.x` | The proxy is not trusted, or there is no proxy and Docker replaced the source. Set `TRUST_PROXY=loopback,uniquelocal`; the server warns once when it is ignoring an announced address. |
