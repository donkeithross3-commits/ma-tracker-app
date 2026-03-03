# Skill Migration Checklist

Move from memory-heavy personas to scalable routing + skill packs.

## Phase 1: Stabilize Baseline

1. Ensure `docs/agent/check_sync.sh` passes in both repos.
2. Freeze current persona memory files (no new deep content additions).
3. Tag repeated incident classes from recent sessions.

## Phase 2: Extract Deep Content

1. For each persona, list sections that are procedural or long-form.
2. Move those sections to `docs/agent/skills/<skill>/SKILL.md`.
3. Move detailed lists/checklists to `references/*.md` under the same skill.
4. Replace extracted memory content with links to the skill files.

## Phase 3: Enforce Memory Budgets

1. Rewrite each persona memory using `MEMORY_FILE_TEMPLATE.md`.
2. Keep each file under 120 lines.
3. Keep one persona = one role boundary.
4. Add a new persona only when ownership boundaries are clear.

## Phase 4: Add Dynamic Context (MCP)

1. Add read-only DB connector.
2. Add logs/metrics connector.
3. Add repo/PR metadata connector.
4. Add broker/market-data connector only with strict credential boundaries.

## Phase 5: Operationalize

1. Install Codex skills with `docs/agent/scripts/install_codex_skills.sh`.
2. Reference skills from Claude persona memory files.
3. Review skill docs monthly and after major incidents.
4. Keep skill docs versioned in both repos.

## Done Criteria

- Persona memory files are route maps, not deep docs.
- Specialist workflows live in skills/references.
- New team members can onboard by reading router + skill index.
- Agents can load deep context on demand without hitting memory limits.
