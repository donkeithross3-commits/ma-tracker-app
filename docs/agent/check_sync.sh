#!/usr/bin/env bash
#
# check_sync.sh -- Verify that the agent contract files are in sync
# across both repos (ma-tracker-app and py_proj).
#
# Usage:
#   docs/agent/check_sync.sh [OTHER_REPO_PATH]
#
# If OTHER_REPO_PATH is not provided, the script auto-detects the sibling repo.
# Exit 0 = all in sync. Exit 1 = drift detected or errors.

set -euo pipefail

# --- Detect which repo we're in -------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -f "$REPO_ROOT/package.json" ]; then
    THIS_REPO="ma-tracker-app"
    SIBLING_NAME="py_proj"
elif [ -f "$REPO_ROOT/KRJ_backtester_updated.py" ]; then
    THIS_REPO="py_proj"
    SIBLING_NAME="ma-tracker-app"
else
    echo "ERROR: Cannot detect repo type. Expected package.json (ma-tracker-app) or KRJ_backtester_updated.py (py_proj) in $REPO_ROOT"
    exit 1
fi

# --- Resolve the other repo -----------------------------------------------

if [ $# -ge 1 ]; then
    OTHER_REPO="$(cd "$1" && pwd)"
else
    OTHER_REPO="$(cd "$REPO_ROOT/.." && pwd)/$SIBLING_NAME"
fi

if [ ! -d "$OTHER_REPO" ]; then
    echo "ERROR: Sibling repo not found at $OTHER_REPO"
    echo "       Provide the path as an argument: $0 /path/to/$SIBLING_NAME"
    exit 1
fi

echo "=== Agent Contract Sync Check ==="
echo "This repo:    $THIS_REPO ($REPO_ROOT)"
echo "Sibling repo: $SIBLING_NAME ($OTHER_REPO)"
echo ""

# --- Markers ---------------------------------------------------------------

BEGIN_MARKER='<!-- BEGIN SHARED BLOCK'
END_MARKER='<!-- END SHARED BLOCK -->'

# --- Helper: extract shared block from a file ------------------------------

extract_shared_block() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "__FILE_MISSING__"
        return
    fi
    # Use awk to extract lines between markers (exclusive of markers)
    awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
        index($0, begin) { found=1; next }
        index($0, end)   { found=0; next }
        found { print }
    ' "$file"
}

# --- Tracking results ------------------------------------------------------

PASS=0
FAIL=0
ERRORS=0

report() {
    local status="$1"
    local description="$2"
    if [ "$status" = "PASS" ]; then
        echo "  [PASS] $description"
        PASS=$((PASS + 1))
    elif [ "$status" = "FAIL" ]; then
        echo "  [FAIL] $description"
        FAIL=$((FAIL + 1))
    else
        echo "  [ERROR] $description"
        ERRORS=$((ERRORS + 1))
    fi
}

# --- Check 1: SHARED_BLOCK.md matches between repos -----------------------

echo "--- Shared files (must be identical across repos) ---"

SHARED_A="$REPO_ROOT/docs/agent/SHARED_BLOCK.md"
SHARED_B="$OTHER_REPO/docs/agent/SHARED_BLOCK.md"

if [ ! -f "$SHARED_A" ]; then
    report "ERROR" "SHARED_BLOCK.md missing in $THIS_REPO"
elif [ ! -f "$SHARED_B" ]; then
    report "ERROR" "SHARED_BLOCK.md missing in $SIBLING_NAME"
elif diff -q "$SHARED_A" "$SHARED_B" > /dev/null 2>&1; then
    report "PASS" "SHARED_BLOCK.md identical across repos"
else
    report "FAIL" "SHARED_BLOCK.md differs between repos"
fi

# --- Check 2: AGENTS.md matches between repos -----------------------------

AGENTS_A="$REPO_ROOT/docs/agent/AGENTS.md"
AGENTS_B="$OTHER_REPO/docs/agent/AGENTS.md"

if [ ! -f "$AGENTS_A" ]; then
    report "ERROR" "AGENTS.md missing in $THIS_REPO"
