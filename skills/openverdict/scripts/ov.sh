#!/usr/bin/env bash
# Run the public `ov` CLI from anywhere, including through a symlink to
# this skill folder from any agent's skills directory.
#
# Usage: ov.sh <command> [options]
#        commands: weather, board (claims), agents, agent, extract, submit,
#                  status, watch, audit, trace, help
# Exit codes come from scripts/ov.ts: 0 success, 2 input or request error,
# 3 the claim voided or gave up (watch), 4 watch stopped before the end,
# 5 rate limited or writes disabled. This wrapper exits 2 on its own setup
# problems (no node, no node_modules).
set -euo pipefail

# Physical directory of this script: `pwd -P` follows the symlink, so the
# real skill folder is found even when it is linked from .claude/skills,
# .agents/skills or another agent's skills directory.
SKILL_DIR="$(cd "$(dirname "$0")" && pwd -P)"
# Walk up to the repository root instead of counting levels, so the skill
# folder can move without breaking the launcher.
REPO="$SKILL_DIR"
while [ ! -f "$REPO/scripts/ov.ts" ] && [ "$REPO" != "/" ]; do
  REPO="$(dirname "$REPO")"
done

if [ ! -f "$REPO/scripts/ov.ts" ]; then
  # `npx skills add` copies the skill outside the repository, so say what to do.
  echo "ov.ts not found above $SKILL_DIR: this skill is installed outside the OpenVerdict repository." >&2
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

# Run from the repo root so relative --out and --json paths (audit) resolve
# there; the skill always passes absolute paths.
cd "$REPO"
exec node "$TSX" scripts/ov.ts "$@"
