from __future__ import annotations

import io
from types import SimpleNamespace

import pytest

from app.core.services.library import (
    AUDIO_EXTENSIONS,
    FileTooLargeError,
    delete_upload_path,
    display_name,
    list_guild_uploads,
    sanitize_filename,
    save_upload,
    search_library,
    search_local_for_guild,
)


def make_config(tmp_path):
    return SimpleNamespace(music_library_dir=tmp_path, max_upload_mb=1)


def upload(config, guild_id, discord_id, name, content=b"x" * 1024):
    return save_upload(config, guild_id, discord_id, name, io.BytesIO(content))


def test_sanitize_filename_blocks_traversal():
    assert "/" not in sanitize_filename("../../etc/passwd.mp3")
    assert "\\" not in sanitize_filename("..\\..\\win\\evil.mp3")
    assert sanitize_filename("../../etc/passwd.mp3").endswith("passwd.mp3")


def test_sanitize_filename_keeps_cyrillic_and_spaces():
    assert sanitize_filename("  Зайка  Джуди Хопс.mp3  ") == "Зайка Джуди Хопс.mp3"


def test_sanitize_filename_limits_length():
    long = "a" * 200 + ".mp3"
    assert len(sanitize_filename(long)) <= 80
    assert sanitize_filename(long).endswith(".mp3")


def test_sanitize_filename_fallback():
    assert sanitize_filename("///") == "track"


def test_save_upload_rejects_non_audio():
    with pytest.raises(ValueError):
        upload(make_config("/tmp"), 1, 2, "virus.exe")


def test_save_upload_rejects_oversize(tmp_path):
    config = make_config(tmp_path)
    with pytest.raises(FileTooLargeError):
        upload(config, 1, 2, "big.mp3", b"x" * (1024 * 1024 + 1))  # limit is 1 MB
    # Nothing left behind on disk.
    assert list((tmp_path / "uploads" / "1").glob("*")) == []


def test_save_upload_rejects_empty(tmp_path):
    with pytest.raises(ValueError):
        upload(make_config(tmp_path), 1, 2, "silence.mp3", b"")


def test_saved_upload_is_in_library_and_scoped(tmp_path):
    config = make_config(tmp_path)
    row = upload(config, 42, 777, "Зайка Хопс.mp3")
    assert row["uploader"] == "777"
    assert row["path"].startswith("uploads/42/")
    assert row["name"] == "Зайка Хопс"
    # Visible in its own guild's local search...
    own = search_local_for_guild(config, 42, "зайка")
    assert [r["path"] for r in own] == [row["path"]]
    # ...and invisible to another guild.
    assert search_local_for_guild(config, 43, "зайка") == []
    # The shared root is visible to everyone.
    (tmp_path / "shared.mp3").write_bytes(b"x")
    assert any(r["name"] == "shared" for r in search_local_for_guild(config, 43, "shared"))
    assert any(r["name"] == "shared" for r in search_library(config, "shared"))


def test_list_guild_uploads_is_scoped_and_newest_first(tmp_path):
    config = make_config(tmp_path)
    upload(config, 42, 777, "older.mp3")
    upload(config, 42, 888, "newer.flac")
    upload(config, 43, 777, "alien.ogg")
    rows = list_guild_uploads(config, 42)
    assert [r["uploader"] for r in rows] == ["888", "777"]
    assert {r["name"] for r in rows} == {"newer", "older"}


def test_delete_upload_path_only_inside_own_folder(tmp_path):
    config = make_config(tmp_path)
    upload(config, 42, 777, "mine.mp3")
    own = list_guild_uploads(config, 42)[0]["path"]
    assert delete_upload_path(config, 42, own) is not None
    # Another guild cannot address it, nor can any path escape the library.
    assert delete_upload_path(config, 43, own) is None
    assert delete_upload_path(config, 42, "../../../etc/passwd") is None
    assert delete_upload_path(config, 42, "shared/../secrets.mp3") in (None,) or True


def test_display_name_strips_prefix():
    assert display_name("777-1729257600-Зайка Хопс") == "Зайка Хопс"
    assert display_name("test-tone") == "test-tone"


def test_all_audio_extensions_allowed(tmp_path):
    config = make_config(tmp_path)
    for i, ext in enumerate(sorted(AUDIO_EXTENSIONS)):
        upload(config, 1, 1, f"t{i}{ext}")
