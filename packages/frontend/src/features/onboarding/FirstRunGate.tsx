/**
 * FirstRunGate — gate for the Dashboard route.
 *
 * Sends a first-time user with an empty library to the onboarding path.
 * A user with a non-empty library is left alone — the banner on the Dashboard
 * offers the path instead of taking it.
 *
 * Extracted into its own file so App.tsx can import it statically without
 * pulling the heavy OnboardingPage / OnboardingFlow component tree into the
 * main chunk. OnboardingPage remains lazy-loaded via `lazy()` in App.tsx.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAudioLibrary } from "../../hooks/useAudioLibrary";
import { useFirstRunDetector } from "./FirstRunDetector";

export function FirstRunGate({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { isFirstRun } = useFirstRunDetector();
  const { entries, isLoading } = useAudioLibrary();

  useEffect(() => {
    if (isFirstRun === undefined || isLoading) return;
    if (entries.length === 0) void navigate("/onboarding", { replace: true });
  }, [isFirstRun, isLoading, entries.length, navigate]);

  // While the gate is deciding, render nothing rather than flashing the
  // dashboard at someone who is about to be redirected.
  if (isFirstRun === true && !isLoading && entries.length === 0) return null;

  return <>{children}</>;
}
