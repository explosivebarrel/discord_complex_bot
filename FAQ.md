# Known issues & FAQ

Real-world problems hit during development/operation, with causes and fixes.
If something is missing here — check `docker logs dcbot-app` first; most
failures self-report into the panel's notification feed too.

## Panel / web

### ERR_TOO_MANY_REDIRECTS on the panel domain

**Cause:** Cloudflare proxying the record in **Flexible** SSL mode (or a
catch-all nginx server block answering the domain). The https request is
redirected to https again, forever.

**Fix:** switch the DNS record to **DNS only** (grey cloud) and let certbot
issue TLS on the server directly — this also bypasses the RU ECH
blockings of Cloudflare edge. If you want Cloudflare proxying anyway, set
SSL/TLS mode to **Full (strict)** and disable ECH for the zone.

### 502 on /api/* but static files load fine

**Cause:** the `app` container is down/crash-looping (502 from the gateway)
or nginx cached a dead container IP.

**Fix:** `docker compose ps`, `docker logs dcbot-app --tail 30` — and the
proxy hop already uses `resolver ... valid=10s` with a variable upstream,
so a plain `docker compose restart web` covers the cache case.

### Live dock / queue stops updating

The panel rides a websocket (`/api/guilds/{id}/player/ws`) through the
whole chain. A stale dock means the upgrade headers were dropped somewhere:
every hop (system nginx, gateway, web) needs
`proxy_set_header Upgrade/Connection` + `proxy_read_timeout`. The configs
in this repo and DEPLOY.md have them.

### Playback controls disappeared from the panel

That is the player-permission system, not a bug: the server owner can gate
volume / effects / queue-clear / seek per server (Manage → Player). The UI
hides what you cannot use; routes answer 403 as a backstop. Ask the owner
or use an owner/super-admin account.

### "Skip vote: 1/2" instead of skipping

Vote-skip is enabled and there are 2+ humans in the voice channel: a skip
fires only when half the channel agrees (bots excluded). Alone in the
channel? Then it skips instantly even with the toggle on. A second skip
reaches the threshold. If it errors — see the changelog (v3.05 fixed a 500
in the threshold math).

## Playback

### A track plays at x2 speed / "chipmunk"

VK hands out HE-AAC variants; lavaplayer decodes raw HE-AAC at half sample
rate. The pipeline prefers mp3 (userscript v1.1.20+, VK sidecar picks mp3
from `audio_streams`), so this should be rare — if it happens, the play
telemetry logs `HE-AAC stream — x2-speed risk`; report the track. Also
check the dock effects menu: a forgotten **x1.5 speed / nightcore** preset
persists across tracks and looks exactly like this bug.

### "Track ended early" / "Track skipped" notifications

The source stream died mid-play (expired signed CDN link, provider reset).
The bot detects a premature end (wall-clock vs track length), reports it
into the bell feed and moves on. Frequent occurrences point at the source
provider, not the bot.

### "Playback re-synced" notifications

Lavalink restarted (node update, supervisor verdict flip) and the bot
re-registered players and resumed playback. Informatio­nal.

### YouTube shows "down" on the availability monitor

On a RU-located server this is usually **real**: youtube.com is unreachable
from datacenter ranges, and the youtube-source plugin is deliberately
gated by a supervisor so it cannot crash the node. `bol-van/zapret` on the
host (blockcheck-found strategy → `/opt/zapret/config`) fixes the
outbound reachability; the supervisor flips the verdict itself within 5
minutes. See DEPLOY.md → "YouTube on a RU-located server".

### "VK: not configured" in the monitor

No VK Music token in Settings. The browser sidecar resolves VK tracks
without a token, but the monitor gates the row on token presence.

### Queue/playlist vanished after a redeploy

Two possible causes, both fixed in the current code: the skip-race (two
track-end events advancing the queue twice) and a crashing resolve
dead-locking the queue — both v3.05+. If you migrate machines, remember
the DB lives in `./data/bot.db` on the server (bind mount) but in the
named volume `bot-data` on the dev machine — `docker compose down` the
source first and copy the *volume*, not the stale `data/bot.db` artifact.

## Discord

### "Council Bot didn't respond in time" under the now-playing message

Fixed (v3.05): the buttons acknowledge immediately and do the work after.
If you still run an older build — update.

### The /nowplaying message doesn't update on track change

`/nowplaying` adopts its own message as the **live** card since v3.05 —
following tracks edit it in place, and the announcements channel moves with
it. Older builds kept it as a one-shot snapshot.

### The bot is silent after a server restart

It rejoins its voice channels and resumes queues automatically
(`rejoin_voice` on_ready). If it did not — check `docker logs dcbot-app |
grep -i rejoin` and that the default voice channel still exists. One
Discord token = one running bot: two instances with the same token fight
over the gateway (stop the old one before starting the new one).

## Fonts / icons

### Icons render as raw text ("play_circle" instead of an icon)

The icon font subset lost its ligatures — a local pyftsubset rebuild
silently drops the rlig lookups. Never subset locally: use
`.zcode/tmp/build_font_subset.py` (it collects names from every string
literal in `web/src`, downloads a ready subset from Google Fonts and
verifies ligature coverage), then bump `?v=N` in `web/src/main.tsx` — the
font URL is served immutable for a year.
