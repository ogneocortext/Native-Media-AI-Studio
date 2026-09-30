---
tags:
  - technical
aliases:
  - Notification System Research 2026
  - SSE Notification Improvements
  - Real-time Events
  - Real-time Notification Best Practices
cssclasses:
  - technical-guide
  - research
date: 2026-09-29
---

# 🔔 Notification System Improvements 2026

> [!info] Purpose
> Research-based improvement ideas for the Native Media AI Studio notification system, with prioritized implementation roadmap.
> Built for [[technical-reference]] and [[backend-debugging-guide]].
>
> **Status:** Research complete — implementation pending

---

## 📊 Current State Analysis

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NOTIFICATION SYSTEM ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Backend (FastAPI + uvicorn)                                                │
│  ├── SSE Endpoint: GET /api/events                                          │
│  ├── SSEManager: Broadcasts to connected clients                            │
│  ├── QueueManager: Job status updates → _notify_subscribers + SSE           │
│  └── Events: job.queued, job.started, job.progress, job.completed,          │
│             job.failed, job.cancelled, job.dead                              │
│                                                                             │
│  Frontend (Vite + React + Zustand)                                          │
│  ├── SSEService: EventSource singleton with reconnection                    │
│  ├── useJobStore: Zustand store for job state                               │
│  ├── toast.ts: DOM-based toast notifications                                │
│  └── Job UI: Queue page with real-time updates                              │
│                                                                             │
│  Go Sidecars                                                                │
│  └── go-dashboard: :3847 — Health + utility SSE (optional fallback)        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Current Strengths

✅ **SSE over WebSocket** — Simpler, HTTP-native, auto-reconnect via EventSource
✅ **Toast de-duplication** — Identical messages don't stack
✅ **Pause on hover/focus** — Timers pause while reading
✅ **Accessibility** — `aria-live` regions, `role="alert"` for errors
✅ **Reduced motion support** — Respects `prefers-reduced-motion`
✅ **Slow client eviction** — 5s queue timeout drops slow consumers
✅ **Connection cap** — Max 50 connections prevents resource exhaustion
✅ **Auto-refresh fallback** — Polls when SSE disconnected

### Current Gaps

❌ **No priority levels** — All events treated equally; progress spam during long renders
❌ **No Last-Event-ID replay** — Missed events during reconnection are lost
❌ **No cross-tab sync** — Multiple tabs have inconsistent notification state
❌ **No notification center** — Toasts disappear; no persistent history
❌ **No unread badge** — Users can't see pending notifications at a glance
❌ **No browser push** — No notifications when tab is hidden
❌ **No quiet hours / preferences** — No per-category notification control
❌ **No offline queue** — Events lost during network interruption
❌ **Connection status not visible** — Users don't know if real-time updates are active
❌ **No event grouping** — Rapid status changes create notification storms

---

## 🎯 Improvement Ideas (Prioritized)

### Priority 1: Critical UX Improvements

#### 1.1 Priority-Based Notification Routing

**Problem:** Long-running jobs emit dozens of `job.progress` events, flooding the toast queue and burying critical errors.

**Solution:** Add a `priority` field to SSE events:

- `urgent` — job.failed, job.dead, system errors → immediate toast + sound
- `high` — job.completed, job.cancelled → toast with longer duration
- `medium` — job.queued, job.started → subtle toast
- `low` — job.progress → suppress toast, update UI only

**Implementation:**

- Backend: Add `priority` to `_format_message()` envelope in `sse/handler.py`
- Frontend: Route events by priority in `sseService.ts` → `jobStore.ts`
- Toast: `showToast()` accepts priority; urgent toasts use `requireInteraction: true`

**Benefit:** Users see failures immediately; progress updates don't spam the UI.

---

#### 1.2 Last-Event-ID Replay on Reconnect

**Problem:** If SSE disconnects for >15s, the client misses all intermediate events. The current code has no replay mechanism.

**Solution:**

- Backend: Track last N events (e.g., 100) in a ring buffer; on connect, send `Last-Event-ID` header
- Frontend: Pass `lastEventId` query param on reconnect; server replays missed events
- SSE endpoint: `EventSourceResponse` supports `Last-Event-ID` via Starlette's `last_event_id`

**Implementation:**

- Backend: Add `_recent_events: deque(maxlen=100)` to `SSEManager`
- On `send_message()`, store `(event_id, message)` in ring buffer
- On `connect()`, return buffer if `Last-Event-ID` header present
- Frontend: `sseService.ts` reads `lastEventId` from `onerror` and passes to `open()`

**Benefit:** No missed job state updates during brief disconnections.

---

#### 1.3 Cross-Tab State Synchronization

**Problem:** Multiple tabs show different notification states; marking a job as read in one tab doesn't update others.

**Solution:** Use `BroadcastChannel` API to sync SSE events across tabs.

**Implementation:**

- Frontend: Create `notificationSyncChannel = new BroadcastChannel('notifications')`
- Leader tab: Maintains SSE connection; broadcasts events to channel
- Follower tabs: Listen to channel; update local store without own SSE connection
- On tab close: Release leader lock; another tab takes over via `navigator.locks`

**Benefit:** Consistent notification state across all open tabs.

---

#### 1.4 Notification Center with Unread Badge

**Problem:** Toasts are ephemeral; users have no way to review missed notifications.

