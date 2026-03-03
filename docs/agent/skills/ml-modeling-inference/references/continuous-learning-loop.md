# Continuous Learning Loop

Use this loop to keep `bmc-quant` stateful without overloading persona memory files.

## Startup

```bash
cd ~/dev/py_proj
.venv/bin/python -m big_move_convexity.scripts.analysis.research_analysis wake
```

This gives one-screen context: model health, queue/fleet status, pending hypotheses, and next actions.

## Production Feedback Hygiene

1. Import closed positions (if available) into a structured ledger:
```bash
.venv/bin/python -m big_move_convexity.scripts.analysis.research_analysis feedback-import-positions --positions-file /path/to/position_store.json
```
2. Add manual/noisy incidents explicitly (rejects, restarts, manual exits):
```bash
.venv/bin/python -m big_move_convexity.scripts.analysis.research_analysis feedback-add --event-type reject_recovery --ticker QQQ --exclude-training --quality-flag reject_recovery
```
3. Check clean vs noisy sample balance:
```bash
.venv/bin/python -m big_move_convexity.scripts.analysis.research_analysis feedback-summary --lookback-hours 36
```

## Planning Rhythm

- Weekday: short targeted sweeps + production feedback cleaning.
- Weekend: long split GPU queues + broader coverage exploration.
- Use `research_analysis weekend-plan` for queue-oriented prioritization.
