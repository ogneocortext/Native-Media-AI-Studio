/**
 * NSFW visibility gate — the client half of `show_nsfw`.
 *
 * The server is authoritative: while `show_nsfw` is false, list/recent/search
 * endpoints drop flagged items entirely, so this store never decides what is
 * hidden — only whether the /nsfw destination is offered in the nav and
 * rendered by the route.
 *
 * The safe default is false: until the settings fetch resolves (or if it
 * fails), the app behaves as a fresh install, with no NSFW entry anywhere.
 */
import { create } from "zustand";
import { getSettings } from "../services/api";

interface NsfwState {
  /** Mirrors config/settings.json `show_nsfw`. */
  showNsfw: boolean;
  /** False until the first settings read has resolved. */
  loaded: boolean;
  /** Read the setting once per session; safe to call from several places. */
  load: () => Promise<void>;
  /** Local mirror update after the Settings page has persisted the toggle. */
  setShowNsfw: (value: boolean) => void;
}

/** In-flight load, so a nav mount and a page mount share one request. */
let inFlight: Promise<void> | null = null;

export const useNsfwStore = create<NsfwState>((set, get) => ({
  showNsfw: false,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    inFlight ??= (async () => {
      try {
        const settings = await getSettings();
        set({ showNsfw: settings.show_nsfw === true, loaded: true });
      } catch {
        // Stay closed. A failed settings read must not open the gate.
        set({ showNsfw: false, loaded: true });
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  },
  setShowNsfw: (value: boolean) => set({ showNsfw: value, loaded: true }),
}));
