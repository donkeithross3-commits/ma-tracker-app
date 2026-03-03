---
name: ml-modeling-inference
description: Build, evaluate, and ship ML model and inference changes for DR3 BMC pipelines while preserving cross-repo contracts. Use for feature engineering, training, registry/version handling, inference behavior, and model integration between py_proj and ma-tracker-app.
---

# ML Modeling Inference

## Quick Start

1. Identify whether the change is training-only, inference-only, or both.
2. Confirm cross-repo contract impact before coding.
3. Keep interfaces stable unless explicitly approved.
4. Validate with targeted tests plus boundary checks.
5. Start from current lifecycle state:
   `cd ~/dev/py_proj && .venv/bin/python -m big_move_convexity.scripts.analysis.research_analysis wake`
6. For production feedback ingestion/cleaning workflow, use:
   `references/continuous-learning-loop.md`

## Critical Boundary

`ma-tracker-app` imports BMC modules from `py_proj` through `BMC_PATH`.

Do not break interfaces used by:

- `ModelRegistry` load and production lookup behavior
- `predict_single(...)` call shape and return schema
- `assemble_feature_vector(...)` return structure
- `generate_signal(...)` return structure

## Workflow

### 1) Contract Check

- Map touched code against cross-repo imports first.
- Document expected unchanged signatures before edits.

### 2) Training/Feature Work

- Keep dataset and feature assumptions explicit.
- Avoid silent schema drift in generated artifacts.

### 3) Inference Work

- Preserve stable return keys consumed by strategy code.
- Keep model loading safe across environments.

### 4) Validation

- Run focused tests for touched modules.
- Run boundary canary checks for cross-repo imports.
- Report compatibility assumptions explicitly.

## Guardrails

- No silent behavior changes in live signal direction logic.
- No hidden default changes that alter production strategy semantics.
- No breaking registry/index format changes without migration plan.

## Output Contract

Return:

1. Training/inference path touched
2. Contract compatibility statement
3. Tests run and gaps
4. Required coordinated deploy steps (if any)
