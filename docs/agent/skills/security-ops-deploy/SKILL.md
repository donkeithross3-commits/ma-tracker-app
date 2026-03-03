---
name: security-ops-deploy
description: Apply secure coding, operational safety, and deployment discipline in DR3 services. Use for auth boundaries, secret handling, CORS/input validation, incident mitigation, release-note gating, and production deployment path changes.
---

# Security Ops Deploy

## Quick Start

1. Identify blast radius first (auth, data exposure, deploy impact).
2. Confirm non-negotiables from the agent contract.
3. Keep diffs minimal and reversible.
4. Validate deploy path and post-deploy checks before closing task.

## DR3 Hot Paths

- `next.config.ts` security headers
- `python-service/app/main.py` CORS config
- `python-service/app/api/options_routes.py` input validation
- `python-service/app/api/ws_relay.py` user-isolation routing
- deploy workflows in `CLAUDE.md` and `docs/agent/AGENTS.md`

## Workflow

### 1) Threat/Boundary Review

- Identify whether change touches secrets, auth, or multi-tenant routing.
- Confirm account-sensitive routes cannot fall back to foreign providers.

### 2) Implementation

- Keep credentials in env vars only.
- Keep ticker/query input validation in place.
- Keep production CORS explicit, never wildcard.

### 3) Deploy Safety

- Use documented deploy path only.
- Include rollback notes for risky changes.
- Ensure release-notes requirement is satisfied for user-visible changes.

### 4) Validation

- Confirm no secrets are logged or committed.
- Confirm auth and routing behavior with representative requests.
- Confirm health checks after deployment.

## Guardrails

- No `allow_origins=["*"]` in production.
- No silent weakening of user isolation in relay routes.
- No secret exposure in logs, code, or docs.
- No raw ad-hoc deploy command drift from approved process.

## Output Contract

Return:

1. Security boundary touched
2. Operational/deploy path used
3. Validation evidence
4. Residual risk and rollback hint
