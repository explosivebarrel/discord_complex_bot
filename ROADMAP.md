# Roadmap

Planned work, ordered by priority. Each item is a separate step; steps 1 and 2
share the same session history mechanism.

## 1. Queue and history (shipped)

- Keep a played-track stack (last ~20) per guild in the music service.
- Add a **Previous** button to the player bar: the current track goes to the
  top of the queue, the last played track resolves again and plays. Stream
  URLs expire, so replay always re-resolves from the stored source.
- Add an **Up next / Recent** view switch to the queue panel. The Recent view
  shows the current track and the last played tracks with the requester name
  and time. A click on a recent track plays it again.
- **Jump to track**: a click on a queued track starts it now. The interrupted
  current track moves to the played stack, the tail of the queue stays in
  place. This reuses the skip mechanism (`jump_to(index)` in the service).
- Add a **Shuffle** button next to Clear: shuffle the rest of the queue.
- The autoplay radio never blocks the queue (a new enqueue replaces it at
  once) and never enters the session history.

## 2. Playlist browser

The queue must not receive a whole playlist as a wall of tracks. A playlist
link opens a preview instead:

- A paginated list (50 tracks per page) with a filter box to search inside
  the playlist.
- Per-track buttons: **Play now** and **Add to queue**.
- Bulk actions: add next 25, add all, shuffle and add.
- The server caches the flat playlist dump for 10-15 minutes and serves pages
  from the cache. `yt-dlp --playlist-items START:END` is the fallback for a
  cache miss.

## 3. Lazy full-playlist playback

For "add all" on a large playlist (1500+ tracks):

- The queue holds a cursor into the playlist source, not 1500 resolved items.
  The first ~100 positions are pending items that resolve just before play
  (the existing deferred `QueueItem` mechanism).
- A background task fetches the next page as the cursor moves.
- The queue shows a collapsed row "Playlist: N tracks left" that expands into
  the same paginated view as the browser.
- Steps 2 and 3 share the playlist-source abstraction and belong to one
  design pass.

## Constraint: one voice channel per bot per guild

Discord gives each member (bots included) one voice state per guild. A single
bot account cannot play in two voice channels of the same guild at the same
time; joining channel B moves it out of channel A. Simultaneous playback in
several channels needs one more bot application (a second token): a second
worker with its own queue and slash commands, with a bot selector in the web
panel. This is a large infrastructure step; start it only when the need is
real.
