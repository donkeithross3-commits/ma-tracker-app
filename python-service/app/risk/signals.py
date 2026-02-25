"""Signal computation helpers for three-signal triangulation.

Computes options-implied deal completion probability and builds
cross-signal comparison data for the morning risk assessment prompt.
"""


def compute_options_implied_probability(
    current_price: float | None,
    deal_price: float | None,
) -> float | None:
    """Compute a simple options-implied deal completion probability.

    Formula: 1 - (spread / deal_price)
    Where spread = deal_price - current_price.

    If the market prices the stock at $24 and the deal is at $25,
    the spread is $1/$25 = 4%, implying ~96% probability of completion.

    Returns None if inputs are missing or invalid.
    """
    if current_price is None or deal_price is None:
        return None
    try:
        current_price = float(current_price)
        deal_price = float(deal_price)
    except (ValueError, TypeError):
        return None
    if deal_price <= 0:
        return None
    spread = deal_price - current_price
    if spread < 0:
        # Trading above deal price — likely competing bid scenario
        return 1.0
    return round(1.0 - (spread / deal_price), 4)


def build_signal_comparison(
    options_implied: float | None,
    sheet_prob: float | None,
    ai_prev_prob: float | None,
) -> dict | None:
    """Build a three-signal comparison dict for prompt injection.

    All probabilities are on 0-1 scale.
    Returns None if fewer than 2 signals are available.

    Returns:
        {
            "signals": {"options": 0.96, "sheet": 0.85, "ai_previous": 0.92},
            "consensus": 0.91,
            "divergences": [
                {"higher": "options", "lower": "sheet", "gap_pp": 11.0}
            ]
        }
    """
    signals = {}
    if options_implied is not None:
        signals["options"] = float(options_implied)
    if sheet_prob is not None:
        signals["sheet"] = float(sheet_prob)
    if ai_prev_prob is not None:
        signals["ai_previous"] = float(ai_prev_prob)

    if len(signals) < 2:
        return None

    values = list(signals.values())
    mean = sum(values) / len(values)

    divergences = []
    signal_names = list(signals.keys())
    for i, name_a in enumerate(signal_names):
        for name_b in signal_names[i + 1:]:
            diff = abs(signals[name_a] - signals[name_b])
            if diff >= 0.05:  # 5pp threshold
                if signals[name_a] > signals[name_b]:
                    higher, lower = name_a, name_b
                else:
                    higher, lower = name_b, name_a
                divergences.append({
                    "higher": higher,
                    "lower": lower,
                    "gap_pp": round(diff * 100, 1),
                })

    return {
        "signals": signals,
        "consensus": round(mean, 4),
        "divergences": divergences,
    }
