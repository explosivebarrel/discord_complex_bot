from app.api.deps import hash_token
from app.core.db import Database


async def test_api_token_lifecycle(db: Database) -> None:
    raw = "vkq_testtoken123"
    token_hash = hash_token(raw)
    await db.create_user_api_token(
        token_hash,
        discord_id=42,
        username="u",
        global_name="User",
        label="userscript",
    )

    row = await db.get_user_api_token(token_hash)
    assert row is not None
    assert row.discord_id == 42
    assert row.revoked is False
    assert row.last_used_at is None

    await db.touch_user_api_token(token_hash)
    row = await db.get_user_api_token(token_hash)
    assert row is not None and row.last_used_at is not None

    keys = await db.list_user_api_tokens(42)
    assert [r.id for r in keys] == [token_hash]
    assert await db.list_user_api_tokens(43) == []

    assert await db.revoke_user_api_token(token_hash, 43) is False  # foreign key owner
    assert await db.revoke_user_api_token(token_hash, 42) is True
    assert await db.list_user_api_tokens(42) == []


async def test_revoke_by_prefix_matches_own_keys_only(db: Database) -> None:
    for n in range(2):
        await db.create_user_api_token(
            hash_token(f"vkq_key{n}"),
            discord_id=7,
            username="u",
            global_name="U",
            label="",
        )

    assert await db.revoke_user_api_token_by_prefix(hash_token("vkq_key0")[:12], 7) is True
    assert await db.revoke_user_api_token_by_prefix("deadbeefdead", 7) is False
    assert await db.revoke_user_api_token_by_prefix(hash_token("vkq_key1")[:12], 8) is False
    remaining = await db.list_user_api_tokens(7)
    assert [r.id for r in remaining] == [hash_token("vkq_key1")]
