/**
 * MasteringPage — dedicated loudness normalization + true-peak limiter page.
 *
 * Gives mastering its own frontend section instead of being mixed into the
 * Visualizer, which was making that page cluttered.
 *
 * Backend: POST /api/audio/master, GET /api/audio/master/measure/{filename}
 * (implemented in packages/backend/app/api/audio_mastering.py +
 * packages/backend/app/services/mastering.py).
 *
 * Per AGENTS.md D16, track selection goes through useAudioLibrary() — the
 * store deduplicates and tags names; the panel renders optionLabel and never
 * re-derives track names with a local regex.
 */

import { Suspense, lazy } from "react";
import { DS } from "../../styles/designSystem";

const MasteringPanel = lazy(
  () => import("../audio-analysis/components/MasteringPanel").then((mod) => ({ default: mod.MasteringPanel })),
);

export function MasteringPage() {
  return (
    <div className={`${DS.card} p-6`}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-muted-foreground"
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
          <h1 className="text-lg font-semibold">Mastering</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Measure loudness and master library tracks to a delivery loudness
          target (Spotify, Apple, Competitive, Amazon) with a QC report.
        </p>
        <div className="h-1 w-full bg-border" />
        <Suspense fallback={<div className="h-64 animate-pulse" />}>
          <MasteringPanel />
        </Suspense>
      </div>
    </div>
  );
}
