"""Music prompt generator service.

Uses local Ollama LLM (default qwen3.5:9b) to produce copy-paste-ready
style prompts + structured lyrics for four music engines:

- suno_v6        — Suno v6 family (v6 / v6-wild / v6-mini). Tag-style Style
                   field (~1000 chars, sweet spot 5-8 descriptors) + tagged lyrics.
- minimax_30     — MiniMax Music 3.0 (music-3.0). Narrative sentences +
                   Structured Caption (Global Metadata / Vocal Details / Arrangement).
- happyshrimp_10 — Alibaba HappyShrimp 1.0 beta. Natural-language scene prompt,
                   end-to-end whole-song, Smart/Custom/Instrumental modes.
- lyria_35       — Google Lyria 3.5 (model id ``lyria-3.5``, Interactions API,
                   44.1 kHz stereo). Full songs (couple minutes, up to ~3 min),
                   timestamps + ``Lyrics:`` block. Launched in Flow Music
                   29 Jul 2026, Gemini app/API 4 Sep 2026. Clip model
                   (lyria-3-clip-preview) = 30s previews.

Verified against Sep 2026 docs (Google DeepMind model card 29 Jul 2026,
ai.google.dev/music-generation 8 Sep 2026, MiniMax Music3 HF + platform docs,
Suno v6 release Sep 2026, Alibaba HappyShrimp beta Aug 2026).
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "qwen3.5:9b"
FALLBACK_MODEL = "qwen3.5:4b"

SUPPORTED_PLATFORMS = ("suno_v6", "minimax_30", "happyshrimp_10", "lyria_35")

# Load lyric technique knowledge base from the project's knowledge library.
_KNOWLEDGE_DIR = Path(__file__).resolve().parents[4] / "docs" / "knowledge-library"
_LYRIC_TECHNIQUES_PATH = _KNOWLEDGE_DIR / "lyric-techniques-2026.json"
_MUSIC_PROMPT_PRESETS_PATH = _KNOWLEDGE_DIR / "music-prompt-presets.json"

def _load_lyric_techniques() -> dict[str, Any]:
    try:
        text = _LYRIC_TECHNIQUES_PATH.read_text(encoding="utf-8")
        data = json.loads(text)
        if isinstance(data, dict) and "techniques" in data:
            return data["techniques"]
        return {}
    except Exception as exc:
        logger.warning("Failed to load lyric techniques from %s: %s", _LYRIC_TECHNIQUES_PATH, exc)
        return {}

def _load_presets() -> dict[str, Any]:
    try:
        text = _MUSIC_PROMPT_PRESETS_PATH.read_text(encoding="utf-8")
        data = json.loads(text)
        if isinstance(data, dict) and "presets" in data:
            return data["presets"]
        return {}
    except Exception as exc:
        logger.warning("Failed to load music prompt presets from %s: %s", _MUSIC_PROMPT_PRESETS_PATH, exc)
        return {}

LYRIC_TECHNIQUES: dict[str, dict[str, Any]] = _load_lyric_techniques()
MUSIC_PROMPT_PRESETS: dict[str, list[dict[str, Any]]] = _load_presets()

# Fallback generic styles are always available even if the JSON fails to load.
GENERIC_LYRIC_STYLES: dict[str, list[str]] = {
    "poetic": ["Use vivid imagery, metaphor, and assonance; compress meaning into short phrases.",
               "Avoid clichés; prefer unexpected word pairings."],
    "conversational": ["Write as if talking to a friend; simple words, natural rhythm, no forced rhymes.",
                       "Use contractions, fragments, and honest emotion."],
    "storytelling": ["Tell a complete mini-story: setup → conflict → resolution across verses.",
                     "Include specific characters, places, and sensory details."],
    "minimal": ["Strip to 1-2 idea words per line; let the beat breathe.",
                "Repeat key phrases; fewer unique words = more memorable."],
    "fragmented": ["Break phrases into 3-5 word chunks with rests; layer vocal textures.",
                   "Use breath sounds and ad-libs as percussion."],
    "narrative": ["Linear timeline: past → present → future; clear scenes.",
                  "Use specific times, locations, and objects as anchors."],
}

PLATFORM_SPECS: dict[str, dict[str, Any]] = {
    "suno_v6": {
        "label": "Suno v6",
        "engine": "Suno v6 / v6-wild / v6-mini",
        "style": "tags",
        "style_limit": 1000,
        "style_sweet_spot": "5-8 comma-separated descriptors",
        "formula": "Genre+Era, Mood, 2-3 Instruments, Vocal, Production",
        "lyric_tags": ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Instrumental Break", "Outro"],
        "sliders": "Variety (0 = keep tags verbatim; >0 rewrites style text), Style Influence (Loose→Strong adherence), Weirdness (Safe→Chaos, 50% normal), Audio Influence (with uploads), Vocal Gender, Duration, Max Mode (>2 min / close covers)",
        "rules": [
            "Sound goes in Style box, story+structure go in Lyrics box — never mix.",
            "4-7 descriptors ideal; max ~10. Front-load genre + vocal (early tags weigh most).",
            "Identity in style (gender, age, register, texture); PERFORMANCE in lyrics: short parenthetical delivery cues after section tags like [Chorus] (belted, open vowels, wide) — physical cues (soft, whispered, belted, close-mic, falsetto) work, emotion words (heartfelt, passionate) don't.",
            "Lyrics: 6-10 syllables/line with consistent counts per section; spell sustains into open vowels (lo-o-ove, staaay) once or twice per section; hyphenate for staccato (do-not-call-me-back); repeat chorus verbatim.",
            "Max 2 genres. Use Exclude Styles for failures (e.g. 'no autotune, no EDM drop'). Never put 'no X' or slider values ('Weirdness 20%') in the style text.",
            "Instrumental: put 'instrumental only' near front, leave lyrics empty or structure-only.",
            "Pronunciation: v6-mini currently pronounces cleanest — test lyric pacing there first, then run the keeper on v6 flagship.",
            "Recommend slider settings + model pick (v6 flagship for finish, v6-mini free for sketches, v6-wild for exploration) in the settings object.",
        ],
    },
    "minimax_30": {
        "label": "MiniMax Music 3.0",
        "engine": "MiniMax Music 3.0 (music-3.0 / music-3.0-free), up to 5 min",
        "style": "narrative sentences + Structured Caption",
        "prompt_limit": 2000,
        "lyrics_limit": 3500,
        "formula": "A [mood] [BPM] [genre] song, featuring [vocal], about [theme], [atmosphere], [instruments]",
        "caption_sections": ["Global Metadata", "Vocal Details", "Arrangement"],
        "lyric_tags": ["Intro", "Verse", "Pre Chorus", "Chorus", "Post Chorus", "Interlude", "Bridge", "Hook", "Build Up", "Break", "Transition", "Inst", "Solo", "Outro"],
        "api_flags": ["lyrics_optimizer (auto lyrics when lyrics empty)", "is_instrumental (no vocals; lyrics not required)", "audio_setting (44100 Hz / 256000 / mp3 recommended)"],
        "rules": [
            "Write sentences, NOT tag salad.",
            "Structured Caption: Global Metadata (genre/BPM/key/emotion arc/use-case) + Vocal Details + Arrangement with section-level evolution.",
            "Include 2-3 arrangement events (e.g. strings enter pre-chorus, drums drop in bridge).",
            "One tag per line in lyrics, official tags: [Intro] [Verse] [Pre Chorus] [Chorus] [Post Chorus] [Interlude] [Bridge] [Hook] [Build Up] [Break] [Transition] [Inst] [Solo] [Outro]. Keep production notes OUT of lyric lines.",
            "Embed lyric language via vocal/genre ('Korean female vocalist', 'Mandopop ballad').",
            "Instrumental mode: lyrics empty, prompt carries the full arrangement arc. Auto-lyrics: leave lyrics empty + lyrics_optimizer.",
        ],
    },
    "happyshrimp_10": {
        "label": "HappyShrimp 1.0",
        "engine": "Alibaba HappyShrimp 1.0 beta (happyshrimp.ai / happyshrimp.cn), end-to-end whole-song, no public API",
        "style": "natural-language scene, not tags",
        "prompt_limit": 5000,
        "formula": "Situation + Genre + Voice + Instruments + Tempo + Arc",
        "modes": ["Smart Lyrics", "Custom Lyrics", "Instrumental"],
        "rules": [
            "Prompt scenes, not tag stacks: 'late shift ends, empty train home, quiet relief'.",
            "Describe emotion/story/era/vocal character/energy curve; model plans grammar+semantics.",
            "One clear genre anchor — weak at genre-bending fusions and over-the-top anthem choruses; leans into one style instead of blending.",
            "If supplying lyrics, keep section labels ([Verse]/[Pre-Chorus]/[Chorus]) and use prompt for production direction only.",
            "Beta: 2 songs per run to compare; reference audio + style/model-version/song-count/audio-influence controls exist; no stems, no published pricing/rights — keep an established workflow for production.",
            "Strong at Chinese-style, R&B/soul, bilingual pop hooks, clean stereo vocals.",
        ],
    },
    "lyria_35": {
        "label": "Lyria 3.5 Pro (Flow Music / Gemini)",
        "engine": "Google Lyria 3.5 (model id lyria-3.5, Interactions API, 44.1 kHz stereo, ~$0.08/song)",
        "style": "descriptive prompt + Lyrics: block (+ optional timestamps / image refs)",
        "input_token_limit": 131072,
        "durations": "Clip (lyria-3-clip-preview) = 30s previews MP3; Lyria 3.5 = full songs, couple minutes / up to ~3 min, MP3 or WAV",
        "formula": "[Genre+Era] + [Mood] + [Instrumentation] + [Tempo/BPM] + [Key] + [Vocal style+language] + [Lyrics:]",
        "rules": [
            "Lead with genre+era, then mood, exact instruments (Fender Rhodes, TR-808 — not families), BPM number, key (G major / D minor), detailed singer profile (gender+timbre+range).",
            "Custom lyrics: prefix with 'Lyrics:' and use [Verse]/[Chorus]/[Bridge] section tags.",
            "Control duration in prompt ('create a 2-minute song') or — better for video scoring — a [mm:ss - mm:ss] timestamp timeline fixing what plays where; last mark sets the end.",
            "Prompt LANGUAGE sets lyric language: write the whole brief in the target language; 'a song in Spanish' inside an English prompt usually returns English.",
            "No negative prompting, no artist-voice mimicry, no copyrighted lyrics — describe traits instead.",
            "Workflow: draft on Clip (fast 30s), render keeper on 3.5; ask WAV when the track goes into an edit, MP3 otherwise. Single-turn (no follow-up edits), non-deterministic (download keepers), SynthID watermarked.",
            "Multimodal: up to 10 images/PDFs can steer mood/style/atmosphere — name them in notes when relevant.",
        ],
    },
}

PLATFORM_LIMITS: dict[str, dict[str, int]] = {
    "suno_v6": {"title": 100, "style": 1000, "prompt": 1000},
    "minimax_30": {"title": 100, "style": 2000, "prompt": 2000, "lyrics": 3500},
    "happyshrimp_10": {"title": 100, "style": 5000, "prompt": 5000},
    "lyria_35": {"title": 100},
}

# Which paste-boxes each engine actually has. `style` is the main prompt box
# on every platform; `prompt` is kept as a legacy alias of `style`.
PLATFORM_OUTPUTS: dict[str, list[str]] = {
    "suno_v6": ["title", "style", "exclude", "lyrics"],
    "minimax_30": ["title", "style", "exclude", "lyrics"],
    "happyshrimp_10": ["title", "style", "lyrics"],
    "lyria_35": ["title", "style", "lyrics"],
}

# Words/phrases engines consistently stumble on: consonant clusters with no
# vowel to hold, rare vocabulary, invented words. Flagged by validate_output
# so the user can respell or replace them before pasting.
STUMBLE_PRONE = (
    "strengths", "sixths", "twelfths", "rural", "jewelry", "squirrel",
    "colonel", "worcestershire", "isthmus", "anemone", "otorhinolaryngologist",
    "synecdoche", "abysmal", "nocturnal",
)

# 2026 lyric-writing technique reference — techniques used by popular artists
# in 2026 for each target genre.  Used by the system prompt to steer the LLM
# toward lyrics that match current hit patterns.
LYRIC_TECHNIQUES: dict[str, dict[str, Any]] = {
    "melodic rap": {
        "techniques": [
            "Internal rhyme chains: rhyme inside the bar, not just at the end.",
            "4-bar verse structure with a 1-bar ad-lib tag at the end of every 4th bar.",
            "Hook repeats a 2-line motif with slight melodic variation each time.",
            "Use parenthetical ad-libs: (yeah), (go), (shit) — short, punchy.",
            "Syllable density: 8-12 syllables per bar; stretch vowels for melody.",
            "Pre-chorus builds tension with shorter lines (5-7 syllables).",
        ],
        "vocal_delivery": "Auto-tuned melodic rap, half-sung half-rapped, dynamic range soft verse → loud hook.",
    },
    "alt R&B": {
        "techniques": [
            "Fragmented phrases: break sentences into 3-5 word chunks with rests.",
            "Vocal layering: harmonies in the hook, whisper-track ad-libs in verses.",
            "Ambiguous storytelling: suggest emotions rather than state them directly.",
            "Pre-chorus as a question or half-finished thought, not a full sentence.",
            "Bridge strips back to voice + one instrument before final hook.",
            "Use onomatopoeia and breath sounds as percussion: (ah), (mm), (shh).",
        ],
        "vocal_delivery": "Breathy falsetto top, spoken-word mid-range, whispered ad-libs; reverb-heavy mix.",
    },
    "phonk": {
        "techniques": [
            "Aggressive repetition: 1-2 line motif repeated 4-8 times per section.",
            "Short phrases (3-6 words) over 808 slides; leave space for the beat.",
            "Chant-like hooks: monosyllabic or bisyllabic words, call-and-response.",
            "Use bracket cues for delivery: [aggressive], [whispered], [screamed].",
            "Verse tells a street story in present tense, no metaphors needed.",
            "Outro fades on a repeated ad-lib or vocal chop.",
        ],
        "vocal_delivery": "Distorted, aggressive, layered with reverb and delay; deep 808-tuned bass vocals.",
    },
    "pop": {
        "techniques": [
            "Hook-first structure: strongest 2-line motif in the first 8 seconds.",
            "AABB or ABAB rhyme scheme; simple, predictable, catchy.",
            "Pre-chorus builds with a question or rising action, resolves in the chorus.",
            "Bridge provides contrast: softer dynamics, fewer words, longer notes.",
            "Use universal emotions (love, heartbreak, freedom) with specific details.",
            "Outro repeats the hook 2-4 times with production fading.",
        ],
        "vocal_delivery": "Belty chorus, soft verse, mixed harmonies; polished, radio-ready tone.",
    },
    "drill": {
        "techniques": [
            "Syncopated triplet flows over 140-150 BPM; off-beat emphasis.",
            "Violent imagery, street narratives, braggadocio — direct, unapologetic.",
            "Ad-libs on every bar end: (grrah), (skrrt), (bang), (free), (whoa).",
            "Short verses (8-12 bars), longer hooks (4-8 bars repeating).",
            "Use of local slang / regional dialect for authenticity.",
            "Beat drops on the first syllable of the hook after a 1-bar silence.",
        ],
        "vocal_delivery": "Aggressive, distorted, layered with ad-libs; deep bass, fast flows.",
    },
    "afrobeat": {
        "techniques": [
            "Polyrhythmic vocal phrasing: 3-over-2 rhythm, off-beat entrances.",
            "Call-and-response between lead vocal and backing vocals.",
            "Pidgin English or local language mixed with English for flavor.",
            "Shorter phrases (4-6 words) leaving room for percussion.",
            "Hook is a repetitive chant or phrase with a danceable groove.",
            "Bridge often features a key change or tempo shift (log drum drop).",
        ],
        "vocal_delivery": "Smooth, melodic, layered harmonies; percussive vocal attacks on off-beats.",
    },
    "country": {
        "techniques": [
            "Storytelling arc: setup → conflict → resolution in 3 verses + chorus.",
            "Specific details: small-town names, brands, landmarks, seasons.",
            "AABB rhyme scheme with occasional internal rhymes.",
            "Chorus is the emotional core — repeat verbatim, same words every time.",
            "Bridge shifts perspective or reveals a twist.",
            "Outro fades on a repeated hook or a final lyrical punchline.",
        ],
        "vocal_delivery": "Twangy, nasal, honest; often slightly broken or strained on emotional lines.",
    },
    "latin": {
        "techniques": [
            "Spanglish mixing: Spanish phrases for emotional emphasis, English for flow.",
            "Reggaeton dembow rhythm: syllables lock to the 4/4 kick pattern.",
            "Perreo / dance call-and-response: vocal line → crowd response → vocal line.",
            "Hook in Spanish if targeting Latin markets; bilingual for crossover.",
            "Short verses (4-8 bars), long repetitive hooks with dance breaks.",
            "Use of vocal effects: pitch-shifted ad-libs, reverb sweeps.",
        ],
        "vocal_delivery": "Smooth, rhythmic, playful; auto-tune for melodic hooks, raw for verses.",
    },
    "indie folk": {
        "techniques": [
            "Narrative lyrics: specific characters, places, seasons, sensory details.",
            "Stream-of-consciousness verses; less rigid rhyme, more internal assonance.",
            "Chorus is a 1-2 line mantra or question that ties the story together.",
            "Use nature and domestic imagery as emotional metaphors.",
            "Bridge often strips to just guitar + voice before building back.",
            "Fingerpicking or strumming patterns inform syllable pacing.",
        ],
        "vocal_delivery": "Raw, unpolished, breathy; close-miked, minimal reverb, natural tone.",
    },
    "edm": {
        "techniques": [
            "Instrumental-first: vocals are a texture, not the lead — short phrases over drops.",
            "Hook is a 1-4 word vocal chop repeated and processed (reversed, pitched).",
            "Build-up: 4-8 bars of rising tension with repeated vocal fragments.",
            "Drop has no lyrics — pure energy. Post-drop uses processed vocal shots.",
            "Verse is minimal: 1-2 lines repeated, leaving space for synths.",
            "Use vocal effects: reverb tails, delay echoes, formant shifts.",
        ],
        "vocal_delivery": "Processed, layered, ethereal; often pitched up or down; wide stereo image.",
    },
    "melodic dubstep": {
        "techniques": [
            "Intimate spoken-word verses: 3-5 word phrases, conversational, leave space for piano chords and reverse swells.",
            "Emotional sung hook: clear melody, short lines, repeat verbatim in chorus.",
            "Half-time groove feel: write syllables to sit behind the beat, not on top.",
            "Use vocal-formant bass replies as ad-libs: (yeah), (uh), (oh) — treat voice as another synth.",
            "Bridge strips to piano + vocal only before final euphoric drop section.",
            "Avoid over-writing: let the sub bass and wobble bass carry the energy; lyrics are the sparse human layer.",
        ],
        "vocal_delivery": "Organic warm male or female vocal; close-miked, intimate, slightly breathy; dry in verses, wide reverb on final hook.",
    },
    "psychedelic bass": {
        "techniques": [
            "Stream-of-consciousness imagery: surreal objects, color synesthesia, warped perspective.",
            "Short repetitive phrases (2-4 words) that loop over 145+ BPM momentum.",
            "Use onomatopoeia and texture words: (swell), (wobble), (glow), (drift).",
            "Verse feels like a fade-in dream; chorus snaps into clarity with sharper rhyme.",
            "Reverse-reverb vocal effect cues: write lyrics that sound good backwards or reversed.",
            "Outro fades into spoken-word fragment or chopped vocal sample.",
        ],
        "vocal_delivery": "Dusty vinyl vocal fragment aesthetic; slightly detuned, loose, improvisational; ad-libs treated as percussion.",
    },
    "electro-pop": {
        "techniques": [
            "Close-mic tense verses: whisper-close delivery, clipped phrases, every word counts.",
            "Commanding anthem chorus: 2-4 line motif, repeat 4+ times, maximum impact.",
            "Robotic harmony textures: write backing vocal lines that sound like synth patches (tight thirds, octaves).",
            "Pre-chorus builds with a single repeated phrase that rises in pitch or intensity.",
            "Bridge strips to voice + one metallic percussion element before final chorus.",
            "Use punchy imperative verbs: (run), (burn), (rise), (break) — action words over feeling words.",
        ],
        "vocal_delivery": "Powerful male or female lead; tense close-mic verses, commanding open chorus; Auto-Tune as aesthetic choice, not correction.",
    },
    "cinematic bass": {
        "techniques": [
            "Dramatic narrative arc: tension → breakdown → monumental release across sections.",
            "Choir-like hook: write lyrics that sound like they belong in a trailer — epic, concise, repeatable.",
            "Bridge features a cinematic string lift moment: lyrics drop out or reduce to 1-2 words.",
            "Use weaponized wit or theatrical honesty for emotional stakes.",
            "Post-chorus is a short, punchy vocal stab rather than a full repeated section.",
            "Outro ends on a sustained vowel or processed vocal chop, not a fade.",
        ],
        "vocal_delivery": "Wide, dramatic, dynamic; from near-whisper to full belt; production treats voice as the lead synth.",
    },
    "indie electronic": {
        "techniques": [
            "Conversational intimacy: write as if texting a friend at 2am; casual, specific, unpolished.",
            "Soaring layered chorus: gang-vocal response on the final hook; 3+ harmony layers.",
            "Major-to-minor chord movement: lyrics shift from hopeful verse to melancholic or determined chorus.",
            "Sparse late-night intro: 1-2 lines, leave space for the beat to breathe.",
            "Bridge provides a new perspective or a single striking image before the final build.",
            "Chopped vocal textures: repeat 1-2 words from the chorus and scatter them as ad-libs.",
        ],
        "vocal_delivery": "Intimate male or female lead; close-miked, natural tone, subtle auto-tune; harmonies wide and airy.",
    },
    "future bass": {
        "techniques": [
            "Cathartic release structure: build tension in verse, explode in drop chorus.",
            "Layered hook: main vocal + 2-3 harmony layers + gang-vocal stabs on final repetition.",
            "Short phrases (3-6 words) over 150 BPM; leave space for super-saw chords and arpeggios.",
            "Use major-to-minor pivot: verse in major, chorus in parallel minor for emotional whiplash.",
            "Pre-chorus is 1-2 lines that build with pitch or intensity.",
            "Outro is a short, glowing instrumental — no lyrical outro needed.",
        ],
        "vocal_delivery": "Soaring, layered, emotional; wide stereo harmonies; subtle pitch correction for polish without losing humanity.",
    },
    "deep dubstep": {
        "techniques": [
            "Warped fragments: break phrases into 2-3 word chunks with glitch-stained rests.",
            "Rubbery mid-bass exchanges: write call-and-response between vocal and bass tone.",
            "Half-time swing feel: syllables land on the half-beat, creating a lurching groove.",
            "Whispered intimacy: near-sung or spoken-word delivery in verses, dry and close.",
            "Melodic triumphant release: final chorus shifts from minor tension to major resolve.",
            "Avoid full sentences in verses; use telegraphic, staccato phrasing.",
        ],
        "vocal_delivery": "Warm male or female lead; dry close-miked, intimate, controlled; elastic pitch bends on keywords.",
    },
    "noir trip-hop": {
        "techniques": [
            "Noir storytelling: late-night urban scenes, rain, neon, solitude, moral ambiguity.",
            "Sparse lyrics: 1-2 lines per bar, leave massive space for the beat.",
            "Whispered female or androgynous male vocal: intimate, detached, cool.",
            "Use sampled-speech fragments: write lines that sound like they could be a vinyl sample.",
            "Tension builds through repetition with subtle variation, not through more words.",
            "Final release is melodic and wide — lyrics open up from noir minimalism into cinematic grandeur.",
        ],
        "vocal_delivery": "Dry, close, breathy; minimal reverb; whispered or half-spoken; cool detachment with emotional undertow.",
    },
    "uk grime": {
        "techniques": [
            "Calm spoken precision: fast 2-step flow but content is controlled, not chaotic.",
            "British dialect: write in natural UK speech patterns (man, innit, wasteman, ting) — sparingly, not forced.",
            "Restrained melodic lift: melody only on the hook, not the verses.",
            "Short 8-16 bar verses, longer 4-8 bar hooks with repetitive chant structure.",
            "Use of grime ad-libs: (skeng), (wagwan), (boom), (check) — as punctuation, not filler.",
            "Rain-dark atmosphere: lyrics reference weather, night, urban landscape as emotional backdrop.",
        ],
        "vocal_delivery": "Low-register female or male vocal; calm, precise, half-spoken; restrained melody only on the hook; modern crisp mix.",
    },
    "future garage": {
        "techniques": [
            "Sparse emotional fragments: 2-4 word phrases over shuffled 2-step drums.",
            "Distant chopped harmonies: write vocal lines that work when pitch-shifted and scattered.",
            "Restrained melodic lift: melody emerges slowly, usually only in the second half of the song.",
            "Rain-dark pads as emotional backdrop: lyrics mirror the darkness but with glimmers of light.",
            "Use repetition with delay: same 1-2 line motif echoed and filtered across sections.",
            "Female vocal sits low in the mix for verses, rises wide and reverb-drenched for the chorus.",
        ],
        "vocal_delivery": "Low-register female vocal; intimate, breathy, close-miked verses; wide, processed, ethereal chorus; filtered Reese bass as vocal duet.",
    },
}

# Per-engine lyric bracket conventions for pronunciation + delivery.
LYRIC_BRACKETS: dict[str, list[str]] = {
    "suno_v6": [
        "Section tags on their own line: [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Outro].",
        "Delivery cue in parentheses right after the tag: [Chorus] (belted, open vowels, wide).",
        "Backing vocals / ad-libs in parentheses on their own lines: (ooh), (yeah).",
        "Sustain spelling on open vowels only (ah, oh, ay, oo): lo-o-ove, staaay — once or twice per section.",
        "Hyphenate for clipped staccato reads: do-not-call-me-back.",
        "Write dialect words as sung in General American: gonna, wanna, kinda — never formal 'going to' in a casual chorus.",
    ],
    "minimax_30": [
        "One tag per line, official tags: [Intro] [Verse] [Pre Chorus] [Chorus] [Post Chorus] [Interlude] [Bridge] [Hook] [Build Up] [Break] [Transition] [Inst] [Solo] [Outro].",
        "Backing vocal cues in parentheses: (Ooh), (Yeah) — adds production polish.",
        "Keep lines short and singable; split prose into phrases. Dialect coloring goes in the vocal description, not spelled into every word.",
    ],
    "happyshrimp_10": [
        "Section labels [Verse] / [Pre-Chorus] / [Chorus]; prompt carries performance direction.",
        "Conversational American phrasing; chorus must be memorable after one listen.",
    ],
    "lyria_35": [
        "Custom lyrics behind a 'Lyrics:' prefix with [Verse] / [Chorus] / [Bridge] section tags.",
        "Background echo in parentheses: Lyrics: Let's go (go).",
        "Pronunciation is Lyria's weak spot vs Suno v6-mini: favor short common words, avoid clusters and rare vocabulary entirely.",
    ],
}

_SYSTEM_TEMPLATE = (
    "You are a music-prompt engineer for __LABEL__ (__ENGINE__).\n"
    'Return ONLY valid JSON with keys: "title" (short memorable song title, max 100 chars), '
    '"style" (string, the main paste-box: ready to paste), '
    '"exclude" (string, styles/instruments to avoid; empty string when not applicable), '
    '"lyrics" (string with section tags; empty string for instrumental mode), '
    '"settings" (object with the platform\'s copy-paste controls — see below), '
    '"notes" (array of 1-3 short strings), '
    '"warnings" (array, may be empty).\n'
    "\nPlatform rules (follow strictly):\n__RULES__\n"
    "\nLyric writing techniques for 2026 (apply when the brief specifies a lyric style or genre):\n"
    "__LYRIC_TECHNIQUES__\n"
    "\nUser brief:\n__BRIEF__\n"
    "\nWrite original lyrics only (never reproduce copyrighted lyrics or artist mimicry).\n"
    "Keep lines short and singable. Repeat the chorus verbatim when a chorus exists.\n"
    "For suno_v6: title max 100 chars; style = 5-8 comma-separated descriptors under 1000 chars "
    "(Genre+Era, Mood, 2-3 Instruments, Vocal, Production — most important first); "
    "exclude = comma-separated Exclude Styles tags (e.g. 'autotune, EDM drop, fade out'), never mixed into style; "
    "settings = {variety (0 to keep tags verbatim, else 1-100), style_influence ('Loose'|'Medium'|'Strong'), "
    "weirdness (0-100, 50 normal), vocal_gender, max_mode (true for >2 min songs or close covers), "
    "model_pick ('v6' flagship / 'v6-mini' free sketch / 'v6-wild' exploration)}; "
    "lyrics carry performance: parenthetical delivery cues + sustain spelling on open vowels.\n"
    "For minimax_30: title max 100 chars; style = narrative sentences + Structured Caption "
    "(Global Metadata / Vocal Details / Arrangement) with 2-3 arrangement events; "
    "exclude = things to avoid (maps to --avoid); "
    "settings = {is_instrumental (bool), lyrics_optimizer (bool, only when lyrics empty), "
    "audio_setting: {sample_rate (44100 recommended), bitrate (256000 recommended), format ('mp3'|'wav'|'pcm')}}; "
    "if brief says instrumental, return lyrics as empty string and put the full arrangement arc in style.\n"
    "For happyshrimp_10: title max 100 chars; style = natural-language scene with "
    "situation + genre anchor + voice + instruments + tempo + arc; exclude may be empty; "
    "settings = {mode ('Smart Lyrics'|'Custom Lyrics'|'Instrumental'), songs_per_run: 2}; "
    "if brief says instrumental, return lyrics as empty string.\n"
    "For lyria_35: title max 100 chars; style = descriptive prompt with detailed singer profile "
    "and explicit duration; exclude MUST be empty string (Lyria 3.5 does not support negative "
    "prompting — mention that in notes instead); lyrics use a 'Lyrics:' block with section tags; "
    "settings = {model ('lyria-3.5' full song / 'lyria-3-clip-preview' fast 30s draft), "
    "response_format ('wav' for edits, 'mp3' otherwise)}; "
    "if brief asks for a timeline, write style as a [mm:ss - mm:ss] timestamp timeline.\n"
)


def _format_brief(brief: dict[str, Any]) -> str:
    """Render user brief without .format() so {braces} in input can't crash us."""
    fields = ("theme", "genre", "mood", "tempo", "key", "vocal", "instruments",
              "language", "dialect", "tricky_words", "duration", "extra",
              "exclude", "use_case", "lyric_style")
    lines = []
    for key in fields:
        value = brief.get(key, "")
        if value:
            lines.append(f"{key.capitalize()}: {value}")
    for flag in ("instrumental", "timeline"):
        if brief.get(flag):
            lines.append(f"{flag.capitalize()}: yes")
    return "\n".join(lines) or "(empty brief)"


