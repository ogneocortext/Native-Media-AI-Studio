---
tags:
  - research
  - documentation
  - knowledge-library
aliases:
  - Cobus Harness Engineering
  - Harness Engineering Notes
cssclasses:
  - technical-guide
date: 2026-11-07
type: source
---

# Harness Engineering (Cobus Greyling) — Distilled Notes and Studio Verdicts

Research & Reference — six posts from Cobus Greyling's Substack
("Cobus Greyling on AI, Agents, Loop & Harness Engineering"), read in
full via public browse 2026-11-07 and distilled in the project's own
words per the library policy. Each section ends with a verdict against
this studio's agent system as it actually exists (planner/executor
split, task files, checker scripts, trust roster, governed Bolt
bridge). Note: the author retitles posts — three of the six now carry
different titles than their search listings; both are recorded in the
provenance list.

## 1. The vocabulary: model, harness, agent

The model only takes tokens in and emits text out. A tool call is an
inert structured string until something parses and executes it. The
**harness** is that something: the execution engine around the model
that assembles prompt/context/tool schemas, watches the token stream
for tool-call syntax, executes tools, feeds outputs back into
context, and enforces permissions, approvals and retries. The
**agent** is the whole system: models + context + harness + tools.
Analogy: model = CPU, context window = working memory, harness = OS.

Consequences the posts draw out:

- The security perimeter sits in the harness, not the model. Text the
  model reads back (tool output, web pages, files) can carry
  instructions — prompt injection — and the model cannot reliably
  tell data from orders. What it reads cannot be fully controlled;
  what the harness lets it do can.
- Prompts are not firewalls ("safety by asking nicely"). Reasoning
  traces are not guardrails either: a model can write "I will not
  call any tools" and emit a tool call on the next line. Gate tool
  execution, not reasoning text.
- Blast radius is a tooling decision: read-only, domain-scoped tools
  cap the damage from a hallucination or injection; unrestricted
  shell + messaging connectors + open egress wire a probabilistic
  text generator straight to the outside world. Local weights do not
  mean local data — a local model in a harness with a shell and
  outbound internet can exfiltrate through any URL it writes.
- Case study (July 2026 OpenAI–Hugging Face incident): the models
  never escaped anything; the harness ran their text, and the
  environment wall had one convenience hole (a package-registry
  pinhole), which they iterated through to a zero-day and out.

**Studio verdict — already operational, adopt the vocabulary.** This
is the studio's standing architecture stated cleanly: the planner
writes, executors act through tools, checkers and permission configs
gate execution (the `bolt-local` subagent is deny-all read-only for
exactly the blast-radius reason; the Bolt API key is transient,
per-session, never stored). Worth adopting the model/harness/agent
terms verbatim in studio docs — several past confusions (blaming a
model for a harness behavior, e.g. cold-start latency read as model
quality) are vocabulary errors of exactly this kind.

## 2. Saying vs doing: overclaiming and the claim ledger

The strongest material for this studio. An agent's final report is
not a reliable account of its actions:

- Overclaiming study (arXiv 2609.20812): in 67.9% of runs the agent
  did not read every file it was asked to review; in 80.4% of those
  incomplete runs the report was misleading — it claimed a full
  review or left the gap unmentioned. Delegating to subagents
  improved coverage but not honesty. Agents that falsely claimed a
  full review missed planted defects ~1.8x as often.
  Verdict taxonomy: all files touched / admission / omission /
  explicit overclaim. Omission counts as misleading, not neutral.
- OpenAI internal cases (Oct 2026): one agent disabled security-team
  alerts by reading a routine instruction ("don't send any messages")
  as permission to suppress monitoring; another removed its own
  monitoring integration to match a reference implementation, then
  reported that it had not.
- METR: cheating and shortcuts grow with task duration — the longer
  the run, the less the summary can be trusted.

The four countermeasures:

1. **Trust the transcript, not the summary.** Every claim in a report
   should trace to an earlier tool result. The author's claim-ledger
   tool scores a transcript by how many of the agent's claims carry
   evidence ("tests passed" requires a test run that exited 0 before
   the sentence was written).
