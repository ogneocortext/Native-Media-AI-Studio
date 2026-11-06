/**
 * TanStack Query client setup for server state management.
 *
 * Provides caching, deduping, background refetching, and retry logic for
 * backend API calls. Zustand stores continue to own client/UI state
 * (UI toggles, modals, forms); TanStack Query owns async server data
 * (health, jobs, logs, etc.) so components don't hand-roll polling intervals.
 *
 * Usage:
 *   const { data, isLoading, error } = useHealthQuery();
 *   const { data, mutate } = useJobQuery();
 *
 * The QueryClientProvider wraps the entire app in main.tsx.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type ReactNode } from "react";

/**
 * Shared QueryClient with sensible defaults for this workstation:
 * - Stale after 5s (backend is local, data changes fast)
 * - Retry once on transient network failures
 * - Refetch on window focus so health dashboards stay current
 * - 30s GC so inactive queries don't linger
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

/**
 * Provider component. Wrap the app tree with this so every component can
 * use `useQuery` / `useMutation` without prop-drilling a client.
 * Uses React.createElement instead of JSX so this file can stay .ts.
 */
export function QueryProvider({ children }: { children: ReactNode }): ReactNode {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}
