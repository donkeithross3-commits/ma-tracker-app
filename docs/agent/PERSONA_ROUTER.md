# Persona Router

Scalable context routing for agent personas across `ma-tracker-app` and `py_proj`.

## Goal

Keep persona memory files short and stable while loading deep expertise only when needed.

## Layered Context Model

1. `Memory files` (routing only): <=120 lines, no deep tutorials.
2. `Skills` (`docs/agent/skills/*`): domain workflows and guardrails.
3. `Skill references`: long checklists, edge-case notes, and links.
4. `MCP connectors`: live state (DB, logs, infra, market feeds) when available.

## Persona -> Skill Routing

| Persona | Primary tasks | Primary skills |
|---|---|---|
| `trading-engine` | Relay latency, execution loop behavior, throughput bottlenecks | `execution-latency`, `options-volatility-structuring` |
| `ml-research` | BMC model training/inference, registry contracts, feature integrity | `ml-modeling-inference` |
| `ops-deploy` | Secrets, auth, deploy safety, incident response | `security-ops-deploy` |
| `db-specialist` | Prisma/Neon schema and query integrity | `security-ops-deploy` (temporary), add dedicated DB skill next |

## Routing Procedure

1. Classify the request to one primary persona.
2. Load one primary skill first; load at most one secondary skill unless blocked.
3. Pull only the reference file sections relevant to the current task.
4. Add MCP context only when live state is required.
5. Return a handoff summary with files changed, validations run, and remaining risk.

## Memory Budget Policy

Memory files are indexes, not knowledge bases.

- `Mission + scope`: 5 lines max
- `Trigger phrases`: 12 lines max
- `Hard constraints`: 15 lines max
- `Startup checklist`: 10 lines max
- `Linked skills/docs`: 15 lines max
- `Output contract`: 8 lines max
- `Reserved`: 55 lines max

Use `docs/agent/MEMORY_FILE_TEMPLATE.md` for all new personas.

## Recommended MCP Priority

1. Read-only Neon/Postgres connector
2. Deploy/log observability connector (service logs + health)
3. GitHub/PR metadata connector
4. Optional broker/market-data connector with strict auth boundaries

## Anti-Patterns

- Putting full playbooks into memory files
- Loading more than two specialist skills for one task
- Copying duplicate guidance into both memory and skills
- Using stale static docs when live state is required
