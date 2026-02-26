"""Reusable HTML generation for baseline model comparison reports.

Provides async functions that query the database and return HTML strings,
usable both from the CLI tool (tools/export_baseline_html.py) and the
FastAPI endpoint (GET /risk/baseline-review-html).
"""
import json
import re
import uuid as _uuid
from itertools import groupby


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def grade_class(grade: str) -> str:
    if not grade:
        return ""
    g = grade.lower()
    if g in ("low", "a", "a+", "a-", "b+"):
        return "grade-low"
    if g in ("medium", "b", "b-", "c+", "c"):
        return "grade-medium"
    return "grade-high"


def inv_class(inv: str) -> str:
    if not inv:
        return "no"
    i = inv.lower().strip()
    if i == "yes":
        return "yes"
    if i == "no":
        return "no"
    return "conditional"


def model_short(model: str) -> str:
    if "opus" in model:
        return "Opus 4.6"
    if "sonnet" in model:
        return "Sonnet 4.6"
    if "haiku" in model:
        return "Haiku 4.5"
    return model


def extract_grade(text: str | None) -> str | None:
    """Extract Low/Medium/High from free-form sheet text."""
    if not text:
        return None
    text_lower = text.strip().lower()
    for grade in ("high", "medium", "low"):
        if text_lower.startswith(grade) or re.search(rf'\b{grade}\b', text_lower):
            return grade.capitalize()
    return None


def build_grade_card(label: str, data) -> str:
    if isinstance(data, dict):
        grade = data.get("grade", "—")
        detail = data.get("detail", "")
        conf = data.get("confidence")
    else:
        grade = str(data) if data else "—"
        detail = ""
        conf = None

    cls = grade_class(grade)
    conf_html = f'<div class="confidence">confidence: {conf}</div>' if conf else ""
    detail_html = f'<div class="detail-text">{detail}</div>' if detail else ""

    return f"""<div class="grade-card">
  <div class="label">{label}</div>
  <div class="grade {cls}">{grade}</div>
  {detail_html}
  {conf_html}
</div>"""


def build_section(title: str, content: str) -> str:
    if not content:
        return ""
    return f"""<div class="section">
  <h2>{title}</h2>
  <p>{content}</p>
</div>"""


def build_list_section(title: str, items: list) -> str:
    if not items:
        return ""
    li = "\n".join(f"  <li>{item}</li>" for item in items)
    return f"""<div class="section">
  <h2>{title}</h2>
  <ul>
{li}
  </ul>
</div>"""


def build_supplemental(parsed: dict) -> str:
    scores = parsed.get("supplemental_scores", {})
    if not scores:
        return ""
    parts = []
    for key in ("market", "timing", "competing_bid"):
        s = scores.get(key, {})
        if isinstance(s, dict) and (s.get("score") is not None or s.get("detail")):
            score = s.get("score", "—")
            detail = s.get("detail", "")
            parts.append(f"<strong>{key.replace('_', ' ').title()}</strong> ({score}/10): {detail[:300]}")
    if not parts:
        return ""
    content = "<br><br>".join(parts)
    return f"""<div class="section">
  <h2>Supplemental Scores</h2>
  <p>{content}</p>
</div>"""


def _severity_badge(score):
    if score >= 5:
        return '<span style="background:#7f1d1d;color:#fca5a5;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">CRITICAL</span>'
    if score >= 3:
        return '<span style="background:#78350f;color:#fcd34d;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">NOTABLE</span>'
    return '<span style="background:#1a2332;color:#93c5fd;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">MONITOR</span>'


def _agree_badge(agree):
    if agree:
        return '<span style="color:#4ade80;font-size:12px">Models agree</span>'
    return '<span style="color:#facc15;font-size:12px">Models disagree</span>'