**Solution:** Add a notification center (bell icon + dropdown):

- Store last 100 notifications in Zustand + `localStorage`
- Show unread count badge on bell icon
- Dropdown shows grouped notification history
- Mark individual/all as read
- Click notification → navigate to relevant job

**Implementation:**

- Frontend: Add `useNotificationStore` Zustand slice
- Components: `NotificationBell.tsx`, `NotificationPanel.tsx`, `NotificationItem.tsx`
- Backend: Add `GET /api/notifications` endpoint (if not exists)

**Benefit:** Users never miss important updates; can review history.

---

### Priority 2: Quality of Life

#### 2.1 Toast Collapse for Repeated Events

**Problem:** Rapid `job.progress` updates (e.g., "Step 5/20", "Step 6/20", ...) create toast spam.

**Solution:** Collapse identical event types within a time window:

- Frontend: Track last N event types per job; if same type within 5s, show "Job X: 3 updates"
- Toast: Replace existing toast with updated count instead of stacking

**Benefit:** Reduced visual noise; users see "3 progress updates" instead of 3 toasts.

---

#### 2.2 Connection Status Indicator

**Problem:** Users don't know if SSE is connected; silent failures during network issues.

**Solution:** Add a subtle connection status dot in the header:

- Green = connected
- Yellow = reconnecting
- Red = disconnected (show "Offline — retrying..." tooltip)

**Implementation:**

- Frontend: Expose `sseConnected` from `useJobStore` (already exists!)
- Add `ConnectionStatusDot` component to `Layout.tsx`

**Benefit:** Users understand real-time status at a glance.

---

#### 2.3 Browser Push Notifications (Optional)

**Problem:** When the tab is hidden, users miss critical job completions/failures.

**Solution:** Use Notification API for high-priority events:

- Request permission on first user interaction
- Show browser notification when `document.visibilityState === 'hidden'`
- Click notification → focus tab and navigate to job

**Benefit:** Critical updates reach users even when the app is in the background.

---

### Priority 3: Advanced

#### 3.1 Quiet Hours / Notification Preferences

**Problem:** No way to mute notifications during focus time or sleep.

**Solution:** Add notification preferences:

- Per-category toggles (progress, completed, failed, system)
- Quiet hours (e.g., 22:00–07:00)
- Backend stores preferences; SSE checks before broadcasting

**Benefit:** Users control notification noise; respect focus time.

---

#### 3.2 Offline Queue & Event Replay

**Problem:** Network interruptions cause event loss; no recovery mechanism.

**Solution:**

- Frontend: Queue events in IndexedDB when offline
- On reconnect: Replay queued events + fetch `?since=lastEventId` from REST API
- Backend: Add `GET /api/events/since?last_id=X` endpoint

**Benefit:** No missed notifications during brief network outages.

---

## 📋 Implementation Checklist

### Backend Changes

- [x] **SSEManager** — Add `_recent_events: deque(maxlen=100)` ring buffer
- [x] **SSEManager** — Add `priority` field to `_format_message()`
- [x] **SSEManager** — Handle `Last-Event-ID` header on connect; replay missed events
- [x] **QueueManager** — Pass priority level to `_broadcast_job_event()` based on event type
- [ ] **API** — Add `GET /api/notifications` endpoint (if needed)
- [ ] **API** — Add `GET /api/events/since?last_id=X` for offline replay

### Frontend Changes

- [x] **sseService.ts** — Pass `lastEventId` on reconnect; parse replay events
- [x] **sseService.ts** — Emit priority from SSE event; route to toast vs. silent update
- [x] **sseService.ts** — Add `BroadcastChannel` for cross-tab sync
- [ ] **jobStore.ts** — Add notification center slice (history, unread count, preferences)
- [x] **toast.ts** — Add priority-based durations; urgent uses `requireInteraction: true`
- [x] **toast.ts** — Collapse repeated events within time window
- [ ] **Components** — Add `NotificationBell`, `NotificationPanel`, `ConnectionStatusDot`
- [ ] **Components** — Add notification preferences page (quiet hours, categories)

### Knowledge Library Updates

- [x] **Create this document** — Notification system research + improvement ideas
- [ ] **Update technical-reference.md** — Document notification system architecture
- [ ] **Update backend-debugging-guide.md** — Add SSE debugging patterns

---

## 🔗 Related Documents

- [[technical-reference]] — System architecture, API reference
- [[backend-debugging-guide]] — Debugging patterns for FastAPI/queue/SSE
- [[go-integration-2026]] — Go sidecars for SSE infrastructure
- [[e2e-test-plan-2026]] — E2E test plan including SSE tests
- [[frontend-build-pipeline]] — SSE deduplication & rate limiting patterns

---

## 📚 References

1. [System Design #10: Design a Notification System](https://devprep.co/articles/system-design-notification-system) (2026-02-10)
2. [Real-Time Notifications Architecture: SSE vs WebSockets](https://www.suprsend.com/post/real-time-notifications-architecture) (2026-06-23)
3. [Server-Sent Events in 2026](https://thebackenddevelopers.substack.com/p/server-sent-events-in-2026-streaming) (2026-05-11)
4. [Design a Notification System UI](https://www.frontend.beauty/system-design/design-a-notification-system-ui) (2025)
5. [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
6. [MDN: BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)

---

_Last updated: 2026-09-29_
