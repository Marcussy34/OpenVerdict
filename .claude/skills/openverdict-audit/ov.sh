#!/usr/bin/env bash
# Run the public `ov` CLI from anywhere, including through the global
# symlink at ~/.claude/skills/openverdict-audit.
#
# Usage: ov.sh <command> [options]
#        commands: weather, board, extract, submit, queue, status, watch, audit, help
# Exit codes come from scripts/ov.ts: 0 success, 2 input or request error,
# 3 the claim voided or gave up (watch), 4 watch stopped before the end,
# 5 rate limited or writes disabled. This wrapper exits 2 on its own setup
# problems (no node, no node_modules).
set -euo pipefail

# Physical directory of this script: `pwd -P` follows the symlink, so the
# repo root is found even when the skill folder is linked from ~/.claude.
SKILL_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# The skill lives at <repo>/.claude/skills/openverdict-audit: three levels up.
REPO="$(cd "$SKILL_DIR/../../.." && pwd -P)"

if [ ! -f "$REPO/scripts/ov.ts" ]; then
  echo "ov.ts not found under $REPO/scripts; is the skill inside the OpenVerdict repo?" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed; install Node 20 or newer, then run pnpm install in $REPO" >&2
  exit 2
fi

# The repo's own tsx, started through node directly. Going through pnpm from
# another folder trips corepack's pinned-version check (the nvm shim refuses
# to run when its pnpm differs from package.json's packageManager), and a
# judge's machine may have no pnpm on PATH at all.
TSX="$REPO/node_modules/tsx/dist/cli.mjs"
if [ ! -f "$TSX" ]; then
  echo "run pnpm install in $REPO (node_modules/tsx is missing)" >&2
  exit 2
fi

# Run from the repo root so relative --out and --json paths (audit) resolve
# there; the skill always passes absolute paths.
cd "$REPO"
exec node "$TSX" scripts/ov.ts "$@"
