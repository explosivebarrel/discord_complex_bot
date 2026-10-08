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
- **Drag and drop** reordering of queue rows; the arrow buttons stay for
  touch devices.

## 2. Playlist browser (shipped)

The queue must not receive a whole playlist as a wall of tracks. A playlist
link opens a preview instead:

- A paginated list (50 tracks per page) with a filter box to search inside
  the playlist.
- Per-track buttons: **Play now** and **Add to queue**.
- Bulk actions: add page, add all (lazy), shuffle +100.
- The server caches the flat playlist dump for 15 minutes and serves pages
  from the cache. Yandex playlists load through LavaSrc; the config caps the
  request at 100 x `playlistLoadLimit` tracks (set to 3 in application.yml).

## 3. Lazy full-playlist playback (shipped)

For "add all" on a large playlist (1500+ tracks):

- The queue holds a cursor into the playlist source, not 1500 resolved items.
  The first ~100 positions are pending items that resolve just before play
  (the existing deferred `QueueItem` mechanism).
- A "load more" marker at the end of the queue pulls the next window when
  the auto-advance reaches it; an expired session drops the marker quietly.
- The queue shows the marker as a collapsed row "N more tracks"; a click on
  it reopens the playlist browser. Shuffle keeps the marker at the tail.

## 4. Personal playlists (shipped)

Named playlists owned by a panel user and stored in the bot database:

- Add tracks from search results, the queue, favorites and playlist browser
  rows ("add to playlist").
- Play a track from the playlist or queue the whole playlist in one click;
  the list is available in every guild the bot is in.
- Optional later: guild-shared playlists managed by the admins.

## 5. Queue persistence (planned)

The queue and the session history live in memory and disappear on a restart:

- Store the queue as pending items (the deferred resolve mechanism already
  fits) and restore it when the bot starts.
- Restore the repeat mode and the session history the same way.

## 6. Unbounded Yandex playlists (planned, when needed)

LavaSrc cannot paginate: one request returns the first 100 x
`playlistLoadLimit` tracks (the current ceiling is 1000):

- Walk the Yandex Music API directly with the stored access token, page by
  page, and keep only track metadata in the browser session.
- Resolve each track right before it plays through the deferred QueueItem
  mechanism. Needed only when playlists longer than 1000 show up.

## Constraint: one voice channel per bot per guild

Discord gives each member (bots included) one voice state per guild. A single
bot account cannot play in two voice channels of the same guild at the same
time; joining channel B moves it out of channel A. Simultaneous playback in
several channels needs one more bot application (a second token): a second
worker with its own queue and slash commands, with a bot selector in the web
panel. This is a large infrastructure step; start it only when the need is
real.
