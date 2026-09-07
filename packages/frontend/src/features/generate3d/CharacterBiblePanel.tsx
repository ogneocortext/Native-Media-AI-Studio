import { RefreshCw } from "lucide-react";
import type { UseGeneration3DReturn } from "./useGeneration3D";

interface CharacterBiblePanelProps {
  hook: UseGeneration3DReturn;
}

export function CharacterBiblePanel({ hook }: CharacterBiblePanelProps) {
  const { charName, setCharName, charNotes, setCharNotes, seed, setSeed, randomizeSeed } = hook;

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <label className="text-sm font-medium text-gray-300 block mb-2">Character bible <span className="text-gray-500 font-normal">— consistency lock</span></label>
      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2">
        <input
          value={charName}
          onChange={(e) => setCharName(e.target.value)}
          placeholder="Name (e.g. Copper Builder)"
          aria-label="Character name"
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
        />
        <input
          value={charNotes}
          onChange={(e) => setCharNotes(e.target.value)}
          placeholder="Notes: copper skin, shaved head, teal jacket…"
          aria-label="Character notes"
          className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500"
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <label className="text-xs text-gray-400" htmlFor="gen3d-seed">Seed</label>
        <input
          id="gen3d-seed"
          type="number"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value) || 0)}
          className="w-28 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-violet-500"
          title="Lock the seed to reproduce a character; randomize for variations"
        />
        <button
          onClick={randomizeSeed}
          className="text-xs px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-300 hover:border-violet-500/40 flex items-center gap-1"
          title="Randomize seed"
        >
          <RefreshCw size={12} /> Random
        </button>
        <span className="text-[11px] text-gray-500">Same seed + same prompt = same mesh. Pick a template to prefill.</span>
      </div>
    </div>
  );
}
