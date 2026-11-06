/**
 * TanStack Query v5 Patterns
 * 
 * Modern idiomatic patterns for TanStack Query v5:
 * - useSuspenseQuery for non-undefined data
 * - queryOptions() for shareable config
 * - queryKey factories for consistent keys
 * - Simplified optimistic updates
 * 
 * Note: Type signatures simplified to avoid Zod v3/v4 compatibility issues.
 * Use `as any` where needed for schema validation at runtime.
 */

import {
  useSuspenseQuery,
  useQueryClient,
  useQueries,
  QueryKey,
  UseMutationOptions,
  UseQueryOptions,
} from "@tanstack/react-query";
import { schemas } from "../schemas/api";
import { z } from "zod/v3";

// ─── Query Key Factories ──────────────────────────────────────────────────────

/**
 * Centralized query key factories.
 * Use these everywhere instead of inline arrays.
 */
export const queryKeys = {
  // Health
  health: {
    all: ["health"] as const,
    aggregate: () => [...queryKeys.health.all, "aggregate"] as const,
    system: () => [...queryKeys.health.all, "system"] as const,
    services: () => [...queryKeys.health.all, "services"] as const,
  },
  
  // Jobs
  jobs: {
    all: ["jobs"] as const,
    list: (status?: string) => [...queryKeys.jobs.all, "list", status ?? "all"] as const,
    detail: (id: string) => [...queryKeys.jobs.all, "detail", id] as const,
    stats: () => [...queryKeys.jobs.all, "stats"] as const,
    metrics: () => [...queryKeys.jobs.all, "metrics"] as const,
  },
  
  // Remix
  remix: {
    all: ["remix"] as const,
    sources: () => [...queryKeys.remix.all, "sources"] as const,
    list: () => [...queryKeys.remix.all, "list"] as const,
    detail: (name: string) => [...queryKeys.remix.all, "detail", name] as const,
    versions: (name: string) => [...queryKeys.remix.all, "versions", name] as const,
    probe: (track: string) => [...queryKeys.remix.all, "probe", track] as const,
  },
  
  // Audio
  audio: {
    all: ["audio"] as const,
    library: () => [...queryKeys.audio.all, "library"] as const,
    stems: (file: string) => [...queryKeys.audio.all, "stems", file] as const,
    analysis: (file: string) => [...queryKeys.audio.all, "analysis", file] as const,
  },
  
  // Generation
  generation: {
    all: ["generation"] as const,
    list: (type: string) => [...queryKeys.generation.all, "list", type] as const,
    detail: (id: string) => [...queryKeys.generation.all, "detail", id] as const,
  },
  
  // Settings
  config: {
    all: ["config"] as const,
    ports: () => [...queryKeys.config.all, "ports"] as const,
    settings: () => [...queryKeys.config.all, "settings"] as const,
  },
} as const;

// ─── queryOptions() Factory ──────────────────────────────────────────────────

/**
 * Create shareable query options with Zod validation.
 * 
 * Usage:
 *   const healthOptions = createQueryOptions({
 *     queryKey: queryKeys.health.aggregate(),
 *     queryFn: () => api.getAggregateHealth(),
 *     schema: schemas.aggregateHealth,
 *     staleTime: 5000,
 *   });
 * 
 *   // In component:
 *   const { data } = useSuspenseQuery(healthOptions);
 */
export function createQueryOptions<
  TQueryKey extends QueryKey,
  TData,
>(options: {
  queryKey: TQueryKey;
  queryFn: () => Promise<unknown>;
  schema: z.ZodSchema<TData>;
  staleTime?: number;
  gcTime?: number;
  retry?: number | boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  select?: (data: TData) => TData;
}): UseQueryOptions<TData, Error, TData, TQueryKey> {
  const { queryKey, queryFn, schema, ...rest } = options;
  
  return {
    queryKey,
    queryFn: async () => {
      const result = await queryFn();
      return validateOrThrow(schema, result);
    },
    ...rest,
  } as UseQueryOptions<TData, Error, TData, TQueryKey>;
}

/**
 * Helper to validate and throw on failure.
 * Internal use in queryFn.
 */
function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.flatten();
    throw new Error(`Query validation failed: ${JSON.stringify(errors.fieldErrors)}`);
  }
  return result.data;
}

