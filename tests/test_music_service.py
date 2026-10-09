from __future__ import annotations

import time
from collections import deque

import pytest

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


def test_set_repeat_validation(music: MusicService) -> None:
    with pytest.raises(MusicServiceError):
        music.set_repeat(GUILD_ID, "sometimes")
    assert music.set_repeat(GUILD_ID, "all") == "all"
    assert music.get_state(GUILD_ID)["repeat"] == "all"


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
    state = music.get_state(GUILD_ID)
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
    assert music._is_playlist_url("https://music.yandex.ru/album/10100/track/10200") is True


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


async def test_play_next_moves_finished_track_to_played(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(make_track("current"), 1, "u")
    fill_queue(music, ["next"])

    await music.play_next(GUILD_ID, "finished")

    assert [i.track.title for i in music.played[GUILD_ID]] == ["current"]
    # The state list is newest first.
    assert music.get_state(GUILD_ID)["played"][0]["title"] == "current"


async def test_previous_replays_last_and_requeues_current(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(make_track("current"), 1, "u")
    fill_queue(music, ["next"])
    await music.play_next(GUILD_ID, "finished")

    assert await music.previous(GUILD_ID, 1) == "current"

    assert player.played == ["next", "current"]
    # What was playing returns to the front of the queue.
    assert [i.track.title for i in music.queues[GUILD_ID]] == ["next"]
    assert music.played[GUILD_ID] == deque()


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
    assert [i.track.title for i in music.played[GUILD_ID]] == ["playing"]
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
    # The queue tail was not lost and not reordered.
    assert [i.track.title for i in music.played[GUILD_ID]] == ["current", "last"]
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
    assert not music.played.get(GUILD_ID)


async def test_autoplay_radio_stays_out_of_played(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(
        make_track("radio"), 0, "autoplay", source="radio", is_autoplay=True
    )
    fill_queue(music, ["song"])

    await music.play_next(GUILD_ID, "stopped")

    assert player.played == ["song"]
    assert GUILD_ID not in music.played


async def test_replay_played_by_position(music: MusicService) -> None:
    player = FakePlayer()
    music.get_player = lambda _gid: player  # type: ignore[method-assign]
    music.current_items[GUILD_ID] = QueueItem(make_track("live"), 1, "u")
    fill_queue(music, ["a"])
    await music.play_next(GUILD_ID, "finished")

    assert await music.replay_played(GUILD_ID, 0, 1) == "live"

    assert player.played == ["a", "live"]
    # The interrupted track "a" took its place in the history.
    assert [i.track.title for i in music.played[GUILD_ID]] == ["a"]
    with pytest.raises(MusicServiceError):
        await music.replay_played(GUILD_ID, 5, 1)


def test_shuffle_queue_keeps_all_tracks(music: MusicService) -> None:
    fill_queue(music, ["a", "b", "c", "d"])

    assert music.shuffle_queue(GUILD_ID) == 4
    assert sorted(i.track.title for i in music.queues[GUILD_ID]) == ["a", "b", "c", "d"]


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


async def test_play_playlist_track_moves_current_to_played(music: MusicService) -> None:
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
    assert [i.track.title for i in music.played[GUILD_ID]] == ["playing now"]
    with pytest.raises(MusicServiceError):
        await music.play_playlist_track(GUILD_ID, session.id, 99, 1, "u")
