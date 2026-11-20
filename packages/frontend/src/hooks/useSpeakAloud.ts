/**
 * useSpeakAloud — read assistant messages aloud through Pocket TTS.
 *
 * Fetches one audio blob per message via /api/voice/pocket/speak and plays
 * it through a single HTMLAudioElement (new speech replaces the old).
 * Voice defaults to the Pocket default voice resolved once from
 * /api/voice/pocket/voices; pass `voice` to override.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getPocketVoices, speakPocket } from "../services/api/voice_pocket";

const MAX_SPEAK_CHARS = 1200;

/** Strip markdown so the voice doesn't read syntax aloud. */
export function toSpeakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPEAK_CHARS);
}

export interface SpeakAloud {
  /** Speak text now; replaces anything currently playing. Resolves when done. */
  speak: (text: string) => Promise<void>;
  stop: () => void;
  speaking: boolean;
  /** Pocket default voice name, once resolved ("" until loaded). */
  voice: string;
}

export function useSpeakAloud(voiceOverride?: string): SpeakAloud {
  const [speaking, setSpeaking] = useState(false);
  const [defaultVoice, setDefaultVoice] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPocketVoices()
      .then((res) => {
        if (!cancelled) setDefaultVoice(res.default_voice);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = "";
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (rawText: string) => {
      const text = toSpeakableText(rawText);
      if (!text) return;
      stop();
      const voice = voiceOverride ?? (defaultVoice === "" ? "maya-blend65" : defaultVoice);
      const controller = new AbortController();
      abortRef.current = controller;
      setSpeaking(true);
      try {
        const blob = await speakPocket(text, voice, controller.signal);
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
      } catch {
        /* aborted or engine offline — stay silent */
      } finally {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
        abortRef.current = null;
        audioRef.current = null;
        setSpeaking(false);
      }
    },
    [stop, voiceOverride, defaultVoice],
  );

  // Stop playback if the page unmounts.
  useEffect(() => stop, [stop]);

  const resolvedVoice = voiceOverride ?? defaultVoice;
  return { speak, stop, speaking, voice: resolvedVoice };
}