# ---------------------------------------------------------------------------
# HTML templates
# ---------------------------------------------------------------------------

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{ticker} — {model_short}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0a0a0f; color: #e5e5e5; padding: 20px 32px; line-height: 1.5; }}
  .nav {{ display: flex; gap: 12px; margin-bottom: 16px; font-size: 14px; }}
  .nav a {{ color: #60a5fa; text-decoration: none; }}
  .nav a:hover {{ text-decoration: underline; }}
  h1 {{ font-size: 22px; margin-bottom: 4px; }}
  .subtitle {{ color: #9ca3af; font-size: 14px; margin-bottom: 20px; }}
  .grade-row {{ display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }}
  .grade-card {{ background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 8px;
                 padding: 12px 16px; min-width: 140px; flex: 1; }}
  .grade-card .label {{ font-size: 11px; text-transform: uppercase; color: #9ca3af;
                        letter-spacing: 0.05em; margin-bottom: 4px; }}
  .grade-card .grade {{ font-size: 20px; font-weight: 700; }}
  .grade-low {{ color: #4ade80; }}
  .grade-medium {{ color: #facc15; }}
  .grade-high {{ color: #f87171; }}
  .section {{ background: #111122; border: 1px solid #1e1e3a; border-radius: 8px;
              padding: 16px 20px; margin-bottom: 12px; }}
  .section h2 {{ font-size: 15px; color: #a5b4fc; margin-bottom: 8px; }}
  .section p, .section li {{ font-size: 14px; color: #d1d5db; }}
  .section ul {{ padding-left: 20px; }}
  .section li {{ margin-bottom: 4px; }}
  .meta {{ display: flex; gap: 24px; font-size: 13px; color: #6b7280; margin-bottom: 16px; }}
  .meta span {{ display: flex; align-items: center; gap: 4px; }}
  .investable {{ display: inline-block; padding: 3px 10px; border-radius: 12px;
                 font-size: 13px; font-weight: 600; }}
  .investable-yes {{ background: #064e3b; color: #6ee7b7; }}
  .investable-no {{ background: #7f1d1d; color: #fca5a5; }}
  .investable-conditional {{ background: #78350f; color: #fcd34d; }}
  .detail-text {{ font-size: 13px; color: #9ca3af; margin-top: 4px; }}
  .confidence {{ font-size: 11px; color: #6b7280; }}
</style>
</head>
<body>
<div class="nav">
  <a href="index.html">← Index</a>
  {prev_link}
  {next_link}
</div>
<h1>{ticker} <span style="color:#6b7280">—</span> {model_short}</h1>
<div class="subtitle">{model} · ${cost:.4f} · {input_tokens} in / {output_tokens} out · depth {reasoning_depth}</div>

<div class="meta">
  <span>Investable: <span class="investable investable-{inv_class}">{investable}</span></span>
  <span>Prob success: {prob_display}</span>
</div>

<div class="grade-row">
{grade_cards}
</div>

{deal_summary_section}
{investable_reasoning_section}
{key_risks_section}
{supplemental_section}
{additional_sections}

</body>
</html>"""


INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Baseline Review — {run_id_short}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0a0a0f; color: #e5e5e5; padding: 20px 32px; }}
  h1 {{ font-size: 24px; margin-bottom: 4px; }}
  .subtitle {{ color: #9ca3af; font-size: 14px; margin-bottom: 20px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
  th {{ text-align: left; padding: 8px 12px; background: #1a1a2e; color: #a5b4fc;
       font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
       border-bottom: 1px solid #2a2a3e; position: sticky; top: 0; }}
  td {{ padding: 6px 12px; border-bottom: 1px solid #1a1a2e; }}
  tr:hover td {{ background: #111122; }}
  a {{ color: #60a5fa; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .grade-low {{ color: #4ade80; }}
  .grade-medium {{ color: #facc15; }}
  .grade-high {{ color: #f87171; }}
  .inv-yes {{ color: #6ee7b7; }}
  .inv-no {{ color: #fca5a5; }}
  .inv-conditional {{ color: #fcd34d; }}
  .model-opus {{ color: #c4b5fd; }}
  .model-sonnet {{ color: #93c5fd; }}
  .model-haiku {{ color: #86efac; }}
  .model-sheet {{ color: #f9a8d4; font-style: italic; }}
  tr.sheet-row td {{ background: #1a1028; border-bottom: 2px solid #2a2a3e; }}
  .owned-yes {{ color: #4ade80; font-weight: 600; }}
  .owned-no {{ color: #4b5563; }}
  .filters {{ display: flex; gap: 8px; margin-bottom: 16px; }}
  .filters button {{ padding: 6px 16px; border-radius: 6px; border: 1px solid #2a2a3e;
                     background: #1a1a2e; color: #9ca3af; font-size: 13px; cursor: pointer;
                     transition: all 0.15s; }}
  .filters button:hover {{ border-color: #4a4a6e; color: #e5e5e5; }}
  .filters button.active {{ background: #2d2b55; border-color: #6366f1; color: #e5e5e5;
                            font-weight: 600; }}
  .stats {{ display: flex; gap: 24px; margin-bottom: 20px; }}
  .stat {{ background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 8px;
           padding: 12px 20px; }}
  .stat .num {{ font-size: 24px; font-weight: 700; }}
  .stat .label {{ font-size: 12px; color: #9ca3af; }}
  .nav {{ display: flex; gap: 12px; margin-bottom: 16px; font-size: 14px; }}
  .nav a {{ color: #60a5fa; text-decoration: none; }}
  .nav a:hover {{ text-decoration: underline; }}
</style>
</head>
<body>
<div class="nav">
  <a href="/sheet-portfolio" target="_top">← Dashboard</a>
  <a href="/" target="_top">Home</a>
</div>
<h1>Baseline Model Comparison</h1>
<div class="subtitle">Run {run_id_short} · {count} results · ${total_cost:.2f} total</div>

<div class="stats">
  <div class="stat"><div class="num">{count}</div><div class="label">Assessments</div></div>
  <div class="stat"><div class="num">{ticker_count}</div><div class="label">Tickers</div></div>
  <div class="stat"><div class="num">{opus_count}</div><div class="label">Opus</div></div>
  <div class="stat"><div class="num">{sonnet_count}</div><div class="label">Sonnet</div></div>
  <div class="stat"><div class="num">${total_cost:.2f}</div><div class="label">Total Cost</div></div>
  <div class="stat"><div class="num">{owned_count}</div><div class="label">Owned</div></div>
</div>

<div class="filters">
  <button class="active" onclick="filterRows('all')">All ({ticker_count})</button>
  <button onclick="filterRows('yes')">Owned ({owned_count})</button>
  <button onclick="filterRows('no')">Not Owned ({not_owned_count})</button>
</div>

<table>
<thead>
<tr>
  <th>Ticker</th><th>Model</th><th>Owned</th><th>Investable</th>
  <th>Vote</th><th>Finance</th><th>Legal</th><th>Regulatory</th><th>MAC</th>
  <th>Cost</th><th>Depth</th>
</tr>
</thead>
<tbody>
{rows}
</tbody>
</table>

<script>
function filterRows(mode) {{
  document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('tbody tr').forEach(tr => {{
    const owned = tr.dataset.owned;
    if (mode === 'all') tr.style.display = '';
    else if (mode === 'yes') tr.style.display = owned === 'yes' ? '' : 'none';
    else tr.style.display = owned === 'no' ? '' : 'none';
  }});
}}
</script>
</body>
</html>"""


FLAGGED_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Flagged Deals Review</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0a0a0f; color: #e5e5e5; padding: 20px 32px; line-height: 1.5; }}
  h1 {{ font-size: 24px; margin-bottom: 4px; }}
  .subtitle {{ color: #9ca3af; font-size: 14px; margin-bottom: 20px; }}
  a {{ color: #60a5fa; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  .grade-low {{ color: #4ade80; }}
  .grade-medium {{ color: #facc15; }}
  .grade-high {{ color: #f87171; }}
  .inv-yes {{ color: #6ee7b7; }}
  .inv-no {{ color: #fca5a5; }}
  .inv-conditional {{ color: #fcd34d; }}
  .stats {{ display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }}
  .stat {{ background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 8px;
           padding: 10px 16px; }}
  .stat .num {{ font-size: 20px; font-weight: 700; }}
  .stat .label {{ font-size: 11px; color: #9ca3af; }}
  .deal-card {{ background: #111122; border: 1px solid #1e1e3a; border-radius: 10px;
                padding: 16px 20px; margin-bottom: 16px; }}
  .deal-header {{ display: flex; justify-content: space-between; align-items: center;
                  margin-bottom: 8px; flex-wrap: wrap; gap: 8px; }}
  .deal-body {{ display: grid; grid-template-columns: auto 1fr; gap: 20px; }}
  @media (max-width: 900px) {{ .deal-body {{ grid-template-columns: 1fr; }} }}
  .deal-grades {{ min-width: 280px; }}
  .compare-table {{ border-collapse: collapse; font-size: 13px; width: 100%; }}
  .compare-table th {{ text-align: left; padding: 4px 10px; color: #6b7280; font-size: 11px;
                       text-transform: uppercase; border-bottom: 1px solid #2a2a3e; }}
  .compare-table td {{ padding: 4px 10px; border-bottom: 1px solid #1a1a2e; }}
  .deal-details {{ font-size: 13px; }}
  .nav {{ display: flex; gap: 12px; margin-bottom: 16px; font-size: 14px; }}
  .nav a {{ color: #60a5fa; text-decoration: none; }}
  .nav a:hover {{ text-decoration: underline; }}
</style>
</head>
<body>
<div class="nav">
  <a href="/sheet-portfolio" target="_top">← Dashboard</a>
  <a href="/" target="_top">Home</a>
</div>
<h1>Flagged Deals Review</h1>
<div class="subtitle">{flagged_count} of {owned_count} owned deals have AI concerns &middot; Sorted by severity</div>

<div class="stats">
  <div class="stat"><div class="num" style="color:#fca5a5">{critical}</div><div class="label">Critical</div></div>
  <div class="stat"><div class="num" style="color:#fcd34d">{notable}</div><div class="label">Notable</div></div>
  <div class="stat"><div class="num" style="color:#93c5fd">{monitor}</div><div class="label">Monitor</div></div>
  <div class="stat"><div class="num" style="color:#4ade80">{clean}</div><div class="label">All Clear</div></div>
</div>

{deal_cards}

</body>
</html>"""


# ---------------------------------------------------------------------------
# Constants for flagged deal analysis
# ---------------------------------------------------------------------------

FACTORS = ("vote", "financing", "legal", "regulatory", "mac")
FACTOR_LABELS = {"vote": "Vote", "financing": "Financing", "legal": "Legal",
                 "regulatory": "Regulatory", "mac": "MAC"}
SHEET_FACTOR_MAP = {"vote": "vote", "financing": "financing", "legal": "legal"}


# ---------------------------------------------------------------------------
# Database queries
# ---------------------------------------------------------------------------

async def get_portfolio_tickers_from_sheet(pool) -> set[str]:
    """Get owned tickers from sheet_rows (non-null investable, not excluded)."""
    async with pool.acquire() as conn:
        snapshot = await conn.fetchrow(
            "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
        )
        if not snapshot:
            return set()
        rows = await conn.fetch(
            """SELECT DISTINCT ticker FROM sheet_rows
               WHERE snapshot_id = $1
                 AND ticker IS NOT NULL
                 AND investable IS NOT NULL
                 AND (is_excluded IS NOT TRUE)""",
            snapshot["id"],
        )
        return {r["ticker"] for r in rows}


async def _fetch_results_and_sheet_grades(pool, run_id: str):
    """Fetch baseline results + sheet grades for a run. Returns (results, sheet_grades, run_id_str)."""
    async with pool.acquire() as conn:
        # Get latest run if not specified
        if not run_id:
            row = await conn.fetchrow(
                "SELECT id FROM baseline_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1"
            )
            if not row:
                return [], {}, None
            run_id = str(row["id"])

        results = await conn.fetch(
            """SELECT ticker, model, is_presented, response,
                      input_tokens, output_tokens, cost_usd, latency_ms,
                      probability_of_success, investable_assessment, reasoning_depth,
                      grade_vote, grade_financing, grade_legal, grade_regulatory, grade_mac
               FROM baseline_model_results
               WHERE run_id = $1
               ORDER BY ticker, model""",
            _uuid.UUID(run_id),
        )

        # Fetch sheet grades for comparison
        snapshot = await conn.fetchrow(
            "SELECT id FROM sheet_snapshots ORDER BY snapshot_date DESC, ingested_at DESC LIMIT 1"
        )
        sheet_grades = {}
        if snapshot:
            sheet_rows = await conn.fetch(
                """SELECT ticker, vote_risk, finance_risk, legal_risk, investable
                   FROM sheet_rows
                   WHERE snapshot_id = $1 AND ticker IS NOT NULL AND (is_excluded IS NOT TRUE)""",
                snapshot["id"],
            )
            for sr in sheet_rows:
                sheet_grades[sr["ticker"]] = {
                    "vote": extract_grade(sr["vote_risk"]),
                    "financing": extract_grade(sr["finance_risk"]),
                    "legal": extract_grade(sr["legal_risk"]),
                    "investable": sr["investable"],
                }

    return list(results), sheet_grades, run_id


# ---------------------------------------------------------------------------
# Flagged deals analysis (shared logic)
# ---------------------------------------------------------------------------

def _analyze_flagged_deals(grouped, portfolio_tickers, sheet_grades):
    """Analyze grouped results and return list of flagged deal dicts, sorted by severity.

    Flagging criteria (owned deals only):
      Tier 1 — At least one model assessed investable != "yes" (No or Conditional).
               These are deals we hold that AI questions.  Score 5 (No) or 3 (Conditional).
      Tier 2 — All models say "yes" but at least one "High" risk grade exists.
               Still investable per AI, but worth monitoring.  Score 2 per High factor.
    Medium-grade factors alone do NOT trigger flagging.
    """
    flagged_deals = []

    for ticker, ticker_files in grouped:
        if ticker not in portfolio_tickers:
            continue

        model_data = {}
        for fname, r in ticker_files:
            parsed = json.loads(r["response"]) if r["response"] else {}
            ml = model_short(r["model"])
            grades = parsed.get("grades", {})
            model_data[ml] = {
                "parsed": parsed,
                "fname": fname,
                "investable": r["investable_assessment"] or parsed.get("investable_assessment", ""),
                "prob": r["probability_of_success"],
                "grades": {},
            }
            for f in FACTORS:
                g = grades.get(f, {})
                if isinstance(g, dict):
                    model_data[ml]["grades"][f] = {
                        "grade": g.get("grade", ""),
                        "detail": g.get("detail", ""),
                        "confidence": g.get("confidence"),
                    }
                else:
                    model_data[ml]["grades"][f] = {"grade": str(g) if g else "", "detail": "", "confidence": None}

        # --- Tier 1: any model says investable != "yes" ---
        investable_flags = {}
        for ml, md in model_data.items():
            inv = md["investable"].strip().lower() if md["investable"] else ""
            if inv and inv != "yes":
                investable_flags[ml] = md["investable"]

        # --- Tier 2: any model gives a "High" risk grade ---
        high_grade_flags = {}
        for ml, md in model_data.items():
            for f in FACTORS:
                g = md["grades"][f]["grade"]
                if g and g.capitalize() == "High":
                    if f not in high_grade_flags:
                        high_grade_flags[f] = {}
                    high_grade_flags[f][ml] = md["grades"][f]

        if not investable_flags and not high_grade_flags:
            continue

        # Build flags & flag_details for the card renderer
        flags = {}
        flag_details = {}

        if investable_flags:
            # Use the most concerning assessment for display
            for ml, inv in investable_flags.items():
                flags["investable"] = inv

        for f, model_grades in high_grade_flags.items():
            flags[f] = "High"
            flag_details[f] = model_grades

        # Severity scoring
        score = 0
        has_no = any(v.strip().lower() == "no" for v in investable_flags.values())
        if has_no:
            score += 5
        elif investable_flags:
            score += 3  # Conditional or other non-yes
        for f in high_grade_flags:
            score += 2

        models = list(model_data.keys())
        agree = True
        if len(models) == 2:
            g1 = {f: model_data[models[0]]["grades"][f]["grade"] for f in FACTORS}
            g2 = {f: model_data[models[1]]["grades"][f]["grade"] for f in FACTORS}
            i1 = model_data[models[0]]["investable"]
            i2 = model_data[models[1]]["investable"]
            if g1 != g2 or i1 != i2:
                agree = False

        sg = sheet_grades.get(ticker, {})
        best = model_data.get("Opus 4.6") or model_data.get("Sonnet 4.6") or next(iter(model_data.values()))

        flagged_deals.append({
            "ticker": ticker,
            "score": score,
            "flags": flags,
            "flag_details": flag_details,
            "model_data": model_data,
            "models_agree": agree,
            "sheet": sg,
            "key_risks": best["parsed"].get("key_risks", []),
            "deal_summary": best["parsed"].get("deal_summary", ""),
            "investable_reasoning": best["parsed"].get("investable_reasoning", ""),
            "prob": best["prob"],
            "fname_opus": model_data.get("Opus 4.6", {}).get("fname", ""),
            "fname_sonnet": model_data.get("Sonnet 4.6", {}).get("fname", ""),
        })

    flagged_deals.sort(key=lambda d: -d["score"])
    return flagged_deals


def _build_deal_card(d):
    """Build HTML card for a single flagged deal."""
    ticker = d["ticker"]

    links = []
    if d["model_data"].get("Opus 4.6"):
        links.append(f'<a href="/api/sheet-portfolio/baseline-review?view=detail&ticker={ticker}&model=opus" target="_blank">Opus report</a>')
    if d["model_data"].get("Sonnet 4.6"):
        links.append(f'<a href="/api/sheet-portfolio/baseline-review?view=detail&ticker={ticker}&model=sonnet" target="_blank">Sonnet report</a>')
    links_html = " · ".join(links)

    grade_rows = []
    for f in FACTORS:
        label = FACTOR_LABELS[f]
        cells = []
        for ml in ("Opus 4.6", "Sonnet 4.6"):
            md = d["model_data"].get(ml)
            if md:
                g = md["grades"][f]["grade"] or "—"
                cls = grade_class(g)
                cells.append(f'<td class="{cls}">{g}</td>')
            else:
                cells.append("<td>—</td>")
        sheet_f = SHEET_FACTOR_MAP.get(f)
        if sheet_f and d["sheet"].get(sheet_f):
            sg = d["sheet"][sheet_f]
            cls = grade_class(sg)
            cells.append(f'<td class="{cls}">{sg}</td>')
        elif sheet_f:
            cells.append('<td style="color:#4b5563">—</td>')
        else:
            cells.append('<td style="color:#4b5563">n/a</td>')

        ai_grades = set()
        for ml in ("Opus 4.6", "Sonnet 4.6"):
            md = d["model_data"].get(ml)
            if md:
                g = md["grades"][f]["grade"]
                if g:
                    ai_grades.add(g.capitalize())
        sheet_val = d["sheet"].get(SHEET_FACTOR_MAP.get(f, "")) if SHEET_FACTOR_MAP.get(f) else None
        disc = ""
        if sheet_val and ai_grades and sheet_val not in ai_grades:
            disc = ' <span style="color:#f87171;font-size:11px">DIFFERS</span>'

        grade_rows.append(f'<tr><td style="color:#9ca3af">{label}{disc}</td>{"".join(cells)}</tr>')

    inv_cells = []
    for ml in ("Opus 4.6", "Sonnet 4.6"):
        md = d["model_data"].get(ml)
        if md:
            inv = md["investable"] or "—"
            ic = inv_class(inv)
            inv_cells.append(f'<td class="inv-{ic}">{inv}</td>')
        else:
            inv_cells.append("<td>—</td>")
    sheet_inv = d["sheet"].get("investable", "")
    if sheet_inv:
        ic = inv_class(sheet_inv)
        inv_cells.append(f'<td class="inv-{ic}">{sheet_inv}</td>')
    else:
        inv_cells.append('<td style="color:#4b5563">—</td>')
    grade_rows.append(f'<tr><td style="color:#9ca3af">Investable</td>{"".join(inv_cells)}</tr>')

    grade_table = f"""<table class="compare-table">
<thead><tr><th></th><th>Opus</th><th>Sonnet</th><th>Sheet</th></tr></thead>
<tbody>{"".join(grade_rows)}</tbody>
</table>"""

    detail_blocks = []
    for f in FACTORS:
        if f not in d["flag_details"]:
            continue
        label = FACTOR_LABELS[f]
        worst = d["flags"].get(f, "Medium")
        cls = grade_class(worst)
        parts = []
        for ml, info in d["flag_details"][f].items():
            detail = info.get("detail", "")
            conf = info.get("confidence")
            conf_s = f" (conf: {conf})" if conf else ""
            if detail:
                parts.append(f'<div style="margin-bottom:6px"><span style="color:#6b7280;font-size:12px">{ml}{conf_s}:</span> {detail}</div>')
        if parts:
            detail_blocks.append(
                f'<div style="margin-bottom:12px">'
                f'<span class="{cls}" style="font-weight:600">{label}: {worst}</span>'
                f'<div style="margin-top:4px;padding-left:12px;border-left:2px solid #2a2a3e">{"".join(parts)}</div>'
                f'</div>'
            )

    inv_block = ""
    if "investable" in d["flags"]:
        inv_block = f'<div style="margin-bottom:12px"><span class="inv-{inv_class(d["flags"]["investable"])}" style="font-weight:600">Investable: {d["flags"]["investable"]}</span><div style="margin-top:4px;padding-left:12px;border-left:2px solid #2a2a3e;color:#d1d5db;font-size:13px">{d["investable_reasoning"]}</div></div>'

    risks_html = ""
    if d["key_risks"]:
        items = "".join(f"<li>{r}</li>" for r in d["key_risks"][:5])
        risks_html = f'<div style="margin-top:12px"><div style="color:#a5b4fc;font-size:13px;font-weight:600;margin-bottom:4px">Key Risks</div><ul style="padding-left:20px;font-size:13px;color:#d1d5db">{items}</ul></div>'

    prob_html = ""
    if d["prob"]:
        prob_html = f' · Prob: {float(d["prob"]):.0%}'

    return f"""<div class="deal-card">
<div class="deal-header">
  <div>
    <span style="font-size:18px;font-weight:700">{ticker}</span>
    {_severity_badge(d["score"])}
    {_agree_badge(d["models_agree"])}
    <span style="color:#6b7280;font-size:13px;margin-left:8px">Score: {d["score"]}{prob_html}</span>
  </div>
  <div style="font-size:13px">{links_html}</div>
</div>
<div style="color:#d1d5db;font-size:13px;margin-bottom:12px">{d["deal_summary"]}</div>
<div class="deal-body">
  <div class="deal-grades">{grade_table}</div>
  <div class="deal-details">
    {"".join(detail_blocks)}
    {inv_block}
    {risks_html}
  </div>
</div>
</div>"""


# ---------------------------------------------------------------------------
# Public async functions
# ---------------------------------------------------------------------------

async def generate_flagged_html(pool, run_id: str | None = None, portfolio_tickers: set[str] | None = None) -> str:
    """Generate the flagged deals review page. Returns HTML string."""
    results, sheet_grades, run_id = await _fetch_results_and_sheet_grades(pool, run_id)
    if not results:
        return "<html><body><h1>No baseline results found</h1></body></html>"

    if portfolio_tickers is None:
        portfolio_tickers = await get_portfolio_tickers_from_sheet(pool)

    # Group by ticker
    files = []
    for r in results:
        ms = model_short(r["model"])
        slug = ms.lower().replace(" ", "-").replace(".", "")
        fname = f"{r['ticker']}-{slug}.html"
        files.append((fname, r))

    grouped = []
    for ticker, group in groupby(files, key=lambda x: x[1]["ticker"]):
        grouped.append((ticker, list(group)))

    owned_count = sum(1 for ticker, _ in grouped if ticker in portfolio_tickers)
    flagged_deals = _analyze_flagged_deals(grouped, portfolio_tickers, sheet_grades)

    deal_cards = "".join(_build_deal_card(d) for d in flagged_deals)

    critical = sum(1 for d in flagged_deals if d["score"] >= 5)
    notable = sum(1 for d in flagged_deals if 3 <= d["score"] < 5)
    monitor = sum(1 for d in flagged_deals if d["score"] < 3)
    clean = owned_count - len(flagged_deals)

    return FLAGGED_TEMPLATE.format(
        flagged_count=len(flagged_deals),
        owned_count=owned_count,
        critical=critical,
        notable=notable,
        monitor=monitor,
        clean=clean,
        deal_cards=deal_cards,
    )


async def generate_index_html(pool, run_id: str | None = None, portfolio_tickers: set[str] | None = None) -> str:
    """Generate the full comparison index page. Returns HTML string."""
    results, sheet_grades, run_id = await _fetch_results_and_sheet_grades(pool, run_id)
    if not results:
        return "<html><body><h1>No baseline results found</h1></body></html>"

    if portfolio_tickers is None:
        portfolio_tickers = await get_portfolio_tickers_from_sheet(pool)

    # Build file list
    files = []
    for r in results:
        ms = model_short(r["model"])
        slug = ms.lower().replace(" ", "-").replace(".", "")
        fname = f"{r['ticker']}-{slug}.html"
        files.append((fname, r))

    grouped = []
    for ticker, group in groupby(files, key=lambda x: x[1]["ticker"]):
        grouped.append((ticker, list(group)))

    index_rows = []
    total_cost = 0
    opus_count = sonnet_count = 0
    tickers = set()
    owned_count = 0

    for ticker, ticker_files in grouped:
        tickers.add(ticker)
        is_owned = ticker in portfolio_tickers
        if is_owned:
            owned_count += 1
        owned_html = f'<td class="owned-yes">Yes</td>' if is_owned else '<td class="owned-no">—</td>'

        first = True
        for fname, r in ticker_files:
            cost = float(r["cost_usd"] or 0)
            total_cost += cost
            ms = model_short(r["model"])
            if "opus" in r["model"]:
                opus_count += 1
            elif "sonnet" in r["model"]:
                sonnet_count += 1

            mc = "model-opus" if "opus" in r["model"] else "model-sonnet" if "sonnet" in r["model"] else "model-haiku"
            inv = r["investable_assessment"] or "—"
            ic = inv_class(inv)

            row_owned = owned_html if first else '<td></td>'
            first = False

            owned_attr = "yes" if is_owned else "no"
            index_rows.append(
                f'<tr data-owned="{owned_attr}">'
                f'<td><a href="{fname}">{r["ticker"]}</a></td>'
                f'<td class="{mc}">{ms}</td>'
                f'{row_owned}'
                f'<td class="inv-{ic}">{inv}</td>'
                f'<td class="{grade_class(r["grade_vote"] or "")}">{r["grade_vote"] or "—"}</td>'
                f'<td class="{grade_class(r["grade_financing"] or "")}">{r["grade_financing"] or "—"}</td>'
                f'<td class="{grade_class(r["grade_legal"] or "")}">{r["grade_legal"] or "—"}</td>'
                f'<td class="{grade_class(r["grade_regulatory"] or "")}">{r["grade_regulatory"] or "—"}</td>'
                f'<td class="{grade_class(r["grade_mac"] or "")}">{r["grade_mac"] or "—"}</td>'
                f'<td>${cost:.4f}</td>'
                f'<td>{r["reasoning_depth"] or "—"}</td>'
                f'</tr>'
            )

        # Sheet grade row
        sg = sheet_grades.get(ticker, {})
        if sg:
            s_inv = sg.get("investable") or "—"
            s_ic = inv_class(s_inv)
            s_vote = sg.get("vote") or "—"
            s_fin = sg.get("financing") or "—"
            s_legal = sg.get("legal") or "—"
            owned_attr = "yes" if is_owned else "no"

            index_rows.append(
                f'<tr class="sheet-row" data-owned="{owned_attr}">'
                f'<td>{ticker}</td>'
                f'<td class="model-sheet">Sheet</td>'
                f'<td></td>'
                f'<td class="inv-{s_ic}">{s_inv}</td>'
                f'<td class="{grade_class(s_vote)}">{s_vote}</td>'
                f'<td class="{grade_class(s_fin)}">{s_fin}</td>'
                f'<td class="{grade_class(s_legal)}">{s_legal}</td>'
                f'<td style="color:#4b5563">n/a</td>'
                f'<td style="color:#4b5563">n/a</td>'
                f'<td></td>'
                f'<td></td>'
                f'</tr>'
            )

    return INDEX_TEMPLATE.format(
        run_id_short=run_id[:8] if run_id else "—",
        count=len(files),
        ticker_count=len(tickers),
        opus_count=opus_count,
        sonnet_count=sonnet_count,
        total_cost=total_cost,
        owned_count=owned_count,
        not_owned_count=len(tickers) - owned_count,
        rows="\n".join(index_rows),
    )


async def generate_detail_html(pool, ticker: str, model_hint: str, run_id: str | None = None) -> str | None:
    """Generate a single-ticker, single-model detail page. Returns HTML or None if not found."""
    async with pool.acquire() as conn:
        if not run_id:
            row = await conn.fetchrow(
                "SELECT id FROM baseline_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1"
            )
            if not row:
                return None
            run_id = str(row["id"])

        # Match model by hint (opus/sonnet)
        model_like = f"%{model_hint}%"
        r = await conn.fetchrow(
            """SELECT ticker, model, response,
                      input_tokens, output_tokens, cost_usd, latency_ms,
                      probability_of_success, investable_assessment, reasoning_depth,
                      grade_vote, grade_financing, grade_legal, grade_regulatory, grade_mac
               FROM baseline_model_results
               WHERE run_id = $1 AND ticker = $2 AND model ILIKE $3
               LIMIT 1""",
            _uuid.UUID(run_id), ticker.upper(), model_like,
        )
        if not r:
            return None

    parsed = json.loads(r["response"]) if r["response"] else {}
    grades = parsed.get("grades", {})
    ms = model_short(r["model"])
    cost = float(r["cost_usd"] or 0)

    grade_cards_parts = []
    for f in FACTORS:
        g = grades.get(f, {})
        grade_cards_parts.append(build_grade_card(FACTOR_LABELS[f], g))
    grade_cards = "\n".join(grade_cards_parts)

    inv = r["investable_assessment"] or parsed.get("investable_assessment", "")
    prob = r["probability_of_success"]
    prob_display = f"{float(prob):.0%}" if prob else "—"

    return HTML_TEMPLATE.format(
        ticker=r["ticker"],
        model_short=ms,
        model=r["model"],
        cost=cost,
        input_tokens=r["input_tokens"] or 0,
        output_tokens=r["output_tokens"] or 0,
        reasoning_depth=r["reasoning_depth"] or "—",
        investable=inv or "—",
        inv_class=inv_class(inv),
        prob_display=prob_display,
        grade_cards=grade_cards,
        deal_summary_section=build_section("Deal Summary", parsed.get("deal_summary", "")),
        investable_reasoning_section=build_section("Investable Reasoning", parsed.get("investable_reasoning", "")),
        key_risks_section=build_list_section("Key Risks", parsed.get("key_risks", [])),
        supplemental_section=build_supplemental(parsed),
        additional_sections="",
        prev_link="",
        next_link=f'<a href="/api/sheet-portfolio/baseline-review?view=flagged">← Back to Flagged</a>',
    )
