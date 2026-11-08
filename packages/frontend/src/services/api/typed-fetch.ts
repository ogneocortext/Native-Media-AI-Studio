/**
 * Typed fetch wrapper for type-safe API calls.
 * Eliminates `any` returns from `res.json()` by parsing through Zod schemas
 * or by using explicit type assertions at the boundary.
 */

import { fetchWithTimeout } from "../fetchWithTimeout";

/**
 * Base API error response shape from FastAPI.
 */
export interface ApiError {
  detail: string | string[] | Record<string, unknown>;
}

/**
 * Standard success response wrapper (for endpoints that wrap data).
 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/**
 * Standard error response wrapper.
 */
export interface ApiFailure {
  success: false;
  error: string;
  detail?: string | string[];
}

/**
 * Union of success/error responses.
 */
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/**
 * Parse a Response as JSON with type safety.
 * Throws on non-ok responses with parsed error detail.
 */
export async function parseJson<T>(
  response: Response,
  endpointName = "API"
): Promise<T> {
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const errorData = (await response.json()) as unknown;
      if (typeof errorData === "object" && errorData !== null) {
        if ("detail" in errorData) {
          detail = typeof errorData.detail === "string"
            ? errorData.detail
            : JSON.stringify(errorData.detail);
        } else if ("error" in errorData) {
          detail = typeof errorData.error === "string"
            ? errorData.error
            : JSON.stringify(errorData.error);
        } else if ("message" in errorData) {
          detail = typeof errorData.message === "string"
            ? errorData.message
            : JSON.stringify(errorData.message);
        }
      }
    } catch {
      detail = response.statusText;
    }
    throw new Error(`${endpointName} failed (${response.status}): ${detail ?? "Unknown error"}`);
  }

  // For 204 No Content, return undefined
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Type-safe fetch that parses JSON and throws on error.
 * Use this instead of raw fetchWithTimeout for API calls.
 */
export async function fetchJson<T>(
  url: string,
  options?: RequestInit & { timeout?: number },
  endpointName?: string
): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  const label = (() => {
    try {
      return new URL(url, window.location.origin).pathname;
    } catch {
      return url.split("?")[0];
    }
  })();
  return parseJson<T>(response, endpointName ?? label);
}

/**
 * Type-safe POST with JSON body.
 */
export async function postJson<T, B = unknown>(
  url: string,
  body: B,
  options?: Omit<RequestInit, "method" | "body"> & { timeout?: number },
  endpointName?: string
): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    body: JSON.stringify(body),
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  }, endpointName);
}

/**
 * Type-safe POST with FormData.
 */
export async function postForm<T>(
  url: string,
  formData: FormData,
  options?: Omit<RequestInit, "method" | "body"> & { timeout?: number },
  endpointName?: string
): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    body: formData,
    ...options,
  }, endpointName);
}

/**
 * Type-safe GET request.
 */
export async function getJson<T>(
  url: string,
  options?: Omit<RequestInit, "method" | "body"> & { timeout?: number },
  endpointName?: string
): Promise<T> {
  return fetchJson<T>(url, { method: "GET", ...options }, endpointName);
}

/**
 * Type-safe DELETE request.
 */
export async function deleteJson<T>(
  url: string,
  options?: Omit<RequestInit, "method" | "body"> & { timeout?: number },
  endpointName?: string
): Promise<T> {
  return fetchJson<T>(url, { method: "DELETE", ...options }, endpointName);
}

/**
 * Type-safe PUT request with JSON body.
 */
export async function putJson<T, B = unknown>(
  url: string,
  body: B,
  options?: Omit<RequestInit, "method" | "body"> & { timeout?: number },
  endpointName?: string
): Promise<T> {
  return fetchJson<T>(url, {
    method: "PUT",
    body: JSON.stringify(body),
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  }, endpointName);
}