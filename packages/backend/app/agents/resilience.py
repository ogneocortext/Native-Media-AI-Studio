"""
Native Media AI Studio - Agent Resilience Utilities

Shared resilience primitives used by both the agent (nma_agent.py) and the API
client (api_client.py). Keeping them in one module avoids circular imports.

Implements Oct 2026 best practices:
- Retry with exponential backoff + full jitter (only retryable errors)
- Circuit breaker pattern (shared across tasks, 3 states: closed/open/half-open)
- Error classification (retryable vs non-retryable vs side-effect-unknown)
- Idempotency key generation (stable across attempts)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import random
import time
from enum import Enum
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------

DEFAULT_BACKOFF_BASE = 0.5  # seconds
DEFAULT_BACKOFF_CAP = 8.0  # seconds
DEFAULT_MAX_ATTEMPTS = 3
CIRCUIT_BREAKER_THRESHOLD = 5
CIRCUIT_BREAKER_COOLDOWN = 30.0  # seconds

STATE_DIR = Path("output/agent-state")
STATE_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------


class ErrorCategory(Enum):
    RETRYABLE = "retryable"      # transient infrastructure errors, LLM throttling,
                                 # temporary unavailability
    NON_RETRYABLE = "non_retryable"  # authentication errors, invalid inputs,
                                      # permission denials
    SIDE_EFFECT_UNKNOWN = "side_effect_unknown"  # timeout after send,
                                                   # connection loss after commit,
                                                   # adapter crash before
                                                   # confirmation stored


def classify_error(exc: Exception) -> ErrorCategory:
    """Classify an exception into retryable / non-retryable /
    side_effect_unknown.

    Retryable: transient infrastructure errors, LLM throttling, temporary
    unavailability.
    Non-retryable: authentication errors, invalid inputs, permission denials.
    Side-effect unknown: timeout after send, connection loss after commit,
    adapter crash before confirmation stored.
    """
    if isinstance(exc, NMAApiError):
        msg = str(exc).lower()
        # HTTP 429 (rate limit), 502/503/504 (server errors) are retryable
        for code in ("429", "502", "503", "504"):
            if code in msg:
                return ErrorCategory.RETRYABLE
        # HTTP 4xx (except 429) are non-retryable
        for code in ("400", "401", "403", "404", "409"):
            if code in msg:
                return ErrorCategory.NON_RETRYABLE
        # Connection errors that may have sent the request are
        # side_effect_unknown
        for code in ("econnreset", "etimedout", "econnrefused"):
            if code in msg:
                return ErrorCategory.SIDE_EFFECT_UNKNOWN
        return ErrorCategory.NON_RETRYABLE
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return ErrorCategory.SIDE_EFFECT_UNKNOWN
    if isinstance(exc, (ConnectionError, OSError)):
        return ErrorCategory.SIDE_EFFECT_UNKNOWN
    return ErrorCategory.NON_RETRYABLE


# ---------------------------------------------------------------------------
# Circuit breaker (shared across tasks)
# ---------------------------------------------------------------------------


class CircuitState(Enum):
    CLOSED = "closed"      # normal operation
    OPEN = "open"          # fail fast, no calls
    HALF_OPEN = "half_open"  # probe with one call


class CircuitBreaker:
    """Circuit breaker shared across tasks/agents.

    After N consecutive failures, the circuit opens and calls fail immediately
    without calling the dependency. After a cooldown, it goes half-open and
    admits one probe call. A success closes it; a failure re-opens it.
    """

    def __init__(self, threshold: int = CIRCUIT_BREAKER_THRESHOLD,
                 cooldown: float = CIRCUIT_BREAKER_COOLDOWN) -> None:
        self.threshold = threshold
        self.cooldown = cooldown
        self._fails = 0
        self._opened_at: float | None = None
        self._lock = asyncio.Lock()

    async def allow(self) -> bool:
        """Return True if the call is allowed to proceed."""
        async with self._lock:
            if self._opened_at is None:
                return True
            if time.monotonic() - self._opened_at >= self.cooldown:
                # Half-open: allow one probe
                self._opened_at = None  # mark as probing
                return True
            return False

    async def record_success(self) -> None:
        """Record a successful call."""
        async with self._lock:
            self._fails = 0
            self._opened_at = None

    async def record_failure(self) -> None:
        """Record a failed call."""
        async with self._lock:
            self._fails += 1
            if self._fails >= self.threshold:
                self._opened_at = time.monotonic()

    @property
    def is_open(self) -> bool:
        if self._opened_at is None:
            return False
        return time.monotonic() - self._opened_at < self.cooldown


# Global circuit breaker registry (shared across tasks/agents)
_CIRCUIT_BREAKERS: dict[str, CircuitBreaker] = {}
_CIRCUIT_LOCK = asyncio.Lock()


async def get_circuit_breaker(name: str) -> CircuitBreaker:
    """Get or create a circuit breaker for a dependency name."""
    async with _CIRCUIT_LOCK:
        if name not in _CIRCUIT_BREAKERS:
            _CIRCUIT_BREAKERS[name] = CircuitBreaker()
        return _CIRCUIT_BREAKERS[name]


# ---------------------------------------------------------------------------
# Retry with exponential backoff + full jitter
# ---------------------------------------------------------------------------


def backoff_delay(attempt: int, *, base: float = DEFAULT_BACKOFF_BASE,
                  cap: float = DEFAULT_BACKOFF_CAP) -> float:
    """Full-jitter exponential backoff: uniform(0, min(cap,
    base * 2^(attempt-1))).

    attempt is 1-based: the first failure sleeps up to `base`.
    """
    if base <= 0:
        return 0.0
    ceiling = min(cap, base * (2 ** max(0, attempt - 1)))
    return random.uniform(0, ceiling)


async def retry_with_backoff(
    fn,
    *,
    max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    backoff_base: float = DEFAULT_BACKOFF_BASE,
    backoff_cap: float = DEFAULT_BACKOFF_CAP,
    circuit_breaker: CircuitBreaker | None = None,
    context: str = "",
) -> Any:
    """Retry an async function with exponential backoff + jitter.

    Only retries on retryable errors. Non-retryable errors are raised
    immediately. Side-effect-unknown errors are retried at most once
    (idempotency key required).
    """
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        # Check circuit breaker before each attempt
        if circuit_breaker is not None:
            if not await circuit_breaker.allow():
                raise NMAApiError(
                    f"Circuit breaker open for {context or 'unknown'}"
                )

        try:
            result = await fn()
            await circuit_breaker.record_success() \
                if circuit_breaker else None
            return result
        except NMAApiError as e:
            category = classify_error(e)
            last_error = e

            if category == ErrorCategory.NON_RETRYABLE:
                await circuit_breaker.record_failure() \
                    if circuit_breaker else None
                raise
            if category == ErrorCategory.SIDE_EFFECT_UNKNOWN:
                # Side-effect unknown: only retry if idempotency key present
                # (caller must have provided one)
                if attempt >= max_attempts:
                    await circuit_breaker.record_failure() \
                        if circuit_breaker else None
                    raise
                # Side-effect unknown: retry once with idempotency key
                await circuit_breaker.record_failure() \
                    if circuit_breaker else None
                delay = backoff_delay(attempt,
                                      base=backoff_base, cap=backoff_cap)
                logger.warning(
                    "%s side-effect-unknown error (attempt %d/%d), "
                    "retrying in %.2fs",
                    context or "api_call", attempt, max_attempts, delay,
                )
                await asyncio.sleep(delay)
                continue
            # Retryable
            if attempt >= max_attempts:
                await circuit_breaker.record_failure() \
                    if circuit_breaker else None
                raise
            await circuit_breaker.record_failure() \
                if circuit_breaker else None
            delay = backoff_delay(attempt, base=backoff_base,
                                  cap=backoff_cap)
            # Honor Retry-After header if present
            if hasattr(e, "retry_after") and e.retry_after:
                delay = max(delay, e.retry_after)
            logger.warning(
                "%s retryable error (attempt %d/%d), retrying in %.2fs: %s",
                context or "api_call", attempt, max_attempts, delay, e,
            )
            await asyncio.sleep(delay)

    raise last_error or NMAApiError(
        f"Exhausted {max_attempts} attempts for {context}")


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def make_idempotency_key(*, tenant: str, operation: str,
                         params: dict[str, Any]) -> str:
    """Create a stable idempotency key from tenant + operation + param hash.

    The key must identify the *operation*, not the *attempt*. Using a
    per-attempt UUID defeats deduplication. Hashing the parameters means
    identical requests (even after a re-plan) share the same key.
    """
    fingerprint = hashlib.sha256(
        json.dumps(params, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    ).hexdigest()[:32]
    key = f"{tenant}:{operation}:{fingerprint}"
    assert len(key) <= 255, f"Idempotency key too long: {len(key)} chars"
    return key


# ---------------------------------------------------------------------------
# NMAApiError (defined here to avoid circular import)
# ---------------------------------------------------------------------------


class NMAApiError(RuntimeError):
    """Raised when the backend API returns an error response."""

    def __init__(self, message: str, *,
                 retryable: bool = False,
                 retry_after: float | None = None,
                 status_code: int | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after
        self.status_code = status_code


logger = logging.getLogger(__name__)