// ─── Pre-built Query Options ─────────────────────────────────────────────────

/**
 * Ready-to-use query options for common endpoints.
 * Import and use directly: `useSuspenseQuery(healthQueries.aggregate())`
 */
export const healthQueries = {
  aggregate: () => createQueryOptions({
    queryKey: queryKeys.health.aggregate(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/health/aggregate`);
      return res.json();
    },
    schema: schemas.aggregateHealth,
    staleTime: 5_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  }),
  
  system: () => createQueryOptions({
    queryKey: queryKeys.health.system(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/health/system`);
      return res.json();
    },
    schema: schemas.systemHealth,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  }),
  
  services: () => createQueryOptions({
    queryKey: queryKeys.health.services(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/health/services`);
      return res.json();
    },
    schema: z.record(z.string()),
    staleTime: 5_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  }),
};

export const jobsQueries = {
  list: (status?: string) => createQueryOptions({
    queryKey: queryKeys.jobs.list(status),
    queryFn: async () => {
      const base = "";
      const url = status ? `${base}/api/jobs?status=${status}` : `${base}/api/jobs`;
      const res = await fetch(url);
      return res.json();
    },
    schema: z.array(schemas.job),
    staleTime: 5_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  }),
  
  detail: (id: string) => createQueryOptions({
    queryKey: queryKeys.jobs.detail(id),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/jobs/${id}`);
      return res.json();
    },
    schema: schemas.job,
    staleTime: 5_000,
    gcTime: 30_000,
    retry: 1,
  }),
  
  stats: () => createQueryOptions({
    queryKey: queryKeys.jobs.stats(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/jobs/stats`);
      return res.json();
    },
    schema: schemas.queueStats,
    staleTime: 5_000,
    gcTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  }),
  
  metrics: () => createQueryOptions({
    queryKey: queryKeys.jobs.metrics(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/jobs/metrics`);
      return res.json();
    },
    schema: schemas.queueMetrics,
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  }),
};

