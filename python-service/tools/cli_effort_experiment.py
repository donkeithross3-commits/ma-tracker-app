#!/usr/bin/env python3
"""CLI Effort Level Experiment for M&A Risk Assessment.

Tests 3 effort levels (medium, high, max) across 5 representative deals
to determine optimal effort level for CLI-based risk assessment.

Runs on Mac (has Claude CLI + OAuth). Uses prompts extracted from production.

Usage:
  python3 tools/cli_effort_experiment.py
  python3 tools/cli_effort_experiment.py --consistency   # adds 4 repeat calls
  python3 tools/cli_effort_experiment.py --resume        # resume from partial results
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

PROMPTS_FILE = Path("/tmp/experiment_prompts.json")
RESULTS_FILE = Path("/tmp/cli_effort_experiment_results.json")
CLI_MODEL = "opus"  # Use Opus for max quality comparison

EFFORT_LEVELS = ["medium", "high", "max"]
TIMEOUT_BY_EFFORT = {
    "medium": 180,   # 3 min
    "high": 360,     # 6 min
    "max": 600,      # 10 min
}

# Model pricing for cost comparison
# Opus: $15/M input, $75/M output
OPUS_INPUT_PRICE_PER_TOKEN = 15.0 / 1_000_000
OPUS_OUTPUT_PRICE_PER_TOKEN = 75.0 / 1_000_000


def call_claude_cli(system_prompt: str, user_prompt: str, effort: str,
                    ticker: str) -> dict:
    """Call Claude CLI at specified effort level. Returns result dict."""
    full_prompt = f"<system>\n{system_prompt}\n</system>\n\n{user_prompt}"

    # CRITICAL: Remove ANTHROPIC_API_KEY so CLI uses OAuth (Max subscription)
    cli_env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}

    timeout = TIMEOUT_BY_EFFORT.get(effort, 600)

    print(f"  [{effort}] Calling Claude CLI for {ticker} (timeout={timeout}s)...")
    t0 = time.monotonic()

    try:
        result = subprocess.run(
            [
                "claude", "-p", full_prompt,
                "--output-format", "json",
                "--model", CLI_MODEL,
                "--effort", effort,
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(Path.home()),
            env=cli_env,
        )

        elapsed_s = time.monotonic() - t0

        if result.returncode != 0:
            return {
                "success": False,
                "error": f"Exit code {result.returncode}: {result.stderr[:500]}",
                "elapsed_s": round(elapsed_s, 1),
            }

        # Parse CLI JSON output
        raw = result.stdout.strip()
        try:
            cli_json = json.loads(raw)
            text = cli_json.get("result", raw)
            # Extract token usage from CLI response if available
            usage = cli_json.get("usage", {})
            input_tokens = usage.get("input_tokens", len(full_prompt) // 4)
            output_tokens = usage.get("output_tokens", len(text) // 4)
        except json.JSONDecodeError:
            text = raw
            input_tokens = len(full_prompt) // 4
            output_tokens = len(text) // 4

        # Try to parse the AI's JSON response
        assessment = None
        try:
            assessment = _extract_json(text)
        except (json.JSONDecodeError, ValueError):
            pass

        return {
            "success": True,
            "elapsed_s": round(elapsed_s, 1),
            "raw_text": text,
            "assessment": assessment,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "text_length": len(text),
            "json_valid": assessment is not None,
        }

    except subprocess.TimeoutExpired:
        elapsed_s = time.monotonic() - t0
        return {
            "success": False,
            "error": f"Timeout after {timeout}s",
            "elapsed_s": round(elapsed_s, 1),
        }
    except FileNotFoundError:
        return {
            "success": False,
            "error": "Claude CLI not found in PATH",
            "elapsed_s": 0,
        }
    except Exception as e:
        elapsed_s = time.monotonic() - t0
        return {
            "success": False,
            "error": str(e),
            "elapsed_s": round(elapsed_s, 1),
        }


def _extract_json(text: str) -> dict:
    """Extract JSON from Claude's response (handles markdown fences etc)."""
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strip markdown fences
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        return json.loads(text[start:end].strip())
    if "```" in text:
        start = text.index("```") + 3
        end = text.index("```", start)
        return json.loads(text[start:end].strip())

    # Find outermost braces
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start:end + 1])

    raise ValueError("No JSON found in response")


