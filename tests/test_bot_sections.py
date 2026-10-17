from __future__ import annotations

from types import SimpleNamespace

from app.api.deps import bot_section_available


def make_bot(**perms: bool):
    """A stand-in for ComplexBot: only get_guild().me.guild_permissions."""
    p = SimpleNamespace(
        view_channel=perms.get("view_channel", True),
        send_messages=perms.get("send_messages", True),
        connect=perms.get("connect", True),
        speak=perms.get("speak", True),
        moderate_members=perms.get("moderate_members", True),
        kick_members=perms.get("kick_members", False),
        ban_members=perms.get("ban_members", False),
    )
    guild = SimpleNamespace(me=SimpleNamespace(guild_permissions=p))
    return SimpleNamespace(get_guild=lambda gid: guild)


def make_bot_no_guild():
    return SimpleNamespace(get_guild=lambda gid: None)


def test_full_permissions_allow_everything():
    bot = make_bot()
    assert all(bot_section_available(bot, 1, s) for s in ("player", "stats", "posts", "moderation", "manage"))


def test_player_needs_connect_and_speak():
    assert not bot_section_available(make_bot(connect=False), 1, "player")
    assert not bot_section_available(make_bot(speak=False), 1, "player")
    assert bot_section_available(make_bot(), 1, "player")


def test_posts_need_send_messages():
    assert not bot_section_available(make_bot(send_messages=False), 1, "posts")
    assert bot_section_available(make_bot(), 1, "posts")


def test_moderation_needs_any_action_permission():
    none = SimpleNamespace(
        view_channel=True,
        send_messages=True,
        connect=True,
        speak=True,
        moderate_members=False,
        kick_members=False,
        ban_members=False,
    )
    bot = SimpleNamespace(get_guild=lambda gid: SimpleNamespace(me=SimpleNamespace(guild_permissions=none)))
    assert not bot_section_available(bot, 1, "moderation")
    assert bot_section_available(make_bot(kick_members=True), 1, "moderation")


def test_manage_needs_nothing():
    assert bot_section_available(make_bot(view_channel=False, connect=False), 1, "manage")


def test_missing_guild_blocks_everything():
    bot = make_bot_no_guild()
    assert not bot_section_available(bot, 1, "player")
    assert not bot_section_available(bot, 1, "manage")


def test_is_guild_owner_mock_awareness():
    from app.api.deps import is_guild_owner, set_access_mock

    guild = SimpleNamespace(owner_id=777)
    bot = SimpleNamespace(get_guild=lambda gid: guild)

    owner = SimpleNamespace(is_superadmin=False, discord_id=777, session_id="s1")
    admin = SimpleNamespace(is_superadmin=False, discord_id=888, session_id="s1")
    root = SimpleNamespace(is_superadmin=True, discord_id=999, session_id="s1")

    assert is_guild_owner(bot, 1, owner)
    assert not is_guild_owner(bot, 1, admin)
    assert is_guild_owner(bot, 1, root)
    # A super-admin previewing another tier is not the owner while mocked.
    set_access_mock("s1", 1, "admin")
    assert not is_guild_owner(bot, 1, root)
    assert not is_guild_owner(bot, 1, owner)  # even the real owner is mocked out
    set_access_mock("s1", 1, None)
    assert is_guild_owner(bot, 1, owner)
    assert is_guild_owner(bot, 1, root)
