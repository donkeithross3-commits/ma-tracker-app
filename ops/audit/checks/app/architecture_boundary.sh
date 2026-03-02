#!/usr/bin/env bash
# Check: app/architecture_boundary
# Cadence: daily
# Severity ceiling: alert
#
# Validates that the portfolio container and FastAPI/IB service remain
# decoupled. Catches re-coupling before it reaches production.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../../bin/lib.sh"

init_check "app/architecture_boundary"

# Locate the repo root (works on droplet and local dev)
REPO_ROOT=""
for dir in "${HOME}/apps/ma-tracker-app" "${HOME}/dev/ma-tracker-app" "$(git rev-parse --show-toplevel 2>/dev/null || true)"; do
    if [[ -d "${dir}/python-service/app" ]]; then
        REPO_ROOT="$dir"
        break
    fi
done

if [[ -z "$REPO_ROOT" ]]; then
    json_finding "repo_not_found" "$SEV_WARN" "Could not locate ma-tracker-app repo"
    finalize_check
fi

PY_SERVICE="${REPO_ROOT}/python-service"
violations=0

# ─── Rule 1: main.py must NOT import or mount portfolio_router ───
if grep -qE 'portfolio_router|portfolio_routes' "${PY_SERVICE}/app/main.py" 2>/dev/null; then
    # Allow comments (lines starting with #)
    if grep -E 'portfolio_router|portfolio_routes' "${PY_SERVICE}/app/main.py" | grep -qvE '^\s*#'; then
        json_finding "main_imports_portfolio" "$SEV_ALERT" \
            "main.py imports or mounts portfolio_router. Portfolio routes must live exclusively in the portfolio container (port 8001)."
        (( violations++ ))
    fi
fi

# ─── Rule 2: portfolio code must NOT import from ..main ───
portfolio_files=(
    "${PY_SERVICE}/app/api/portfolio_routes.py"
    "${PY_SERVICE}/app/portfolio_main.py"
    "${PY_SERVICE}/app/scheduler/"
    "${PY_SERVICE}/app/portfolio/"
    "${PY_SERVICE}/app/services/"
)
for target in "${portfolio_files[@]}"; do
    if [[ -d "$target" ]]; then
        matches=$(grep -rlE 'from \.\.(main|scanner) import' "$target" 2>/dev/null || true)
    elif [[ -f "$target" ]]; then
        matches=$(grep -lE 'from \.\.(main|scanner) import' "$target" 2>/dev/null || true)
    else
        continue
    fi
    if [[ -n "$matches" ]]; then
        json_finding "portfolio_imports_main" "$SEV_ALERT" \
            "Portfolio code imports from main.py or scanner.py: ${matches}. This creates deployment coupling."
        (( violations++ ))
    fi
done

# ─── Rule 3: Dockerfile.portfolio must NOT copy scanner.py or tools/ ───
if [[ -f "${PY_SERVICE}/Dockerfile.portfolio" ]]; then
    if grep -qE 'COPY.*(scanner\.py|tools/)' "${PY_SERVICE}/Dockerfile.portfolio" 2>/dev/null; then
        json_finding "dockerfile_copies_ib_code" "$SEV_WARN" \
            "Dockerfile.portfolio copies IB/tools code (scanner.py or tools/) that the portfolio container doesn't need."
        (( violations++ ))
    fi
fi

# ─── Rule 4: position_tracker must NOT hardcode localhost:8000 ───
tracker="${PY_SERVICE}/app/scheduler/position_tracker.py"
if [[ -f "$tracker" ]]; then
    # Flag hardcoded localhost:8000 that isn't in a comment or default fallback
    if grep -qE '^[^#]*["\x27]http://localhost:8000' "$tracker" 2>/dev/null; then
        # Allow it as the default in os.environ.get() fallback
        if ! grep -qE 'os\.environ\.get.*localhost:8000' "$tracker" 2>/dev/null; then
            json_finding "hardcoded_localhost_8000" "$SEV_ALERT" \
                "position_tracker.py hardcodes localhost:8000. Must use FASTAPI_SERVICE_URL env var for Docker compatibility."
            (( violations++ ))
        fi
    fi
fi

# ─── Summary ───
if (( violations == 0 )); then
    log_info "Architecture boundary: all ${#portfolio_files[@]} rules pass [OK]"
fi

finalize_check
