from __future__ import annotations

import time
import asyncio
from collections import deque

import pytest

from app.core.db import Database
from app.core.services import vk_music
from app.core.services.music import MusicService, MusicServiceError, PlaylistSession, QueueItem

from .conftest import GUILD_ID, FakePlayer, fill_queue, make_track


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("https://www.youtube.com/watch?v=abc", "yt"),
        ("https://music.youtube.com/watch?v=abc", "yt"),
        ("https://youtu.be/abc", "yt"),
        ("https://soundcloud.com/artist/track", "sc"),
        ("https://on.soundcloud.com/abcd", "sc"),
        ("https://music.yandex.ru/album/1/track/2", "ym"),
        ("https://vk.com/audio123_456", "vk"),
        ("https://m.vk.com/audio123_456", "vk"),
        ("https://music.vk.com/playlist/123_45", "vk"),
        ("https://vk.ru/audios123", "vk"),
        ("https://archive.org/details/nitem", "archive"),
        # Unknown URL hosts keep the tag the panel sent.
        ("http://ice1.somafm.com/groovesalad-128-mp3", "ym"),
        ("кино звезда", "ym"),
    ],
)
def test_detect_source(music: MusicService, query: str, expected: str) -> None:
    assert music._detect_source(query, "ym") == expected  # noqa: SLF001


def test_move_queued_rotates_order(music: MusicService) -> None:
    fill_queue(music, ["a", "b", "c"])
    assert music.move_queued(GUILD_ID, 0, 2) == "a"
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["b", "c", "a"]
    assert music.move_queued(GUILD_ID, 2, 0) == "a"
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["a", "b", "c"]


def test_remove_queued_and_validation(music: MusicService) -> None:
    fill_queue(music, ["a", "b"])
    assert music.remove_queued(GUILD_ID, 1) == "b"
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["a"]
    with pytest.raises(MusicServiceError):
        music.remove_queued(GUILD_ID, 5)
    with pytest.raises(MusicServiceError):
        music.move_queued(GUILD_ID, 0, 9)