def score_assessment_quality(assessment: dict, ticker: str, deal_info: dict) -> dict:
    """Score the quality of an assessment on 1-5 scale across dimensions."""
    if not assessment:
        return {"total": 0, "details": "No valid assessment"}

    scores = {}

    # 1. Grade completeness: Are all 5 grades + 3 scores present?
    grades = assessment.get("grades", {})
    expected_grades = {"vote", "financing", "legal", "regulatory", "mac"}
    present_grades = set(grades.keys()) & expected_grades
    scores["grade_completeness"] = min(5, len(present_grades) + (
        1 if assessment.get("supplemental_scores") else 0
    ))

    # 2. Detail quality: Do grades have substantive details?
    detail_score = 0
    for factor in expected_grades:
        g = grades.get(factor, {})
        detail = g.get("detail", "")
        if len(detail) > 100:
            detail_score += 1.0
        elif len(detail) > 50:
            detail_score += 0.6
        elif len(detail) > 20:
            detail_score += 0.3
    scores["detail_quality"] = min(5, detail_score)

    # 3. Probability calibration: Is prob_success reasonable?
    prob = assessment.get("probability_of_success", {})
    prob_val = prob.get("value") if isinstance(prob, dict) else prob
    if prob_val is not None:
        try:
            prob_val = float(prob_val)
            # Reasonable range check: not everything should be 95+
            if 60 <= prob_val <= 99:
                scores["probability_calibration"] = 4
                if prob_val < 90:  # Shows differentiation
                    scores["probability_calibration"] = 5
            elif 40 <= prob_val < 60 or prob_val > 99:
                scores["probability_calibration"] = 2
            else:
                scores["probability_calibration"] = 1
        except (ValueError, TypeError):
            scores["probability_calibration"] = 0
    else:
        scores["probability_calibration"] = 0

    # 4. Risk identification: Key risks present and specific?
    risks = assessment.get("key_risks", [])
    if len(risks) >= 3:
        avg_risk_len = sum(len(str(r)) for r in risks) / len(risks)
        if avg_risk_len > 50:
            scores["risk_identification"] = 5
        elif avg_risk_len > 30:
            scores["risk_identification"] = 4
        else:
            scores["risk_identification"] = 3
    elif len(risks) >= 1:
        scores["risk_identification"] = 2
    else:
        scores["risk_identification"] = 0

    # 5. Production comparison: Does it compare against sheet grades?
    disagreements = assessment.get("production_disagreements", [])
    has_vs_production = any(
        g.get("vs_production") for g in grades.values()
    )
    if has_vs_production and disagreements:
        scores["production_comparison"] = 5
    elif has_vs_production:
        scores["production_comparison"] = 4
    elif disagreements:
        scores["production_comparison"] = 3
    else:
        scores["production_comparison"] = 1

    # 6. Predictions: Are there falsifiable predictions with dates?
    predictions = assessment.get("predictions", [])
    valid_predictions = [
        p for p in predictions
        if p.get("type") and p.get("by_date") and p.get("probability") is not None
    ]
    if len(valid_predictions) >= 3:
        scores["predictions"] = 5
    elif len(valid_predictions) >= 2:
        scores["predictions"] = 4
    elif len(valid_predictions) >= 1:
        scores["predictions"] = 3
    else:
        scores["predictions"] = 1

    # 7. Break price: Is it present with methodology?
    bp = assessment.get("break_price_estimate", {})
    if isinstance(bp, dict) and bp.get("value") and bp.get("anchors"):
        scores["break_price"] = 5
    elif isinstance(bp, dict) and bp.get("value"):
        scores["break_price"] = 3
    else:
        scores["break_price"] = 1

    total = sum(scores.values()) / len(scores) if scores else 0
    return {
        "total": round(total, 2),
        "scores": scores,
        "num_dimensions": len(scores),
    }


