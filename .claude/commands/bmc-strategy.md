Cross-repo BMC strategy development workflow.

The BigMoveConvexityStrategy in `python-service/standalone_agent/strategies/big_move_convexity.py`
bridges ma-tracker-app's IB execution engine with py_proj's ML pipeline.

## Architecture

```
ma-tracker-app IB Agent → ExecutionEngine (100ms eval loop)
  → BigMoveConvexityStrategy.evaluate()
    → [imports from py_proj via BMC_PATH]
      → assemble_feature_vector() → predict_single() → generate_signal()
        → OrderAction(BUY) → IB TWS
```

## Cross-Repo Imports (9 modules from py_proj)

```python
from big_move_convexity.live.data_store import LiveDataStore
from big_move_convexity.bars.bar_accumulator import BarAccumulator
from big_move_convexity.ml.model_registry import ModelRegistry
from big_move_convexity.live.daily_bootstrap import DailyBootstrap
from big_move_convexity.dpal.polygon_ws import PolygonWebSocketProvider
from big_move_convexity.dpal.polygon_ws_client import PolygonWSClient
from big_move_convexity.features.feature_stack import assemble_feature_vector
from big_move_convexity.ml.inference import predict_single
from big_move_convexity.signal.signal_generator import Signal, SignalConfig, generate_signal
```

## Development Workflow

1. Check py_proj is accessible: `ls $BMC_PATH/big_move_convexity/__init__.py`
   (Default: `../../py_proj` relative to standalone_agent/)

2. Read the strategy file:
   `python-service/standalone_agent/strategies/big_move_convexity.py`

3. Check the dashboard SignalsTab:
   `components/ma-options/SignalsTab.tsx`

4. Test strategy state telemetry:
   `GET /api/ma-options/bmc-signal`

5. If changing py_proj interfaces, update BOTH repos in the same session.

## Key Configuration

```python
_DEFAULTS = {
    "signal_threshold": 0.5,
    "decision_interval_seconds": 60,
    "scan_start": "13:30",
    "scan_end": "15:55",
    "auto_entry": False,  # paper trading safety
    "otm_target_pct": 0.20,  # 20bp OTM
}
```

## Testing

- Strategy E2E: `cd /path/to/py_proj && .venv/bin/pytest big_move_convexity/tests/test_bmc_strategy_e2e.py -v`
- Agent integration: requires IB TWS running locally
