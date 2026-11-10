# Server migration: what was done and why

Moving the bot from the dev machine (Windows, Docker Desktop) to the VPS
and the decisions made along the way.

## 1. Where the state lives (and why)

| State | Storage | Why |
| --- | --- | --- |
| `bot.db` (settings, playlists, history, caches) | Server: **bind mount `./data/bot.db` → `/data/bot.db`**; dev (Windows): **named volume `bot-data`** | A plain file on the server disk: visible, backed up with the disk. On Windows dev the volume is deliberate — SQLite over an NTFS bind mount breaks locking and perf |
| Local music | bind `./data/music` | Plain files, user-managed |
| VK browser session | bind `./data/vk_session.json` + named volume `vk-profile` | The sidecar's logged-in VK session |
| `.env` (tokens, secrets) | bind `./.env` | The panel edits it at runtime; Lavalink reads it on recreate |

Gotcha that bit us during migration: `data/bot.db` on the dev disk was a
stale October artifact — the live DB always lived in the `bot-data` volume
(since the first skeleton, "Keep the SQLite file on the named volume" in
docker-compose.yml). The real DB is extracted with:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v discord_complex_bot_bot-data:/data:ro \
  -v "C:\Users\BlackX\AppData\Local\Temp\dbexport:/backup" alpine cp /data/bot.db /backup/bot.db
```

(MSYS_NO_PATHCONV matters on Git Bash — otherwise the container paths get
mangled into `C:/Program Files/Git/...`.)

## 2. Migration steps (dev → server)

1. Copy the extracted `bot.db` into `/opt/discord_complex_bot/data/` on the
   server (any file channel; scp from the dev machine is rejected — the
   server's sshd does not know the dev keys).
2. `git pull && docker compose up -d --build` — with
   `GATEWAY_EXPOSED_PORT=8101` in `.env` (the server convention numbers its
   own gateways from 8101; check occupancy with `ss -tlnp`).
3. Copy `data/music` and `data/vk_session.json` (the sidecar reuses the
   VK login without re-auth).
4. System nginx site for `bot.domain` → `127.0.0.1:8101` (see
   [deploy-host-nginx.md](deploy-host-nginx.md)), then
   `certbot --nginx -d bot.domain`.
5. `.env` on the server: `BASE_URL=https://bot.domain`,
   `DISCORD_REDIRECT_URI=https://bot.domain/api/auth/callback` (and the same
   URI in the Discord Developer Portal).
6. First boot note: if the DB is copied while the app is down, `alembic
   upgrade head` is only needed when the copy predates the latest
   migration; a healthy `Bot ready` in the logs means it is fine.

## 3. Known-good verification

```bash
curl -s https://bot.domain/api/health        # {"status":"ok", ...}
docker logs dcbot-app --tail 20              # Bot ready as Council Bot ...
docker logs dcbot-lavalink | grep supervise  # youtube reachable=...
```

## 4. YouTube "down" on a RU-located server — expected behavior

The availability monitor reports YouTube DOWN when either youtube.com is
unreachable from the server or the Lavalink youtube-source plugin is not
enabled. The plugin is **gated by design** (lavalink/supervise.sh): the
supervisor probes youtube.com every 5 minutes and starts Lavalink with the
plugin enabled only when the probe passes — the plugin crashes the whole
Lavalink at boot when YouTube is unreachable, so this keeps the node alive.

On a Moscow VPS the probe commonly fails for real (RKN throttling of
YouTube from datacenter ranges), so the monitor is telling the truth, not
lying. Fix options, in order of preference:

1. **zapret on the host** (bol-van/zapret, systemd service) — the same
   outbound-DPI bypass discussed for the Discord gateway. Once youtube.com
   is reachable, the supervisor flips the verdict itself within one check
   interval (5 min) and the plugin comes up without any config changes.
   One zapret instance covers Discord voice and YouTube at once.
2. **EU-located server** — removes the whole class of problems (see the
   hosting discussion).
3. Do **not** force-enable the plugin (PROBE_URL tricks): with YouTube
   genuinely unreachable the plugin crashes Lavalink at boot — the gate
   exists exactly to prevent that.

"VK: not configured" is normal without a VK Music token in Settings; the
browser-sidecar path does not need one, but the monitor gates the row on
token presence.