def compare_assessments(a: dict, b: dict) -> dict:
    """Compare two assessments for consistency."""
    if not a or not b:
        return {"consistent": False, "reason": "Missing assessment"}

    diffs = []

    # Compare grades
    a_grades = a.get("grades", {})
    b_grades = b.get("grades", {})
    for factor in ["vote", "financing", "legal", "regulatory", "mac"]:
        ag = a_grades.get(factor, {}).get("grade", "")
        bg = b_grades.get(factor, {}).get("grade", "")
        if ag != bg:
            diffs.append(f"{factor}: {ag} vs {bg}")

    # Compare scores
    a_scores = a.get("supplemental_scores", {})
    b_scores = b.get("supplemental_scores", {})
    for factor in ["market", "timing", "competing_bid"]:
        as_ = a_scores.get(factor, {}).get("score", -1)
        bs_ = b_scores.get(factor, {}).get("score", -1)
        if abs(as_ - bs_) > 1:
            diffs.append(f"{factor} score: {as_} vs {bs_}")

    # Compare probability
    a_prob = a.get("probability_of_success", {})
    b_prob = b.get("probability_of_success", {})
    a_val = a_prob.get("value", 0) if isinstance(a_prob, dict) else a_prob
    b_val = b_prob.get("value", 0) if isinstance(b_prob, dict) else b_prob
    try:
        prob_diff = abs(float(a_val) - float(b_val))
        if prob_diff > 5:
            diffs.append(f"probability: {a_val} vs {b_val} (delta={prob_diff:.1f}pp)")
    except (TypeError, ValueError):
        pass

    return {
        "grade_diffs": len([d for d in diffs if ":" in d and "score" not in d and "prob" not in d]),
        "score_diffs": len([d for d in diffs if "score" in d]),
        "prob_diff": prob_diff if 'prob_diff' in dir() else None,
        "all_diffs": diffs,
        "consistent": len(diffs) == 0,
    }


def compute_api_cost(input_tokens: int, output_tokens: int) -> float:
    """Compute what this would cost via Opus API."""
    return (input_tokens * OPUS_INPUT_PRICE_PER_TOKEN +
            output_tokens * OPUS_OUTPUT_PRICE_PER_TOKEN)


