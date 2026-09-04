#!/usr/bin/env bash
# Run the public OpenVerdict auditor from anywhere, including through a
# symlink to this skill folder from any agent's skills directory.
#
# Usage: run.sh <claim link | claim id> [--base <url>] [--json <file>] [--out <file>] [--run <runId>] [--quiet]
#        run.sh --list [--base <url>] [--limit <n>] [--json <file>]   (the board: every claim, newest first)
# Exit codes come from scripts/audit-claim.ts: 0 pass (or unavailable),
# 1 at least one check FAILED, 2 input or fetch error. This wrapper exits 2
# on its own setup problems (no node, no node_modules).
set -euo pipefail

# Physical directory of this script: `pwd -P` follows the symlink, so the
# real skill folder is found even when it is linked from .claude/skills,
# .agents/skills or another agent's skills directory.
SKILL_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# Walk up to the repository root instead of counting levels, so the skill
# folder can move without breaking the launcher.
REPO="$SKILL_DIR"
while [ ! -f "$REPO/scripts/audit-claim.ts" ] && [ "$REPO" != "/" ]; do
  REPO="$(dirname "$REPO")"
done

if [ ! -f "$REPO/scripts/audit-claim.ts" ]; then
  # `npx skills add` copies the skill outside the repository, so say what to do.
  echo "audit-claim.ts not found above $SKILL_DIR: this skill is installed outside the OpenVerdict repository." >&2
  echo "Clone it, then run this launcher from skills/openverdict/scripts inside the clone:" >&2
  echo "  git clone https://github.com/Marcussy34/OpenVerdict.git && cd OpenVerdict && pnpm install" >&2
  echo "Without the repository, every read in SKILL.md is still a plain HTTPS GET against https://app.openverdict.info/api." >&2
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
echo "openverdict: repo $REPO" >&2

# Run from the repo root so relative --json and --out paths resolve there;
# the skill always passes absolute paths.
cd "$REPO"
exec node "$TSX" scripts/audit-claim.ts "$@"
