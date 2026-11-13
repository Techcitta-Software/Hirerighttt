from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.server import runtime
from app.services import tts

router = APIRouter()


@router.get("/interview/tts/status")
async def tts_status(request: Request) -> dict:
    await runtime.require_auth_email(request)
    return {"enabled": tts.tts_enabled(), "voice": tts.resolve_voice(), "sampleRate": tts.SAMPLE_RATE}


@router.post("/interview/tts")
async def speak(request: Request):
    """Stream the interviewer's voice for `text` as raw 16-bit PCM (mono, 24 kHz)."""
    email = await runtime.require_auth_email(request)
    if not runtime.rate_limit(f"tts:{email}", 90, 60_000):
        return JSONResponse(status_code=429, content={"error": "Too many voice requests. Try again shortly."})
    if not tts.tts_enabled():
        return JSONResponse(status_code=503, content={"error": "Neural voice is not available."})
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Send JSON with a text field.")
    text = tts.clean_text((body or {}).get("text"))
    if not text:
        raise HTTPException(status_code=400, detail="Nothing to say.")
    try:
        first, rest, close = await tts.open_speech(text, (body or {}).get("voice"))
    except tts.TtsUnavailable:
        # The browser reads this status and switches to the device voice immediately.
        return JSONResponse(status_code=503, content={"error": "Neural voice is not available."})

    async def audio():
        try:
            yield first
            async for chunk in rest:
                yield chunk
        finally:
            await close()

    return StreamingResponse(
        audio(),
        media_type="application/octet-stream",
        headers={
            "X-Audio-Format": "pcm_s16le",
            "X-Sample-Rate": str(tts.SAMPLE_RATE),
            "Cache-Control": "no-store",
        },
    )
