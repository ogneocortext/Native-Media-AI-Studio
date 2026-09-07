import type { WizardStep } from "./useGeneration3D";

interface WizardStepperProps {
  step: WizardStep;
  onStepChange: (step: WizardStep) => void;
}

export function WizardStepper({ step, onStepChange }: WizardStepperProps) {
  const steps: { key: WizardStep; label: string; description: string }[] = [
    { key: "describe", label: "Describe", description: "Prompt, character bible, and reference image" },
    { key: "style", label: "Style", description: "Model selection and generation parameters" },
    { key: "generate", label: "Generate", description: "Review configuration and run pipeline" },
  ];

  const stepIndex = steps.findIndex((s) => s.key === step);

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center justify-between">
        {steps.map((s, idx) => {
          const state = idx < stepIndex ? "done" : idx === stepIndex ? "active" : "upcoming";
          return (
            <button
              key={s.key}
              onClick={() => onStepChange(s.key)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all capitalize text-sm min-w-[140px] ${
                state === "active"
                  ? "bg-violet-600/20 border-violet-500 text-white shadow-[0_0_12px_rgba(139,92,246,0.25)]"
                  : state === "done"
                  ? "bg-emerald-900/30 border-emerald-700 text-emerald-200 hover:bg-emerald-900/50"
                  : "bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                  state === "active"
                    ? "bg-violet-500 text-white shadow-[0_0_8px_rgba(139,92,246,0.4)]"
                    : state === "done"
                    ? "bg-emerald-500 text-white"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {state === "done" ? "✓" : idx + 1}
              </span>
              <div className="flex flex-col items-start leading-tight">
                <span className="font-medium text-xs">{s.label}</span>
                <span className={`text-[10px] ${state === "active" ? "text-violet-300" : "text-gray-500"}`}>{s.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