def build_system_prompt(platform: str, brief: dict[str, Any]) -> str:
    spec = PLATFORM_SPECS[platform]
    rules = "\n".join(f"- {r}" for r in spec["rules"])
    brackets = "\n".join(f"- {b}" for b in LYRIC_BRACKETS.get(platform, []))
    dialect = str(brief.get("dialect", "") or "General American").strip()
    tricky = str(brief.get("tricky_words", "") or "").strip()
    genre = str(brief.get("genre", "") or "").strip().lower()
    lyric_style = str(brief.get("lyric_style", "") or "").strip()

    # Build technique guidance: include genre-specific techniques + any
    # explicitly requested lyric style techniques.
    technique_lines: list[str] = []
    if genre and genre in LYRIC_TECHNIQUES:
        entry = LYRIC_TECHNIQUES[genre]
        technique_lines.extend(entry["techniques"])
        if entry.get("vocal_delivery"):
            technique_lines.append(f"Vocal delivery for {genre}: {entry['vocal_delivery']}")
    if lyric_style:
        normalized = lyric_style.lower()
        matched = False
        for key, entry in LYRIC_TECHNIQUES.items():
            if normalized in key or key in normalized:
                for t in entry["techniques"]:
                    if t not in technique_lines:
                        technique_lines.append(t)
                if entry.get("vocal_delivery") and f"Vocal delivery for {key}:" not in "\n".join(technique_lines):
                    technique_lines.append(f"Vocal delivery for {key}: {entry['vocal_delivery']}")
                matched = True
                break
        if not matched:
            for k, tips in GENERIC_LYRIC_STYLES.items():
                if k in normalized:
                    technique_lines.extend(tips)
                    matched = True
                    break
    if not technique_lines:
        technique_lines.append(
            "Default: use 2026 pop techniques — hook-first, AABB or ABAB rhyme, "
            "simple, catchy, repeat the chorus verbatim."
        )
    technique_block = "\n".join(f"- {t}" for t in technique_lines)
    pron = (
        f"\nDialect: write all lyrics to sing naturally in {dialect} American "
        "delivery (casual contractions, sung spellings, no formal/stiff phrasing).\n"
        "Lyric bracket conventions for this engine:\n" + brackets + "\n"
        "Respell any word the engine would stumble on into a singable form "
        "(e.g. 'rural' -> 'roo-rul' only if it must stay; prefer replacing it)."
    )
    if tricky:
        pron += f"\nWords that stumbled before — respell or replace: {tricky}."
    return (
        _SYSTEM_TEMPLATE
        .replace("__LABEL__", spec["label"])
        .replace("__ENGINE__", spec["engine"])
        .replace("__RULES__", rules)
        .replace("__BRIEF__", _format_brief(brief))
        .replace("__LYRIC_TECHNIQUES__", technique_block)
        + pron
    )


