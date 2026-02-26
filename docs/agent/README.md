# Agent Contract System

How AI coding agents (Claude Code, Cursor, etc.) are configured across the DR3 Dashboard two-repo system.

---

## Overview

The DR3 Dashboard spans two repos (`ma-tracker-app` and `py_proj`). Both repos need shared rules (security, workflow, coordination) plus repo-specific guidance. The agent contract system keeps these rules in sync using a single-source-of-truth pattern:

1. Shared rules live in `SHARED_BLOCK.md`.
2. That block is embedded (copy-pasted) into each repo's `.cursorrules` and `CLAUDE.md` between marker comments.
3. A sync check script verifies nothing has drifted.

---

## File Map

| File | Purpose | Synced across repos? |
|------|---------|---------------------|
| `docs/agent/AGENTS.md` | Full agent contract -- rules, architecture, protocols | Yes (identical) |
| `docs/agent/SHARED_BLOCK.md` | Canonical source for the shared block embedded in instruction files | Yes (identical) |
| `docs/agent/check_sync.sh` | Script to verify all files are in sync | Yes (identical) |
| `docs/agent/README.md` | This file -- workflow documentation | Yes (identical) |
| `.cursorrules` | Cursor IDE instructions (shared block + repo-specific) | No (per-repo) |
| `CLAUDE.md` | Claude Code instructions (shared block + repo-specific) | No (per-repo) |

---

## Updating Shared Rules

When a rule should apply to **both** repos:

1. **Edit** `docs/agent/SHARED_BLOCK.md` in one repo.
2. **Copy** the file to the other repo so both are byte-identical:
   ```bash
   cp /path/to/repo-a/docs/agent/SHARED_BLOCK.md /path/to/repo-b/docs/agent/SHARED_BLOCK.md
   ```
3. **Re-embed** the shared block into all 4 instruction files. In each file, replace everything between the markers:
   ```
   <!-- BEGIN SHARED BLOCK — DO NOT EDIT — source: docs/agent/SHARED_BLOCK.md -->
   ...paste SHARED_BLOCK.md contents here...
   <!-- END SHARED BLOCK -->
   ```
   Files to update:
   - `ma-tracker-app/.cursorrules`
   - `ma-tracker-app/CLAUDE.md`
   - `py_proj/.cursorrules`
   - `py_proj/CLAUDE.md`
4. **Verify** with the sync check:
   ```bash
   docs/agent/check_sync.sh
   ```
5. **Commit** in both repos.

---

## Updating Repo-Specific Rules

When a rule applies to **only one** repo:

1. Edit that repo's `.cursorrules` and/or `CLAUDE.md`.
2. Only change content **outside** the shared block markers.
3. Do not touch the other repo or `SHARED_BLOCK.md`.
4. If adding to `.cursorrules`, consider whether `CLAUDE.md` needs the same content (they should be consistent for that repo).

---

## Onboarding a New Agent

**OpenClaw/ClawdBot:** Use the copy-paste prompt in `docs/agent/OPENCLAW_ONBOARDING_PROMPT.md` so ClawdBot receives the shared block and full contract. You can copy that file to py_proj for parity.

If another new AI tool is introduced:

1. Create an instruction file in the format the new tool expects.
2. Embed the shared block from `docs/agent/SHARED_BLOCK.md` using the standard markers:
   ```
   <!-- BEGIN SHARED BLOCK — DO NOT EDIT — source: docs/agent/SHARED_BLOCK.md -->
   ...
   <!-- END SHARED BLOCK -->
   ```
3. Add repo-specific guidance below the shared block.
4. Update `docs/agent/AGENTS.md` Section 3 to document the new file.
5. Update `check_sync.sh` if the new file should be verified.
6. Commit in both repos.

---

## Running the Sync Check

From either repo root:

```bash
docs/agent/check_sync.sh
```

The script auto-detects which repo it is in and finds the sibling repo at `../<sibling-name>`. To specify the sibling path manually:

```bash
docs/agent/check_sync.sh /path/to/other/repo
```

**Output:** Pass/fail for each checked file. Exit code 0 = all in sync, 1 = drift detected.

### What gets checked

- `SHARED_BLOCK.md` identical across repos
- `AGENTS.md` identical across repos
- `README.md` identical across repos
- `check_sync.sh` identical across repos
- Shared block in each `.cursorrules` and `CLAUDE.md` matches the canonical `SHARED_BLOCK.md`

---

## Troubleshooting

**"Drift detected" on SHARED_BLOCK.md or AGENTS.md:**
Someone edited the file in only one repo. Copy the correct version to the other repo and commit both.

**"Shared block has drifted from canonical":**
The shared block inside `.cursorrules` or `CLAUDE.md` no longer matches `SHARED_BLOCK.md`. Re-embed following the "Updating Shared Rules" steps above.

**"Shared block markers not found":**
The BEGIN/END marker comments were removed or corrupted in an instruction file. Re-add them around the shared block content.

**"File not found" errors:**
A required file is missing. Create it (copy from the other repo for synced files) or check if it was accidentally deleted.

**Sibling repo not found:**
The script expects repos to be siblings (e.g., `~/dev/ma-tracker-app` and `~/dev/py_proj`). Pass the path explicitly if your layout differs:
```bash
docs/agent/check_sync.sh /custom/path/to/sibling-repo
```
