# Memory File Template

Use this template for Claude/Codex persona memory files.
Target length: 80-120 lines.

```markdown
# <persona-name>

## Mission (max 3 lines)
- <what this persona is responsible for>

## In Scope (max 8 lines)
- <task type 1>
- <task type 2>

## Out Of Scope (max 6 lines)
- <task type to hand off>

## Trigger Phrases (max 12 lines)
- "<phrase or intent>" -> <action>

## Startup Checklist (max 10 lines)
1. Read <primary docs>
2. Check <active session markers / git log>
3. Confirm <constraints>

## Hard Constraints (max 15 lines)
- <non-negotiable 1>
- <non-negotiable 2>

## Linked Skills (max 12 lines)
- [execution-latency](docs/agent/skills/execution-latency/SKILL.md)
- [ml-modeling-inference](docs/agent/skills/ml-modeling-inference/SKILL.md)
- [options-volatility-structuring](docs/agent/skills/options-volatility-structuring/SKILL.md)
- [security-ops-deploy](docs/agent/skills/security-ops-deploy/SKILL.md)

## Output Contract (max 8 lines)
- Always return:
  - changed files
  - validations run
  - open risks and next actions
```

## Usage Notes

- Do not copy long procedural content into memory files.
- Put deep workflows in skills and references.
- Keep only routing and guardrails in memory.
