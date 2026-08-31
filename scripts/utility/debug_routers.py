from app.api import audio, transcription

print(f"Audio router routes: {len(audio.router.routes)}")
for r in audio.router.routes:
    path = getattr(r, 'path', 'no path')
    methods = getattr(r, 'methods', 'no methods')
    print(f"  {methods} {path}")

print(f"\nTranscription router routes: {len(transcription.router.routes)}")
for r in transcription.router.routes:
    path = getattr(r, 'path', 'no path')
    methods = getattr(r, 'methods', 'no methods')
    print(f"  {methods} {path}")
