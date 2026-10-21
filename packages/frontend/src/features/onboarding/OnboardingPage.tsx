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

import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { useFirstRunDetector } from "./FirstRunDetector";
import { OnboardingFlow } from "./OnboardingFlow";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { complete } = useFirstRunDetector();

  const handleExit = () => navigate("/");

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

/**
 * Gate for the Dashboard route: sends a first-time user with an empty
 * library to the onboarding path. A user with a non-empty library is left
 * alone — the banner on the Dashboard offers the path instead of taking it.
 */
export function FirstRunGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { isFirstRun } = useFirstRunDetector();
  const { entries, isLoading } = useAudioLibrary();

  useEffect(() => {
    if (isFirstRun === undefined || isLoading) return;
    if (entries.length === 0) navigate("/onboarding", { replace: true });
  }, [isFirstRun, isLoading, entries.length, navigate]);

  // While the gate is deciding, render nothing rather than flashing the
  // dashboard at someone who is about to be redirected.
  if (isFirstRun === true && !isLoading && entries.length === 0) return null;

  return <>{children}</>;
}

/** Redirect helper for routes that should never render during the gate. */
export function OnboardingRedirect() {
  return <Navigate to="/onboarding" replace />;
}
