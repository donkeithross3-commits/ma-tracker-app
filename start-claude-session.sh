#!/bin/bash

# M&A Tracker - Claude Code Session Initializer
# Generates context prompt for starting a new Claude Code session

echo "==================================================="
echo "M&A Intelligence Tracker - Session Context"
echo "==================================================="
echo ""

# Current directory and git info
CURRENT_DIR=$(pwd)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "not a git repo")
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "no commits")

echo "📁 Directory: $CURRENT_DIR"
echo "🌿 Git Branch: $BRANCH"
echo "📝 Last Commit: $LAST_COMMIT"
echo ""

# Check for uncommitted changes
if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
    echo "✓ No uncommitted changes"
else
    echo "⚠️  Uncommitted changes detected:"
    git status --short 2>/dev/null
fi

echo ""
echo "==================================================="
echo "Session Context Prompt (copy below to Claude Code)"
echo "==================================================="
echo ""

# Generate context prompt
cat << 'PROMPT'
I'm continuing work on the M&A Intelligence Tracker project.

## Current State
PROMPT

echo "- **Directory:** $CURRENT_DIR"
echo "- **Git Branch:** $BRANCH"
echo "- **Last Commit:** $LAST_COMMIT"
echo ""

# Check if .claude-session exists
if [ -f ".claude-session" ]; then
    echo "## Session State"
    echo ""
    cat .claude-session
    echo ""
fi

# Service status
echo "## Service Status"
echo ""

# Check backend
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null | grep -q "200"; then
    echo "- **Backend (Python):** ✓ Running (http://localhost:8000)"
else
    echo "- **Backend (Python):** ✗ Not running"
fi

# Check frontend
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null | grep -q "200"; then
    echo "- **Frontend (Next.js):** ✓ Running (http://localhost:3000)"
else
    echo "- **Frontend (Next.js):** ✗ Not running"
fi

echo ""
echo "## Available Commands"
echo ""
echo "Use these slash commands for common workflows:"
echo "- \`/init\` - Initialize session with project context"
echo "- \`/verify\` - Verification mode (explore code)"
echo "- \`/bug-fix\` - Bug fix workflow"
echo "- \`/feature\` - Feature development workflow"
echo "- \`/db-migration\` - Database migration helper"
echo "- \`/monitor\` - Monitor service workflow"
echo ""

# Recent changes
echo "## Recent Changes"
echo ""
git log --oneline -5 2>/dev/null || echo "No git history available"
echo ""

echo "## What would you like to work on?"
echo ""

echo "==================================================="
echo ""
echo "📋 Prompt copied! Paste into Claude Code to start your session."
echo ""
echo "💡 Tip: Keep .claude-session updated with your progress."
echo "💡 Tip: Use slash commands (/init, /feature, etc.) for guided workflows."
echo ""
