# Agent Contract — DR3 Dashboard System

> **Last updated:** 2026-02-22
> **Canonical location:** `docs/agent/AGENTS.md` in both `ma-tracker-app` and `py_proj`.

---

## 1. Purpose

This document governs all AI coding agents (Claude Code, Cursor, or any future tool) working on the DR3 Dashboard system. It ensures agents:
- Understand the two-repo architecture and their boundaries
- Follow consistent security, quality, and workflow standards
- Coordinate changes without stepping on each other
- Maintain the continuous release notes process

---

## 2. System Map

### Repositories

| Repo | Location (dev) | Branch | Purpose |
|------|----------------|--------|---------|
| **ma-tracker-app** | `/Users/donross/dev/ma-tracker-app` | `main` | Next.js 16 dashboard, FastAPI backend, IB data agent, Prisma ORM |
| **py_proj** | `/Users/donross/dev/py_proj` | `cursor-dev` | KRJ backtester, market state pipelines (regime detection, displacement signals), research scripts |

### Shared Infrastructure

| Resource | Details |
|----------|---------|
| **Production** | https://dr3-dashboard.com |
| **Droplet** | 134.199.204.12 (SSH alias: `droplet`) |
| **Database** | Neon PostgreSQL (shared by both repos) |
| **Docker** | `ma-tracker-app` runs in Docker on the droplet; `py_proj` runs bare on the droplet |
| **Data exchange** | `py_proj` writes to `~/apps/data/krj/` on the droplet; Docker mounts this into the Next.js container |

### Data Flow Between Repos

```
py_proj (Saturday cron)                    ma-tracker-app (Docker)
  KRJ_backtester_updated.py                  app/krj/page.tsx
  → latest_*.csv                             → reads data/krj/*.csv
  → metadata.json                            → reads data/krj/metadata.json
  → enriched_signals.json                    → reads data/krj/enriched_signals.json
  → displacement_signals.json                → reads data/krj/displacement_signals.json

  Writes to ~/apps/data/krj/ on droplet → Docker volume mount → /app/data/krj/
```

---

## 3. Agent Instruction Files

Each repo has TWO agent instruction files that serve different tools:

| File | Read by | Purpose |
|------|---------|---------|
| `.cursorrules` | Cursor IDE | Cursor's project-level instructions |
| `CLAUDE.md` | Claude Code CLI | Claude Code's project-level instructions |

**Both files in each repo contain:**
1. An identical **shared block** (from `docs/agent/SHARED_BLOCK.md`)
2. Repo-specific guidance unique to that repo

The shared block is delimited by markers:
```
<!-- BEGIN SHARED BLOCK — DO NOT EDIT — source: docs/agent/SHARED_BLOCK.md -->
...
<!-- END SHARED BLOCK -->
```

### Additional Instruction Files

**ma-tracker-app** `.cursor/rules/*.mdc` (domain-specific Cursor rules):
- `execution-engine.mdc` — IB execution engine patterns
- `security-and-latency.mdc` — Security and latency non-negotiables
- `ib-contract-resolution.mdc` — IB contract resolution lessons
- `realtime-event-push.mdc` — Real-time account event architecture
- `ui-configurability.mdc` — Column chooser and comfort mode
- `ib-tws-api-settings.mdc` — IB TWS API settings
- `push-and-deploy.mdc` — Auto-deploy on task completion

**py_proj** `.cursor/rules/*.mdc` (domain-specific Cursor rules):
- `bmc-pipeline.mdc` — BMC production pipeline architecture, module dependencies
- `bmc-research.mdc` — Research scripts, feature groups, LSTM sweep, analysis
- `market-state.mdc` — Regime detection, displacement, phase pipeline
- `krj-backtester.mdc` — Weekly pipeline, CSV contracts, droplet deployment
- `data-pipeline.mdc` — Polygon API, TAQ, VIX, rate limits, dataset builder

These are Cursor-only and do NOT need to be synced to `CLAUDE.md` (Claude Code reads `CLAUDE.md` which has equivalent content inline).

**Repo-root `AGENTS.md`** (both repos):
- Discovered by Codex and OpenClaw at repo root
- Contains repo overview, module map, constraints, key commands
- NOT synced between repos (each has repo-specific content)

**`.codex/config.toml`** (both repos):
- Codex project configuration (model, sandbox mode, doc fallback)

**`.claude/commands/*.md`** (both repos):
- Claude Code slash commands for common workflows
- py_proj: `init.md`, `research.md`, `bmc-dev.md`, `verify.md`
- ma-tracker-app: `init.md`, `verify.md`, `bmc-strategy.md`, and others

---

## 4. Non-Negotiable Rules

### Security & Privacy

1. **Never log, print, or commit secrets.** API keys, database credentials, auth tokens — not even prefixes. Use `***` to confirm a secret is set.
2. **Never commit real credentials** to source files, markdown, comments, or config templates. Use `<PLACEHOLDER>` or environment variables.
3. **Never use `allow_origins=["*"]`** in production CORS configuration.
4. **Validate all user input** at system boundaries. In `ma-tracker-app`, use `validate_ticker()` for ticker symbols.
5. **Do not expose internal paths, IPs, or infra details** in client-facing code or public documentation.
6. **Security headers** are enabled by default in `next.config.ts`. Only disable for debugging.

### Code Quality

1. **Read before writing.** Never propose changes to code you haven't read.
2. **Minimal diffs.** Only change what's needed. Don't add docstrings, comments, or refactoring beyond the task.
3. **No over-engineering.** Three similar lines > a premature abstraction.
4. **Preserve existing contracts.** Don't change function signatures, CLI usage, or output formats without explicit instruction.
5. **Test on the critical path.** If the change affects the weekly pipeline or production dashboard, verify it works before committing.