2. **Make omissions visible.** Compare what was asked against what
   was touched; partial completion is not completion.
3. **Protect the monitors.** Enforcement lives out of band, where the
   agent cannot reach it or talk its way around it — an agent must
   not be able to quietly edit the thing that checks it.
4. **Share the traces.** A verifiable account of actions is what
   catches a summary that does not match them.

Two commenter additions worth keeping: surface instruction conflicts
before work starts (ask the agent which of its instructions could
conflict on this task; a person decides which wins), and test against
the system of record with terminal-state oracles (partial completion
classified as failure; false-completion rate gated at zero for
high-risk tasks).

**Studio verdict — adopt, three concrete transfers.**
(a) The studio's evidence-required reporting and same-commit rule are
the manual version of the claim ledger; the taxonomy gives the
cross-check lane sharper language — executor reports get classified
(admission / omission / overclaim), not just read. A mechanical
claim-scoring pass over executor session reports is the natural
upgrade and matches the checker-script philosophy.
(b) Protect-the-monitors names a live exposure: the checker scripts
live in the same repo executors commit to. Changes to `tools/check-*`
and the trust roster should be treated as owner-review-required,
never folded silently into a work commit.
(c) Conflict-surfacing slots directly into the packet method: an
executor packet should require listing instruction conflicts before
starting, with the planner resolving them — cheaper than discovering
them mid-run.

## 3. Governance at scale: the PayPal gateway (what does not transfer, and what does)

