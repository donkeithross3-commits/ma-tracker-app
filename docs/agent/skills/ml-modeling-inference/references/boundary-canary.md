# Boundary Canary Checklist

Run this checklist when changing `py_proj/big_move_convexity/*` used by the runtime agent.

## Import Contract

1. `big_move_convexity.live.data_store.LiveDataStore`
2. `big_move_convexity.bars.bar_accumulator.BarAccumulator`
3. `big_move_convexity.ml.model_registry.ModelRegistry`
4. `big_move_convexity.live.daily_bootstrap.DailyBootstrap`
5. `big_move_convexity.dpal.polygon_ws.PolygonWebSocketProvider`
6. `big_move_convexity.dpal.polygon_ws_client.PolygonWSClient`
7. `big_move_convexity.features.feature_stack.assemble_feature_vector`
8. `big_move_convexity.ml.inference.predict_single`
9. `big_move_convexity.signal.signal_generator.Signal`, `SignalConfig`, `generate_signal`

## Verification

1. Imports resolve from `ma-tracker-app` strategy path with `BMC_PATH`.
2. Inference return payload fields consumed by strategy still exist.
3. Model registry production lookup still resolves expected model version.
4. Any intentional break has coordinated changes in both repos.