elif [ ! -f "$AGENTS_B" ]; then
    report "ERROR" "AGENTS.md missing in $SIBLING_NAME"
elif diff -q "$AGENTS_A" "$AGENTS_B" > /dev/null 2>&1; then
    report "PASS" "AGENTS.md identical across repos"
else
    report "FAIL" "AGENTS.md differs between repos"
fi

# --- Check 3: Shared block in each instruction file vs canonical -----------

echo ""
echo "--- Shared block embedded in instruction files ---"

CANONICAL_BLOCK=$(cat "$SHARED_A" 2>/dev/null || echo "__FILE_MISSING__")

check_embedded_block() {
    local repo_label="$1"
    local file_path="$2"
    local file_basename
    file_basename="$(basename "$file_path")"

    if [ "$CANONICAL_BLOCK" = "__FILE_MISSING__" ]; then
        report "ERROR" "Cannot check $repo_label/$file_basename -- canonical SHARED_BLOCK.md missing"
        return
    fi

    local extracted
    extracted="$(extract_shared_block "$file_path")"

    if [ "$extracted" = "__FILE_MISSING__" ]; then
        report "ERROR" "$repo_label/$file_basename -- file not found"
        return
    fi

    if [ -z "$extracted" ]; then
        report "FAIL" "$repo_label/$file_basename -- shared block markers not found"
        return
    fi

    if diff <(echo "$CANONICAL_BLOCK") <(echo "$extracted") > /dev/null 2>&1; then
        report "PASS" "$repo_label/$file_basename shared block matches canonical"
    else
        report "FAIL" "$repo_label/$file_basename shared block has drifted from canonical"
    fi
}

# This repo's instruction files
check_embedded_block "$THIS_REPO" "$REPO_ROOT/.cursorrules"
check_embedded_block "$THIS_REPO" "$REPO_ROOT/CLAUDE.md"

# Sibling repo's instruction files
check_embedded_block "$SIBLING_NAME" "$OTHER_REPO/.cursorrules"
check_embedded_block "$SIBLING_NAME" "$OTHER_REPO/CLAUDE.md"

# --- Check 4: README.md matches between repos (if it exists) --------------

echo ""
echo "--- Other synced files ---"

README_A="$REPO_ROOT/docs/agent/README.md"
README_B="$OTHER_REPO/docs/agent/README.md"

if [ ! -f "$README_A" ] && [ ! -f "$README_B" ]; then
    report "PASS" "README.md not yet created in either repo (OK)"
elif [ ! -f "$README_A" ]; then
    report "FAIL" "README.md exists in $SIBLING_NAME but missing in $THIS_REPO"
elif [ ! -f "$README_B" ]; then
    report "FAIL" "README.md exists in $THIS_REPO but missing in $SIBLING_NAME"
elif diff -q "$README_A" "$README_B" > /dev/null 2>&1; then
    report "PASS" "README.md identical across repos"
else
    report "FAIL" "README.md differs between repos"
fi

# check_sync.sh itself
SYNC_A="$REPO_ROOT/docs/agent/check_sync.sh"
SYNC_B="$OTHER_REPO/docs/agent/check_sync.sh"

if [ ! -f "$SYNC_A" ]; then
    report "ERROR" "check_sync.sh missing in $THIS_REPO"
elif [ ! -f "$SYNC_B" ]; then
    report "FAIL" "check_sync.sh exists in $THIS_REPO but missing in $SIBLING_NAME"
elif diff -q "$SYNC_A" "$SYNC_B" > /dev/null 2>&1; then
    report "PASS" "check_sync.sh identical across repos"
else
    report "FAIL" "check_sync.sh differs between repos"
fi

# --- Summary ---------------------------------------------------------------

echo ""
echo "=== Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Errors: $ERRORS"

if [ $FAIL -gt 0 ] || [ $ERRORS -gt 0 ]; then
    echo ""
    echo "DRIFT DETECTED -- run the sync protocol (see docs/agent/README.md)"
    exit 1
else
    echo ""
    echo "All files in sync."
    exit 0
fi
