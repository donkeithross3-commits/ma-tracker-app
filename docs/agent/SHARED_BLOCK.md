## Cross-Repo Agent Contract (Shared Block)

> **Canonical source:** `docs/agent/SHARED_BLOCK.md` in each repo.
> This block MUST appear identically in `.cursorrules` and `CLAUDE.md` in BOTH repos.
> Run `docs/agent/check_sync.sh` to verify sync. See `docs/agent/AGENTS.md` for full contract.

### Two-Repo System

This codebase is ONE HALF of a two-repo system. Both repos serve https://dr3-dashboard.com.

| Repo | Purpose | Branch | Language |
|------|---------|--------|----------|
| `ma-tracker-app` | Next.js dashboard, FastAPI backend, IB agent | `main` | TypeScript / Python |
| `py_proj` | KRJ backtester, market state pipelines, research | `cursor-dev` | Python |

**Shared infra:** Droplet `134.199.204.12` (SSH alias: `droplet`), Neon PostgreSQL, Docker.

### Multi-Device Sync

- Before ending a session, commit and push all changes.
- Use `pushall` to sync both repos before switching machines.
- Production domain: https://dr3-dashboard.com

### Security & Privacy

- **Never log, print, or commit secrets** (API keys, DB credentials, auth tokens). Use `***` to confirm a secret is set.
- **Never commit real API keys or passwords** to source files, markdown, or comments. Use `<PLACEHOLDER>` or env vars.
- **Never use `allow_origins=["*"]`** in production CORS config.
- **Validate all user input** at system boundaries (ticker symbols, query params, form data).
- **Do not expose internal paths, IPs, or infra details** in client-facing code or public docs.

### Release Notes (MANDATORY)

The dashboard has a continuous release notes system. Every user-visible change MUST be documented:

1. Create or update `release-notes/YYYY-MM-DD.json` in `ma-tracker-app` (see format in CLAUDE.md).
2. Generate screenshots with `python-service/tools/release_screenshots.py` when applicable.
3. Commit JSON + PNGs together. The changelog pages (`/changelog`) pick them up automatically.
4. **Never skip this step.** Users rely on the changelog to understand what changed.

### Agent Coordination

- **You are not the only agent working on this system.** Both Claude Code and Cursor work on these repos.
- Before making architectural changes, check for in-progress work in `.claude-session` or recent commits.
- Guidance changes that affect both repos must update BOTH copies of `SHARED_BLOCK.md` and re-embed.
- Repo-specific guidance stays in that repo's `.cursorrules` / `CLAUDE.md` only.
- Read `docs/agent/AGENTS.md` for the full contract including onboarding and change protocol.