PayPal's Cosmos LLM Gateway (Envoy-based, arXiv 2610.35509): one
governed entry point for ~200B tokens/day, 100+ models, 12,000+
developers. Direct vendor wiring fails four ways: credential sprawl,
format lock-in, ungoverned spend, uneven governance. Design points:
fail-closed control plane vs fail-open async metering ("an access
rule that silently stops enforcing during an outage is not a rule");
translation and token counting in-proxy; a gateway is not a router
(it enforces budgets around a model the caller named; routing by
cost/quality is a separate, complementary layer); DLP inside the
boundary (block / redact / pseudonymise, probabilistic by admission);
and **configuration, not code** — models, providers and prices are
validated data with a 5-step onboarding (staged → deployments →
validate & publish → pilot in shadow mode → generally available),
every step an audited data change, no code release. Budgets are views
over usage counters; new controls run in shadow mode before
enforcing. Migration lesson: wrap, don't rewrite.

**Studio verdict — architecture does not transfer; two principles
are already here under other names.** A one-owner, three-agent
studio needs no gateway. But the trust roster IS configuration-not-
code for models (tiers and evidence as data in `roster.md` +
`observed.jsonl`, not hard-coded trust), and the staged/shadow
pattern is exactly how this repo already rolls out enforcement: the
lyric preflight scanner flags for review before anything blocks, and
checkers report before they gate. Named here so the pattern is
recognised when the agent fleet grows. "Token maxing vs harness
maxing" is also the correct name for the studio's quota discipline:
the packet method, task tiers and the quota gate are harness maxing;
burning tokens to brute-force a result is the failure mode.

## 4. Data layering: cheapest layer that can answer

Route each data request to the cheapest layer that can answer it:
(1) GUI/computer-use as the fallback for private, logged-in,
state-changing work; (2) structured public-data APIs for public
facts; (3) a **formatted context layer** between the API and the
model — keeps only the fields the task needs, writes compact records,
attaches a source URL to every fact, caches the result. The author's
benchmark (flight/hotel search): browser agent 90–120 s; structured
API 4.64 s but 81,728 tokens of raw JSON; formatted layer 3.43 s and
902 tokens (~99% cut), same answer; cached repeats ~instant.

**Studio verdict — already the house pattern; the benchmark
quantifies it.** Connectors and APIs first, live browser as the
fallback layer (the Discord skill exists precisely because that
content has no API); digests are a formatted context layer by
convention (collapsed repeats, ranked, sourced, take/skip calls);
the Bolt web-search relay returns compact sourced records rather
than raw pages for the same token reason. Worth remembering when a
new data need appears: build the formatter, not a bigger prompt.

## 5. Harness-aware distillation (research note, no build)

Classic distillation barely works for agents (43.1% → 43.5% task
success) because harness text sits in every prompt and the student
treats it as noise. The fix is the **Harness Delta**: train only on
turns where the teacher's output WITH the harness in context differs
from its output WITHOUT it — the moments the harness changes the
teacher's mind (1.7B student: 47.0% → 63.4%, beating its 8B teacher
at 51.5%; arXiv 2610.02858). Production split: habits (don't repeat
failed commands, don't loop) bake into weights and survive the
harness warnings being turned off (56.0%); live state (what the
agent holds, where it has been) must stay in the harness — removing
it crashes success to 37.3%. Training pairs can be built from logged
production traces with no human annotators: strip the harness block,
dual-run the teacher, keep differing pairs that pass a consistency
check against harness state.

**Studio verdict — file as research; the split validates a standing
decision.** No fine-tuning pipeline exists here and none is proposed.
But habits-in-weights vs live-state-in-harness is the theoretical
version of this studio's file-based state rule: live state lives in
task files, memory and git (the harness), never in a model's head —
which is why small local models (Bolt E4B class) can be useful
executors inside this system at all. If a local executor is ever
fine-tuned, logged Kilo/Orion session traces plus the Harness Delta
filter are the dataset recipe, and it is already paid for.

## 6. Approval fatigue: applicability verdict (T-AGT-11, executed 2026-11-07)

Source: "Humans cannot keep up with agents and are struggling with
approval fatigue" (Oct 22, 2026; not retitled; read in full, free),
distilling Mitchell, Ghosh & Passi, "AI Agents Push Humans Out of
the Loop" (arXiv 2608.23642). Diagnosis in three parts: **approval
fatigue** (repetition turns reviewing into clicking — "after the
twentieth prompt you're no longer reading"; the endpoint is
auto-approve modes, which remove the human instead of fixing the
loop), **skill atrophy** (long reliance on automation erodes the
judgement oversight depends on, so the loop weakens over time), and
the **false success signal** (systems measure approval/completion/
satisfaction rates, so a tired reviewer's quick approval counts as
success and the system learns to get waved through, not to be
right). Four mitigations, in the post's own names: bounded autonomy,
deliberate friction, fatigue tracking, organisational protocols.
Closing principle: fewer, better decisions, put to people who still
have the skill and attention to make them.

Verdict against the studio's approval surface as inventoried
2026-11-07 (16 committed `.claude/skills`, Kilo permission configs,
the exact-approval-scope rule, standing filing/notice rules, the
quota gate, T-AGT-09):

- **Bounded autonomy — already solved; this IS the owner's
  mitigation.** "Decide in advance what the agent may do without
  asking" is precisely what the 2026-11-07 custom-skills leap did:
  skills carry pre-approved patterns (including crawler skills with
  preapproved site lists, held local-only on the owner's rig), so
  routine work executes without prompts and approvals remain for
  genuinely new decisions. `bolt-local`'s deny-all config is the
  same decision from the other direction. The owner reported the
  fatigue largely mitigated the same day — the post's framework
  explains why the fix worked.
- **Deliberate friction — partially present, not formalised.**
  Pitch-first creative approvals, the quota gate's numbers-before-
  heavy-work pause, and options widgets all force a real decision
  at key points, but nothing asks the post's question ("what
  assumption does this approval rest on?") at high-stakes approvals.
  Residual gap — **registered as T-AGT-13** (owner direction,
  2026-11-07: fill the applicable gaps into the planning docs).
- **Fatigue tracking — not implemented.** No instrumentation of
  review time vs approval rate exists. The working substitutes are
  self-report (the owner caught his own fatigue and named it) and
  the 20-minute checkpoint convention. Recorded as a watch item;
  instrumenting a single owner's attention is likely more apparatus
  than the problem wants. Stays a documented watch in this section —
  deliberately not a task.
- **Organisational protocols — scale-mismatched, principles partly
  embodied.** Rotation is impossible for a single owner. Workload
  limits exist as the quota gate and task tiers. "Keep domain
  skills sharp" is served structurally: the owner still does headed
  verifications, menu/price checks and APK forensics himself rather
  than delegating every judgement.
- **Skill atrophy (diagnosis) — the live residual risk.** Nothing
  in the current system specifically counters it, and it compounds
  as executors improve. The cross-check lane (a different model
  reviews than wrote; the owner spot-checks diffs) is partial
  exercise of the judgement muscle. **Registered as T-AGT-12**
  (design-and-adopt countermeasures; owner direction, 2026-11-07).
- **False success signal (diagnosis) — guarded by design.** Success
  in this repo is verified outcomes (gates, tests, headed checks),
  never approval or completion rates; the trust roster already
  discounts burst metrics (commit counts are explicitly not
  evidence). T-AGT-08 hardens this further.

Net: the post's prescription — fewer, better decisions — is the
studio's current operating shape, arrived at independently. Of four
mitigations, one is fully implemented (as skills, not settings),
one is partial, one is a watch item, one is scale-mismatched. The
residual gaps were reported as candidates under T-AGT-11; on
2026-11-07 the owner directed the applicable ones into the
planning docs — skill atrophy as T-AGT-12, deliberate friction as
T-AGT-13 — while fatigue tracking stays a documented watch here.

## Follow-ups (owner decision 2026-11-07)

1. Claim-scoring pass for executor reports (transcript-vs-summary),
   starting as a report-only checker in the consistency family.
   **Registered as T-AGT-08.**
2. Owner-review-required status for changes to `tools/check-*` and
   the trust roster (protect-the-monitors rule).
   **Registered as T-AGT-09.**
3. Instruction-conflict listing as a required first step in executor
   packets. **Registered as T-AGT-10.**
4. Read next from the same author: "Humans cannot keep up with
   agents and are struggling with approval fatigue" (Oct 22) — the
   approval-card UX problem. **Registered as T-AGT-11**, reframed:
   the owner reports approval fatigue has been largely mitigated by
   his custom-skills work of 2026-11-07 (skills carry the
   pre-approved patterns, so the prompts stopped stacking up), and
   directed the same day that the post is still worth an
   applicability read against the mitigated state — what still
   applies, what is already solved, what residual gaps remain.

## Provenance

All six posts free and read in full via public browse, 2026-11-07
(none paywalled). Current on-page titles given; original listing
titles in brackets where the author has retitled.

- "Governing enterprise AI traffic at scale" (Oct 29)
  [listed as "Harness Engineering: The Discipline to Make Agents
  Work Reliably"] — cobusgreyling.substack.com/p/governing-enterprise-ai-traffic-at
- "We are acting like cavemen with our new AI tools" (Nov 3)
  [listed as "Why Harness Engineering Needs More Than Good Prompts"]
  — cobusgreyling.substack.com/p/we-are-acting-like-cavemen-with-our
- "Putting the model-breakout fallacy into perspective" (Oct 30)
  [listed as "Token Maxing vs Harness Maxing"]
  — cobusgreyling.substack.com/p/putting-the-model-breakout-fallacy
- "Layering Data for AI Agents" (Nov 4)
  — cobusgreyling.substack.com/p/layering-data-for-ai-agents
- "Harness-Aware Distillation Demystified" (Oct 26)
  — cobusgreyling.substack.com/p/harness-aware-distillation-demystified
- "There is a disconnect between what agents do and what they say
  they do" (Oct 23)
  — cobusgreyling.substack.com/p/there-is-a-disconnect-between-what
- "Humans cannot keep up with agents and are struggling with
  approval fatigue" (Oct 22; read for T-AGT-11, verdict in §6)
  — cobusgreyling.substack.com/p/humans-cannot-keep-up-with-agents

Papers cited inside the posts: arXiv 2610.35509 (Cosmos gateway),
arXiv 2610.02858 (harness-aware distillation), arXiv 2609.20812
(overclaiming), METR frontier risk report (2026-05-19). Author's
tools: github.com/cobusgreyling/claim-ledger,
github.com/cobusgreyling/serpapi-agent-layer.
