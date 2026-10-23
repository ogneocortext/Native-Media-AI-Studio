#!/usr/bin/env python3

path = r"D:\Backup of Important Data for Windows 11 Upgrade\Native Media AI Studio\docs\knowledge-library\comfyui-workflows.md"

with open(path, "rb") as f:
    content = f.read()

# Update date
old = b"2026-09-09 \xe2\x80\x94"
new = b"2026-10-22 \xe2\x80\x94"
content = content.replace(old, new, 1)

# Insert new sections before '## Related' but after the '---' separator
# Structure: _Last updated... then --- then ## Related
idx_related = content.find(b"## Related")
if idx_related >= 0:
    # Find the --- before ## Related
    # Look for --- just before ## Related
    section_marker = b"---## Related"
    idx_marker = content.find(section_marker)
    if idx_marker >= 0:
        # Insert new sections before the ---## Related marker
        new_sections = b"""---

## Prompt Submission Format

Prompts are sent to ComfyUI via `POST /prompt` with a workflow JSON payload.

The workflow follows ComfyUI's numbered node format:

```json
{
  "3": { "class_type": "KSampler",
    "inputs": {
      "seed": <int>, "steps": <int>, "cfg": <float>,
      "sampler_name": "<str>", "scheduler": "<str>"
    }
  },
  "4": { "class_type": "CheckpointLoaderSimple",
    "inputs": {"ckpt_name": "<checkpoint>"}
  },
  "5": { "class_type": "EmptyLatentImage",
    "inputs": {"batch_size": 1, "height": <int>, "width": <int>}
  },
  "6": { "class_type": "CLIPTextEncode",
    "inputs": {"clip": ["4", 1], "text": "<prompt_text>"}
  },
  "7": { "class_type": "CLIPTextEncode",
    "inputs": {"clip": ["4", 1], "text": "<negative_prompt>"}
  }
}
```

Key fields:
- `seed`: Random seed or specific integer (-1 for random)
- `steps`: Number of sampling steps (default: 20)
- `cfg` (CFG scale): Guidance scale (default: 7.0)
- `sampler_name`: Sampler algorithm (default: "euler_ancestral")
- `scheduler`: Scheduler type (default: "normal")
- `prompt_text`: Positive prompt text (encoded via CLIPTextEncode)
- `negative_prompt`: Negative prompt text

## Backlog Timeout Mechanism

When a prompt is queued behind other work in ComfyUI, the deadline
is automatically extended from the default 300s (5 minutes) to
_QUEUE_BACKLOG_TIMEOUT (1800s / 30 minutes). This prevents premature
cancellation of prompts that are waiting in the queue.

The extension works as follows:
- Initial timeout: 300s (configurable per-generation)
- If prompt enters queue phase: timeout extended to 1800s
- Comparison: `elapsed_ms = current_time - start_time`
- If `elapsed_ms > QUEUE_BACKLOG_TIMEOUT`: prompt is cancelled

This ensures that prompts with long queues get sufficient time,
while prompts that have been running for a while still get cancelled
if they exceed the total threshold.

## Prompt Cancellation Flow

When a generation times out or fails, the following steps occur:

1. `_wait_for_result()` detects non-success exit status
2. Best-effort attempt to cancel the prompt via `cancel_prompt()`
3. `cancel_prompt()` uses `GET /queue` to check prompt status
4. If found, sends `POST /queue {"delete": [prompt_id]}` to ComfyUI
5. Never uses `DELETE /queue` (returns 405 on this ComfyUI build)
6. Any original error is preserved and not masked by cancellation

This design ensures that:
- Abandoned prompts are cleaned up from ComfyUI's queue
- The original error is always reported to the user
- No prompt leaks into the next generation cycle

"""
        content = content[:idx_marker] + new_sections + content[idx_marker:]

    with open(path, "wb") as f:
        f.write(content)

    print("Successfully updated " + path)
