/**
 * Re-export of the canonical remix wizard from the remix feature.
 *
 * This file previously held a byte-identical copy of
 * `packages/frontend/src/features/remix/remixWizard.ts`. Keeping one source of
 * truth means a change to the wizard logic is made once, not in two places.
 *
 * The visualizer's RemixPanel imports these names from `./remixWizard`, so this
 * re-export keeps those imports working without duplicating code.
 */

export {
  buildWizardSlots,
  safeVocalsStartBar,
  wizardDurationSec,
  wizardName,
  wizardSummary,
  type WizardGoal,
  type WizardInput,
} from "../../remix/remixWizard";
