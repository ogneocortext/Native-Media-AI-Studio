"""
Push notification subscription store.

In production, subscriptions should be persisted to a database and
integrated with a Web Push provider (pywebpush / Firebase Cloud Messaging).
This module provides an in-memory store for development and a typed surface
the API layer can call without importing provider-specific packages.
"""

from __future__ import annotations

import threading
from typing import Any

push_subscriptions: dict[str, dict[str, Any]] = {}

_lock = threading.Lock()


def add_subscription(subscription: dict[str, Any]) -> None:
    endpoint = subscription.get("endpoint")
    if not endpoint:
        raise ValueError("subscription missing endpoint")
    with _lock:
        push_subscriptions[endpoint] = subscription


def remove_subscription(endpoint: str) -> None:
    with _lock:
        push_subscriptions.pop(endpoint, None)


def get_subscriptions() -> list[dict[str, Any]]:
    with _lock:
        return list(push_subscriptions.values())
