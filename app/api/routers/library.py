from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.api.deps import get_config
from app.core.config import Config
from app.core.services.library import media_type, safe_library_path, verify_stream_token

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("/stream/{rel_path:path}")
async def stream(
    rel_path: str,
    expires: int | None = None,
    token: str | None = None,
    config: Config = Depends(get_config),
) -> FileResponse:
    """Serve a library file to Lavalink. Access goes through a signed URL,
    so no session cookie is needed here."""
    if not verify_stream_token(config, rel_path, expires, token):
        raise HTTPException(status_code=403, detail="Invalid or expired stream token")
    file = safe_library_path(config, rel_path)
    if file is None:
        raise HTTPException(status_code=404, detail="File not found in the library")
    return FileResponse(file, media_type=media_type(rel_path), filename=Path(rel_path).name)
