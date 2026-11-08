"""Voice synthesis services (F5-TTS, zero-shot voice cloning).

Mirrors the lip-sync service layout: a thin adapter that shells out to the
pinned ``D:\\venvs\\f5tts`` interpreter via ``tools/f5tts_run.py``, a queue
handler, and config driven by ``config/voice.json``. No training, no
third-party TTS APIs — reference-based cloning only.
"""
