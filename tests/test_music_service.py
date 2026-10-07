from __future__ import annotations

import pytest
from collections import deque

from app.core.services.music import MusicServiceError, QueueItem

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
