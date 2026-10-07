from __future__ import annotations

from app.core.db import Database


async def test_guild_settings_autoplay_defaults_and_update(db: Database) -> None:
    settings = await db.get_guild_settings(100)
    assert settings.autoplay_enabled is False
    assert settings.autoplay_query == ""

    settings = await db.update_guild_settings(100, autoplay_enabled=True, autoplay_query="lofi")
    assert settings.autoplay_enabled is True
    assert settings.autoplay_query == "lofi"

    # A partial update must not reset the other field.
    settings = await db.update_guild_settings(100, autoplay_query="jazz")
    assert settings.autoplay_enabled is True
    assert settings.autoplay_query == "jazz"


async def test_play_history_tops_and_totals(db: Database) -> None:
    for _ in range(2):
        await db.add_play_history(
            100,
            title="Song A",
            author="Artist",
            uri="https://example.com/a",
            source="yt",
            length_ms=1000,
            requested_by_id=7,
            requested_by_name="FEZEN",
        )
    await db.add_play_history(
        100,
        title="Song B",
        author="Artist",
        uri="https://example.com/b",
        source="sc",
        length_ms=2000,
        requested_by_id=8,
        requested_by_name="Masha",
    )
    await db.add_play_history(
        200,  # another guild, must not leak into stats of guild 100
        title="Song C",
        author="Artist",
        uri="https://example.com/c",
        source="yt",
        length_ms=3000,
        requested_by_id=7,
        requested_by_name="FEZEN",
    )

    top = await db.top_tracks(100)
    assert top[0] == {"title": "Song A", "author": "Artist", "source": "yt", "plays": 2}
    assert len(top) == 2

    requesters = await db.top_requesters(100)
    assert requesters[0]["name"] == "FEZEN" and requesters[0]["plays"] == 2

    totals = await db.history_totals(100)
    assert totals == {"plays_total": 3, "plays_30d": 3, "unique_tracks": 2}

    recent = await db.recent_history(100, limit=10)
    assert len(recent) == 3
    assert {r["title"] for r in recent} == {"Song A", "Song B"}
    assert all(r["played_at"] for r in recent)


async def test_favorites_upsert_scope_and_remove(db: Database) -> None:
    first_id = await db.add_favorite(
        1, title="T1", author="A", uri="https://e.com/1", source="yt", length_ms=1, artwork=None
    )
    same_id = await db.add_favorite(
        1, title="T1 renamed", author="A", uri="https://e.com/1", source="yt", length_ms=1, artwork=None
    )
    assert first_id == same_id  # same uri updates the row instead of duplicating

    other_id = await db.add_favorite(
        1, title="T2", author="A", uri="https://e.com/2", source="sc", length_ms=2, artwork=None
    )
    await db.add_favorite(
        2, title="T3", author="A", uri="https://e.com/1", source="yt", length_ms=3, artwork=None
    )  # another user, same uri

    favorites = await db.list_favorites(1)
    assert len(favorites) == 2
    assert {f["uri"] for f in favorites} == {"https://e.com/1", "https://e.com/2"}

    found = await db.find_favorite_by_uri(1, ["https://e.com/1", "https://e.com/2", "https://e.com/9"])
    assert found == {"https://e.com/1": first_id, "https://e.com/2": other_id}

    assert await db.remove_favorite(1, first_id) is True
    assert await db.remove_favorite(1, first_id) is False
    assert await db.remove_favorite(2, other_id) is False  # the row belongs to user 1
    assert len(await db.list_favorites(1)) == 1