export const remixQueries = {
  sources: () => createQueryOptions({
    queryKey: queryKeys.remix.sources(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/audio/remix/sources`);
      return res.json();
    },
    schema: z.array(schemas.remixSource),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  }),
  
  list: () => createQueryOptions({
    queryKey: queryKeys.remix.list(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/audio/remix`);
      return res.json();
    },
    schema: z.array(schemas.remixSummary),
    staleTime: 10_000,
    gcTime: 60_000,
    retry: 1,
  }),
  
  probe: (track: string) => createQueryOptions({
    queryKey: queryKeys.remix.probe(track),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/audio/remix/probe/${encodeURIComponent(track)}`);
      return res.json();
    },
    schema: schemas.audioProbe,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
  }),
};

export const audioQueries = {
  library: () => createQueryOptions({
    queryKey: queryKeys.audio.library(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/audio`);
      return res.json();
    },
    schema: z.array(z.object({
      filename: z.string(),
      duration_sec: z.number().optional(),
      size_bytes: z.number().optional(),
    })),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  }),
  
  stems: (file: string) => createQueryOptions({
    queryKey: queryKeys.audio.stems(file),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/audio/stems/${encodeURIComponent(file)}`);
      return res.json();
    },
    schema: schemas.audioStems,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
  }),
};

export const configQueries = {
  ports: () => createQueryOptions({
    queryKey: queryKeys.config.ports(),
    queryFn: async () => {
      const base = "";
      const res = await fetch(`${base}/api/config/ports`);
      return res.json();
    },
    schema: schemas.portConfig,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  }),
};

// ─── Optimistic Mutation Patterns (v5 Simplified) ────────────────────────────

/**
 * Create a mutation with simplified optimistic updates.
 * 
 * Usage:
 *   const addJobMutation = createOptimisticMutation({
 *     mutationFn: (params) => api.createJob(params),
 *     queryKey: queryKeys.jobs.all,
 *     optimisticUpdate: (current, newJob) => [newJob, ...(current ?? [])],
 *   });
 * 
 *   // In component:
 *   const { data: jobs } = useSuspenseQuery(jobsQueries.list());
 *   const mutation = useMutation(addJobMutation);
 * 
 *   return (
 *     <ul>
 *       {jobs?.map(j => <li key={j.id}>{j.job_type}</li>)}
 *       {mutation.isPending && <li style={{opacity: 0.5}}>{mutation.variables.job_type}</li>}
 *     </ul>
 *   );
 */
export function createOptimisticMutation<
  TData,
  TVariables,
  TQueryData,
  TError = Error
>(options: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  queryKey: QueryKey;
  optimisticUpdate: (currentData: TQueryData | undefined, variables: TVariables) => TQueryData;
  onSettled?: (data: TData | undefined, error: TError | null, variables: TVariables) => void;
  onError?: (error: TError, variables: TVariables, context: { previousData: TQueryData | undefined }) => void;
}) {
  return {
    mutationFn: options.mutationFn,
    onMutate: async (variables: TVariables) => {
      const queryClient = useQueryClient();
      await queryClient.cancelQueries({ queryKey: options.queryKey });
      const previousData = queryClient.getQueryData<TQueryData>(options.queryKey);
      
      queryClient.setQueryData<TQueryData>(options.queryKey, (old) => 
        options.optimisticUpdate(old, variables)
      );
      
      return { previousData };
    },
    onError: (_error: TError, _variables: TVariables, context: { previousData: TQueryData | undefined } | undefined) => {
      if (context?.previousData !== undefined) {
        const queryClient = useQueryClient();
        queryClient.setQueryData(options.queryKey, context.previousData);
      }
    },
    onSettled: (_data: TData | undefined, _error: TError | null, _variables: TVariables) => {
      const queryClient = useQueryClient();
      queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
  } as UseMutationOptions<TData, TError, TVariables, { previousData: TQueryData | undefined }>;
}

// ─── Pre-built Mutation Options ──────────────────────────────────────────────

export const jobMutations = {
  create: () => createOptimisticMutation({
    mutationFn: async (params: { job_type: string; params: Record<string, unknown>; max_retries?: number }) => {
      const base = "";
      const res = await fetch(`${base}/api/jobs/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return res.json();
    },
    queryKey: queryKeys.jobs.all,
    optimisticUpdate: (current: any[] | undefined, newJob: { job_type: string; params: Record<string, unknown>; max_retries?: number }) => {
      const newJobOptimistic = {
        id: `temp-${Date.now()}`,
        job_type: newJob.job_type,
        params: newJob.params,
        status: "queued" as const,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return current ? [newJobOptimistic, ...current] : [newJobOptimistic];
    },
  }),
  
  cancel: () => createOptimisticMutation({
    mutationFn: async (id: string) => {
      const base = "";
      const res = await fetch(`${base}/api/jobs/${id}/cancel`, { method: "POST" });
      return res.json();
    },
    queryKey: queryKeys.jobs.all,
    optimisticUpdate: (current: any[] | undefined, id: string) => {
      if (!current) return [];
      return current.map(job => 
        job.id === id ? { ...job, status: "cancelled" as const } : job
      );
    },
  }),
  
  retry: () => createOptimisticMutation({
    mutationFn: async (id: string) => {
      const base = "";
      const res = await fetch(`${base}/api/jobs/${id}/retry`, { method: "POST" });
      return res.json();
    },
    queryKey: queryKeys.jobs.all,
    optimisticUpdate: (current: any[] | undefined, id: string) => {
      if (!current) return [];
      return current.map(job => 
        job.id === id ? { ...job, status: "queued" as const, retry_count: job.retry_count + 1 } : job
      );
    },
  }),
  
  delete: () => createOptimisticMutation({
    mutationFn: async (id: string) => {
      const base = "";
      await fetch(`${base}/api/jobs/${id}`, { method: "DELETE" });
      return { id };
    },
    queryKey: queryKeys.jobs.all,
    optimisticUpdate: (current: any[] | undefined, id: string) => {
      if (!current) return [];
      return current.filter(job => job.id !== id);
    },
  }),
};

