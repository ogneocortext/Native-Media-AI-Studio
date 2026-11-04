/**
 * OnboardingPage — the `/onboarding` route, and the first-run gate.
 *
 * Route shape (Option A, per `docs/ux/5-minute-path.md`): a dedicated route,
 * not a modal and not a dashboard toggle. A modal fights the stage; a toggle
 * is a setting, and the path's whole point is no settings.
 *
 * Two entry rules:
 *   - First run + empty library → the app opens here. The path *is* the
 *     empty state.
 *   - First run + non-empty library (existing installs) → no hijack; the
 *     Dashboard shows a one-time banner that links here instead.
 *
 * `FirstRunGate` implements the first rule and is mounted on the Dashboard
 * route. The page itself is always reachable — it is also the "Quick start"
 * nav item.
 */

import { useNavigate } from "react-router-dom";
import { useFirstRunDetector } from "./FirstRunDetector";
import { OnboardingFlow } from "./OnboardingFlow";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { complete } = useFirstRunDetector();

  const handleExit = async () => navigate("/");

  return (
    <OnboardingFlow
      onExit={handleExit}
      // Completion sets the flag but does NOT navigate: the success card is
      // the celebration, and the user leaves the path through its own three
      // actions (keep it, go deeper, or make another).
      onComplete={() => complete()}
    />
  );
}
