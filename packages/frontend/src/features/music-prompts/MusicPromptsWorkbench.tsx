import { useState } from "react";
import { MusicPromptGenerator } from "./MusicPromptGenerator";
import { TrebloTagPicker } from "./TrebloTagPicker";

/**
 * The music-prompts workbench: two sibling tools in one section.
 *
 * The generator engineers prose and structure; the picker supplies exact verified
 * Treblo tags. They are deliberately NOT coupled in v1 — no auto-merging of LLM
 * output into picked tags — because whether exact tags beat a well-written
 * natural-language description is still the open experiment (SPEC.md). Tabs, not
 * a merge, so each tool can be judged on its own.
 */
type Tab = "generator" | "tags";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "generator", label: "Prompt Generator", hint: "Engineer prose and structure" },
  { id: "tags", label: "Tag Picker", hint: "Pick exact Treblo tags" },
];

export function MusicPromptsWorkbench() {
  const [tab, setTab] = useState<Tab>("generator");

  return (
    <div className="space-y-4">
      <nav role="tablist" aria-label="Music prompt tools" className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            title={t.hint}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? "border-blue-500 text-blue-300"
                : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Both panels stay mounted: the generator keeps its state when the user
          steps over to refine tags and back. */}
      <div role="tabpanel" hidden={tab !== "generator"}>
        {tab === "generator" && <MusicPromptGenerator />}
      </div>
      <div role="tabpanel" hidden={tab !== "tags"}>
        {tab === "tags" && <TrebloTagPicker />}
      </div>
    </div>
  );
}

export default MusicPromptsWorkbench;
