# Server deployment: system nginx -> gateway -> containers

The deployment chain on the VPS mirrors the memle55 convention:

```
internet ──> system nginx (443, certbot TLS, bot.domain)
                └──> 127.0.0.1:8080 gateway container
                        └──> web (SPA + /api proxy) ──> app
```

No compose service publishes a public port: `web`, `app`, `lavalink` and
`vk-resolver` live on the compose network only; the gateway publishes
**127.0.0.1:8080** (loopback, so only the system nginx reaches it).

## 1. System nginx site

`/etc/nginx/sites-available/bot.domain.conf` (replace the domain):

```nginx
# The gateway hop upgrades player-state websockets: the connection
# upgrade mapping must live at http level (conf.d includes are http).
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name bot.domain;

    # ACME challenges before anything else.
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name bot.domain;

    # certbot fills these in (see below); keep the lines for the first run.
    # ssl_certificate     /etc/letsencrypt/live/bot.domain/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/bot.domain/privkey.pem;

    # Local-library uploads ride through here (MAX_UPLOAD_MB=50).
    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        # Long-lived player websocket.
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Enable and reload:

```bash
ln -s /etc/nginx/sites-available/bot.domain.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## 2. TLS certificate

```bash
sudo apt install certbot python3-certbot-nginx   # if not installed yet
sudo certbot --nginx -d bot.domain               # edits the server block in place
```

(On a server without certbot's nginx plugin: issue with
`certbot certonly --webroot -w /var/www/html -d bot.domain`, then paste the
two `ssl_certificate` lines above manually.)

## 3. Bring the stack up

```bash
cd /opt/dcbot && git pull
docker compose up -d --build
docker compose run --rm app alembic upgrade head   # idempotent
```

Then set in `.env` (the OAuth callback must match exactly):

```
BASE_URL=https://bot.domain
DISCORD_REDIRECT_URI=https://bot.domain/api/auth/callback
```

and `docker compose up -d --no-deps --build app` to apply. If the redirect
URI changed, also update it in the Discord Developer Portal.

## 4. Check

```bash
curl -s https://bot.domain/api/health
```

and open the panel: player websocket (queue live updates) rides the same
chain, so if the dock goes stale, the upgrade headers above are the place
to look.

## Local development

`docker-compose.override.yml` (git-ignored) restores the convenience ports
on the dev machine: web on :8000, lavalink on :2333, vk-resolver on
127.0.0.1:8100. The server never sees them.