async def test_repeat_one_replays_on_finish(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(make_track("current"), 1, "u")
    fill_queue(music, ["next"])
    music.set_repeat(GUILD_ID, "one")

    await music.play_next(GUILD_ID, "finished")
    assert player.played == ["current"]
    # An explicit skip ("stopped") must still advance to the next track.
    await music.play_next(GUILD_ID, "stopped")
    assert player.played == ["current", "next"]
    assert len(music.queues[GUILD_ID]) == 0


async def test_repeat_all_cycles_to_queue_end(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    fill_queue(music, ["a", "b"])
    music.set_repeat(GUILD_ID, "all")

    await music.play_next(GUILD_ID, "finished")  # plays a
    await music.play_next(GUILD_ID, "finished")  # a ends -> to the end, plays b
    assert player.played == ["a", "b"]
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["a"]
    await music.play_next(GUILD_ID, "stopped")  # b ends -> to the end, plays a again
    assert player.played == ["a", "b", "a"]
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["b"]


async def test_no_repeat_drains_queue(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    fill_queue(music, ["a"])
    await music.play_next(GUILD_ID, "finished")
    assert player.played == ["a"]
    await music.play_next(GUILD_ID, "finished")
    assert player.played == ["a"]  # nothing left, nothing played
    assert GUILD_ID not in music.current_items


async def test_set_repeat_validation(music: MusicService) -> None:
    with pytest.raises(MusicServiceError):
        music.set_repeat(GUILD_ID, "sometimes")
    assert music.set_repeat(GUILD_ID, "all") == "all"
    assert (await music.get_state(GUILD_ID))["repeat"] == "all"


async def test_play_next_without_player_is_noop(music: MusicService) -> None:
    fill_queue(music, ["a"])
    assert await music.play_next(GUILD_ID) is None
    assert len(music.queues[GUILD_ID]) == 1


async def test_play_next_records_history(music: MusicService, db) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    fill_queue(music, ["a"])
    await music.play_next(GUILD_ID, "finished")
    history = await db.recent_history(GUILD_ID)
    assert len(history) == 1
    assert history[0]["title"] == "a"
    assert history[0]["requested_by"] == "tester"


async def test_pending_item_resolves_at_play(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    item = QueueItem(
        track=None,
        requested_by_id=1,
        requested_by_name="u",
        source="yt",
        pending_url="https://www.youtube.com/watch?v=x",
        title="lazy song",
        author="artist",
        length=5_000,
    )
    music.queues[GUILD_ID] = deque([item])

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]
    track = await music.play_next(GUILD_ID, "finished")
    assert track is not None and track.title == "lazy song"
    assert player.played == ["lazy song"]
    assert item.track is not None  # the pending item became resolved


async def test_broken_pending_skips_to_next(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    bad = QueueItem(track=None, requested_by_id=1, requested_by_name="u", source="yt",
                    pending_url="https://x/1", title="broken")
    good = QueueItem(track=None, requested_by_id=1, requested_by_name="u", source="yt",
                     pending_url="https://x/2", title="good")
    music.queues[GUILD_ID] = deque([bad, good])

    async def fake_resolve(it: QueueItem):
        if it.title == "broken":
            raise MusicServiceError("Could not load the YouTube stream.")
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]
    track = await music.play_next(GUILD_ID, "finished")
    assert track is not None and track.title == "good"
    assert player.played == ["good"]
    assert music.last_error is not None and "broken" in music.last_error["context"]["title"]


async def test_autoplay_starts_station_when_queue_drains(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]

    async def fake_radio_search(query: str, limit: int = 15):
        return [
            {
                "title": "Groove Salad",
                "author": "SomaFM",
                "uri": "http://ice1.somafm.com/groovesalad-128-mp3",
                "length": 0,
                "artwork": None,
                "source": "radio",
            }
        ]

    monkeypatch.setattr("app.core.services.extern_search.radio_search", fake_radio_search)

    async def fake_load(url: str):
        return make_track("Groove Salad")

    music._load_stream = fake_load  # type: ignore[method-assign]
    await music.db.update_guild_settings(GUILD_ID, autoplay_enabled=True, autoplay_query="lofi")

    fill_queue(music, ["a"])
    await music.play_next(GUILD_ID, "finished")
    assert player.played == ["a"]
    # The queue ran dry: the station joins as a pending item and starts.
    await music.play_next(GUILD_ID, "finished")
    assert player.played == ["a", "Groove Salad"]
    station = music.current_items[GUILD_ID]
    assert station.source == "radio" and station.requested_by_name == "autoplay"


async def test_autoplay_disabled_drains_silently(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    fill_queue(music, ["a"])
    await music.play_next(GUILD_ID, "finished")
    await music.play_next(GUILD_ID, "finished")
    assert player.played == ["a"]
    assert GUILD_ID not in music.current_items


async def test_state_reports_loading_during_transition(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(
        track=None,
        requested_by_id=1,
        requested_by_name="u",
        source="yt",
        pending_url="https://www.youtube.com/watch?v=x",
        title="lazy",
        length=5_000,
    )
    state = await music.get_state(GUILD_ID)
    assert state["current"]["loading"] is True
    assert state["current"]["title"] == "lazy"
    assert state["playing"] is False


class FakePlaylist:
    def __init__(self, name: str, tracks: list) -> None:
        self.name = name
        self.tracks = tracks


async def test_ym_playlist_queues_through_lavalink(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]

    async def fake_load(query: str):
        assert "ymsearch:" not in query  # the prefix breaks URL loads
        return FakePlaylist("Лучшее: КИНО", [make_track("t1"), make_track("t2"), make_track("t3")])

    music._lavalink_load_with_retry = fake_load  # type: ignore[method-assign]
    result = await music.enqueue(
        GUILD_ID, "https://music.yandex.ru/users/yamusic-bestsongs/playlists/41075", 1, "u", source="ym"
    )
    # The idle player starts the first track immediately: 3 minus one playing.
    assert result["queued"] == 2
    assert result["now_playing"] is True
    assert "КИНО" in result["title"]
    assert len(music.queues[GUILD_ID]) == 2


def test_album_url_counts_as_ym_playlist(music: MusicService) -> None:
    assert music._is_playlist_url("https://music.yandex.ru/album/10100") is True
    assert music._is_playlist_url("https://music.yandex.ru/users/x/playlists/41075") is True
    # An album/track URL points at ONE track: it is not a playlist.
    assert music._is_playlist_url("https://music.yandex.ru/album/10100/track/10200") is False


async def test_resolve_playlist_null_guard(music: MusicService) -> None:
    # yt-dlp prints a bare null with exit code 0 on unsupported pages.
    async def fake_run(args: list[str], attempts: int = 3, label: str = "The site") -> str:
        return "null"

    music._run_ytdlp = fake_run  # type: ignore[method-assign]
    with pytest.raises(MusicServiceError):
        await music._resolve_playlist("https://www.youtube.com/playlist?list=x")


def test_section_allows_matrix() -> None:
    from app.api.deps import section_allows

    # admins pass for admins/everyone, but not for a section switched off
    assert section_allows("admins", True) is True
    assert section_allows("everyone", True) is True
    assert section_allows("off", True) is False
    # members only pass when the section is open to everyone
    assert section_allows("admins", False) is False
    assert section_allows("everyone", False) is True
    assert section_allows("off", False) is False


async def test_play_next_records_new_track_at_start(music: MusicService) -> None:
    """Recent is written when a track STARTS: the playing song is already
    "recently played" the moment it begins."""
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(make_track("current"), 1, "u")
    fill_queue(music, ["next"])

    await music.play_next(GUILD_ID, "finished")

    assert [i.track.title for i in music.played[GUILD_ID]] == ["next"]
    # The state list is newest first.
    assert (await music.get_state(GUILD_ID))["played"][0]["title"] == "next"


async def test_replayed_track_moves_to_front_instead_of_duplicating(music: MusicService) -> None:
    """Re-playing a track bumps its Recent entry to the newest position; the
    session history never holds the same track twice."""
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    first = QueueItem(make_track("a"), 1, "u")
    second = QueueItem(make_track("b"), 1, "u")
    music._push_played(GUILD_ID, first)
    music._push_played(GUILD_ID, second)

    music._push_played(GUILD_ID, QueueItem(make_track("a"), 1, "u"))

    assert [i.track.title for i in music.played[GUILD_ID]] == ["b", "a"]


async def test_previous_replays_last_and_requeues_current(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    fill_queue(music, ["first", "second"])
    await music.play_next(GUILD_ID, "finished")
    await music.play_next(GUILD_ID, "finished")

    assert await music.previous(GUILD_ID, 1, "zheny") == "first"

    assert player.played == ["first", "second", "first"]
    # What was playing returns to the front of the queue.
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["second"]
    # The playing track's own entry was consumed by going back; the replayed
    # one was re-recorded at its start.
    assert [i.track.title for i in music.played[GUILD_ID]] == ["first"]
    # The acting user becomes the requester of the replayed track.
    assert music.current_items[GUILD_ID].requested_by_name == "zheny"


async def test_previous_without_history_fails(music: MusicService) -> None:
    music.get_player = lambda _gid: FakePlayer()  # type: ignore[method-assign]
    with pytest.raises(MusicServiceError):
        await music.previous(GUILD_ID, 1)


async def test_jump_to_keeps_the_queue_order(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(make_track("playing"), 1, "u")
    fill_queue(music, ["a", "b", "c"])

    assert await music.jump_to(GUILD_ID, 1, 1) == "b"

    assert player.played == ["b"]
    # The chosen track leaves the queue, everything else keeps its order.
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["a", "c"]
    assert [i.track.title for i in music.played[GUILD_ID]] == ["b"]
    with pytest.raises(MusicServiceError):
        await music.jump_to(GUILD_ID, 9, 1)


async def test_marker_expansion_keeps_later_queue_tracks_in_place(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    session = _make_session(music, 150)
    marker = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="playlist",
        title="50 more tracks", more_from_playlist=(session.id, 100),
        playlist_url=session.url, playlist_source="yt",
    )
    fill_queue(music, ["last"])
    music.queues[GUILD_ID].append(marker)

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(make_track("current"), 1, "u")
    await music.play_next(GUILD_ID, "finished")  # "last" plays now
    await music.play_next(GUILD_ID, "finished")  # marker expands, track 100 plays

    titles = [i.display_title for i in music.queues[GUILD_ID]]
    assert titles == [f"track {i}" for i in range(101, 150)]
    # The queue tail was not lost and not reordered; history holds the
    # tracks that actually started.
    assert [i.track.title for i in music.played[GUILD_ID]] == ["last", "track 100"]
    assert player.played == ["last", "track 100"]


async def test_expand_splices_page_above_marker_and_keeps_order(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    session = _make_session(music, 120)
    marker = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="playlist",
        title="20 more tracks", more_from_playlist=(session.id, 100),
        playlist_url=session.url, playlist_source="yt",
    )
    fill_queue(music, ["last"])
    music.queues[GUILD_ID].append(marker)

    result = await music.expand_queue_playlist(GUILD_ID, 1, 1)

    # Only 20 entries remain, so the page is short and the marker is gone.
    assert result == {"expanded": 20, "remaining": 0, "total": 120}
    titles = [i.display_title for i in music.queues[GUILD_ID]]
    # "last" sat before the marker and stays in front of the spliced page.
    assert titles == ["last"] + [f"track {i}" for i in range(100, 120)]


async def test_expand_keeps_the_marker_while_tracks_remain(music: MusicService) -> None:
    session = _make_session(music, 120)
    marker = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="playlist",
        title="120 more tracks", more_from_playlist=(session.id, 0),
        playlist_url=session.url, playlist_source="yt",
    )
    music.queues[GUILD_ID] = deque([marker])

    result = await music.expand_queue_playlist(GUILD_ID, 0, 1)

    assert result == {"expanded": 50, "remaining": 70, "total": 120}
    queue = music.queues[GUILD_ID]
    assert [i.display_title for i in queue][:50] == [f"track {i}" for i in range(50)]
    assert queue[50].more_from_playlist == (session.id, 50)
    assert queue[50].display_title == "70 more tracks"


async def test_expand_rebinds_expired_session(music: MusicService) -> None:
    music.get_player = lambda _gid: FakePlayer()  # type: ignore[method-assign]
    session = _make_session(music, 120)
    session.created = time.monotonic() - 901.0
    marker = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="playlist",
        title="20 more tracks", more_from_playlist=(session.id, 100),
        playlist_url="https://example.com/pl", playlist_source="yt",
    )
    music.queues[GUILD_ID] = deque([marker])

    fresh = PlaylistSession(
        id=9, title="Test playlist", source="yt", url="https://example.com/pl",
        entries=session.entries, created=time.monotonic(),
    )

    async def fake_open(query: str, source: str):
        music.playlist_sessions[fresh.id] = fresh
        return fresh

    music.open_playlist = fake_open  # type: ignore[method-assign]
    result = await music.expand_queue_playlist(GUILD_ID, 0, 1)

    assert result["expanded"] == 20
    # The spliced items come from the fresh session; the playlist is over.
    titles = [i.display_title for i in music.queues[GUILD_ID]]
    assert titles == [f"track {i}" for i in range(100, 120)]


async def test_enqueue_interrupts_autoplay_radio(music: MusicService) -> None:
    player = FakePlayer()
    player.playing = True
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(
        make_track("radio"), 0, "autoplay", source="radio", is_autoplay=True
    )

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]
    result = await music.enqueue(
        GUILD_ID,
        "https://www.youtube.com/watch?v=abc",
        1,
        "u",
        source="yt",
        meta={"title": "real song", "length_ms": 1000},
    )

    # The endless radio must not hold the queue hostage.
    assert result["now_playing"] is True
    assert player.played == ["real song"]
    assert music.current_items[GUILD_ID].display_title == "real song"
    # The radio stays out of Recent; the real song entered it at start.
    assert [i.track.title for i in music.played[GUILD_ID]] == ["real song"]


async def test_autoplay_radio_stays_out_of_played(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(
        make_track("radio"), 0, "autoplay", source="radio", is_autoplay=True
    )
    fill_queue(music, ["song"])

    await music.play_next(GUILD_ID, "stopped")

    assert player.played == ["song"]
    # The radio stays out of Recent; the real song entered it at start.
    assert [i.track.title for i in music.played[GUILD_ID]] == ["song"]


async def test_replay_played_by_position(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    fill_queue(music, ["old", "live"])
    await music.play_next(GUILD_ID, "finished")
    await music.play_next(GUILD_ID, "finished")

    # Panel position 0 is the newest row: the currently playing track.
    assert await music.replay_played(GUILD_ID, 0, 1, "zheny") == "live"

    assert player.played == ["old", "live", "live"]
    # A restart keeps its entry (re-recorded at start).
    assert [i.track.title for i in music.played[GUILD_ID]] == ["old", "live"]
    assert music.current_items[GUILD_ID].requested_by_name == "zheny"
    with pytest.raises(MusicServiceError):
        await music.replay_played(GUILD_ID, 5, 1)


def test_shuffle_queue_keeps_all_tracks(music: MusicService) -> None:
    fill_queue(music, ["a", "b", "c", "d"])

    assert music.shuffle_queue(GUILD_ID) == 4
    assert sorted(i.track.title for i in music.queues[GUILD_ID]) == ["a", "b", "c", "d"]


async def test_requeue_played_appends_without_touching_history(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    fill_queue(music, ["old"])
    await music.play_next(GUILD_ID, "finished")  # "old" plays, enters history

    assert await music.requeue_played(GUILD_ID, 0, 2, "zheny") == "old"

    # The queue gets a copy; the history entry stays put (repeatable action).
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["old"]
    assert [i.track.title for i in music.played[GUILD_ID]] == ["old"]
    assert player.played == ["old"]  # playback was not interrupted
    # The acting user replaces the original requester on the queued copy.
    assert music.queues[GUILD_ID][0].requested_by_name == "zheny"
    assert music.played[GUILD_ID][0].requested_by_name == "tester"
    with pytest.raises(MusicServiceError):
        await music.requeue_played(GUILD_ID, 5, 1)


def test_for_replay_rebuilds_page_url_for_yt(music: MusicService) -> None:
    item = QueueItem(make_track("a"), 1, "u", source="yt")
    out = music._for_replay(item)  # noqa: SLF001
    assert out.track is None
    assert out.pending_url == "https://example.com/a"


def test_for_replay_keeps_radio_track(music: MusicService) -> None:
    item = QueueItem(make_track("r"), 1, "u", source="radio")
    out = music._for_replay(item)  # noqa: SLF001
    assert out.track is not None
    assert out.pending_url == ""


def _make_session(music: MusicService, count: int, source: str = "yt") -> PlaylistSession:
    entries = [
        {
            "title": f"track {i}",
            "author": "artist",
            "url": f"https://example.com/{i}",
            "duration": 60_000,
            "artwork": None,
        }
        for i in range(count)
    ]
    session = PlaylistSession(
        id=1, title="Test playlist", source=source, url="https://example.com/pl",
        entries=entries, created=time.monotonic(),
    )
    music.playlist_sessions[session.id] = session
    return session


def test_playlist_page_pagination_and_filter(music: MusicService) -> None:
    session = _make_session(music, 120)

    page = music.playlist_page(session.id, 0)
    assert page["total"] == 120 and page["pages"] == 3 and page["page"] == 0
    assert [t["index"] for t in page["tracks"]] == list(range(50))

    last = music.playlist_page(session.id, 2)
    assert len(last["tracks"]) == 20

    found = music.playlist_page(session.id, 0, "track 5")
    assert found["matched"] == 11  # 5, 15, 25, ..., 115
    assert found["pages"] == 1

    with pytest.raises(MusicServiceError):
        music.playlist_page(999, 0)


async def test_queue_entire_playlist_windows_and_marker(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    session = _make_session(music, 250)

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]
    result = await music.queue_entire_playlist(GUILD_ID, session.id, 1, "u")
    assert result == {"queued": 100, "remaining": 150, "total": 250}
    queue = music.queues[GUILD_ID]
    # 99 window items wait in the queue, "track 0" started playing (idle start).
    assert len(queue) == 100
    assert queue[-1].more_from_playlist == (session.id, 100)
    assert player.played == ["track 0"]  # idle start played the first one

    # Skip to the marker: play_next expands the next window in its place.
    for _ in range(99):
        await music.play_next(GUILD_ID, "finished")
    assert queue[-1].more_from_playlist == (session.id, 100)
    await music.play_next(GUILD_ID, "finished")
    # New window: 99 wait + the marker; "track 100" plays now.
    assert len(queue) == 100
    assert queue[-1].more_from_playlist == (session.id, 200)
    assert player.played[-1] == "track 100"


async def test_expired_marker_drops_silently(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    session = _make_session(music, 10)
    session.created = time.monotonic() - 901.0
    marker = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="playlist",
        title="10 more tracks", more_from_playlist=(session.id, 0),
    )
    music.queues[GUILD_ID] = deque([marker])

    assert await music.play_next(GUILD_ID, "finished") is None
    assert not music.queues[GUILD_ID]


def test_shuffle_keeps_playlist_markers_at_the_end(music: MusicService) -> None:
    fill_queue(music, ["a", "b", "c"])
    marker = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="playlist",
        title="5 more tracks", more_from_playlist=(1, 0),
    )
    music.queues[GUILD_ID].append(marker)

    assert music.shuffle_queue(GUILD_ID) == 3
    assert music.queues[GUILD_ID][-1].more_from_playlist == (1, 0)
    assert sorted(i.track.title for i in list(music.queues[GUILD_ID])[:3]) == ["a", "b", "c"]


async def test_add_playlist_tracks_validates_and_dedupes(music: MusicService) -> None:
    music.get_player = lambda _gid: None  # type: ignore[method-assign]
    session = _make_session(music, 10)

    added = await music.add_playlist_tracks(GUILD_ID, session.id, [5, 2, 2, 99, -1], 1, "u")
    assert added == 2
    assert [i.display_title for i in music.queues[GUILD_ID]] == ["track 2", "track 5"]
    with pytest.raises(MusicServiceError):
        await music.add_playlist_tracks(GUILD_ID, session.id, [500], 1, "u")


async def test_play_playlist_track_records_at_start(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    session = _make_session(music, 3)
    music.current_items[GUILD_ID] = QueueItem(make_track("playing now"), 1, "u")

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]
    title = await music.play_playlist_track(GUILD_ID, session.id, 1, 1, "u")

    assert title == "track 1"
    assert player.played == ["track 1"]
    assert [i.track.title for i in music.played[GUILD_ID]] == ["track 1"]
    with pytest.raises(MusicServiceError):
        await music.play_playlist_track(GUILD_ID, session.id, 99, 1, "u")


async def test_persist_and_restore_round_trip(music: MusicService, db: Database) -> None:
    music.current_items[GUILD_ID] = QueueItem(make_track("now playing"), 1, "u")
    fill_queue(music, ["next one", "after"])
    music.set_repeat(GUILD_ID, "all")
    music.played[GUILD_ID] = deque([QueueItem(make_track("older"), 1, "u")], maxlen=20)
    music.played[GUILD_ID].append(QueueItem(make_track("recent"), 1, "u"))

    await music.persist_state()

    # A fresh service instance reads the same database: a restart simulation.
    restored = MusicService(None, db, music.config)
    await restored.restore_state()

    assert [i.display_title for i in restored.queues[GUILD_ID]] == [
        "now playing",  # the interrupted track returns as the queue head
        "next one",
        "after",
    ]
    assert all(i.track is None for i in restored.queues[GUILD_ID])  # deferred resolve
    assert restored.repeat_modes[GUILD_ID] == "all"
    # History comes back newest last, so the panel view shows "recent" first.
    assert [i.display_title for i in restored.played[GUILD_ID]] == ["older", "recent"]


async def test_persist_clears_snapshot_of_idle_guild(music: MusicService) -> None:
    fill_queue(music, ["a"])
    await music.persist_state()
    assert await music.db.load_music_snapshots()

    music.queues.pop(GUILD_ID)
    music.repeat_modes[GUILD_ID] = "off"
    await music.persist_state()
    assert not await music.db.load_music_snapshots()


async def test_restore_rebinds_lazy_marker_to_fresh_session(music: MusicService, db: Database) -> None:
    stale = _make_session(music, 120)
    marker = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="playlist",
        title="20 more tracks", more_from_playlist=(stale.id, 100),
        playlist_url=stale.url, playlist_source="yt",
    )
    music.queues[GUILD_ID] = deque([marker])
    await music.persist_state()

    restored = MusicService(None, db, music.config)
    fresh = PlaylistSession(
        id=9, title="Test playlist", source="yt", url=stale.url,
        entries=stale.entries, created=time.monotonic(),
    )

    async def fake_open(query: str, source: str):
        restored.playlist_sessions[fresh.id] = fresh
        return fresh

    restored.open_playlist = fake_open  # type: ignore[method-assign]
    await restored.restore_state()
    await restored._rebind_markers([(GUILD_ID, restored.queues[GUILD_ID][0])])  # noqa: SLF001

    rebound = restored.queues[GUILD_ID][0]
    assert rebound.more_from_playlist == (9, 100)
    assert rebound.display_title == "20 more tracks"


# --- VK Music ---

def _vk_token_stub(music: MusicService) -> None:
    async def token() -> str:
        return "vk-test-token"

    music._vk_token = token  # type: ignore[method-assign]


def test_vk_playlist_url_detection(music: MusicService) -> None:
    assert music._is_playlist_url("https://vk.com/audios123") is True  # noqa: SLF001
    assert music._is_playlist_url("https://music.vk.com/playlist/123_45") is True  # noqa: SLF001
    assert music._is_playlist_url("https://vk.com/album/123_45") is True  # noqa: SLF001
    assert music._is_playlist_url("https://vk.com/audio123_456") is False  # noqa: SLF001
    assert music.looks_like_playlist("https://vk.com/audios123", "vk") is True
    assert music.looks_like_playlist("https://vk.com/audio123_456", "vk") is False


async def test_vk_enqueue_plain_text_takes_first_search_hit(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    _vk_token_stub(music)

    async def fake_search(_token: str, _query: str, _limit: int):
        return [
            {
                "title": "Song", "author": "Artist",
                "uri": "https://vk.com/audio1_2", "length": 30_000,
                "artwork": None, "source": "vk", "requested_by": "", "encoded": None,
            }
        ]

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    monkeypatch.setattr(vk_music, "search", fake_search)
    music._resolve_item = fake_resolve  # type: ignore[method-assign]

    result = await music.enqueue(GUILD_ID, "some song", 1, "u", source="vk")

    assert result["now_playing"] is True
    item = music.current_items[GUILD_ID]
    assert item.source == "vk"
    assert item.pending_url == "https://vk.com/audio1_2"
    assert item.display_title == "Song"


async def test_vk_enqueue_track_url_reads_meta_from_api(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    _vk_token_stub(music)

    async def fake_track(_token: str, owner_id: int, audio_id: int):
        assert (owner_id, audio_id) == (1, 2)
        return {"owner_id": 1, "id": 2, "artist": "Artist", "title": "Song", "duration": 30}

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    monkeypatch.setattr(vk_music, "track", fake_track)
    music._resolve_item = fake_resolve  # type: ignore[method-assign]

    await music.enqueue(GUILD_ID, "https://vk.com/audio1_2", 1, "u", source="vk")

    item = music.current_items[GUILD_ID]
    assert item.display_title == "Song"
    assert item.length == 30_000


async def test_vk_resolve_item_loads_a_fresh_stream(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="vk",
        pending_url="https://vk.com/audio1_2", title="Song", author="Artist",
    )
    _vk_token_stub(music)

    async def fake_stream(_token: str, owner_id: int, audio_id: int):
        return "https://cdn.vkuser.net/song.mp3"

    async def fake_load(url: str):
        assert url == "https://cdn.vkuser.net/song.mp3"
        return make_track("cdname")

    monkeypatch.setattr(vk_music, "stream_url", fake_stream)
    music._load_stream = fake_load  # type: ignore[method-assign]

    track = await music._resolve_item(item)  # noqa: SLF001

    # FakeTrack does not model the wavelink _title property, so the
    # metadata patch lands on the private attribute.
    assert track._title == "Song"  # noqa: SLF001
    assert track._author == "Artist"  # noqa: SLF001


async def test_vk_resolve_rejects_hls(music: MusicService, monkeypatch: pytest.MonkeyPatch) -> None:
    item = QueueItem(
        track=None, requested_by_id=1, requested_by_name="u", source="vk",
        pending_url="https://vk.com/audio1_2", title="Song", author="Artist",
    )
    _vk_token_stub(music)

    async def hls_stream(_token: str, _owner: int, _audio: int):
        raise vk_music.VkMusicError("VK streams this track over HLS, which the player cannot play.")

    monkeypatch.setattr(vk_music, "stream_url", hls_stream)

    with pytest.raises(MusicServiceError):
        await music._resolve_item(item)  # noqa: SLF001


async def test_vk_open_playlist_stores_deep_links(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    _vk_token_stub(music)

    async def fake_playlist(_token: str, owner_id: int, playlist_id: int):
        assert (owner_id, playlist_id) == (123, 45)
        entry = {
            "title": "t", "author": "a", "url": "https://vk.com/audio1_1",
            "duration": 1_000, "artwork": None,
        }
        return "My collection", [entry]

    monkeypatch.setattr(vk_music, "playlist", fake_playlist)

    session = await music.open_playlist("https://vk.com/playlist/123_45", "vk")

    assert session.title == "My collection"
    assert session.entries[0]["url"] == "https://vk.com/audio1_1"


async def test_vk_requires_token(music: MusicService) -> None:
    with pytest.raises(MusicServiceError, match="VK Music is not configured"):
        await music.search("song", source="vk")


async def test_autoplay_yields_to_enqueue_during_resolve(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The autoplay filler resolves over the network; a track enqueued while
    that resolve is in flight must win, and the filler is dropped."""
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]

    release = asyncio.Event()

    async def slow_load(url: str):
        await release.wait()
        return make_track("radio station")

    music._load_stream = slow_load  # type: ignore[method-assign]
    await music.db.update_guild_settings(GUILD_ID, autoplay_enabled=True, autoplay_query="lofi")

    fill_queue(music, ["a"])
    await music.play_next(GUILD_ID, "finished")
    assert player.played == ["a"]

    # The queue drains; play_next stalls inside _load_stream awaiting the net.
    pending = asyncio.create_task(music.play_next(GUILD_ID, "finished"))
    await asyncio.sleep(0.01)
    # The finished track means an idle player (wavelink clears it on end).
    player.playing = False
    # Meanwhile the user enqueues a real track: it sees an idle bot and plays.
    await music.enqueue(
        GUILD_ID, "https://www.youtube.com/watch?v=x", 1, "u",
        source="yt", meta={"title": "user track", "length_ms": 1000},
    )
    release.set()
    await pending

    assert player.played == ["a", "user track"]
    assert music.current_items[GUILD_ID].display_title == "user track"


async def test_autoplay_playlist_shuffles_without_recent_repeats(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Playlist autoplay: shuffled picks, no track repeats inside the
    recent window, and the source falls back to radio when unset."""
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]

    async def fake_load(url: str):
        track = make_track(f"song {url.rsplit('/', 1)[-1]}")
        track.uri = url  # keep the playlist uri so the recent window matches
        return track

    music._load_stream = fake_load  # type: ignore[method-assign]

    playlist_id = await music.db.create_user_playlist(1, "autopl")
    await music.db.add_user_playlist_tracks(
        1, playlist_id,
        [{"title": f"song {n}", "author": "a", "uri": f"https://ex.com/{n}",
          "source": "yt", "length_ms": 10, "artwork": None} for n in range(6)],
    )
    await music.db.update_guild_settings(
        GUILD_ID, autoplay_enabled=True, autoplay_playlist_id=playlist_id,
    )

    fill_queue(music, ["a"])
    await music.play_next(GUILD_ID, "finished")
    played: list[str] = []
    for _ in range(6):
        track = await music.play_next(GUILD_ID, "finished")
        played.append(track.title)
        assert track.title.startswith("song ")
    # The recent window is min(tracks-1, 15) = 5: within any 5 consecutive
    # picks there must be no repeat.
    titles = [t.replace("song ", "") for t in played]
    for i in range(len(titles) - 5):
        assert len(set(titles[i:i + 5])) == 5


async def test_add_user_playlist_tracks_skips_duplicates(db: Database) -> None:
    pid = await db.create_user_playlist(1, "dupes")
    body = [
        {"title": "a", "uri": "https://ex.com/1"},
        {"title": "b", "uri": "https://ex.com/2"},
    ]
    added, skipped = await db.add_user_playlist_tracks(1, pid, body)
    assert (added, skipped) == (2, 0)
    added, skipped = await db.add_user_playlist_tracks(
        1, pid, [{"title": "a copy", "uri": "https://ex.com/1"}],
    )
    assert (added, skipped) == (0, 1)


async def test_track_artwork_cache_roundtrip(db: Database) -> None:
    """Covers are stored by title|author and backfilled into track dicts."""
    key = db.artwork_key("Song", "Artist")
    await db.upsert_track_artworks([(key, "https://img/cover.jpg")])

    covers = await db.get_track_artworks([key, db.artwork_key("Other", "x")])
    assert covers == {key: "https://img/cover.jpg"}

    rows = [
        {"title": "Song", "author": "Artist", "artwork": None},
        {"title": "Song", "author": "Artist", "artwork": "https://own/img.jpg"},
        {"title": "Unknown", "author": "x", "artwork": None},
    ]
    await db.fill_track_artworks(rows)
    assert rows[0]["artwork"] == "https://img/cover.jpg"
    # An existing cover is never overwritten by the cache.
    assert rows[1]["artwork"] == "https://own/img.jpg"
    # No cached cover: stays empty.
    assert not rows[2]["artwork"]


async def test_resync_players_rejoins_and_replays_after_node_reconnect(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """After a Lavalink reconnect the app replays the interrupted track for
    every guild that still has a Discord voice state; guilds whose voice
    state is really gone drop their stale current item."""
    class FakeVoice:
        def __init__(self, channel_id: int | None) -> None:
            self.channel = None if channel_id is None else FakeChannel(channel_id)

    class FakeChannel:
        def __init__(self, cid: int) -> None:
            self.id = cid
            self.joined: list[bool] = []

        async def connect(self, cls=None, self_deaf=False):
            player = FakePlayer()
            player.channel = self
            async def _set_volume(_v: int) -> None:
                return None
            player.set_volume = _set_volume
            self.joined.append(True)
            alive.voice_client = player
            return player

    class FakeMember:
        def __init__(self, channel_id: int | None) -> None:
            self.voice = FakeVoice(channel_id)

    class FakeGuild:
        def __init__(self, cid: int | None) -> None:
            self.id = GUILD_ID
            self.me = FakeMember(cid)
            self.voice_client = None

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]

    alive = FakeGuild(42)
    dead = FakeGuild(None)

    class FakeBot:
        def __init__(self) -> None:
            self._guilds = {GUILD_ID: alive}
            self._ready = True

        def is_ready(self) -> bool:
            return self._ready

        def get_guild(self, gid: int):
            return self._guilds.get(gid)

    music.bot = FakeBot()  # type: ignore[assignment]
    # get_player's isinstance(vc, wavelink.Player) cannot work with fakes.
    music.get_player = lambda gid: (  # type: ignore[method-assign]
        music.bot.get_guild(gid).voice_client if music.bot.get_guild(gid) else None
    )
    item = QueueItem(make_track("resync me"), 1, "tester")
    music.current_items[GUILD_ID] = item

    await music.resync_players()

    assert alive.voice_client is not None
    assert "resync me" in alive.voice_client.played
    assert music.current_items[GUILD_ID] is item

    # A guild without a voice state drops the stale current item instead.
    music.bot._guilds[GUILD_ID] = dead
    music.current_items[GUILD_ID] = item
    await music.resync_players()
    assert GUILD_ID not in music.current_items


async def test_ym_album_track_url_queues_the_single_track(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A /album/<id>/track/<id> URL points at ONE track: it must play
    directly (no playlist preview) with the URL's track picked."""

    # Raw REST payload: loadType "track" but a list of track dicts.
    async def fake_rest_load(_url: str):
        return [
            {"encoded": "e1", "pluginInfo": {}, "info": {"identifier": "111", "title": "other song", "author": "a", "uri": "ym/111", "length": 1000, "isSeekable": True, "isStream": False, "position": 0, "sourceName": "yandexmusic"}},
            {"encoded": "e2", "pluginInfo": {}, "info": {"identifier": "157603586", "title": "the right one", "author": "a", "uri": "ym/157603586", "length": 2000, "isSeekable": True, "isStream": False, "position": 0, "sourceName": "yandexmusic"}},
        ]

    music._lavalink_rest_load = fake_rest_load  # type: ignore[method-assign]
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]

    url = "https://music.yandex.ru/album/44677180/track/157603586?utm_source=desktop"
    assert music.looks_like_playlist(url, "ym") is False

    result = await music.enqueue(GUILD_ID, url, 1, "fezen", source="ym")

    assert result["now_playing"] is True
    assert music.current_items[GUILD_ID].track.title == "the right one"


async def test_resync_starts_queue_head_when_current_is_gone(
    music: MusicService, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A guild whose current track ended inside a Lavalink connection gap
    gets its player back and the queue head starts."""

    class FakeChannel:
        def __init__(self) -> None:
            self.id = 42

        async def connect(self, cls=None, self_deaf=False):
            player = FakePlayer()
            player.channel = self

            async def _set_volume(_v: int) -> None:
                return None

            player.set_volume = _set_volume
            guild.voice_client = player
            return player

    class FakeVoice:
        channel = FakeChannel()

    class FakeMe:
        voice = FakeVoice()

    class FakeGuild:
        id = GUILD_ID
        me = FakeMe()
        voice_client = None

    class FakeBot:
        def __init__(self, g) -> None:
            self._ready = True
            self._guild = g

        def is_ready(self) -> bool:
            return self._ready

        def get_guild(self, gid: int):
            return self._guild

    guild = FakeGuild()
    music.bot = FakeBot(guild)  # type: ignore[assignment]
    music.get_player = lambda gid: guild.voice_client  # type: ignore[method-assign]
    fill_queue(music, ["queued head"])

    async def fake_resolve(it: QueueItem):
        return make_track(it.display_title)

    music._resolve_item = fake_resolve  # type: ignore[method-assign]
    notified: list[str] = []

    async def fake_notify(gid, category, title, body=""):
        notified.append(title)

    music.notify = fake_notify  # type: ignore[method-assign]

    await music.resync_players()

    # The queue head started and left the queue.
    assert [i.track.title for i in music.played[GUILD_ID]] == ["queued head"]
    assert music.queues[GUILD_ID] == deque()
    assert "Playback resumed" in notified
