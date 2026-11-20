"""Live duplex voice session -- ``/api/voice/live`` WebSocket.

Cascade architecture (see docs/knowledge-library/
real-time-duplex-voice-open-source-landscape-and-local-cascade-plan-2026.md):

    mic PCM16 -> Silero VAD -> endpointing -> faster-whisper STT
             -> Ollama LLM -> Pocket TTS stream -> PCM16 audio out

Barge-in: while the assistant is speaking, sustained user speech (VAD) above
``live.barge_speech_ms`` cancels the Pocket stream and the same utterance
buffer keeps accumulating, so the interruption becomes the next user turn.

Wire protocol (all config from ``config/tts.json`` -> ``live`` section):

- Client -> server, binary frames: PCM16 mono at ``live.sample_rate_in``.
- Client -> server, JSON text frames:
    {"type": "start", "voice": "maya-blend65"}   begin a session
    {"type": "stop"}                             end the session
    {"type": "text", "text": "..."}              inject a text turn (testing)
- Server -> client, JSON text frames:
    {"type": "state", "state": "idle|listening|thinking|speaking"}
    {"type": "transcript", "text": "...", "final": true}
    {"type": "reply", "text": "..."}
    {"type": "error", "message": "..."}
- Server -> client, binary frames: raw PCM16 mono 24 kHz (Pocket native rate).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import numpy as np
import torch
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core import tts_settings
from ..core.cors import is_local_origin
from ..core.ollama_client import chat_content
from . import voice_pocket as _vp

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Voice Live"])

EmitEvent = Callable[[dict[str, Any]], Awaitable[None]]
EmitAudio = Callable[[bytes], Awaitable[None]]

VAD_CHUNK = 512  # silero expects 512 samples @ 16 kHz (32 ms per chunk)
VAD_SR = 16000
SPEECH_THRESHOLD = 0.5
# While the assistant speaks, mic audio is contaminated by speaker echo; the
# browser's echoCancellation constraint does most of the work, this higher
# bar is the second line of defence against phantom barge-ins.
BARGE_THRESHOLD = 0.65
MIN_UTTERANCE_MS = 250.0
CHUNK_MS = VAD_CHUNK / VAD_SR * 1000.0

SYSTEM_PROMPT = (
    "You are Maya, a warm and concise voice assistant in a real-time spoken "
    "conversation. Reply in one to three short sentences of plain spoken "
    "language -- no markdown, no lists, no stage directions."
)

_whisper_model = None
_whisper_lock = asyncio.Lock()


async def _load_whisper(cfg: dict[str, Any]):
    """Lazy-load faster-whisper once per process (model load is seconds)."""
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is not None:
            return _whisper_model
        from faster_whisper import WhisperModel  # noqa: PLC0415 - heavy import

        name = str(cfg.get("stt_model") or "base")
        device = str(cfg.get("stt_device") or "cuda")
        compute = str(cfg.get("stt_compute_type") or "int8")
        logger.info("Loading faster-whisper %s on %s/%s", name, device, compute)
        _whisper_model = await asyncio.to_thread(
            WhisperModel, name, device=device, compute_type=compute
        )
        return _whisper_model


def _load_vad():
    from silero_vad import load_silero_vad  # noqa: PLC0415 - lazy, tiny onnx

    return load_silero_vad(onnx=True)


class LiveVoiceSession:
    """One duplex conversation. Not safe for concurrent feed() callers."""

    def __init__(self, emit_event: EmitEvent, emit_audio: EmitAudio):
        cfg = tts_settings.live()
        self._emit_event = emit_event
        self._emit_audio = emit_audio
        self._cfg = cfg
        self.sample_rate = int(cfg.get("sample_rate_in") or VAD_SR)
        self.endpoint_silence_ms = float(cfg.get("endpoint_silence_ms") or 800)
        self.barge_speech_ms = float(cfg.get("barge_speech_ms") or 400)
        self.max_utterance_ms = float(cfg.get("max_utterance_s") or 30) * 1000.0
        self.voice = str(cfg.get("voice") or "")
        self.llm_model = str(cfg.get("llm_model") or "") or None
        self._vad = None
        self._whisper = None

        self._state = "idle"
        self._closed = False
        self._pcm_buf = bytearray()
        self._in_speech = False
        self._speech_run_ms = 0.0
        self._speech_total_ms = 0.0
        self._silence_ms = 0.0
        self._utterance = bytearray()
        self._pending: list[str] = []
        self._history: list[dict[str, str]] = []
        self._turn_task: asyncio.Task[None] | None = None
        self._tts_cancel = asyncio.Event()
        self._tts_client: httpx.AsyncClient | None = None
        self._tts_resp: httpx.Response | None = None

    # -- public API ------------------------------------------------------

    async def emit(self, kind: str, **fields: Any) -> None:
        await self._emit_event({"type": kind, **fields})

    async def set_state(self, state: str, **fields: Any) -> None:
        self._state = state
        await self.emit("state", state=state, **fields)

    async def start(self, voice: str | None = None) -> None:
        if self._vad is None:
            self._vad = await asyncio.to_thread(_load_vad)
        if self._whisper is None:
            self._whisper = await _load_whisper(self._cfg)
        if voice:
            self.voice = voice
        await self.set_state("listening")

    async def stop(self) -> None:
        self._closed = True
        await self._cancel_turn()
        self._reset_vad_tracking()
        await self.set_state("idle")

    async def handle_text(self, text: str) -> None:
        text = text.strip()
        if not text or self._closed:
            return
        if self._turn_task is not None and not self._turn_task.done():
            self._pending.append(text)
            return
        self._turn_task = asyncio.create_task(self._run_turn(text))

    async def feed(self, data: bytes) -> None:
        """Inbound PCM16 chunk from the browser."""
        if self._closed or self._state == "idle":
            return
        self._pcm_buf += data
        chunk_bytes = VAD_CHUNK * 2
        while len(self._pcm_buf) >= chunk_bytes:
            raw = bytes(self._pcm_buf[:chunk_bytes])
            del self._pcm_buf[:chunk_bytes]
            await self._vad_chunk(raw)

    async def close(self) -> None:
        await self.stop()

    # -- VAD / endpointing -------------------------------------------------

    def _reset_vad_tracking(self) -> None:
        self._in_speech = False
        self._speech_run_ms = 0.0
        self._speech_total_ms = 0.0
        self._silence_ms = 0.0
        self._utterance.clear()
        self._pcm_buf.clear()
        if self._vad is not None:
            self._vad.reset_states()

    def _vad_prob(self, pcm_i16: bytes) -> float:
        samples = np.frombuffer(pcm_i16, dtype=np.int16).astype(np.float32) / 32768.0
        x = torch.from_numpy(samples).unsqueeze(0)
        with torch.no_grad():
            out = self._vad(x, VAD_SR)
        return float(out.reshape(-1)[0].item())

    async def _vad_chunk(self, raw: bytes) -> None:
        threshold = BARGE_THRESHOLD if self._state == "speaking" else SPEECH_THRESHOLD
        speech = self._vad_prob(raw) >= threshold

        if self._state == "speaking":
            if speech:
                self._speech_run_ms += CHUNK_MS
                if not self._in_speech:
                    self._in_speech = True
                    self._speech_total_ms = 0.0
                    self._utterance.clear()
                self._speech_total_ms += CHUNK_MS
                self._utterance += raw
                if self._speech_run_ms >= self.barge_speech_ms:
                    await self._barge_in()
            else:
                self._speech_run_ms = 0.0
            return

        # listening + thinking share endpointing: speech during "thinking" is
        # buffered and queued as a pending turn when it finalizes.
        if self._state in ("listening", "thinking"):
            if speech:
                if not self._in_speech:
                    self._in_speech = True
                    self._speech_total_ms = 0.0
                    self._silence_ms = 0.0
                    self._utterance.clear()
                self._speech_total_ms += CHUNK_MS
                self._silence_ms = 0.0
                self._utterance += raw
            elif self._in_speech:
                self._silence_ms += CHUNK_MS
                if self._silence_ms >= self.endpoint_silence_ms:
                    await self._finish_utterance()
            return

        # idle / unknown states: discard audio
        return

    async def _finish_utterance(self) -> None:
        pcm = bytes(self._utterance)
        total_ms = self._speech_total_ms
        self._reset_vad_tracking()
        if self._state == "thinking":
            # Queue behind the in-flight turn; processed when it completes.
            text = await self._transcribe(pcm)
            if text:
                self._pending.append(text)
                await self.emit("transcript", text=text, final=True)
            return
        if total_ms < MIN_UTTERANCE_MS:
            return
        text = await self._transcribe(pcm)
        if not text:
            await self.set_state("listening")
            return
        await self.emit("transcript", text=text, final=True)
        if self._turn_task is not None and not self._turn_task.done():
            # A turn is still unwinding (e.g. TTS tail) — queue behind it.
            self._pending.append(text)
            return
        self._turn_task = asyncio.create_task(self._run_turn(text))

    # -- turn pipeline ------------------------------------------------------

    async def _transcribe(self, pcm_i16: bytes) -> str:
        await self.set_state("thinking")
        audio = (
            np.frombuffer(pcm_i16, dtype=np.int16).astype(np.float32) / 32768.0
        )
        try:
            segments, _info = await asyncio.to_thread(
                self._whisper.transcribe, audio, beam_size=1, vad_filter=False
            )
            text = " ".join(seg.text for seg in segments).strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Live STT failed: %s", exc)
            await self.emit("error", message=f"Speech recognition failed: {exc}")
            text = ""
        return text

    async def _run_turn(self, user_text: str) -> None:
        try:
            self._history.append({"role": "user", "content": user_text})
            self._history = self._history[-12:]
            messages = [{"role": "system", "content": SYSTEM_PROMPT}] + self._history
            reply = await chat_content(
                messages,
                model=self.llm_model,
                timeout=90,
                think=False,
            )
            if not reply:
                await self.emit("error", message="The language model did not respond.")
                await self.set_state("listening")
                return
            self._history.append({"role": "assistant", "content": reply})
            await self.emit("reply", text=reply)
            await self._speak(reply)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("Live turn failed: %s", exc)
            await self.emit("error", message=f"Turn failed: {exc}")
            await self.set_state("listening")
        finally:
            nxt = self._pending.pop(0) if self._pending else None
            if nxt is not None and not self._closed:
                self._turn_task = asyncio.create_task(self._run_turn(nxt))
            elif self._state == "thinking":
                await self.set_state("listening")

    async def _speak(self, text: str) -> None:
        token = _vp._token()
        if token is None:
            await self.emit(
                "error",
                message=_vp._NOT_CONFIGURED.format(env=_vp._token_env_name()),
            )
            await self.set_state("listening")
            return

        self._tts_cancel.clear()
        base = _vp._base_url()
        client = httpx.AsyncClient(timeout=_vp._timeout())
        self._tts_client = client
        try:
            req = client.build_request(
                "POST",
                f"{base}/speech",
                json={"text": text, "voice": self.voice or _vp._cfg().get("default_voice")},
                headers=_vp._auth_headers(token),
            )
            resp = await client.send(req, stream=True)
            self._tts_resp = resp
            if resp.status_code != 200:
                await resp.aclose()
                await self.emit(
                    "error",
                    message=f"Pocket TTS speak failed (upstream {resp.status_code})",
                )
                await self.set_state("listening")
                return
            await self.set_state("speaking")
            async for chunk in resp.aiter_bytes():
                if self._tts_cancel.is_set() or self._closed:
                    break
                await self._emit_audio(chunk)
        except httpx.HTTPError as exc:
            if not self._tts_cancel.is_set():
                logger.warning("Live TTS stream failed: %s", exc)
                await self.emit("error", message="Pocket TTS is unreachable.")
        finally:
            if self._tts_resp is not None:
                await self._tts_resp.aclose()
            await client.aclose()
            self._tts_client = None
            self._tts_resp = None
            if self._state == "speaking":
                await self.set_state("listening")

    async def _barge_in(self) -> None:
        """User talked over the assistant: kill TTS, keep their utterance."""
        logger.info("Barge-in: cancelling TTS playback")
        self._tts_cancel.set()
        await self.set_state("listening", barged=True)

    async def _cancel_turn(self) -> None:
        self._tts_cancel.set()
        if self._tts_resp is not None:
            try:
                await self._tts_resp.aclose()
            except Exception:  # noqa: BLE001
                pass
        if self._turn_task is not None and not self._turn_task.done():
            self._turn_task.cancel()
            try:
                await self._turn_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._turn_task = None
        self._pending.clear()


@router.websocket("/api/voice/live")
async def voice_live_ws(websocket: WebSocket) -> None:
    """Duplex voice session: PCM16 in, PCM16+JSON events out."""
    origin = websocket.headers.get("origin", "")
    if origin and not is_local_origin(origin):
        await websocket.close(code=4001, reason="Origin not allowed")
        return
    await websocket.accept()

    async def emit_event(event: dict[str, Any]) -> None:
        await websocket.send_text(json.dumps(event))

    async def emit_audio(chunk: bytes) -> None:
        await websocket.send_bytes(chunk)

    session = LiveVoiceSession(emit_event, emit_audio)

    async def receiver() -> None:
        try:
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                data = msg.get("bytes")
                if data:
                    await session.feed(data)
                    continue
                text = msg.get("text")
                if text:
                    try:
                        ctrl = json.loads(text)
                    except json.JSONDecodeError:
                        continue
                    kind = ctrl.get("type")
                    if kind == "start":
                        asyncio.create_task(session.start(ctrl.get("voice")))
                    elif kind == "stop":
                        await session.stop()
                    elif kind == "text":
                        await session.handle_text(str(ctrl.get("text") or ""))
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("Voice live receiver ended: %s", exc)

    try:
        await receiver()
    finally:
        await session.close()