export const remixMutations = {
  build: () => createOptimisticMutation({
    mutationFn: async (recipe: any) => {
      const base = "";
      const res = await fetch(`${base}/api/audio/remix/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipe),
      });
      return res.json();
    },
    queryKey: queryKeys.remix.list(),
    optimisticUpdate: (current: any[] | undefined) => current ?? [],
  }),
  
  preview: () => createOptimisticMutation({
    mutationFn: async (recipe: any) => {
      const base = "";
      const res = await fetch(`${base}/api/audio/remix/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipe),
      });
      return res.json();
    },
    queryKey: queryKeys.remix.all,
    optimisticUpdate: (current: any[] | undefined) => current ?? [],
  }),
  
  enhance: () => createOptimisticMutation({
    mutationFn: async (name: string) => {
      const base = "";
      const res = await fetch(`${base}/api/audio/remix/${encodeURIComponent(name)}/enhance`, {
        method: "POST",
      });
      return res.json();
    },
    queryKey: queryKeys.remix.list(),
    optimisticUpdate: (current: any[] | undefined, name: string) => {
      if (!current) return [];
      return current.map(remix => 
        remix.name === name ? { ...remix, has_enhanced: true } : remix
      );
    },
  }),
};

export const jobMutationsActions = {
  createJob: () => createOptimisticMutation({
    mutationFn: async (params: { job_type: string; params: Record<string, unknown>; max_retries?: number }) => {
      const base = "";
      const res = await fetch(`${base}/api/jobs/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return res.json();
    },
    queryKey: queryKeys.jobs.all,
    optimisticUpdate: (current: any[] | undefined, params: { job_type: string; params: Record<string, unknown>; max_retries?: number }) => {
      const newJobOptimistic = {
        id: `temp-${Date.now()}`,
        job_type: params.job_type,
        params: params.params,
        status: "queued" as const,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return current ? [newJobOptimistic, ...current] : [newJobOptimistic];
    },
  }),
  
cancelJob: () => createOptimisticMutation({
    mutationFn: async (id: string) => {
      const base = "";
      await fetch(`${base}/api/jobs/${id}/cancel`, { method: "POST" });
      return { id };
    },
    queryKey: queryKeys.jobs.all,
    optimisticUpdate: (current: any[] | undefined, id: string) => {
      if (!current) return [];
      return current.map(job => 
        job.id === id ? { ...job, status: "cancelled" as const } : job
      );
    },
  }),
};

// ─── Suspense Query Helpers ──────────────────────────────────────────────────

/**
 * Hook that throws a promise until data is ready.
 * Use with <Suspense fallback={<Skeleton />}>.
 * 
 * Usage:
 *   // In component tree:
 *   <Suspense fallback={<JobsSkeleton />}>
 *     <JobsList />
 *   </Suspense>
 * 
 *   // In JobsList:
 *   const { data: jobs } = useSuspenseHealthAggregate(); // Never undefined!
 *   return <ul>{jobs.map(...)}</ul>;
 */
export function useSuspenseHealthAggregate() {
  return useSuspenseQuery(healthQueries.aggregate() as any);
}

export function useSuspenseHealthSystem() {
  return useSuspenseQuery(healthQueries.system() as any);
}

export function useSuspenseJobsList(status?: string) {
  return useSuspenseQuery(jobsQueries.list(status) as any);
}

export function useSuspenseJobsStats() {
  return useSuspenseQuery(jobsQueries.stats() as any);
}

export function useSuspenseRemixSources() {
  return useSuspenseQuery(remixQueries.sources() as any);
}

export function useSuspenseRemixList() {
  return useSuspenseQuery(remixQueries.list() as any);
}

export function useSuspenseAudioLibrary() {
  return useSuspenseQuery(audioQueries.library() as any);
}

export function useSuspenseConfigPorts() {
  return useSuspenseQuery(configQueries.ports() as any);
}

// ─── Parallel Queries ────────────────────────────────────────────────────────

/**
 * Fetch multiple queries in parallel with useQueries.
 * Returns array of query results in same order.
 * 
 * Usage:
 *   const [healthResult, jobsResult, configResult] = useParallelQueries([
 *     healthQueries.aggregate(),
 *     jobsQueries.stats(),
 *     configQueries.ports(),
 *   ]);
 * 
 *   const [health, jobs, config] = [healthResult.data, jobsResult.data, configResult.data];
 */
export function useParallelQueries<TQueries extends Array<any>>(
  queries: [...TQueries]
) {
  return useQueries({ queries });
}

// ─── Export All ──────────────────────────────────────────────────────────────

export const queries = {
  health: healthQueries,
  jobs: jobsQueries,
  remix: remixQueries,
  audio: audioQueries,
  config: configQueries,
};

export const mutations = {
  jobs: jobMutations,
  remix: remixMutations,
  jobActions: jobMutationsActions,
};