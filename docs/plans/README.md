# docs/plans/

One file per work item. This is how planning drives the local coding agents:
Orion writes the plan here, the repo owner approves, it gets pushed, agents
`git pull` and implement from it. Plans survive context compression because
they live in git, not in a chat window.

## Convention

- File name: `<topic>-<slug>.md` (e.g. `q2-auto-fallback.md`).
- Every plan starts with a header: **Status**, **Decides** (decision-log Q#),
  **Owner**, **Approved**.
- Before implementing a plan, read it **and** `docs/architecture/decision-log.md`.
  Do not re-litigate items marked decided (D1–D8). Open questions (Q1–Q4) are
  fair game only inside the plan that decides them.
- When implementation is done, update the plan: set **Status: Done** and append
  a **Build notes** section (what was built, what diverged from the plan and why).
- Plans are planning documents, not code. Implementation lands in normal commits.
  A plan never authorizes touching `unity-visualizer/` (protected standalone
  project) or changing decided architecture without a decision-log entry.

## Statuses

- `Proposed` — written, awaiting owner review.
- `Approved` — owner signed off; agents may implement.
- `In progress` — an agent is building it.
- `Done` — implemented; build notes appended.
