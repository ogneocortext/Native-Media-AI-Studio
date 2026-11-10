---
tags:
  - platform
aliases:
  - ACP Agent Registry 2026
cssclasses:
  - platform-guide
date: 2026-11-09
type: source
---
> [!info] Purpose
> Snapshot of the official Agent Client Protocol (ACP) registry as of 2026-11-07 (45 agents), with license and cost class per agent, compiled 2026-11-09 from the registry JSON itself - the primary source, not vendor marketing. Reference for choosing which third-party agents may plug into Devin Desktop (formerly Windsurf) and on what terms.

---

## Overview

ACP agents run inside Devin Desktop's Agent Command Center and bill through their own vendors, never through Devin quota. Cost classes used below: FREE (none exist at full capability), OPEN-SOURCE (software free; model costs are yours), FREE-TIER-THEN-PAID, PAID, PAY-PER-USE, UNVERIFIED. Registry counts at snapshot: 22 open-source, 12 free-tier-then-paid, 5 paid, 2 pay-per-use, 4 unverified.

**Compiled:** 2026-11-09 - **Registry snapshot:** official ACP registry, updated 2026-11-07 - **Agents listed:** 45

## What ACP is

The **Agent Client Protocol (ACP)** is an open protocol that standardizes communication between code editors and coding agents - the same role LSP plays for language servers. Any agent that implements ACP can plug into any ACP-compatible editor. The canonical list lives in the official registry JSON, which clients fetch programmatically:

- Registry: https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
- Registry docs: https://agentclientprotocol.com/get-started/registry

## The Windsurf context (why this list matters here)

