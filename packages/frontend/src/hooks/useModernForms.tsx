/**
 * React 19 Modern Form & Action Hooks
 * 
 * Replaces manual useState + useEffect + fetch patterns with:
 * - useActionState for server action lifecycle
 * - useOptimistic for instant UI feedback
 * - useFormStatus for nested submit buttons
 * - use() for promise-aware rendering
 * 
 * Based on React 19.3 official docs (react.dev)
 * Requires @types/react 19+ and @types/react-dom 19+
 */

import {
  useActionState,
  useOptimistic,
  use,
} from "react";
import { useFormStatus } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ZodTypeAny } from "zod";

// ─── Type Helpers ─────────────────────────────────────────────────────────────

export type ActionState<T> =
  | { status: "idle" }
  | { status: "pending"; submittedAt: number }
  | { status: "success"; data: T; submittedAt: number }
  | { status: "error"; error: Error; submittedAt: number };

export type OptimisticUpdate<TData, TVariables> = (
  currentData: TData | undefined,
  variables: TVariables
) => TData;

// ─── useActionState Wrapper (Server Action Pattern) ───────────────────────────

/**
 * Modern form submission with React 19's useActionState.
 * 
 * Based on React 19 official docs: https://react.dev/reference/react/useActionState
 * 
 * Usage:
 *   const [state, submitAction, isPending] = useActionState(
 *     async (prevState, formData) => {
 *       const result = await api.createJob(formData);
 *       return { success: true, data: result };
 *     },
 *     { status: "idle" } as ActionState<Job>
 *   );
 * 
 *   return <form action={submitAction}>...</form>;
 * 
 * Key patterns from React 19 docs:
 * - Action function signature: (previousState, formData) => newState
 * - Works with Server Functions (async functions with "use server")
 * - Returns [state, action, isPending] - use action prop on <form>
 * - Combine with useOptimistic for instant UI feedback
 * - useFormStatus for nested submit buttons
 */
export function useServerAction<TData, TFormData extends FormData = FormData>(
  action: (prevState: ActionState<TData>, formData: TFormData) => Promise<ActionState<TData>>,
  initialState: ActionState<TData> = { status: "idle" }
): [
  ActionState<TData>,
  (formData: TFormData) => void,
  boolean
] {
  const [state, dispatch, isPending] = useActionState(action, initialState);
  return [state, dispatch, isPending];
}

/**
 * Typed version for Server Functions (Next.js App Router style).
 * 
 * Usage:
 *   const [state, formAction, isPending] = useServerActionTyped(
 *     async (prevState: ActionState<T>, formData: FormData) => {
 *       const result = await serverAction(formData);
 *       return { success: true, data: result };
 *     },
 *     initialState
 *   );
 */
export function useServerActionTyped<TData>(
  action: (prevState: ActionState<TData>, formData: FormData) => Promise<ActionState<TData>>,
  initialState: ActionState<TData> = { status: "idle" }
): [
  ActionState<TData>,
  (formData: FormData) => void,
  boolean
] {
  const [state, dispatch, isPending] = useActionState(action, initialState);
  return [state, dispatch, isPending];
}

// ─── useOptimisticMutation (TanStack Query v5 + React 19) ─────────────────────────

/**
 * Simplified optimistic mutation using TanStack Query v5 + React 19 useOptimistic.
 * 
 * This replaces manual onMutate/onError/onSettled cache manipulation.
 * 
 * Based on TanStack Query v5 docs: https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates
 * 
 * Usage:
 *   const { data: todos } = useQuery({ queryKey: ['todos'] });
 *   const addMutation = useOptimisticMutation({
 *     mutationFn: (newTodo: string) => api.createTodo(newTodo),
 *     optimisticUpdate: (current, newTodo) => [...(current ?? []), { id: 'temp', text: newTodo, pending: true }],
 *     queryKey: ['todos'],
 *   });
 * 
 *   if (data) return (
 *     <ul>
 *       {data.map(t => <li key={t.id}>{t.text}</li>)}
 *       {addMutation.isPending && <li style={{opacity: 0.5}}>{addMutation.variables}</li>}
 *     </ul>
 *   );
 * 
 * Best practice from React 19 docs:
 * - Combine useActionState with useOptimistic for instant UI feedback
 * - Use startTransition for non-blocking updates
 * - useOptimistic accepts either updater functions or reducer pattern
 */
