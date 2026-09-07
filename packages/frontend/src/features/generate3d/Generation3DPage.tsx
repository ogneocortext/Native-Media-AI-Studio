import { useNavigate } from "react-router-dom";
import { useGeneration3D } from "./useGeneration3D";
import { PageHeader } from "./PageHeader";
import { WizardStepper } from "./WizardStepper";
import { ModelSelector } from "./ModelSelector";
import { AdvancedParams } from "./AdvancedParams";
import { PromptSection } from "./PromptSection";
import { CharacterBiblePanel } from "./CharacterBiblePanel";
import { ReferenceImageSection } from "./ReferenceImageSection";
import { GenerateButton } from "./GenerateButton";
import { ResultPanel } from "./ResultPanel";
import { ServiceStatusCard } from "./ServiceStatusCard";
import { GeneratedHistoryCard } from "./GeneratedHistoryCard";
import { RenderingGuideCard } from "./RenderingGuideCard";
import { PipelineCard } from "./PipelineCard";
import { ConfigurationSummary } from "./ConfigurationSummary";

export function Generation3DPage() {
  const navigate = useNavigate();
  const hook = useGeneration3D(navigate);

  const handleCharacterTemplate = (_prompt: string, bible: string, label: string) => {
    hook.setCharNotes(bible);
    if (!hook.charName.trim()) hook.setCharName(label);
  };

  const handleReset = () => {
    hook.setWizardStep("describe");
    hook.setPrompt("");
    hook.setModel("hunyuan3d-2mini");
    hook.setSteps(15);
    hook.setCharName("");
    hook.setCharNotes("");
    hook.setSeed(42);
    hook.setGenMode("text");
    hook.handleReferenceFile(null);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <PageHeader hook={hook} />
      <WizardStepper step={hook.wizardStep} onStepChange={hook.setWizardStep} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {hook.wizardStep === "describe" && (
            <>
              <div className="bg-gray-800 rounded-xl border border-gray-700">
                <div className="p-5 border-b border-gray-700">
                  <h2 className="text-sm font-semibold text-gray-200">Prompt</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Start with what you want to build. Pick a template or write your own prompt, then lock the character identity if this is a recurring subject.
                  </p>
                </div>
                <div className="p-5">
                  <PromptSection
                    prompt={hook.prompt}
                    setPrompt={hook.setPrompt}
                    wordCount={hook.wordCount}
                    genMode={hook.genMode}
                    setGenMode={hook.setGenMode}
                    onCharacterTemplateSelect={handleCharacterTemplate}
                  />
                </div>
              </div>

              <div className="bg-gray-800 rounded-xl border border-gray-700">
                <div className="p-5 border-b border-gray-700">
                  <h2 className="text-sm font-semibold text-gray-200">Character Bible</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Optional but recommended for characters. This bibles the model so reruns stay consistent across shots.
                  </p>
                </div>
                <div className="p-5">
                  <CharacterBiblePanel hook={hook} />
                </div>
              </div>

              <ReferenceImageSection hook={hook} />

              <div className="flex justify-end">
                <button
                  onClick={() => hook.setWizardStep("style")}
                  disabled={!hook.prompt.trim() || hook.wordCount > 75}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-400 text-white rounded-lg border border-violet-500 transition-colors"
                >
                  Next: Style &rarr;
                </button>
              </div>
            </>
          )}

          {hook.wizardStep === "style" && (
            <>
              <div className="bg-gray-800 rounded-xl border border-gray-700">
                <div className="p-5 border-b border-gray-700">
                  <h2 className="text-sm font-semibold text-gray-200">Model</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Pick the model and quality level. Hunyuan3D-2mini is the safe default for 8GB VRAM.
                  </p>
                </div>
                <div className="p-5">
                  <ModelSelector hook={hook} />
                </div>
              </div>

              <div className="bg-gray-800 rounded-xl border border-gray-700">
                <div className="p-5 border-b border-gray-700">
                  <h2 className="text-sm font-semibold text-gray-200">Advanced Parameters</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Fine-tune generation behavior. Leave these at defaults unless you know what you&apos;re changing.
                  </p>
                </div>
                <div className="p-5">
                  <AdvancedParams hook={hook} />
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => hook.setWizardStep("describe")}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg border border-gray-600 transition-colors"
                >
                  &larr; Back
                </button>
                <button
                  onClick={() => hook.setWizardStep("generate")}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg border border-violet-500 transition-colors"
                >
                  Next: Generate &rarr;
                </button>
              </div>
            </>
          )}

          {hook.wizardStep === "generate" && (
            <>
              <ConfigurationSummary hook={hook} />

              <div className="bg-gray-800 rounded-xl border border-gray-700">
                <div className="p-5 border-b border-gray-700">
                  <h2 className="text-sm font-semibold text-gray-200">Generate</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    Ready to render. Keep this tab open; VRAM swapping may pause Ollama while the model loads.
                  </p>
                </div>
                <div className="p-5 space-y-4">
                  <GenerateButton hook={hook} />
                  {hook.error && (
                    <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg p-3 text-xs">
                      {hook.error}
                    </div>
                  )}
                </div>
              </div>

              <ResultPanel hook={hook} />

              <div className="flex justify-between">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg border border-gray-600 transition-colors"
                >
                  ↺ Start Over
                </button>
                <button
                  onClick={() => hook.setWizardStep("style")}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg border border-gray-600 transition-colors"
                >
                  &larr; Back to Style
                </button>
              </div>
            </>
          )}
        </div>

        <div className="space-y-6">
          <ServiceStatusCard hook={hook} />
          <PipelineCard />
          {hook.wizardStep === "describe" && (
            <>
              <GeneratedHistoryCard hook={hook} />
              <RenderingGuideCard />
            </>
          )}
          {hook.wizardStep === "style" && (
            <RenderingGuideCard />
          )}
        </div>
      </div>
    </div>
  );
}