- Windsurf was renamed **Devin Desktop** by Cognition on **June 2, 2026**. The IDE, plans, and extensions carried over; only the name and branding changed.
- Devin Desktop runs third-party agents through ACP in its Agent Command Center. Its docs name only five examples (Codex CLI, Claude Agent, OpenCode, Junie, Gemini CLI) - the full registry below is much larger: https://docs.devin.ai/desktop/acp
- **ACP agents in Devin Desktop require a Pro, Max, or Teams plan** - they do not run on the Free plan (per Devin Desktop pricing/FAQ coverage, e.g. https://sharkly.ai/blog/is-windsurf-free/).
- **Every ACP agent bills through its own vendor, not through Devin quota.** Enabling an agent in the panel costs nothing; running it costs whatever that vendor charges. Devin/Cognition's privacy terms do not cover third-party agents.
- Local registry file (Windows): `%USERPROFILE%\AppData\Roaming\Code\User\acp\registry.json`

## Cost classes used in this document

| Class | Meaning |
|---|---|
| **FREE** | No cost to run as-is, including a usable hosted quota |
| **OPEN-SOURCE** | The software is free (permissive/copyleft license). You pay only model costs - your own API keys, a provider plan, or $0 with local models |
| **FREE-TIER-THEN-PAID** | A real free tier exists; sustained use requires a paid plan |
| **PAID** | No free tier (a time-boxed trial does not count as a tier) |
| **PAY-PER-USE** | No subscription; you pay per invocation / per token / per credit |
| **UNVERIFIED** | Small or new entrant; pricing could not be verified from public sources on 2026-11-09 |

**Headline finding:** there is **no agent in the registry that is unconditionally FREE at full capability**. Every "free" route is either open-source software where the models are on you, or a free tier in front of a paid plan. Counts: **OPEN-SOURCE 22 - FREE-TIER-THEN-PAID 12 - PAID 5 - PAY-PER-USE 2 - UNVERIFIED 4 - FREE 0.**

---

## Part 1 - The 8 agents in the user's Devin Desktop panel

These are the agents shown in Settings -> Agents on 2026-11-09. Only Devin Local was enabled.

### 1. Devin Local (registry name: Devin) - FREE-TIER-THEN-PAID
*Registry description: "Devin CLI coding agent by Cognition."*
Devin now sells Free ($0, light agent quota), Pro ($20/mo), Max ($200/mo), and Teams ($80/mo minimum + $40/full seat). The old Core/ACU pricing was retired in April 2026; overage is billed at API rates. (https://whizi.io/resources/devin-pricing/ - https://hokai.io/hub/tools/devin)
**Verdict:** Already the user's Tier A Provisional executor - the only panel entry that should be enabled. Note the user's Devin free-access window ends **December 4, 2026** on his current arrangement, after which it is paid-only.

### 2. Codex - FREE-TIER-THEN-PAID
*Registry description: "ACP adapter for OpenAI's coding assistant."*
Codex has no standalone price: it rides a ChatGPT plan. A limited amount is included on Free; the real entry is Plus at $20/mo (Pro tiers $100/$200/$500), or bring an OpenAI API key and pay per token (e.g. GPT-6.1 Sol $2 in / $10 out per 1M). (https://www.nocode.mba/articles/codex-pricing - https://standardcompute.com/codex-cli-pricing)
**Verdict:** On the user's roster as GPT-6 - Tier C, supervised, boilerplate/docs only. Nothing about the ACP door changes that.

### 3. Agoragentic - PAY-PER-USE
*Registry description: "Agent marketplace with 174+ AI capabilities. Browse, invoke, and pay for agent services settled in USDC on Base L2."*
No subscription and no free tier: every invocation is a paid transaction in USDC crypto.
**Verdict:** Hardest no on the panel. An unvetted third-party agent marketplace with per-call crypto settlement is the user's skills-as-unvetted-code concern in its purest form. Leave disabled.

### 4. Amp - FREE-TIER-THEN-PAID (corrected from an earlier "paid" call)
*Registry description: "ACP wrapper for Amp - the frontier coding agent."*
Amp spun out of Sourcegraph in December 2025. Since **September 13, 2026** the agent itself is **free on the Hobby tier** if you bring your own model subscription or API keys and run on your own machine. Amp-hosted cloud machines ("orbs") are pay-as-you-go; Individual "Megawatt" is $20/mo (45,000 orb minutes), "Gigawatt" $200/mo. The older "$10/day free credits" model is superseded. (https://www.software-lifecycle.com/software/amp - https://www.reviewramble.com/tools/amp)
**Verdict:** Frontier-class and the strongest untested name on the panel - and now genuinely free to trial in BYOK mode. Still **Untested** until a first-contact task under the roster protocol.

### 5. Google Antigravity - FREE-TIER-THEN-PAID
*Registry description: "Google's AI coding agent."*
Generally available since September 2026. The Individual plan is **$0** with "basic weekly rate limits" on agent models (quotas were tightened repeatedly during preview); higher limits ride Google AI Pro ($19.99/mo) or Ultra ($99.99 / $199.99). There is no standalone Antigravity subscription. (https://justinmckelvey.com/blog/google-antigravity-pricing - https://axonbuild.com/blog/google-antigravity-pricing/)
**Verdict:** Free or not, this stays disabled - the user uninstalled Antigravity in the October 26, 2026 consolidation under a standing never-reinstall rule.

### 6. Auggie CLI - PAID
*Registry description: "Augment Code's powerful software agent, backed by industry-leading context engine."*
No free tier. After an October 2026 overhaul (Augment's Context Engine, Cosmos platform, and Auggie CLI were acquired by **Harness** on Oct 8, 2026), pricing is flat team plans: Standard $20/mo flat (up to 50 seats, $20 of usage included), Business $100/mo flat ($100 usage included), Enterprise custom. Usage bills at model list price **plus a 40% service fee**, plus Cosmos compute at $0.19/hr. (https://docs.augmentcode.com/models/token-based-pricing - https://academy.techpresso.co/reviews/is-augment-code-worth-it)
**Verdict:** A large-codebase context engine is a real pitch for a growing repo, but it's a paid team product mid-acquisition. Untested; no reason to move first here.

### 7. Bob (IBM Bob) - PAID
*Registry description: "IBM Bob is your AI-Powered Development Partner."*
Free 30-day trial with 50 "Bobcoins" - and no free tier after it. Pro $20/mo (50 Bobcoins), Pro+ $60/mo (180), Ultra $200/mo (1,000); overage $0.50/Bobcoin. Enterprise-flavored, with paid add-ons for Java/IBM i/IBM Z modernization. (https://www.ibm.com/products/ai-coding-agent/pricing)
**Verdict:** Enterprise sales motion, coin metering, mainframe upsells. Nothing here fits a solo studio. Leave disabled.

### 8. Cline - OPEN-SOURCE
*Registry description: "Autonomous coding agent CLI - capable of creating/editing files, running commands, using the browser, and more."*
The software is free and open source (Apache-2.0, https://github.com/cline/cline). All cost is model inference: bring your own API keys, pay a provider, or run local models for $0. An optional Enterprise plan exists for organizations.
**Verdict:** The ACP entry is the CLI sibling of the user's VS Code fallback. Same known failure mode (it kicks him out); the CLI badge doesn't fix that. Software free, models on you.

---

## Part 2 - All 45 registry agents, grouped by cost class

Descriptions are quoted from the official registry JSON (2026-11-07). Pricing sources are inline; all checked 2026-11-09 unless noted.

### OPEN-SOURCE - free software; you pay only model costs (or run local for $0) - 23 license-verified

*Completion note (Maya, 2026-11-09): the original compile of this file truncated mid-table at 12 rows. The table below was completed from the registry JSON's own license metadata - every entry here carries a non-proprietary license in the official registry. Five further registry entries also carry open licenses but are thin ACP adapters/wrappers for hosted services, not forkable agents: Codex (Apache-2.0 adapter), Gemini CLI (Apache-2.0), GLM Agent (Apache-2.0 community wrapper), Amp (Apache-2.0 wrapper repo), Agoragentic (MIT integration package).*

| Agent | What it is | Cost notes |
|---|---|---|
| **Autohand Code** | "Autohand Code CLI with native ACP support" | Apache-2.0 (github.com/autohandai/code-cli). BYO model keys. |
| **Cline** | See panel 8 | Apache-2.0. BYO keys / local models. |
| **crow-cli** | "Minimal ACP Native Coding Agent" | MIT (github.com/crow-cli/crow-cli). BYO keys. |
| **DeepAgents** | "Batteries-included AI coding and general purpose agent powered by LangChain" | LangChain open-source framework (github.com/langchain-ai/deepagentsjs). Model costs are yours. |
| **Dirac** | "Reduces API costs by more than 50%... Fully Open Source" | Apache-2.0 (github.com/dirac-run/dirac). Its pitch is cutting the API bill you bring. |
| **fast-agent** | "Code and build agents with comprehensive multi-provider support" | Apache-2.0 (github.com/evalstate/fast-agent). A framework, not a service. |
| **goose** | "A local, extensible, open source AI agent that automates engineering tasks" | Block's agent (github.com/block/goose); runs locally, works with local models - can be run at $0. |
| **Harn** | "Harn runs .harn agent pipelines as a native ACP coding agent over stdio" | Apache-2.0 (github.com/burin-labs/harn). BYO models. |
| **Kilo** | "The open source coding agent" | MIT (github.com/Kilo-Org/kilocode). Free software; model costs via your providers or local models. **This is the user's daily driver - see Part 3.** |
| **Kimchi** | "Coding agent powered by multi-model orchestration" | Apache-2.0 (github.com/getkimchi/kimchi). BYO providers. |
| **Kimi CLI (Legacy)** | "Archived by Moonshot AI. Use Kimi Code instead" | Open-source, archived. Superseded - do not adopt. |
| **Kimi Code** | "Moonshot AI's next-gen coding agent" | MIT CLI (github.com/MoonshotAI/kimi-code). Moonshot's API has **no free tier** ($1 minimum recharge; K2.7 Code  $0.95 in / $4.00 out per 1M), but the Kimi weights are open, so self
...[truncated 8189 chars]
| **Corust Agent** | "Co-building with a seasoned Rust partner" | GPL-3.0-or-later (github.com/Corust-ai/corust-agent-release). Copyleft - commercial fork terms need care. |
| **MiniMax Code** | "MiniMax Code is an AI coding agent with Agent Client Protocol support" | MIT per registry; no public repo listed in the registry entry. |
| **Minion Code** | "An enhanced AI code assistant built on the Minion framework" | AGPL-3.0 (github.com/femto/minion-code). Strong copyleft - hosted/commercial use triggers source obligations. |
| **Mistral Vibe** | "Mistral's open-source coding assistant" | Apache-2.0 (github.com/mistralai/mistral-vibe). BYO Mistral API or local models. |
| **OpenCode** | "The open source coding agent" | MIT (github.com/anomalyco/opencode). The most-adopted open agent in the registry. |
| **OpenCode V2** | "The open source coding agent, version 2" | MIT (same repo). Next major version of the above. |
| **pi ACP** | "ACP adapter for pi coding agent" | MIT (github.com/svkozak/pi-acp). Adapter for the pi agent. |
| **Qwen Code** | "Alibaba's Qwen coding assistant" | Apache-2.0 (github.com/QwenLM/qwen-code). Gemini CLI lineage, tuned for Qwen models. Its hosted free OAuth tier ended 2026-04-15; the software remains open. |
| **siGit Code** | "Local-first coding agent. Runs entirely on your machine with optional on-device LLM" | Apache-2.0 (github.com/getsigit/sigit). The local-first entry. |
| **Stakpak** | "Open-source DevOps agent in Rust with enterprise-grade security" | Apache-2.0 (github.com/stakpak/agent). DevOps-leaning. |
| **VT Code** | "An open-source coding agent with LLM-native code understanding and robust shell safety" | MIT (github.com/vinhnx/VTCode). |

### The other 22 - proprietary software or hosted services

Per the registry's license metadata, these carry **proprietary** licenses: Google Antigravity, Auggie CLI, Bob, Claude Agent, Codebuddy Code, Cortex Code, Cursor, Devin, DimCode, Factory Droid, GitHub Copilot, Grok Build, Junie, Kiro CLI, Nova, Poolside, Qoder CLI (17). The remaining five are service-classified in Part 1 / the cost summary: Agoragentic (pay-per-use), Amp, Codex, and Gemini CLI (free-tier-then-paid services whose clients/adapters are open-licensed), and GLM Agent (community ACP wrapper over Zhipu's paid GLM Coding Plan).

## Part 3 - Notable for this user

- **Kilo is registry-listed and MIT-licensed** - the daily driver is itself forkable open source.
- **OpenCode is in the registry twice (V1 + V2), MIT** - availability does not change the October 2026 consolidation verdict; forking a base is a different decision from reinstalling a daily driver, and it stays the user's call.
- **Qwen Code + Gemini CLI**: both clients are open source; both hosted free tiers died in 2026 (Qwen OAuth tier 2026-04-15; Gemini CLI sign-in free tier 2026-06-18). The software survived; the free hosted route did not.
- **siGit Code** is the local-first/on-device entry - closest in spirit to the user's owned-stack direction.

## Related

- [[nemotron-3-5-bolt-e4b-2026]]:see-also
- [[torch-cuda-support-windows-2026]]:see-also