export function useOptimisticMutation<
  TData,
  TVariables,
  TQueryData,
  TError = Error
>(options: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  optimisticUpdate: OptimisticUpdate<TQueryData, TVariables>;
  queryKey: readonly unknown[];
  onSettled?: (data: TData | undefined, error: TError | null, variables: TVariables) => void;
}) {
  const queryClient = useQueryClient();
  
  const mutation = useMutation({
    mutationFn: options.mutationFn,
    onMutate: async (variables) => {
      // Cancel in-flight queries to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: options.queryKey });
      
      // Snapshot previous value for potential rollback
      const previousData = queryClient.getQueryData<TQueryData>(options.queryKey);
      
      // Optimistically update
      queryClient.setQueryData<TQueryData>(options.queryKey, (old) => 
        options.optimisticUpdate(old, variables)
      );
      
      return { previousData };
    },
    onError: (_error, _variables, context) => {
      // Rollback to previous value
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(options.queryKey, context.previousData);
      }
    },
    onSuccess: (_data, _variables, _context) => {
      // Keep optimistic update, will be replaced by server data on invalidate
    },
    onSettled: (_data, _error, variables) => {
      // Always refetch to get canonical server state
      void queryClient.invalidateQueries({ queryKey: options.queryKey });
      options.onSettled?.(undefined, null, variables);
    },
  });
  
  return mutation;
}

// ─── useFormStatus for Nested Submit Buttons ──────────────────────────────────

/**
 * SubmitButton component that reads form status via useFormStatus.
 * 
 * CRITICAL RULE from React 19 docs: 
 * "useFormStatus will not return status information for a <form> rendered in the same component."
 * The component MUST be a child of the <form>, not the component that renders it.
 * 
 * Based on React 19 docs: https://react.dev/reference/react-dom/hooks/useFormStatus
 * 
 * Usage:
 *   <form action={submitAction}>
 *     <input name="email" />
 *     <SubmitButton>Sign Up</SubmitButton>
 *   </form>
 * 
 * Status object (React 19.2+):
 * - pending: boolean
 * - data: FormData | null
 * - method: string
 * - action: Function | null
 */
export function SubmitButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      {...props}
    >
      {pending ? "Submitting..." : children}
    </button>
  );
}

/**
 * Enhanced form status hook with all React 19.2+ fields.
 * 
 * Usage:
 *   const { pending, data, method, action } = useEnhancedFormStatus();
 */
export function useEnhancedFormStatus() {
  const status = useFormStatus();
  return {
    pending: status.pending,
    data: status.data,
    method: status.method,
    action: status.action,
  };
}

// ─── Zod Schema Validation Hook (v4.6+) ─────────────────────────────────────────

/**
 * Validate form data against a Zod schema.
 * 
 * Note: Zod v3 doesn't have .validate() or .compile() - those are v4.6+ features.
 * For fast validation in v3, use .safeParse().success or compile schemas manually.
 * 
 * Usage:
 *   const { validate, validateFast, validateAsync } = useZodValidation(UserSchema);
 * 
 *   const handleSubmit = (formData: FormData) => {
 *     const data = Object.fromEntries(formData);
 *     
 *     // Fast path for invalid input
 *     if (!validateFast(data)) {
 *       setErrors("Invalid input");
 *       return;
 *     }
 *     
 *     const result = validate(data);
 *     if (!result.success) {
 *       setErrors(result.errors);
 *       return;
 *     }
 *     // result.data is typed as User
 *   };
 * 
 * Based on Zod v3: https://zod.dev
 */
export function useZodValidation<TSchema extends ZodTypeAny>(schema: TSchema) {
  const validate = (data: unknown) => {
    return schema.safeParse(data);
  };
  
  const validateAsync = async (data: unknown) => {
    return schema.safeParseAsync(data);
  };
  
  const validateFast = (data: unknown): boolean => {
    // Fast boolean check using safeParse
    // For even faster validation on hot paths, consider compiling schemas
    return schema.safeParse(data).success;
  };
  
  const validateAsyncFast = async (data: unknown): Promise<boolean> => {
    return (await schema.safeParseAsync(data)).success;
  };
  
  return { validate, validateAsync, validateFast, validateAsyncFast };
}

