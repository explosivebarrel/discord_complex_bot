# Deploying to a server

The full chain on a VPS:

```
internet ──> system nginx (443, certbot TLS, bot.domain)
                └──> 127.0.0.1:8101 gateway container
                        └──> web (SPA + /api proxy) ──> app
                                                    └──> lavalink
```

No compose service publishes a public port — the `gateway` container is the
only front door, and even it binds **loopback**. The port is per-server:
`GATEWAY_EXPOSED_PORT` in `.env` (default 8080; this project's own server
numbers self-hosted gateways from 8101 — check occupancy with `ss -tlnp`).

## Requirements

- A Linux VPS, 4 GB RAM recommended (Lavalink ~1 GB, app + vk-resolver ~1 GB)
  — see the hosting notes in this repo's history; RU-network caveats in
  [FAQ.md](FAQ.md).
- Docker + Compose.
- A DNS record for `bot.domain` pointing at the server (A record, **grey
  cloud** if you use Cloudflare — see FAQ "redirect loop").

## Bring-up

```bash
git clone <repo> /opt/discord_complex_bot && cd /opt/discord_complex_bot
cp .env.example .env            # fill it: tokens, secrets, superadmin ids
# put your state in data/: bot.db (or let the app create an empty one),
# data/music/*, data/vk_session.json
docker compose up -d --build
docker compose run --rm app alembic upgrade head   # only for an empty/new db
```

Set in `.env`:

```
BASE_URL=https://bot.domain
DISCORD_REDIRECT_URI=https://bot.domain/api/auth/callback
GATEWAY_EXPOSED_PORT=8101
```

(the redirect URI must match the one registered in the Discord Developer
Portal), then `docker compose up -d --no-deps --build app`.

## System nginx + TLS

`/etc/nginx/sites-available/bot.domain.conf` — first iteration is
HTTP-only (the TLS lines come from certbot):

```nginx
server {
    listen 80;
    server_name bot.domain;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}
```

```bash
ln -sf /etc/nginx/sites-available/bot.domain.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d bot.domain      # issues the cert and rewrites the file
```

After certbot, make sure the 443 block contains (certbot keeps locations,
adds the ssl lines):

```nginx
client_max_body_size 64m;            # local-library uploads

location / {
    proxy_pass http://127.0.0.1:8101;   # = GATEWAY_EXPOSED_PORT
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";      # player websocket
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 3600s;                    # long-lived websocket
    proxy_send_timeout 3600s;
}
```

The upgrade headers are mandatory — the panel's live queue rides a
websocket through this whole chain.

## Verify

```bash
curl -s https://bot.domain/api/health   # {"status":"ok", ...}
docker logs dcbot-app --tail 20         # "Bot ready as Council Bot ..."
```

Open `https://bot.domain` — the panel live dock should tick.

## Moving state between machines

All bot state is in two places: `data/` (music, vk session) and the
database. On the server the DB is a **plain file** `data/bot.db` (bind
mount); on the dev machine (Windows) it lives in the named volume
`bot-data` — SQLite over a Windows bind mount breaks locking. Extract it:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v discord_complex_bot_bot-data:/data:ro \
  -v "$PWD:/backup" alpine cp /data/bot.db /backup/bot.db
```

Move `data/` + the DB together, stop the source app first, and never run
two bots with one Discord token — they fight over the gateway session.

## YouTube on a RU-located server

The Lavalink youtube-source plugin is gated by a reachability supervisor
(`lavalink/supervise.sh`): every 5 minutes it probes youtube.com and starts
Lavalink with the plugin only when the probe passes (the plugin crashes the
node otherwise). From a RU datacenter IP the probe often fails for real —
the monitor will honestly show YouTube `down`. `bol-van/zapret` on the host
fixes the outbound DPI blocks; once youtube.com is reachable, the supervisor
flips the verdict itself within one interval. Do not force-enable the
plugin — with YouTube unreachable it crashes Lavalink at boot.
