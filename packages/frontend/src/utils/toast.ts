// Standalone toast utility — no React context needed.
// Works by directly manipulating the DOM, survives re-renders.
//
// Design notes:
// - Enter/exit are driven by CSS classes (`.toast--enter` / `.toast--leave`).
//   The previous version animated `opacity`/`transform` via inline styles while
//   `toast.css` also ran a `toast-in` keyframe with `forwards`; CSS animations
//   outrank inline declarations, so the fade-out never actually played.
// - Timers pause while the pointer or keyboard focus is inside a toast, so a
//   message can be read or copied, and resume with the remaining time.
// - Identical messages are de-duplicated while visible (polling/SSE handlers
//   used to stack a new toast on every tick) and the stack is capped.
// - `error` exists as a first-class type: failures used to be reported as
//   `warning`, which is indistinguishable from a validation hint.

export type ToastType = "success" | "info" | "warning" | "error";
export type ToastPriority = "urgent" | "high" | "medium" | "low";

export interface ToastOptions {
  type?: ToastType;
  /** Auto-dismiss delay in ms. `0` keeps the toast until dismissed. */
  duration?: number;
  /** Render a close button (default `true`). */
  dismissible?: boolean;
  /** Secondary line, e.g. the server's detail message. */
  detail?: string;
  /** Priority level for routing and stacking behavior. */
  priority?: ToastPriority;
  /** Unique key for de-duplication; defaults to `type|message`. */
  key?: string;
}

export interface ToastHandle {
  /** Remove the toast now (plays the exit animation when motion is allowed). */
  dismiss(): void;
  /** Replace the message in place — no new toast, no re-animation. */
  update(message: string, detail?: string): void;
  readonly element: HTMLDivElement;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  // Long enough to notice and act on; a failure vanishing in 3s is useless.
  error: 9000,
};

/** Priority overrides: urgent stays until dismissed, low auto-dismisses quickly. */
const PRIORITY_DURATIONS: Record<ToastPriority, number | null> = {
  urgent: null,   // requireInteraction: true — stays until dismissed
  high: 10000,
  medium: 5000,
  low: 3000,
};

/** How many toasts stay on screen before the oldest is dropped. */
const MAX_VISIBLE = 4;
/** Ignore an identical message for this long after it was dismissed. */
const REDISPLAY_COOLDOWN_MS = 1000;
/** Fallback removal delay; `transitionend` does not fire with motion disabled. */
const EXIT_FALLBACK_MS = 260;

/** Time window for collapsing repeated events (ms). */
const COLLAPSE_WINDOW_MS = 5000;
/** Max count shown in a collapsed toast (e.g. "5 progress updates"). */
const MAX_COLLAPSE_COUNT = 99;