def run_experiment(prompts: dict, include_consistency: bool = False,
                   resume_results: dict | None = None) -> dict:
    """Run the full experiment."""
    system_prompt = prompts["system_prompt"]
    deals = prompts["deals"]

    results = resume_results or {
        "experiment_start": datetime.now().isoformat(),
        "model": CLI_MODEL,
        "system_prompt_chars": len(system_prompt),
        "system_prompt_est_tokens": len(system_prompt) // 4,
        "deal_results": {},
        "consistency_results": {},
        "summary": {},
    }

    # Phase 1: Main experiment (5 deals × 3 effort levels = 15 calls)
    print("\n" + "=" * 70)
    print("PHASE 1: Main Experiment (5 deals × 3 effort levels)")
    print("=" * 70)

    for ticker, deal_info in deals.items():
        if "error" in deal_info:
            print(f"\nSkipping {ticker}: {deal_info['error']}")
            continue

        if ticker not in results["deal_results"]:
            results["deal_results"][ticker] = {
                "deal_info": {
                    "acquirer": deal_info["acquirer"],
                    "deal_price": deal_info["deal_price"],
                    "current_price": deal_info["current_price"],
                    "category": deal_info["category"],
                    "vote_risk": deal_info["vote_risk"],
                    "prompt_est_tokens": deal_info["prompt_est_tokens"],
                },
                "efforts": {},
            }

        for effort in EFFORT_LEVELS:
            if effort in results["deal_results"][ticker]["efforts"]:
                print(f"\n  [{ticker}/{effort}] Already done, skipping")
                continue

            print(f"\n{'─' * 50}")
            print(f"  {ticker} ({deal_info['acquirer']}) @ effort={effort}")
            print(f"{'─' * 50}")

            result = call_claude_cli(
                system_prompt, deal_info["user_prompt"], effort, ticker
            )

            if result["success"]:
                quality = score_assessment_quality(
                    result.get("assessment"), ticker, deal_info
                )
                api_cost = compute_api_cost(
                    result["input_tokens"], result["output_tokens"]
                )
                result["quality_score"] = quality
                result["hypothetical_api_cost"] = round(api_cost, 4)
                result["cli_cost"] = 0.0

                print(f"  ✓ {result['elapsed_s']}s | "
                      f"JSON valid: {result['json_valid']} | "
                      f"Quality: {quality['total']:.1f}/5 | "
                      f"API would cost: ${api_cost:.4f}")
            else:
                print(f"  ✗ {result['error']}")

            results["deal_results"][ticker]["efforts"][effort] = result

            # Save after each call in case of interruption
            _save_results(results)

    # Phase 2: Consistency (2 deals × 2 effort levels × 1 repeat = 4 extra calls)
    if include_consistency:
        print("\n" + "=" * 70)
        print("PHASE 2: Consistency Check (2 deals × 2 effort levels × 1 repeat)")
        print("=" * 70)

        consistency_tickers = ["CFLT", "NVRI"]  # Clean deal + complex deal
        consistency_efforts = ["medium", "max"]  # Extremes

        for ticker in consistency_tickers:
            if ticker not in deals or "error" in deals[ticker]:
                continue
            for effort in consistency_efforts:
                key = f"{ticker}_{effort}_repeat"
                if key in results["consistency_results"]:
                    print(f"\n  [{key}] Already done, skipping")
                    continue

                print(f"\n{'─' * 50}")
                print(f"  REPEAT: {ticker} @ effort={effort}")
                print(f"{'─' * 50}")

                result = call_claude_cli(
                    system_prompt, deals[ticker]["user_prompt"], effort, ticker
                )

                if result["success"] and result.get("assessment"):
                    quality = score_assessment_quality(
                        result.get("assessment"), ticker, deals[ticker]
                    )
                    result["quality_score"] = quality

                    # Compare with original
                    original = results["deal_results"].get(ticker, {}).get(
                        "efforts", {}
                    ).get(effort, {})
                    if original.get("assessment"):
                        consistency = compare_assessments(
                            original["assessment"], result["assessment"]
                        )
                        result["consistency_vs_original"] = consistency
                        print(f"  ✓ {result['elapsed_s']}s | "
                              f"Quality: {quality['total']:.1f}/5 | "
                              f"Diffs from original: {len(consistency['all_diffs'])}")
                    else:
                        print(f"  ✓ {result['elapsed_s']}s | "
                              f"Quality: {quality['total']:.1f}/5 | "
                              f"No original to compare")
                else:
                    error = result.get("error", "Unknown error")
                    print(f"  ✗ {error}")

                results["consistency_results"][key] = result
                _save_results(results)

    # Phase 3: Compute summary
    _compute_summary(results)
    _save_results(results)

    return results