def build_user_prompt(brief: dict[str, Any]) -> str:
    theme = str(brief.get("theme", "") or "").strip()
    genre = str(brief.get("genre", "") or "open").strip()
    duration = str(brief.get("duration", "") or "full song").strip()
    extras: list[str] = []
    if brief.get("key"):
        extras.append(f"in {brief['key']}")
    if brief.get("instrumental"):
        extras.append("as an instrumental with no vocals")
    if brief.get("timeline"):
        extras.append("with a [mm:ss - mm:ss] timestamp timeline")
    suffix = (" " + " ".join(extras)) if extras else ""
    return f"Write a {duration} in genre {genre}{suffix} about: {theme}"


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def _coerce_str(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "\n".join(_coerce_str(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _extract_json(text: str) -> dict[str, Any]:
    """Best-effort JSON extraction from LLM output (handles code fences)."""
    raw = (text or "").strip()
    fence = _FENCE_RE.search(raw)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {"prompt": "", "lyrics": _coerce_str(data), "notes": [], "warnings": []}
    except Exception:
        pass
    # Balanced parse: try decoding from each '{' until one succeeds
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", raw):
        try:
            data, _ = decoder.raw_decode(raw[match.start():])
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    # Fallback: treat whole output as lyrics draft
    return {"prompt": "", "lyrics": raw, "notes": [], "warnings": ["LLM did not return JSON; showing raw output as lyrics."]}


def _normalize(data: dict[str, Any]) -> dict[str, Any]:
    """Guarantee string title/style/exclude/prompt/lyrics + list notes/warnings.

    `prompt` is a legacy alias of `style`: old models return `prompt`, new ones
    return `style`. Both keys are always populated with the same value so old
    and new clients keep working.
    """
    style = _coerce_str(data.get("style", "")) or _coerce_str(data.get("prompt", ""))
    data["style"] = style
    data["prompt"] = style  # legacy alias
    data["title"] = _coerce_str(data.get("title", ""))
    data["exclude"] = _coerce_str(data.get("exclude", ""))
    data["lyrics"] = _coerce_str(data.get("lyrics", ""))
    settings = data.get("settings")
    data["settings"] = settings if isinstance(settings, dict) else {}
    notes = data.get("notes") or []
    data["notes"] = [_coerce_str(n) for n in notes] if isinstance(notes, list) else [_coerce_str(notes)]
    warnings = data.get("warnings") or []
    data["warnings"] = [_coerce_str(w) for w in warnings] if isinstance(warnings, list) else [_coerce_str(warnings)]
    return data


def _default_settings(platform: str, brief: dict[str, Any]) -> dict[str, Any]:
    """Sensible copy-paste controls when the model omits the settings object."""
    instrumental = bool(brief.get("instrumental"))
    if platform == "suno_v6":
        return {
            "variety": 0,
            "style_influence": "Strong",
            "weirdness": 50,
            "vocal_gender": "",
            "max_mode": False,
            "model_pick": "v6-mini for free sketches, v6 flagship for the finish",
        }
    if platform == "minimax_30":
        return {
            "is_instrumental": instrumental,
            "lyrics_optimizer": False,
            "audio_setting": {"sample_rate": 44100, "bitrate": 256000, "format": "mp3"},
        }
    if platform == "happyshrimp_10":
        return {
            "mode": "Instrumental" if instrumental else "Smart Lyrics",
            "songs_per_run": 2,
        }
    if platform == "lyria_35":
        return {
            "model": "lyria-3-clip-preview for fast 30s drafts, lyria-3.5 for the full song",
            "response_format": "wav for edits, mp3 otherwise",
        }
    return {}


def validate_output(platform: str, data: dict[str, Any], brief: dict[str, Any] | None = None) -> list[str]:
    warnings: list[str] = list(data.get("warnings") or [])
    title = _coerce_str(data.get("title", ""))
    prompt = _coerce_str(data.get("style", "") or data.get("prompt", ""))
    lyrics = _coerce_str(data.get("lyrics", ""))
    exclude = _coerce_str(data.get("exclude", ""))
    brief = brief or {}
    if title and len(title) > 100:
        warnings.append(f"Title {len(title)} chars exceeds the ~100-char title field; shorten it.")
    if platform == "suno_v6":
        if len(prompt) > 1000:
            warnings.append(f"Style prompt {len(prompt)} chars exceeds Suno 1000-char field; front-load key tags.")
        tags = [t.strip() for t in prompt.split(",") if t.strip()]
        if len(tags) > 10:
            warnings.append(f"{len(tags)} descriptors — trim to 5-8 to avoid mush.")
        if lyrics.strip() and "[Verse]" not in lyrics and "[Chorus]" not in lyrics:
            warnings.append("Add [Verse]/[Chorus] section tags to lyrics for structure.")
        if exclude and len(exclude) > 500:
            warnings.append("Exclude Styles is very long; keep it to a few comma-separated tags.")
        settings = data.get("settings") or {}
        if settings.get("variety", 0) != 0:
            warnings.append("Variety > 0 lets v6 rewrite your style text — set Variety to 0 to keep tags verbatim.")
    elif platform == "minimax_30":
        if len(prompt) > 2000:
            warnings.append("Prompt exceeds MiniMax 2000-char limit.")
        if len(lyrics) > 3500:
            warnings.append("Lyrics exceed MiniMax 3500-char limit.")
        if brief.get("instrumental") and lyrics.strip():
            warnings.append("Instrumental mode: clear the lyrics and let the prompt carry the arrangement.")
    elif platform == "happyshrimp_10":
        if len(prompt) > 5000:
            warnings.append("Prompt exceeds HappyShrimp 5000-char box.")
        genre_words = [g.strip() for g in _coerce_str(brief.get("genre", "")).replace("/", ",").split(",") if g.strip()]
        if len(genre_words) > 2:
            warnings.append("HappyShrimp is weak at genre fusions — pick one anchor genre instead of blending.")
    elif platform == "lyria_35":
        if lyrics.strip() and "Lyrics:" not in lyrics and "Lyrics:" not in prompt:
            warnings.append("Prefix custom lyrics with 'Lyrics:' for Lyria 3.5.")
        if exclude.strip():
            warnings.append("Lyria 3.5 has no negative prompting — describe what you want instead of pasting Exclude.")
        if brief.get("timeline") and "[0:" not in prompt and "[00:" not in prompt:
            warnings.append("Timeline requested but no [mm:ss] marks found — ask for a timestamped timeline.")
    if not prompt and not lyrics and not title:
        warnings.append("Empty result from model.")
    if lyrics.strip():
        stumbled = sorted({w for w in STUMBLE_PRONE if re.search(rf"\b{re.escape(w)}\b", lyrics, re.IGNORECASE)})
        if stumbled:
            warnings.append(f"Stumble-prone words in lyrics ({', '.join(stumbled)}) — respell or replace before pasting.")
        tricky = [t.strip().lower() for t in _coerce_str(brief.get("tricky_words", "")).replace(",", "\n").split("\n") if t.strip()]
        unhandled = [t for t in tricky if re.search(rf"\b{re.escape(t)}\b", lyrics, re.IGNORECASE)]
        if unhandled:
            warnings.append(f"Previously stumbled words still verbatim ({', '.join(unhandled)}) — respell them (e.g. stretched vowels) or swap them out.")
        if platform == "lyria_35":
            long_words = sorted({w for w in re.findall(r"[A-Za-z]{11,}", lyrics) if w.lower() not in ("instrumental",)})
            if len(long_words) > 3:
                warnings.append(f"Lyria pronounces worse than Suno v6-mini — simplify long words ({', '.join(long_words[:5])}) or test on v6-mini first.")
    return warnings


def _char_counts(platform: str, data: dict[str, Any]) -> dict[str, Any]:
    limits = PLATFORM_LIMITS.get(platform, {})
    style = _coerce_str(data.get("style", "") or data.get("prompt", ""))
    return {
        "title_chars": len(_coerce_str(data.get("title", ""))),
        "title_limit": limits.get("title"),
        "style_chars": len(style),
        "style_limit": limits.get("style"),
        "exclude_chars": len(_coerce_str(data.get("exclude", ""))),
        "exclude_limit": None,
        # Legacy aliases for old clients
        "prompt_chars": len(style),
        "lyrics_chars": len(_coerce_str(data.get("lyrics", ""))),
        "prompt_limit": limits.get("prompt", limits.get("style")),
        "lyrics_limit": limits.get("lyrics"),
    }


async def generate_music_prompt(
    platform: str,
    brief: dict[str, Any],
    model: str | None = None,
    adapter: Any | None = None,
) -> dict[str, Any]:
    """Generate title + style + exclude + lyrics for one engine via local Ollama."""
    if platform not in SUPPORTED_PLATFORMS:
        raise ValueError(f"Unsupported platform: {platform}")
    if adapter is None:
        from ..adapters.ollama import OllamaAdapter

        adapter = OllamaAdapter(mock_mode=False)
    chosen = (model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    system = build_system_prompt(platform, brief)
    user = build_user_prompt(brief)
    payload_base: dict[str, Any] = {
        "system": system,
        "format": "json",
        "think": False,
        "options": {"temperature": 0.85, "num_ctx": 8192},
    }

    async def _call(model_name: str) -> dict[str, Any]:
        result = await adapter.generate({**payload_base, "prompt": user, "model": model_name})
        return _normalize(_extract_json(result.get("response", "")))

    try:
        data = await _call(chosen)
    except Exception as exc:  # model missing / Ollama down -> try fallback, then error text
        logger.warning("Primary model %s failed (%s), trying %s", chosen, exc, FALLBACK_MODEL)
        if chosen == FALLBACK_MODEL:
            logger.error("Music prompt generation failed: %s", exc)
            data = _normalize({
                "prompt": "",
                "lyrics": "",
                "notes": [],
                "warnings": [f"Generation failed: {exc}. Is Ollama running with {chosen}?"],
            })
        else:
            try:
                data = await _call(FALLBACK_MODEL)
                chosen = FALLBACK_MODEL
            except Exception as exc2:
                logger.error("Music prompt generation failed: %s", exc2)
                data = _normalize({
                    "prompt": "",
                    "lyrics": "",
                    "notes": [],
                    "warnings": [f"Generation failed: {exc2}. Is Ollama running with {chosen}?"],
                })
    data["warnings"] = validate_output(platform, data, brief)
    data["platform"] = platform
    data["model_used"] = chosen
    if not data.get("settings"):
        data["settings"] = _default_settings(platform, brief)
    data.update(_char_counts(platform, data))
    data["spec"] = {
        "label": PLATFORM_SPECS[platform]["label"],
        "engine": PLATFORM_SPECS[platform]["engine"],
    }
    return data
