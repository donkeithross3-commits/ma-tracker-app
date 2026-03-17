"""
Black-Scholes implied volatility computation.

Polygon does NOT store historical greeks or IV. We must self-compute from:
  - Option OHLCV close price
  - Underlying close price
  - Strike price
  - Time to expiry
  - Risk-free rate (Treasury yield proxy)

Uses Newton-Raphson iteration for IV inversion.
"""

import math
from typing import Optional


def _norm_cdf(x: float) -> float:
    """Standard normal CDF approximation (Abramowitz & Stegun)."""
    if x < -10:
        return 0.0
    if x > 10:
        return 1.0
    # Constants
    a1 = 0.254829592
    a2 = -0.284496736
    a3 = 1.421413741
    a4 = -1.453152027
    a5 = 1.061405429
    p = 0.3275911

    sign = 1.0 if x >= 0 else -1.0
    x_abs = abs(x)
    t = 1.0 / (1.0 + p * x_abs)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x_abs * x_abs / 2.0)
    return 0.5 * (1.0 + sign * y)


def _norm_pdf(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-x * x / 2.0) / math.sqrt(2.0 * math.pi)


def bs_price(
    S: float,       # Underlying price
    K: float,       # Strike
    T: float,       # Time to expiry in years
    r: float,       # Risk-free rate (annual)
    sigma: float,   # Volatility (annual)
    option_type: str = "C",  # "C" or "P"
) -> float:
    """Black-Scholes option price."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0

    d1 = (math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    if option_type == "C":
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def bs_vega(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
) -> float:
    """Black-Scholes vega (sensitivity of price to volatility)."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0

    d1 = (math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * math.sqrt(T))
    return S * _norm_pdf(d1) * math.sqrt(T)


def implied_volatility(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float = 0.05,
    option_type: str = "C",
    max_iterations: int = 50,
    tolerance: float = 1e-6,
) -> Optional[float]:
    """
    Compute implied volatility using Newton-Raphson method.

    Args:
        market_price: Observed option price (typically mid or close)
        S: Underlying price
        K: Strike price
        T: Time to expiry in years (trading days / 252 or calendar days / 365)
        r: Risk-free rate (annualized)
        option_type: "C" for call, "P" for put
        max_iterations: Max Newton-Raphson iterations
        tolerance: Convergence threshold

    Returns:
        Implied volatility (annualized) or None if computation fails
    """
    if market_price <= 0 or S <= 0 or K <= 0 or T <= 0:
        return None

    # Check for intrinsic value floor
    if option_type == "C":
        intrinsic = max(0, S - K * math.exp(-r * T))
    else:
        intrinsic = max(0, K * math.exp(-r * T) - S)

    if market_price < intrinsic * 0.99:
        return None  # Price below intrinsic — bad data

    # Initial guess using Brenner-Subrahmanyam approximation
    sigma = math.sqrt(2.0 * math.pi / T) * market_price / S
    sigma = max(0.01, min(sigma, 5.0))  # Clamp to reasonable range

    for _ in range(max_iterations):
        price = bs_price(S, K, T, r, sigma, option_type)
        vega = bs_vega(S, K, T, r, sigma)

        if vega < 1e-12:
            # Vega too small — deep ITM/OTM, can't converge
            return None

        diff = price - market_price
        if abs(diff) < tolerance:
            return sigma

        sigma -= diff / vega
        sigma = max(0.001, min(sigma, 10.0))  # Keep in bounds

    # Didn't converge — return best estimate if close enough
    if abs(bs_price(S, K, T, r, sigma, option_type) - market_price) < market_price * 0.05:
        return sigma

    return None


def bs_delta(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str = "C",
) -> Optional[float]:
    """Compute Black-Scholes delta."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return None

    d1 = (math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * math.sqrt(T))

    if option_type == "C":
        return _norm_cdf(d1)
    else:
        return _norm_cdf(d1) - 1.0


def bs_gamma(S: float, K: float, T: float, r: float, sigma: float) -> Optional[float]:
    """Compute Black-Scholes gamma."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return None

    d1 = (math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * math.sqrt(T))
    return _norm_pdf(d1) / (S * sigma * math.sqrt(T))


def bs_theta(
    S: float, K: float, T: float, r: float, sigma: float, option_type: str = "C"
) -> Optional[float]:
    """Compute Black-Scholes theta (per day, negative = decay)."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return None

    d1 = (math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)

    common = -S * _norm_pdf(d1) * sigma / (2 * math.sqrt(T))

    if option_type == "C":
        theta = common - r * K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        theta = common + r * K * math.exp(-r * T) * _norm_cdf(-d2)

    return theta / 365.0  # Per calendar day