### Data Pipeline Integrity

1. **Never overwrite production KRJ data** during deploys. `~/apps/data/krj/` on the droplet is owned by the Saturday cron job. Deploying `ma-tracker-app` must NOT copy stale repo data over fresh pipeline output.
2. **Preserve CSV conventions.** Do not change filenames (`latest_*.csv`), column names, or the `data/krj/` directory structure without explicit instruction.
3. **Incremental updates only.** Data refresh scripts (e.g., `daily_loader.py --incremental`) should append new data, not re-download everything.

---

## 5. Release Notes Process (CRITICAL)

The DR3 Dashboard has a **continuous release notes system** that is mandatory for all user-visible changes.

### What Triggers a Release Note

- New features or UI changes visible to users
- Bug fixes that users would notice
- Data pipeline changes that affect what users see on the dashboard
- New columns, tabs, filters, or visualizations

### Process

1. **Create** `release-notes/YYYY-MM-DD.json` in `ma-tracker-app` (use the most recent Friday as the date, or the actual release date).
2. **Format** follows the schema documented in `ma-tracker-app/CLAUDE.md` under "Changelog & Release Notes System."
3. **Generate screenshots** using `python-service/tools/release_screenshots.py` when the feature has a visual component.
4. **Commit** the JSON file and any PNGs together.
5. **Deploy** — the changelog pages (`/changelog`) automatically pick up new entries.

### Why This Matters

- Users check `/changelog` to understand what changed each week
- The release notes drive user trust and engagement
- Skipping this step creates a silent deploy that frustrates users

---

## 6. Guidance Change Protocol

### Changing Shared Rules

When a rule should apply to both repos:

1. Edit `docs/agent/SHARED_BLOCK.md` in **one** repo.
2. Copy the file to the other repo (`cp` or manual paste — must be byte-identical).
3. Re-embed the shared block into all 4 instruction files (`.cursorrules` and `CLAUDE.md` in both repos).
4. Run `docs/agent/check_sync.sh` to verify all copies match.
5. Commit in both repos.

### Changing Repo-Specific Rules

When a rule applies to only one repo:

1. Edit only that repo's `.cursorrules` and/or `CLAUDE.md`.
2. Do NOT touch the shared block or the other repo.
3. If adding to `.cursorrules`, consider whether `CLAUDE.md` needs the same content (they should be redundant for that repo).

### Adding a New Agent Instruction File

1. Document the new file in this contract (Section 3).
2. If it's cross-repo, add to both repos.
3. If it's Cursor-specific (`.cursor/rules/*.mdc`), ensure equivalent guidance exists in `CLAUDE.md`.

---

## 7. Workflow Standards

### Commit & Deploy

- **ma-tracker-app:** Commit → push to `main` → auto-deploy to droplet (Docker rebuild). See `CLAUDE.md` for the exact deploy command.
- **py_proj:** Commit → push to `cursor-dev`. Deployment to droplet is manual (rsync or SSH).

### Multi-Device Sync

- Use `pushall` to sync both repos before switching machines.
- Always commit and push before ending a session.

### Coordination Between Agents

- Check `.claude-session` and recent git log for in-progress work before starting.
- If you see uncommitted changes from another agent, do not discard them.
- Major architectural changes should be discussed with the user first (use plan mode).

---

## 8. Repo-Specific Quick Reference

### ma-tracker-app

```bash
# Dev start/stop
./dev-start.sh / ./dev-stop.sh

# Frontend
npm run dev          # Dev server (port 3000)
npm run build        # Production build
npm run db:push      # Push Prisma schema
npm run db:studio    # Prisma Studio GUI

# Backend
cd python-service && source venv/bin/activate
python3 start_server.py  # FastAPI (port 8000)

# Deploy
ssh droplet 'cd ~/apps/ma-tracker-app && git pull origin main && cd ~/apps && docker compose build --no-cache web && docker compose up -d --force-recreate web'
```

### py_proj

```bash
# Activate venv
source .venv/bin/activate

# Weekly KRJ pipeline
python KRJ_backtester_updated.py

# Market state pipeline
python -m market_state.daily_loader --incremental
python -m market_state.phase1_foundation
python -m market_state.phase2_regime
python -m market_state.displacement --dashboard-export /path/to/output

# Research scripts
python research/NN_script_name.py
```

---

## 9. File Inventory

### Synced Files (must be identical across repos)

| File | Purpose |
|------|---------|
| `docs/agent/AGENTS.md` | This contract |
| `docs/agent/SHARED_BLOCK.md` | Shared block source |
| `docs/agent/check_sync.sh` | Sync verification script |
| `docs/agent/README.md` | Workflow documentation |

### Per-Repo Files

| File | Repo | Purpose |
|------|------|---------|
| `.cursorrules` | Both | Cursor instructions (shared block + repo-specific) |
| `CLAUDE.md` | Both | Claude Code instructions (shared block + repo-specific) |
| `AGENTS.md` (repo root) | Both | Codex/OpenClaw instruction file (repo-specific, NOT synced) |
| `.codex/config.toml` | Both | Codex project configuration |
| `.cursor/rules/*.mdc` | Both | Domain-specific Cursor rules (7 in ma-tracker-app, 5 in py_proj) |
| `.claude/commands/*.md` | Both | Claude Code slash commands for common workflows |

---

## 10. Onboarding a New Agent

If a new AI tool or agent is added to work on this codebase:

1. Create an instruction file in the format the tool expects.
2. Embed the shared block from `docs/agent/SHARED_BLOCK.md` using the standard markers.
3. Add repo-specific guidance below the shared block.
4. Update this contract (Section 3) to list the new file.
5. Update `check_sync.sh` if the file should be verified.
6. Commit in both repos.
