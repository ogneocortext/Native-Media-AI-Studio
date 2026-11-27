"""EventBus delivery-manager fan-out must run even with zero subscribers.

Regression test for the seam where publish() returned early on an empty
in-process subscriber list, before the SSE/WebSocket fan-out — dropping
health/resource/queue events before they reached any client.
"""

from app.core.event_bus import Event, EventBus, EventCategory


class FakeSSEManager:
    def __init__(self):
        self.sent = []

    async def send_message(self, payload):
        self.sent.append(payload)


class FakeWSManager:
    def __init__(self):
        self.sent = []

    async def broadcast(self, event_type, data):
        self.sent.append((event_type, data))


async def test_publish_fans_out_to_managers_with_zero_subscribers():
    bus = EventBus()
    sse, ws = FakeSSEManager(), FakeWSManager()
    bus.set_managers(sse_manager=sse, ws_manager=ws)

    event = Event(
        category=EventCategory.HEALTH,
        type="system.health_changed",
        data={"status": "healthy"},
    )
    delivered = await bus.publish(event)

    assert delivered == 0  # no in-process subscribers notified
    assert len(sse.sent) == 1
    assert sse.sent[0]["type"] == "system.health_changed"
    assert ws.sent == [("system.health_changed", {"status": "healthy"})]


async def test_publish_still_delivers_to_subscribers_and_replay():
    bus = EventBus()
    sse = FakeSSEManager()
    bus.set_managers(sse_manager=sse)

    received = []

    async def callback(evt):
        received.append(evt)

    await bus.subscribe(callback, event_type="job.updated")
    event = Event(category=EventCategory.JOB, type="job.updated", data={"job_id": "j1"})
    delivered = await bus.publish(event)

    assert delivered == 1
    assert received == [event]
    assert len(sse.sent) == 1
    # replay buffer recorded the event
    replayed = await bus.get_replay_events()
    assert any(entry["event"]["id"] == event.id for entry in replayed)
