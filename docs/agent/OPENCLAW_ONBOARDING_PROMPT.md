# Prompt: Initialize OpenClaw/ClawdBot to Respect the DR3 Agent Contract

**Use this prompt with the agent responsible for setting up your OpenClaw/ClawdBot environment.** It summarizes the multi-agent contract system that Claude Code and Cursor just installed and asks for a plan so ClawdBot always follows the same rules and patterns.

---

## Copy-paste prompt (give this to the OpenClaw setup agent)

---

You are an AI agent responsible for planning how to initialize the **OpenClaw/ClawdBot** environment so that ClawdBot, when working on the DR3 Dashboard codebase, **always respects the same rules and patterns** as the existing Cursor and Claude Code agents.

### Context: What Was Just Created

Two other agents (Claude Code and Cursor) have set up a **multi-agent contract system** across two repositories that together serve https://dr3-dashboard.com:

- **ma-tracker-app** — Next.js dashboard, FastAPI backend, IB data agent (branch: `main`)
- **py_proj** — KRJ backtester, market state pipelines, research scripts (branch: `cursor-dev`)

**Canonical contract and sync artifacts (identical in both repos):**

1. **`docs/agent/AGENTS.md`** — Full agent contract: purpose, system map, non-negotiables (security, code quality, data pipeline integrity), **mandatory release notes process**, guidance-change protocol, workflow standards, repo-specific quick reference, file inventory, and **Section 10: Onboarding a New Agent**.
2. **`docs/agent/SHARED_BLOCK.md`** — The ~40-line shared block that must appear identically in every agent instruction file. It covers: two-repo system, multi-device sync, security & privacy, **release notes (mandatory)**, and agent coordination.
3. **`docs/agent/README.md`** — Workflow documentation: how to update shared vs repo-specific rules, how to run the sync check, onboarding steps, troubleshooting.
4. **`docs/agent/check_sync.sh`** — Bash script that verifies: (a) the four files above are byte-identical across both repos, and (b) the shared block embedded in each instruction file matches `SHARED_BLOCK.md`. Run from repo root: `bash docs/agent/check_sync.sh`. Exit 0 = in sync; exit 1 = drift.

**Per-repo instruction files (each contains the shared block + repo-specific guidance):**

- **`.cursorrules`** — Read by Cursor IDE. In ma-tracker-app it also points to `.cursor/rules/*.mdc` for domain rules (execution engine, security/latency, IB contract resolution, realtime event push, UI configurability, IB TWS API settings, push-and-deploy).
- **`CLAUDE.md`** — Read by Claude Code CLI. Same shared block as `.cursorrules`; repo-specific content is the long-form operational and architectural guidance.

The shared block in both files is delimited by:

```
<!-- BEGIN SHARED BLOCK — DO NOT EDIT — source: docs/agent/SHARED_BLOCK.md -->
... contents ...
<!-- END SHARED BLOCK -->
```

**Critical rules that every agent must follow (and that ClawdBot must respect):**

- **Security & privacy:** Never log/print/commit secrets; never commit real credentials; no `allow_origins=["*"]` in production; validate user input; no exposure of internal paths/IPs in client-facing code.
- **Release notes (mandatory):** Every user-visible change (features, bug fixes, pipeline changes that affect the dashboard) must be documented in `release-notes/YYYY-MM-DD.json` in ma-tracker-app, with screenshots when applicable. Never skip this step.
- **Data pipeline integrity:** Never overwrite production KRJ data during deploys; preserve CSV conventions and directory structure unless explicitly instructed otherwise.
- **Coordination:** Check for in-progress work (e.g. `.claude-session`, recent git log) before starting; do not discard uncommitted changes from other agents; discuss major architectural changes with the user first.
- **Guidance consistency:** If ClawdBot’s instruction file is part of the “shared block” verification (see below), any change to shared rules must go through `SHARED_BLOCK.md` and be re-embedded everywhere; then run `check_sync.sh`.

### Your Task

**Plan the work** to initialize the OpenClaw/ClawdBot environment so that:

1. **ClawdBot always receives and respects** the rules and patterns defined in:
   - **`.cursorrules`** and **`CLAUDE.md`** (and, when working in ma-tracker-app, the substance of **`.cursor/rules/*.mdc`**),
   - **`docs/agent/AGENTS.md`** (full contract),
   - **`docs/agent/SHARED_BLOCK.md`** (canonical shared block),
   - and any other specifications of our system (e.g. deploy process, release notes workflow, security and latency rules).

2. **ClawdBot is treated as a first-class agent** in the same contract: it should either:
   - **Option A:** Have its own instruction file (e.g. `CLAWDBOT.md` or whatever OpenClaw expects) that includes the **exact same shared block** from `docs/agent/SHARED_BLOCK.md` between the standard markers, plus repo-specific guidance (and, if applicable, a pointer to `docs/agent/AGENTS.md` and to `.cursor/rules/*.mdc` for ma-tracker-app). If you add this file, it must be documented in `docs/agent/AGENTS.md` Section 3, and **`docs/agent/check_sync.sh`** should be updated to verify the shared block in this new file as well (so we maintain one source of truth and detect drift).  
   - **Option B:** Be configured to read **only** the existing `.cursorrules` and/or `CLAUDE.md` (and `docs/agent/AGENTS.md`) at session start, so it never has a separate instruction file that could drift. In that case, document in AGENTS.md how ClawdBot is onboarded (e.g. “ClawdBot reads .cursorrules + CLAUDE.md + docs/agent/AGENTS.md”).

3. **The plan** should cover:
   - Where ClawdBot’s instructions live (file path(s) and format).
   - Exactly how the shared block and repo-specific guidance are loaded (e.g. embedded in one file, or “read these files in order”).
   - How to ensure the **release notes mandate** and **security/deploy rules** are unmissable (e.g. called out in the first screen of instructions).
   - If you add a new instruction file that contains the shared block: how to add it to `check_sync.sh` so the script checks that file in both repos (or in the repo(s) where ClawdBot will run).
   - Any OpenClaw-specific constraints (e.g. max instruction length, file format) and how to satisfy them while still including the full contract and shared block.
   - A short “day-one” checklist for the user: pull latest, run `docs/agent/check_sync.sh`, confirm ClawdBot’s instruction file(s) are present and in sync.

### Non-negotiables for your plan

- Do not weaken or remove the **release notes** requirement or the **security/privacy** rules.
- Do not introduce a second source of truth for the shared block; either embed from `SHARED_BLOCK.md` with the same markers or have ClawdBot read the existing instruction files.
- If you extend `check_sync.sh`, keep it runnable from repo root with the same usage (and optional sibling-repo path); document any new checks in `docs/agent/README.md`.

### Deliverables

1. A **concrete plan** (numbered steps or short sections) for initializing the OpenClaw/ClawdBot environment so ClawdBot always respects `.cursorrules`, `CLAUDE.md`, and the rest of the system.
2. **Exact file paths and formats** for any new instruction file(s) and any edits to `docs/agent/AGENTS.md`, `docs/agent/README.md`, and `docs/agent/check_sync.sh`.
3. A **one-paragraph summary** the user can paste into their notes: “How ClawdBot is kept in sync with the DR3 agent contract.”

---

## End of prompt

---

*This prompt is part of the agent contract system. See `docs/agent/AGENTS.md` and `docs/agent/README.md`.*
