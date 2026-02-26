"""Export baseline model results as browsable HTML files.

Usage:
    python tools/export_baseline_html.py [run_id] [output_dir]

Generates one HTML file per ticker×model result, plus index.html and flagged.html.
Optionally reads /tmp/portfolio_tickers.json for "Owned" column.

This is a thin CLI wrapper around app.risk.baseline_report.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

import asyncpg

from app.risk.baseline_report import (
    generate_flagged_html,
    generate_index_html,
    get_portfolio_tickers_from_sheet,
    # Individual-page helpers (still needed for per-ticker file export)
    model_short,
    grade_class,
    inv_class,
    build_grade_card,
    build_section,
    build_list_section,
    build_supplemental,
    extract_grade,
    HTML_TEMPLATE,
    INDEX_TEMPLATE,
)


async def main():
    run_id = sys.argv[1] if len(sys.argv) > 1 else None
    output_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/baseline-review")

    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"], min_size=1, max_size=3)

    # Get latest run if not specified
    async with pool.acquire() as conn:
        if not run_id:
            row = await conn.fetchrow(
                "SELECT id FROM baseline_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1"
            )
            if not row:
                print("No completed baseline runs found")
                return
            run_id = str(row["id"])

        # Fetch all results
        import uuid
        results = await conn.fetch(
            """SELECT ticker, model, is_presented, response,
                      input_tokens, output_tokens, cost_usd, latency_ms,
                      probability_of_success, investable_assessment, reasoning_depth,
                      grade_vote, grade_financing, grade_legal, grade_regulatory, grade_mac
               FROM baseline_model_results
               WHERE run_id = $1
               ORDER BY ticker, model""",
            uuid.UUID(run_id),
        )

    if not results:
        print(f"No results for run {run_id}")
        await pool.close()
        return

    # Load portfolio tickers — prefer JSON file for CLI, fall back to DB
    portfolio_tickers = set()
    portfolio_file = Path("/tmp/portfolio_tickers.json")
    if portfolio_file.exists():
        portfolio_data = json.loads(portfolio_file.read_text())
        portfolio_tickers = set(portfolio_data.get("tickers", []))
        print(f"Loaded {len(portfolio_tickers)} portfolio tickers from {portfolio_file}")
    else:
        portfolio_tickers = await get_portfolio_tickers_from_sheet(pool)
        if portfolio_tickers:
            print(f"Loaded {len(portfolio_tickers)} portfolio tickers from DB")
        else:
            print(f"No portfolio file at {portfolio_file} — Owned column will be empty")

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Exporting {len(results)} results to {output_dir}")

    # Build file list for prev/next navigation
    files = []
    for r in results:
        ms = model_short(r["model"])
        slug = ms.lower().replace(" ", "-").replace(".", "")
        fname = f"{r['ticker']}-{slug}.html"
        files.append((fname, r))

    # Generate individual pages
    for i, (fname, r) in enumerate(files):
        parsed = json.loads(r["response"]) if r["response"] else {}
        grades = parsed.get("grades", {})

        grade_cards = ""
        for factor in ("vote", "financing", "legal", "regulatory", "mac"):
            data = grades.get(factor, {})
            grade_cards += build_grade_card(factor.title(), data)

        prev_link = f'<a href="{files[i-1][0]}">← Prev</a>' if i > 0 else ""
        next_link = f'<a href="{files[i+1][0]}">Next →</a>' if i < len(files) - 1 else ""

        inv = r["investable_assessment"] or parsed.get("investable_assessment", "—")
        prob = r["probability_of_success"]
        prob_display = f"{float(prob):.0%}" if prob else parsed.get("probability_of_success", "—")

        html = HTML_TEMPLATE.format(
            ticker=r["ticker"],
            model=r["model"],
            model_short=model_short(r["model"]),
            cost=float(r["cost_usd"] or 0),
            input_tokens=r["input_tokens"] or 0,
            output_tokens=r["output_tokens"] or 0,
            reasoning_depth=r["reasoning_depth"] or 0,
            investable=inv,
            inv_class=inv_class(inv),
            prob_display=prob_display,
            grade_cards=grade_cards,
            deal_summary_section=build_section("Deal Summary", parsed.get("deal_summary", "")),
            investable_reasoning_section=build_section(
                "Investable Reasoning", parsed.get("investable_reasoning", "")
            ),
            key_risks_section=build_list_section("Key Risks", parsed.get("key_risks", [])),
            supplemental_section=build_supplemental(parsed),
            additional_sections="",
            prev_link=prev_link,
            next_link=next_link,
        )

        (output_dir / fname).write_text(html)

    # Generate index and flagged pages using the shared module
    index_html = await generate_index_html(pool, run_id=run_id, portfolio_tickers=portfolio_tickers)
    (output_dir / "index.html").write_text(index_html)

    flagged_html = await generate_flagged_html(pool, run_id=run_id, portfolio_tickers=portfolio_tickers)
    (output_dir / "flagged.html").write_text(flagged_html)

    await pool.close()

    print(f"Done! {len(files)} reports + index.html + flagged.html → {output_dir}")
    print(f"Open: file://{output_dir}/index.html")
    print(f"Flagged: file://{output_dir}/flagged.html")


if __name__ == "__main__":
    asyncio.run(main())
