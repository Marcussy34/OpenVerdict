#!/usr/bin/env bash
# Run the public OpenVerdict auditor from anywhere, including through the
# global symlink at ~/.claude/skills/openverdict-audit.
#
# Usage: run.sh <claim link | claim id> [--base <url>] [--json <file>] [--out <file>] [--run <runId>] [--quiet]
# Exit codes come from scripts/audit-claim.ts: 0 pass (or unavailable),
# 1 at least one check FAILED, 2 input or fetch error. This wrapper exits 2
# on its own setup problems (no node, no node_modules).
set -euo pipefail

# Physical directory of this script: `pwd -P` follows the symlink, so the
# repo root is found even when the skill folder is linked from ~/.claude.
SKILL_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# The skill lives at <repo>/.claude/skills/openverdict-audit: three levels up.
REPO="$(cd "$SKILL_DIR/../../.." && pwd -P)"

if [ ! -f "$REPO/scripts/audit-claim.ts" ]; then
  echo "audit-claim.ts not found under $REPO/scripts; is the skill inside the OpenVerdict repo?" >&2
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

# One line of context for the caller; the dossier itself goes to stdout.
echo "openverdict-audit: repo $REPO" >&2

# Run from the repo root so relative --json and --out paths resolve there;
# the skill always passes absolute paths.
cd "$REPO"
exec node "$TSX" scripts/audit-claim.ts "$@"
