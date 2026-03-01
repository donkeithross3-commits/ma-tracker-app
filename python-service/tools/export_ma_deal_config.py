"""Export M&A deal configuration from Neon DB to deal_config.json.

Queries the latest sheet_rows + sheet_deal_details snapshot and outputs a JSON
config file compatible with download_ma_options.py.

Usage::

    cd ma-tracker-app/python-service
    source .venv/bin/activate
    python tools/export_ma_deal_config.py --output ../../py_proj/scripts/ma_options/deal_config.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import date
from pathlib import Path

logger = logging.getLogger(__name__)

QUERY = """
SELECT sr.ticker, sr.acquiror, sr.deal_price, sr.announced_date,
       sr.close_date, sr.category,
       sdd.expected_close_date, sdd.outside_date, sdd.cash_per_share
FROM sheet_rows sr
JOIN sheet_snapshots ss ON sr.snapshot_id = ss.id
LEFT JOIN sheet_deal_details sdd
    ON sdd.snapshot_id = ss.id AND sdd.ticker = sr.ticker
WHERE ss.id = (
    SELECT id FROM sheet_snapshots
    WHERE status = 'complete'
    ORDER BY snapshot_date DESC
    LIMIT 1
)
  AND sr.ticker IS NOT NULL
  AND sr.deal_price IS NOT NULL
ORDER BY sr.ticker
"""


def _serialise(val):
    """Convert DB values to JSON-safe types."""
    if val is None:
        return None
    if isinstance(val, date):
        return val.isoformat()
    if hasattr(val, "as_tuple"):  # Decimal
        return float(val)
    return val


async def export_config(output_path: Path) -> None:
    import asyncpg

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        # Try loading from .env in python-service/
        env_file = Path(__file__).resolve().parent.parent / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not db_url:
        logger.error("DATABASE_URL not set. Set it or create python-service/.env")
        sys.exit(1)

    conn = await asyncpg.connect(db_url)
    try:
        rows = await conn.fetch(QUERY)
    finally:
        await conn.close()

    if not rows:
        logger.error("No rows returned from sheet_rows. Is the DB populated?")
        sys.exit(1)

    deals = []
    for r in rows:
        deal = {
            "ticker": r["ticker"],
            "acquiror": r["acquiror"],
            "deal_price": _serialise(r["deal_price"]),
            "announced_date": _serialise(r["announced_date"]),
            "status": "completed" if r["close_date"] else "active",
            "category": r["category"],
        }
        if r["close_date"]:
            deal["close_date"] = _serialise(r["close_date"])
        if r["expected_close_date"]:
            deal["expected_close_date"] = _serialise(r["expected_close_date"])
        if r["outside_date"]:
            deal["outside_date"] = _serialise(r["outside_date"])
        if r["cash_per_share"]:
            deal["cash_per_share"] = _serialise(r["cash_per_share"])
        deals.append(deal)

    config = {
        "deals": deals,
        "defaults": {
            "strike_range_pct": [0.70, 1.10],
            "pre_announcement_days": 30,
            "post_close_days": 10,
            "half_spread_estimate": 0.03,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(config, f, indent=2)

    logger.info(
        "Exported %d deals (%d active, %d completed) to %s",
        len(deals),
        sum(1 for d in deals if d["status"] == "active"),
        sum(1 for d in deals if d["status"] == "completed"),
        output_path,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export M&A deal config from Neon DB",
    )
    parser.add_argument(
        "--output", "-o",
        default="../../py_proj/scripts/ma_options/deal_config.json",
        help="Output path for deal_config.json",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    asyncio.run(export_config(Path(args.output)))


if __name__ == "__main__":
    main()
