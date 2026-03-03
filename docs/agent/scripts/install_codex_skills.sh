#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SKILLS_SRC="$REPO_ROOT/docs/agent/skills"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
SKILLS_DEST="$CODEX_HOME_DIR/skills/dr3"

if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "Missing skill source directory: $SKILLS_SRC" >&2
  exit 1
fi

mkdir -p "$SKILLS_DEST"

for skill_dir in "$SKILLS_SRC"/*; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  dest="$SKILLS_DEST/$name"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$skill_dir"/. "$dest"/
done

echo "Installed DR3 skills to: $SKILLS_DEST"
