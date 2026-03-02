"""
Trade History Database
=====================
Async PostgreSQL persistence for algo trade P&L history.

Singleton via module-level `_instance` + `get_trade_db()`.
Agent's position_store.json is the source of truth; this DB is the historical archive.
All writes are idempotent upserts (ON CONFLICT ... DO UPDATE).
"""

import asyncpg
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Module-level singleton
_instance: Optional["TradeDatabase"] = None


def get_trade_db() -> Optional["TradeDatabase"]:
    """Return the global TradeDatabase instance, or None if not initialized."""
    return _instance


class TradeDatabase:
    """Async PostgreSQL trade history store with connection pooling."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or self._load_database_url()
        self.pool: Optional[asyncpg.Pool] = None

    @staticmethod
    def _load_database_url() -> str:
        url = os.getenv("DATABASE_URL", "")
        if not url:
            raise ValueError("DATABASE_URL not set")
        # Fix Prisma-style sslmode param for asyncpg
        if "?sslmode=" in url:
            url = url.replace("?sslmode=require", "?ssl=require")
        return url

    async def connect(self):
        """Create the connection pool."""
        if not self.pool:
            self.pool = await asyncpg.create_pool(
                self.database_url, min_size=2, max_size=10
            )
            logger.info("TradeDatabase pool created (min=2, max=10)")

    async def disconnect(self):
        """Close the connection pool."""
        if self.pool:
            try:
                await self.pool.close()
                self.pool = None
                logger.info("TradeDatabase pool closed")
            except Exception as e:
                logger.error("Error closing TradeDatabase pool: %s", e)
                self.pool = None

    # ── Upsert (called from ws_relay on position_sync) ──

    async def upsert_positions(self, user_id: str, positions: List[dict]) -> int:
        """Upsert a batch of positions + their fills. Returns count upserted.

        Each position is wrapped in a savepoint so one failure doesn't abort the batch.
        """
        if not self.pool or not positions:
            return 0

        count = 0
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                for pos in positions:
                    try:
                        # Savepoint per position: if this one fails, only the
                        # savepoint rolls back — the outer transaction stays valid.
                        async with conn.transaction():
                            await self._upsert_one_position(conn, user_id, pos)
                            count += 1
                    except Exception as e:
                        logger.error(
                            "Failed to upsert position %s: %s",
                            pos.get("id", "?"), e,
                        )
        if count:
            logger.info("TradeDatabase: upserted %d/%d positions for user %s",
                        count, len(positions), user_id)
        return count

    async def _upsert_one_position(
        self, conn: asyncpg.Connection, user_id: str, pos: dict
    ):
        """Upsert a single position and its fills."""
        position_id = pos.get("id", "")
        entry = pos.get("entry", {})
        instrument = pos.get("instrument", {})
        fill_log = pos.get("fill_log", [])
        lineage = pos.get("lineage", {})
        risk_config = pos.get("risk_config", {})
        runtime_state = pos.get("runtime_state", {})

        # Extract top-level fields from nested data
        symbol = instrument.get("symbol", "")
        sec_type = instrument.get("secType", "OPT")
        strike = instrument.get("strike")
        expiry = instrument.get("expiry", "")
        right_type = instrument.get("right", "")
        multiplier = instrument.get("multiplier", 100)
        if isinstance(multiplier, str):
            try:
                multiplier = int(multiplier)
            except (ValueError, TypeError):
                multiplier = 100

        entry_price = entry.get("avg_price") or entry.get("entry_price")
        entry_quantity = entry.get("quantity") or entry.get("qty")
        entry_time_raw = entry.get("fill_time") or entry.get("time")

        # Parse entry_time
        entry_time = None
        if entry_time_raw:
            entry_time = self._parse_timestamp(entry_time_raw)

        # Model version from lineage
        model_version = lineage.get("model_version", "") if lineage else ""

        # Parse agent-side created_at for the DB created_at column (used in queries)
        agent_created_at_raw = pos.get("created_at")
        created_at_dt = self._parse_timestamp(agent_created_at_raw)

        # Compute P&L from fill_log
        total_gross_pnl, total_commission, total_net_pnl = self._compute_pnl(
            entry_price, entry_quantity, multiplier, fill_log
        )

        # Closed-at timestamp
        closed_at = None
        closed_at_raw = pos.get("closed_at")
        if closed_at_raw:
            closed_at = self._parse_timestamp(closed_at_raw)

        await conn.execute(
            """
            INSERT INTO algo_positions (
                position_id, user_id, status, strategy_type, parent_strategy,
                symbol, sec_type, strike, expiry, right_type,
                entry_price, entry_quantity, entry_time,
                exit_reason, closed_at,
                total_gross_pnl, total_commission, total_net_pnl, multiplier,
                model_version, lineage, risk_config, runtime_state,
                agent_created_at, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10,
                $11, $12, $13,
                $14, $15,
                $16, $17, $18, $19,
                $20, $21, $22, $23,
                $24, COALESCE($25, NOW()), NOW()
            )
            ON CONFLICT (user_id, position_id) DO UPDATE SET
                status = EXCLUDED.status,
                entry_price = EXCLUDED.entry_price,
                entry_quantity = EXCLUDED.entry_quantity,
                entry_time = EXCLUDED.entry_time,
                exit_reason = EXCLUDED.exit_reason,
                closed_at = EXCLUDED.closed_at,
                total_gross_pnl = EXCLUDED.total_gross_pnl,
                total_commission = EXCLUDED.total_commission,
                total_net_pnl = EXCLUDED.total_net_pnl,
                model_version = EXCLUDED.model_version,
                lineage = EXCLUDED.lineage,
                risk_config = EXCLUDED.risk_config,
                runtime_state = EXCLUDED.runtime_state,
                updated_at = NOW()
            """,
            position_id,
            user_id,
            pos.get("status", "active"),
            pos.get("strategy_type", "risk_manager"),
            pos.get("parent_strategy", ""),
            symbol,
            sec_type,
            strike,
            expiry,
            right_type,
            entry_price,
            entry_quantity,
            entry_time,
            pos.get("exit_reason", ""),
            closed_at,
            total_gross_pnl,
            total_commission,
            total_net_pnl,
            multiplier,
            model_version,
            json.dumps(lineage) if lineage else "{}",
            json.dumps(risk_config) if risk_config else "{}",
            json.dumps(runtime_state) if runtime_state else "{}",
            agent_created_at_raw,
            created_at_dt,
        )

        # Apply annotation hint from reconciliation (only if no human note exists)
        annotation_hint = pos.get("annotation_hint")
        if annotation_hint and isinstance(annotation_hint, dict):
            await conn.execute(
                """
                UPDATE algo_positions
                SET manual_intervention = $3,
                    intervention_type = $4,
                    annotation = COALESCE(annotation, $5)
                WHERE user_id = $1 AND position_id = $2
                  AND annotation IS NULL
                """,
                user_id,
                position_id,
                annotation_hint.get("manual_intervention", False),
                annotation_hint.get("intervention_type", ""),
                annotation_hint.get("auto_note", ""),
            )

        # Upsert fills
        for idx, fill in enumerate(fill_log):
            await self._upsert_one_fill(conn, user_id, position_id, idx, fill)

        # Delete any fill rows with index >= current fill_log length.
        # This handles the case where fills were removed from the agent's
        # fill_log (e.g. phantom entry fills purged by purge_phantom_entry_fills).
        # Without this, orphaned rows at old indices linger in the DB forever
        # because INSERT ON CONFLICT never removes rows.
        await conn.execute(
            "DELETE FROM algo_fills WHERE user_id = $1 AND position_id = $2 AND fill_index >= $3",
            user_id,
            position_id,
            len(fill_log),
        )

    async def _upsert_one_fill(
        self,
        conn: asyncpg.Connection,
        user_id: str,
        position_id: str,
        fill_index: int,
        fill: dict,
    ):
        """Upsert a single fill entry."""
        analytics = fill.get("execution_analytics", {})
        fill_time = self._parse_timestamp(fill.get("fill_time"))

        await conn.execute(
            """
            INSERT INTO algo_fills (
                position_id, user_id, fill_index,
                fill_time, order_id, exec_id, level,
                qty_filled, avg_price, remaining_qty, pnl_pct,
                commission, realized_pnl_ib, fill_exchange, slippage, last_liquidity
            ) VALUES (
                $1, $2, $3,
                $4, $5, $6, $7,
                $8, $9, $10, $11,
                $12, $13, $14, $15, $16
            )
            ON CONFLICT (user_id, position_id, fill_index) DO UPDATE SET
                fill_time = EXCLUDED.fill_time,
                order_id = EXCLUDED.order_id,
                exec_id = EXCLUDED.exec_id,
                level = EXCLUDED.level,
                qty_filled = EXCLUDED.qty_filled,
                avg_price = EXCLUDED.avg_price,
                remaining_qty = EXCLUDED.remaining_qty,
                pnl_pct = EXCLUDED.pnl_pct,
                commission = EXCLUDED.commission,
                realized_pnl_ib = EXCLUDED.realized_pnl_ib,
                fill_exchange = EXCLUDED.fill_exchange,
                slippage = EXCLUDED.slippage,
                last_liquidity = EXCLUDED.last_liquidity
            """,
            position_id,
            user_id,
            fill_index,
            fill_time,
            fill.get("order_id"),
            fill.get("exec_id", ""),
            fill.get("level", "unknown"),
            fill.get("qty_filled"),
            fill.get("avg_price"),
            fill.get("remaining_qty"),
            fill.get("pnl_pct"),
            analytics.get("commission"),
            analytics.get("realized_pnl_ib"),
            analytics.get("fill_exchange", ""),
            analytics.get("slippage"),
            analytics.get("last_liquidity"),
        )

    # ── Query Methods ──

    async def query_positions(
        self,
        user_id: str,
        status: Optional[str] = None,
        symbol: Optional[str] = None,
        model_version: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Tuple[List[dict], int]:
        """Query positions with filters. Returns (rows, total_count)."""
        if not self.pool:
            return [], 0

        conditions = ["user_id = $1"]
        params: list = [user_id]
        idx = 2

        if status:
            conditions.append(f"status = ${idx}")
            params.append(status)
            idx += 1
        if symbol:
            conditions.append(f"symbol = ${idx}")
            params.append(symbol.upper())
            idx += 1
        if model_version:
            conditions.append(f"model_version = ${idx}")
            params.append(model_version)
            idx += 1
        if date_from:
            conditions.append(f"created_at >= ${idx}")
            params.append(datetime.fromisoformat(date_from + "T00:00:00+00:00" if "T" not in date_from else date_from))
            idx += 1
        if date_to:
            conditions.append(f"created_at <= ${idx}")
            dt_str = date_to + "T23:59:59+00:00" if "T" not in date_to else date_to
            params.append(datetime.fromisoformat(dt_str))
            idx += 1

        where = " AND ".join(conditions)

        async with self.pool.acquire() as conn:
            # Total count
            total = await conn.fetchval(
                f"SELECT COUNT(*) FROM algo_positions WHERE {where}", *params
            )

            # Paginated rows
            params_with_pagination = params + [limit, offset]
            rows = await conn.fetch(
                f"""
                SELECT * FROM algo_positions
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params_with_pagination,
            )

        return [self._row_to_dict(r) for r in rows], total

    async def query_fills(self, user_id: str, position_id: str) -> List[dict]:
        """Return all fills for a position."""
        if not self.pool:
            return []

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM algo_fills
                WHERE user_id = $1 AND position_id = $2
                ORDER BY fill_index
                """,
                user_id,
                position_id,
            )
        return [self._row_to_dict(r) for r in rows]

    async def query_summary(
        self,
        user_id: str,
        group_by: str = "date",
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        exclude_flagged: bool = False,
    ) -> dict:
        """Aggregate P&L summary grouped by date, symbol, or model_version."""
        if not self.pool:
            return {"summary": [], "totals": {}}

        # Determine GROUP BY expression
        group_col_map = {
            "date": "DATE(created_at)",
            "symbol": "symbol",
            "model_version": "COALESCE(model_version, 'unknown')",
        }
        group_expr = group_col_map.get(group_by, "DATE(created_at)")

        conditions = ["user_id = $1", "status = 'closed'"]
        params: list = [user_id]
        idx = 2

        if exclude_flagged:
            conditions.append("manual_intervention = FALSE")

        if date_from:
            conditions.append(f"created_at >= ${idx}")
            params.append(datetime.fromisoformat(date_from + "T00:00:00+00:00" if "T" not in date_from else date_from))
            idx += 1
        if date_to:
            conditions.append(f"created_at <= ${idx}")
            dt_str = date_to + "T23:59:59+00:00" if "T" not in date_to else date_to
            params.append(datetime.fromisoformat(dt_str))
            idx += 1

        where = " AND ".join(conditions)

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT
                    {group_expr} AS group_key,
                    COUNT(*) AS trades,
                    SUM(CASE WHEN total_net_pnl > 0 THEN 1 ELSE 0 END) AS wins,
                    ROUND(
                        SUM(CASE WHEN total_net_pnl > 0 THEN 1 ELSE 0 END)::numeric
                        / NULLIF(COUNT(*), 0) * 100, 1
                    ) AS win_rate,
                    COALESCE(SUM(total_gross_pnl), 0) AS total_gross_pnl,
                    COALESCE(SUM(total_commission), 0) AS total_commission,
                    COALESCE(SUM(total_net_pnl), 0) AS total_net_pnl
                FROM algo_positions
                WHERE {where}
                GROUP BY {group_expr}
                ORDER BY {group_expr} DESC
                """,
                *params,
            )

            # Totals
            totals_row = await conn.fetchrow(
                f"""
                SELECT
                    COUNT(*) AS trades,
                    SUM(CASE WHEN total_net_pnl > 0 THEN 1 ELSE 0 END) AS wins,
                    ROUND(
                        SUM(CASE WHEN total_net_pnl > 0 THEN 1 ELSE 0 END)::numeric
                        / NULLIF(COUNT(*), 0) * 100, 1
                    ) AS win_rate,
                    COALESCE(SUM(total_gross_pnl), 0) AS total_gross_pnl,
                    COALESCE(SUM(total_commission), 0) AS total_commission,
                    COALESCE(SUM(total_net_pnl), 0) AS total_net_pnl
                FROM algo_positions
                WHERE {where}
                """,
                *params,
            )

        summary = []
        for r in rows:
            item = dict(r)
            # Convert date objects to strings
            gk = item.get("group_key")
            if hasattr(gk, "isoformat"):
                item["group_key"] = gk.isoformat()
            # Convert Decimal to float (None-safe)
            for k in ("total_gross_pnl", "total_commission", "total_net_pnl", "win_rate"):
                v = item.get(k)
                item[k] = float(v) if v is not None else 0.0
            item["trades"] = int(item.get("trades") or 0)
            item["wins"] = int(item.get("wins") or 0)
            summary.append(item)

        totals = {}
        if totals_row:
            totals = dict(totals_row)
            for k in ("total_gross_pnl", "total_commission", "total_net_pnl", "win_rate"):
                v = totals.get(k)
                totals[k] = float(v) if v is not None else 0.0
            totals["trades"] = int(totals.get("trades") or 0)
            totals["wins"] = int(totals.get("wins") or 0)

        return {"summary": summary, "totals": totals}

    # ── Annotation ──

    ALLOWED_INTERVENTION_TYPES = frozenset({
        "manual_tws_exit", "partial_fill_abort", "reject_recovery", "other",
    })

    async def annotate_position(
        self,
        user_id: str,
        position_id: str,
        annotation: Optional[str] = None,
        manual_intervention: Optional[bool] = None,
        intervention_type: Optional[str] = None,
    ) -> bool:
        """Update annotation fields on a position.  Only provided fields are updated.

        Returns True if a row was affected.
        """
        if not self.pool:
            return False

        # Validate intervention_type
        if intervention_type and intervention_type not in self.ALLOWED_INTERVENTION_TYPES:
            raise ValueError(
                f"Invalid intervention_type '{intervention_type}'. "
                f"Allowed: {', '.join(sorted(self.ALLOWED_INTERVENTION_TYPES))}"
            )

        set_clauses = []
        params: list = []
        idx = 1

        if annotation is not None:
            set_clauses.append(f"annotation = ${idx}")
            params.append(annotation)
            idx += 1
        if manual_intervention is not None:
            set_clauses.append(f"manual_intervention = ${idx}")
            params.append(manual_intervention)
            idx += 1
        if intervention_type is not None:
            set_clauses.append(f"intervention_type = ${idx}")
            params.append(intervention_type)
            idx += 1

        if not set_clauses:
            return False

        set_clauses.append("updated_at = NOW()")
        set_sql = ", ".join(set_clauses)

        params.append(user_id)
        params.append(position_id)

        async with self.pool.acquire() as conn:
            result = await conn.execute(
                f"""
                UPDATE algo_positions
                SET {set_sql}
                WHERE user_id = ${idx} AND position_id = ${idx + 1}
                """,
                *params,
            )
        return result != "UPDATE 0"

    # ── Helpers ──

    @staticmethod
    def _compute_pnl(
        entry_price: Optional[float],
        entry_qty: Optional[int],
        multiplier: int,
        fill_log: List[dict],
    ) -> Tuple[Optional[float], float, Optional[float]]:
        """Compute gross P&L, total commission, and net P&L from fills.

        Returns (gross_pnl, commission, net_pnl). Any may be None if data insufficient.
        """
        if not fill_log or not entry_price or not entry_qty:
            return None, 0.0, None

        total_commission = 0.0
        exit_proceeds = 0.0
        has_exit = False

        for fill in fill_log:
            analytics = fill.get("execution_analytics", {})
            comm = analytics.get("commission")
            if comm is not None:
                total_commission += float(comm)

            level = fill.get("level", "")
            if level != "entry":
                # This is an exit fill
                avg_px = fill.get("avg_price")
                qty = fill.get("qty_filled")
                if avg_px is not None and qty is not None:
                    exit_proceeds += float(avg_px) * int(qty) * multiplier
                    has_exit = True

        if not has_exit:
            return None, total_commission, None

        entry_cost = float(entry_price) * int(entry_qty) * multiplier
        gross_pnl = round(exit_proceeds - entry_cost, 4)
        net_pnl = round(gross_pnl - total_commission, 4)
        return gross_pnl, round(total_commission, 4), net_pnl

    @staticmethod
    def _parse_timestamp(value) -> Optional[datetime]:
        """Parse a timestamp from epoch float or ISO string."""
        if value is None:
            return None
        if isinstance(value, (int, float)):
            try:
                return datetime.fromtimestamp(value, tz=timezone.utc)
            except (OSError, ValueError):
                return None
        if isinstance(value, str):
            for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(value, fmt)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    return dt
                except ValueError:
                    continue
            # Try epoch as string
            try:
                return datetime.fromtimestamp(float(value), tz=timezone.utc)
            except (ValueError, OSError):
                pass
        return None

    @staticmethod
    def _row_to_dict(row: asyncpg.Record) -> dict:
        """Convert an asyncpg Record to a JSON-serializable dict."""
        d = dict(row)
        for k, v in d.items():
            if isinstance(v, datetime):
                d[k] = v.isoformat()
            elif hasattr(v, "__float__"):  # Decimal
                d[k] = float(v)
            elif isinstance(v, str) and k in ("lineage", "risk_config", "runtime_state"):
                try:
                    d[k] = json.loads(v)
                except (json.JSONDecodeError, TypeError):
                    pass
        # UUID -> str
        if "id" in d and hasattr(d["id"], "hex"):
            d["id"] = str(d["id"])
        return d


async def init_trade_db() -> TradeDatabase:
    """Initialize the global TradeDatabase singleton."""
    global _instance
    if _instance is None:
        _instance = TradeDatabase()
        await _instance.connect()
    return _instance


async def shutdown_trade_db():
    """Shutdown the global TradeDatabase singleton."""
    global _instance
    if _instance:
        await _instance.disconnect()
        _instance = None