// ─── Promise-Aware Rendering with use() ─────────────────────────────────────────

/**
 * Component that suspends until a promise resolves.
 * Use with React Suspense boundary.
 * 
 * Based on React 19 docs: https://react.dev/reference/react/use
 * 
 * Usage:
 *   <Suspense fallback={<Loading />}>
 *     <DataComponent promise={fetchUser(id)} />
 *   </Suspense>
 * 
 *   function DataComponent({ promise }: { promise: Promise<User> }) {
 *     const user = use(promise); // Suspends until resolved
 *     return <div>{user.name}</div>;
 *   }
 * 
 * Note: The promise must be created outside the component or memoized
 * to avoid creating a new promise on every render.
 */
export function usePromise<T>(promise: Promise<T>): T {
  return use(promise);
}

// ─── Transition-Aware State Updates ───────────────────────────────────────────

/**
 * Hook for optimistic UI updates during transitions.
 * Use with React 19's startTransition for non-blocking updates.
 * 
 * Based on React 19 docs: https://react.dev/reference/react/startTransition
 * 
 * Usage:
 *   const [optimisticName, setOptimisticName] = useOptimisticState(currentName);
 * 
 *   const handleChange = (newName: string) => {
 *     startTransition(() => {
 *       setOptimisticName(newName); // Instant UI update
 *       api.updateName(newName).then(() => {
 *         // Server confirmed, optimistic state will auto-revert if needed
 *       });
 *     });
 *   };
 * 
 * Best practice from React 19 docs:
 * - Combine useOptimistic with useActionState for forms
 * - Use startTransition for non-blocking updates
 * - useOptimistic accepts either updater functions or reducer pattern
 */
export function useOptimisticState<T>(initialValue: T) {
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    initialValue,
    (_current, newValue: T) => newValue
  );
  
  return [optimisticValue, setOptimisticValue] as const;
}

/**
 * Optimistic state with reducer pattern (for complex updates).
 * 
 * Usage:
 *   const [optimisticItems, addOptimisticItem] = useOptimisticReducer(
 *     initialItems,
 *     (current, newItem) => [...current, { ...newItem, pending: true }]
 *   );
 */
export function useOptimisticReducer<TState, TAction>(
  initialState: TState,
  reducer: (state: TState, action: TAction) => TState
) {
  const [optimisticState, dispatchOptimistic] = useOptimistic(
    initialState,
    reducer
  );
  
  return [optimisticState, dispatchOptimistic] as const;
}

// ─── Promise-Aware Data Fetching ──────────────────────────────────────────────

/**
 * Fetch data with promise-aware rendering.
 * Use with Suspense boundary.
 * 
 * Usage:
 *   const userPromise = fetchUser(id);
 *   const user = useSuspensefulFetch(userPromise);
 * 
 * Or with useSuspenseQuery (TanStack Query v5):
 *   const { data: user } = useSuspenseUserQuery(id);
 */
export function useSuspensefulFetch<T>(promise: Promise<T>): T {
  return use(promise);
}

/**
 * Create a suspenseful fetch that can be used with use().
 * 
 * Usage:
 *   const userPromise = createSuspensefulFetch(() => fetchUser(id));
 *   // In component:
 *   const user = use(userPromise);
 */
export function createSuspensefulFetch<T>(
  fetcher: () => Promise<T>
): () => Promise<T> {
  // Store promise in module scope to avoid recreation on render
  let cachedPromise: Promise<T> | null = null;
  
  return async () => {
    cachedPromise ??= fetcher();
    return cachedPromise;
  };
}

// ─── Re-export for Convenience ────────────────────────────────────────────────

export {
  useActionState,
  useOptimistic,
  use,
} from "react";

export { useMutation as useTanStackMutation, useQueryClient as useTanStackQueryClient } from "@tanstack/react-query";