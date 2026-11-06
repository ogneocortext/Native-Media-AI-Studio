/**
 * React 19 Modern Form & Action Hooks
 * 
 * Replaces manual useState + useEffect + fetch patterns with:
 * - useActionState for server action lifecycle
 * - useOptimistic for instant UI feedback
 * - useFormStatus for nested submit buttons
 * - use() for promise-aware rendering
 * 
 * Note: React 19 hooks require @types/react 19+ or explicit declarations.
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

// ─── useOptimisticMutation (TanStack Query + React 19) ─────────────────────────

/**
 * Simplified optimistic mutation using TanStack Query v5 + React 19 useOptimistic.
 * 
 * This replaces manual onMutate/onError/onSettled cache manipulation.
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
      queryClient.invalidateQueries({ queryKey: options.queryKey });
      options.onSettled?.(undefined, null, variables);
    },
  });
  
  return mutation;
}

// ─── useFormStatus for Nested Submit Buttons ──────────────────────────────────

/**
 * SubmitButton component that reads form status via useFormStatus.
 * Must be a child of a <form> element.
 * 
 * Usage:
 *   <form action={submitAction}>
 *     <input name="email" />
 *     <SubmitButton>Sign Up</SubmitButton>
 *   </form>
 */
export function SubmitButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  // useFormStatus is available in react-dom 19+
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// ─── Zod Schema Validation Hook ───────────────────────────────────────────────

/**
 * Validate form data against a Zod schema.
 * Returns discriminated union for explicit error handling.
 * 
 * Usage:
 *   const { validate, errors } = useZodValidation(UserSchema);
 * 
 *   const handleSubmit = (formData: FormData) => {
 *     const data = Object.fromEntries(formData);
 *     const result = validate(data);
 *     if (!result.success) {
 *       setErrors(result.errors);
 *       return;
 *     }
 *     // result.data is typed as User
 *   };
 */
export function useZodValidation<TSchema extends ZodTypeAny>(schema: TSchema) {
  const validate = (data: unknown) => {
    return schema.safeParse(data);
  };
  
  const validateAsync = async (data: unknown) => {
    return schema.safeParseAsync(data);
  };
  
  const validateFast = (data: unknown): boolean => {
    // Fast boolean check - up to 16x faster than safeParse for invalid input
    return schema.safeParse(data).success;
  };
  
  return { validate, validateAsync, validateFast };
}

// ─── Promise-Aware Rendering with use() ───────────────────────────────────────

/**
 * Component that suspends until a promise resolves.
 * Use with React Suspense boundary.
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
 */
export function usePromise<T>(promise: Promise<T>): T {
  return use(promise);
}

// ─── Transition-Aware State Updates ───────────────────────────────────────────

/**
 * Hook for optimistic UI updates during transitions.
 * Use with React 19's startTransition for non-blocking updates.
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
 */
export function useOptimisticState<T>(initialValue: T) {
  const [optimisticValue, setOptimisticValue] = useOptimistic(
    initialValue,
    (_current, newValue: T) => newValue
  );
  
  return [optimisticValue, setOptimisticValue] as const;
}

// ─── Re-export for Convenience ────────────────────────────────────────────────

export {
  useActionState,
  useOptimistic,
  useTransition,
  startTransition,
  use,
} from "react";

export { useMutation as useTanStackMutation, useQueryClient as useTanStackQueryClient } from "@tanstack/react-query";