def _compute_summary(results: dict):
    """Compute experiment summary statistics."""
    summary = {
        "by_effort": {},
        "total_calls": 0,
        "total_time_s": 0,
        "total_hypothetical_api_cost": 0,
    }

    for effort in EFFORT_LEVELS:
        effort_data = {
            "latencies_s": [],
            "quality_scores": [],
            "json_valid_count": 0,
            "total_count": 0,
            "failures": 0,
        }

        for ticker, deal_data in results.get("deal_results", {}).items():
            result = deal_data.get("efforts", {}).get(effort)
            if not result:
                continue

            effort_data["total_count"] += 1
            if result.get("success"):
                effort_data["latencies_s"].append(result["elapsed_s"])
                if result.get("json_valid"):
                    effort_data["json_valid_count"] += 1
                if result.get("quality_score"):
                    effort_data["quality_scores"].append(
                        result["quality_score"]["total"]
                    )
                summary["total_hypothetical_api_cost"] += result.get(
                    "hypothetical_api_cost", 0
                )
            else:
                effort_data["failures"] += 1

            summary["total_calls"] += 1
            summary["total_time_s"] += result.get("elapsed_s", 0)

        if effort_data["latencies_s"]:
            effort_data["avg_latency_s"] = round(
                sum(effort_data["latencies_s"]) / len(effort_data["latencies_s"]), 1
            )
            effort_data["min_latency_s"] = min(effort_data["latencies_s"])
            effort_data["max_latency_s"] = max(effort_data["latencies_s"])

        if effort_data["quality_scores"]:
            effort_data["avg_quality"] = round(
                sum(effort_data["quality_scores"]) / len(effort_data["quality_scores"]),
                2,
            )
            effort_data["min_quality"] = min(effort_data["quality_scores"])
            effort_data["max_quality"] = max(effort_data["quality_scores"])

        effort_data["json_compliance_pct"] = round(
            100 * effort_data["json_valid_count"] / max(1, effort_data["total_count"]),
            1,
        )

        summary["by_effort"][effort] = effort_data

    # Consistency summary
    if results.get("consistency_results"):
        consistency_diffs = []
        for key, result in results["consistency_results"].items():
            cv = result.get("consistency_vs_original", {})
            if cv:
                consistency_diffs.append(len(cv.get("all_diffs", [])))

        if consistency_diffs:
            summary["consistency"] = {
                "avg_diffs": round(sum(consistency_diffs) / len(consistency_diffs), 1),
                "max_diffs": max(consistency_diffs),
                "fully_consistent_pct": round(
                    100 * consistency_diffs.count(0) / len(consistency_diffs), 1
                ),
            }

    # Overnight estimate (40 deals)
    for effort, data in summary["by_effort"].items():
        if data.get("avg_latency_s"):
            overnight_est_min = round(40 * data["avg_latency_s"] / 60, 0)
            data["overnight_40_deals_est_min"] = overnight_est_min

    summary["total_hypothetical_api_cost"] = round(
        summary["total_hypothetical_api_cost"], 2
    )

    results["summary"] = summary


def _save_results(results: dict):
    """Save results to file (incremental save after each call)."""
    # Remove raw_text from saved results to keep file manageable
    clean = json.loads(json.dumps(results, default=str))
    for ticker_data in clean.get("deal_results", {}).values():
        for effort_data in ticker_data.get("efforts", {}).values():
            if "raw_text" in effort_data:
                effort_data["raw_text_length"] = len(effort_data["raw_text"])
                del effort_data["raw_text"]
    for key, cons_data in clean.get("consistency_results", {}).items():
        if "raw_text" in cons_data:
            cons_data["raw_text_length"] = len(cons_data["raw_text"])
            del cons_data["raw_text"]

    with open(RESULTS_FILE, "w") as f:
        json.dump(clean, f, indent=2)


