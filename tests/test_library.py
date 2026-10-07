from __future__ import annotations

import time

from app.core.services.library import (
    library_stream_url,
    safe_library_path,
    search_library,
    verify_stream_token,
)


def _make_library(config) -> None:
    root = config.music_library_dir
    (root / "mixes").mkdir(parents=True, exist_ok=True)
    (root / "кифир.mp3").write_bytes(b"x" * 1024)
    (root / "mixes" / "set.flac").write_bytes(b"y" * 2048)
    (root / "note.txt").write_text("not audio")


def test_search_library_filters_and_paths(config) -> None:
    _make_library(config)
    everything = search_library(config)
    assert {f["path"] for f in everything} == {"кифир.mp3", "mixes/set.flac"}
    nested = search_library(config, "set")
    assert len(nested) == 1 and nested[0]["name"] == "set"
    assert search_library(config, "nothing-matches") == []


def test_stream_token_roundtrip(config) -> None:
    url = library_stream_url(config, "кифир.mp3")
    assert url.startswith("http://localhost:8000/api/library/stream/")
    assert "expires=" in url and "token=" in url

    # extract query values back
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    expires = int(query["expires"][0])
    token = query["token"][0]
    assert verify_stream_token(config, "кифир.mp3", expires, token) is True
    assert verify_stream_token(config, "другой.mp3", expires, token) is False
    assert verify_stream_token(config, "кифир.mp3", expires - 10, token) is False
    assert verify_stream_token(config, "кифир.mp3", int(time.time()) - 1, token) is False


def test_safe_library_path_blocks_traversal(config) -> None:
    _make_library(config)
    assert safe_library_path(config, "кифир.mp3") is not None
    assert safe_library_path(config, "mixes/set.flac") is not None
    assert safe_library_path(config, "../secrets.txt") is None
    assert safe_library_path(config, "missing.mp3") is None
