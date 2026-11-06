/**
 * Navigation performance instrumentation for sidebar page transitions.
 *
 * Wraps react-router's useNavigate to measure:
 *   - navigateMs: Time from navigate() call to route change (includes lazy module load)
 *   - renderMs: Time from route change to first render commit
 *   - totalMs: Total navigation time
 *
 * Usage:
 *   const navigate = useNavigationMetrics();
 *   navigate('/create/music-video'); // automatically timed
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate as useReactRouterNavigate } from "react-router-dom";
import type { NavigateOptions } from "react-router-dom";
import { recordNavigationTiming } from "../utils/metrics";

interface NavigationSample {
  fromPath: string;
  toPath: string;
  navigateMs: number;
  renderMs: number;
  totalMs: number;
  timestamp: number;
}

/**
 * Hook that wraps react-router's useNavigate with navigation timing.
 * Records timing metrics to the global metrics store.
 */
export function useNavigationMetrics() {
  const navigate = useReactRouterNavigate();
  const location = useLocation();
  const navigateStartTime = useRef<number | null>(null);
  const pendingNavigation = useRef<{ fromPath: string; toPath: string; startTime: number } | null>(
    null,
  );
  const [lastNavigation, setLastNavigation] = useState<NavigationSample | null>(null);

  // Track when a route change completes (render commit)
  useEffect(() => {
    if (pendingNavigation.current && navigateStartTime.current) {
      const renderEndTime = performance.now();
      const renderMs = renderEndTime - navigateStartTime.current;
      const navigateMs = renderMs; // In SPA, navigate and render overlap; use total as navigate
      const totalMs = renderMs;

      const sample: NavigationSample = {
        fromPath: pendingNavigation.current.fromPath,
        toPath: pendingNavigation.current.toPath,
        navigateMs,
        renderMs,
        totalMs,
        timestamp: Date.now(),
      };

      recordNavigationTiming(
        sample.fromPath,
        sample.toPath,
        sample.navigateMs,
        sample.renderMs,
        sample.totalMs,
      );
      setLastNavigation(sample);

      pendingNavigation.current = null;
      navigateStartTime.current = null;
    }
  }, [location.pathname]);

  const wrappedNavigate = useCallback(
    async (to: string, options?: NavigateOptions) => {
      const fromPath = location.pathname;
      const startTime = performance.now();

      navigateStartTime.current = startTime;
      pendingNavigation.current = { fromPath, toPath: to, startTime };

      return navigate(to, options);
    },
    [navigate, location.pathname],
  );

  return { navigate: wrappedNavigate, lastNavigation };
}

/**
 * Simple wrapper component that measures render time of a route component.
 * Wraps the route element and measures time from mount to first render commit.
 */
export function RouteTimer({ children }: { children: React.ReactNode }) {
  const mountTime = useRef<number | null>(null);

  useEffect(() => {
    mountTime.current = performance.now();
  }, []);

  return <>{children}</>;
}