let toastContainer: HTMLDivElement | null = null;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getContainer(): HTMLDivElement {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    // Screen readers announce nothing without a live region.
    toastContainer.setAttribute("role", "region");
    toastContainer.setAttribute("aria-live", "polite");
    toastContainer.setAttribute("aria-label", "Notifications");
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

interface ToastState {
  type: ToastType;
  message: string;
  detail?: string;
  priority: ToastPriority;
  timer: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
  paused: boolean;
  dismissed: boolean;
  messageEl: HTMLElement;
  detailEl: HTMLElement | null;
  /** Collapse tracking: number of repeated events within the collapse window. */
  collapseCount: number;
  collapseKey: string;
}

const live = new Map<HTMLDivElement, ToastState>();
/** `type|message` -> dismissal timestamp, for the redisplay cooldown. */
const recentlyDismissed = new Map<string, number>();
/** Tracks collapse windows: collapseKey -> { count, expiresAt }. */
const collapseTimers = new Map<string, { count: number; expiresAt: number }>();

function keyFor(type: ToastType, message: string, customKey?: string): string {
  return customKey ?? `${type}|${message}`;
}

function getCollapseKey(options: ToastOptions, message: string): string {
  return options.key ?? `${options.type ?? "info"}|${message}`;
}

function cancelTimer(state: ToastState): void {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function armTimer(state: ToastState, element: HTMLDivElement, delay: number): void {
  cancelTimer(state);
  if (delay <= 0) return;
  state.remaining = delay;
  state.startedAt = Date.now();
  state.timer = setTimeout(() => removeToast(element), delay);
}

function pause(state: ToastState, element: HTMLDivElement): void {
  if (state.paused || state.dismissed) return;
  state.paused = true;
  element.dataset.paused = "true";
  cancelTimer(state);
  if (state.remaining > 0) state.remaining -= Date.now() - state.startedAt;
}

function resume(state: ToastState, element: HTMLDivElement): void {
  if (!state.paused || state.dismissed) return;
  state.paused = false;
  delete element.dataset.paused;
  armTimer(state, element, Math.max(state.remaining, 600));
}

/**
 * Remove a toast.
 *
 * `animate: false` evicts immediately — used when the stack is full, so making
 * room must not queue another exit animation on top of the overflow.
 */
function removeToast(element: HTMLDivElement, animate = true): void {
  const state = live.get(element);
  if (!state) return;
  state.dismissed = true;
  cancelTimer(state);
  live.delete(element);
  recentlyDismissed.set(keyFor(state.type, state.message), Date.now());

  if (!animate || prefersReducedMotion() || !element.isConnected) {
    element.remove();
    return;
  }

  element.classList.remove("toast--enter");
  element.classList.add("toast--leave");
  const drop = () => {
    cancelTimer(state);
    element.remove();
  };
  element.addEventListener("transitionend", drop, { once: true });
  // `transitionend` never fires when transitions are disabled, so always arm a
  // fallback; otherwise the node would leak in the container forever.
  state.timer = setTimeout(drop, EXIT_FALLBACK_MS);
}

function trimStack(): void {
  const container = getContainer();
  // Toasts already fading out are on their way; only count the live ones, or
  // the cap would be exceeded by the exit animations themselves.
  const toasts = Array.from(container.querySelectorAll<HTMLDivElement>(".toast")).filter(
    (el) => !el.classList.contains("toast--leave"),
  );
  while (toasts.length > MAX_VISIBLE) {
    const oldest = toasts.shift();
    if (oldest) removeToast(oldest, false);
  }
}

function render(state: ToastState, element: HTMLDivElement): void {
  state.messageEl.textContent = state.message;
  element.title = state.message;
  if (state.detailEl) {
    state.detailEl.textContent = state.detail ?? "";
    state.detailEl.hidden = !state.detail;
  }
}

const NOOP_HANDLE: ToastHandle = {
  dismiss: () => {},
  update: () => {},
  element: null as unknown as HTMLDivElement,
};

export function showToast(
  message: string,
  typeOrOptions: ToastType | ToastOptions = "success",
): ToastHandle {
  const options: ToastOptions =
    typeof typeOrOptions === "string" ? { type: typeOrOptions } : typeOrOptions;
  const type = options.type ?? "success";
  const priority = options.priority ?? "medium";
  const duration = options.duration ?? PRIORITY_DURATIONS[priority] ?? DEFAULT_DURATIONS[type];

  if (typeof document === "undefined" || !document.body) {
    return NOOP_HANDLE; // non-DOM environment (SSR / node test)
  }

  const container = getContainer();
  const collapseKey = getCollapseKey(options, message);
  const key = keyFor(type, message, options.key);

  // For low-priority events, collapse within the time window instead of stacking
  if (priority === "low") {
    const now = Date.now();
    const existing = collapseTimers.get(collapseKey);
    if (existing && now < existing.expiresAt) {
      existing.count += 1;
      if (existing.count <= MAX_COLLAPSE_COUNT) {
        // Update any visible toast with this collapse key
        for (const [element, state] of live) {
          if (state.collapseKey === collapseKey) {
            const countText = existing.count > 1
              ? `${message} (${existing.count} updates)`
              : message;
            state.message = countText;
            state.collapseCount = existing.count;
            render(state, element);
            armTimer(state, element, duration);
            return {
              dismiss: () => removeToast(element),
              update: (next, detail) => {
                state.message = next;
                if (detail !== undefined) state.detail = detail;
                render(state, element);
              },
              element,
            };
          }
        }
      }
    } else {
      collapseTimers.set(collapseKey, { count: 1, expiresAt: now + COLLAPSE_WINDOW_MS });
    }
  }

  // Swallow an echo of a message that was just dismissed (rapid double-clicks,
  // a retry firing twice) without dropping the user's chance to read it.
  const lastDismissed = recentlyDismissed.get(key) ?? 0;
  if (Date.now() - lastDismissed < REDISPLAY_COOLDOWN_MS) {
    recentlyDismissed.delete(key);
    return NOOP_HANDLE;
  }

  // De-duplicate while visible: an identical message refreshes the existing
  // toast's timer instead of stacking another copy.
  for (const [element, state] of live) {
    if (keyFor(state.type, state.message) !== key) continue;
    if (options.detail !== undefined) state.detail = options.detail;
    render(state, element);
    armTimer(state, element, duration);
    return {
      dismiss: () => removeToast(element),
      update: (next, detail) => {
        state.message = next;
        if (detail !== undefined) state.detail = detail;
        render(state, element);
      },
      element,
    };
  }

  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  element.dataset.toastType = type;
  // `alert` implies an assertive live announcement; everything else is polite.
  element.setAttribute("role", type === "error" ? "alert" : "status");
  element.dataset.priority = priority;

  const messageEl = document.createElement("span");
  messageEl.className = "toast__msg";
  element.appendChild(messageEl);

  let detailEl: HTMLElement | null = null;
  if (options.detail !== undefined) {
    detailEl = document.createElement("span");
    detailEl.className = "toast__detail";
    element.appendChild(detailEl);
  }

  const state: ToastState = {
    type,
    message,
    detail: options.detail,
    priority,
    timer: null,
    remaining: duration,
    startedAt: Date.now(),
    paused: false,
    dismissed: false,
    messageEl,
    detailEl,
    collapseCount: 1,
    collapseKey,
  };
  render(state, element);

  if (options.dismissible !== false) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast__close";
    close.setAttribute("aria-label", "Dismiss notification");
    close.textContent = "×";
    close.addEventListener("click", () => removeToast(element));
    element.appendChild(close);
  }

  element.addEventListener("mouseenter", () => pause(state, element));
  element.addEventListener("mouseleave", () => resume(state, element));
  element.addEventListener("focusin", () => pause(state, element));
  element.addEventListener("focusout", () => resume(state, element));

  live.set(element, state);
  container.appendChild(element);
  trimStack();

  if (prefersReducedMotion()) {
    armTimer(state, element, duration);
  } else {
    // Start off-screen and release on the next frame so the transition runs.
    element.classList.add("toast--enter");
    requestAnimationFrame(() => element.classList.remove("toast--enter"));
    armTimer(state, element, duration);
  }

  return {
    dismiss: () => removeToast(element),
    update: (next, detail) => {
      state.message = next;
      if (detail !== undefined) state.detail = detail;
      render(state, element);
    },
    element,
  };
}

/** Dismiss every visible toast (e.g. on route change). */
export function clearToasts(): void {
  for (const element of Array.from(live.keys())) {
    removeToast(element);
  }
}