def print_summary(results: dict):
    """Print a human-readable experiment summary."""
    summary = results.get("summary", {})

    print("\n" + "=" * 70)
    print("EXPERIMENT SUMMARY")
    print("=" * 70)

    print(f"\nTotal calls: {summary.get('total_calls', 0)}")
    print(f"Total time: {summary.get('total_time_s', 0):.0f}s "
          f"({summary.get('total_time_s', 0)/60:.1f} min)")
    print(f"Total hypothetical API cost: ${summary.get('total_hypothetical_api_cost', 0):.2f}")
    print(f"Actual CLI cost: $0.00 (Max subscription)")

    print("\n" + "-" * 70)
    print(f"{'Effort':<10} {'Avg Latency':>12} {'Avg Quality':>12} {'JSON %':>8} "
          f"{'40-Deal Est':>12}")
    print("-" * 70)

    for effort in EFFORT_LEVELS:
        data = summary.get("by_effort", {}).get(effort, {})
        lat = f"{data.get('avg_latency_s', 0):.1f}s"
        qual = f"{data.get('avg_quality', 0):.2f}/5"
        json_pct = f"{data.get('json_compliance_pct', 0):.0f}%"
        overnight = f"{data.get('overnight_40_deals_est_min', 0):.0f} min"
        print(f"{effort:<10} {lat:>12} {qual:>12} {json_pct:>8} {overnight:>12}")

    if summary.get("consistency"):
        c = summary["consistency"]
        print(f"\nConsistency: avg {c['avg_diffs']:.1f} diffs/repeat, "
              f"max {c['max_diffs']}, "
              f"{c['fully_consistent_pct']:.0f}% fully consistent")

    # Per-deal breakdown
    print("\n" + "-" * 70)
    print("PER-DEAL QUALITY SCORES")
    print("-" * 70)
    print(f"{'Ticker':<8} {'medium':>10} {'high':>10} {'max':>10} {'Best':>8}")
    print("-" * 70)

    for ticker, deal_data in results.get("deal_results", {}).items():
        efforts = deal_data.get("efforts", {})
        scores = {}
        for effort in EFFORT_LEVELS:
            e = efforts.get(effort, {})
            qs = e.get("quality_score", {}).get("total", 0)
            scores[effort] = qs

        best = max(scores, key=scores.get) if scores else "N/A"
        print(f"{ticker:<8} "
              f"{scores.get('medium', 0):>10.2f} "
              f"{scores.get('high', 0):>10.2f} "
              f"{scores.get('max', 0):>10.2f} "
              f"{best:>8}")

    # Recommendation
    print("\n" + "=" * 70)
    print("RECOMMENDATION")
    print("=" * 70)

    by_effort = summary.get("by_effort", {})
    med_qual = by_effort.get("medium", {}).get("avg_quality", 0)
    high_qual = by_effort.get("high", {}).get("avg_quality", 0)
    max_qual = by_effort.get("max", {}).get("avg_quality", 0)

    max_vs_high = max_qual - high_qual
    max_vs_med = max_qual - med_qual
    high_vs_med = high_qual - med_qual

    print(f"\nQuality differences:")
    print(f"  max vs high: {max_vs_high:+.2f} points")
    print(f"  max vs medium: {max_vs_med:+.2f} points")
    print(f"  high vs medium: {high_vs_med:+.2f} points")

    if max_vs_high >= 1.0:
        rec = "MAX effort — quality improvement ≥1 point over high"
    elif max_vs_high >= 0.5:
        rec = "HIGH effort — modest quality gain over high doesn't justify 2-5x latency"
    else:
        rec = "MEDIUM effort — minimal quality difference, fastest processing"

    med_time = by_effort.get("medium", {}).get("overnight_40_deals_est_min", 0)
    max_time = by_effort.get("max", {}).get("overnight_40_deals_est_min", 0)
    high_time = by_effort.get("high", {}).get("overnight_40_deals_est_min", 0)

    print(f"\nOvernight 40-deal estimates:")
    print(f"  medium: {med_time:.0f} min")
    print(f"  high: {high_time:.0f} min")
    print(f"  max: {max_time:.0f} min")
    print(f"\nRecommendation: {rec}")


def main():
    parser = argparse.ArgumentParser(description="CLI effort level experiment")
    parser.add_argument("--consistency", action="store_true",
                        help="Include consistency repeat calls")
    parser.add_argument("--resume", action="store_true",
                        help="Resume from partial results")
    args = parser.parse_args()

    if not PROMPTS_FILE.exists():
        print(f"Error: {PROMPTS_FILE} not found. Run extract_prompts.py first.")
        sys.exit(1)

    with open(PROMPTS_FILE) as f:
        prompts = json.load(f)

    print(f"Loaded prompts for {len(prompts['deals'])} deals")
    print(f"System prompt: {len(prompts['system_prompt'])} chars "
          f"(~{len(prompts['system_prompt'])//4} tokens)")

    resume_results = None
    if args.resume and RESULTS_FILE.exists():
        with open(RESULTS_FILE) as f:
            resume_results = json.load(f)
        completed = sum(
            1 for d in resume_results.get("deal_results", {}).values()
            for e in d.get("efforts", {}).values()
            if e.get("success")
        )
        print(f"Resuming from {completed} completed calls")

    results = run_experiment(
        prompts,
        include_consistency=args.consistency,
        resume_results=resume_results,
    )

    print_summary(results)
    print(f"\nFull results saved to: {RESULTS_FILE}")


if __name__ == "__main__":
    main()
