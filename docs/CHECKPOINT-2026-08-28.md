# Session checkpoint — 2026-08-28 (pre-compaction, supersedes 2026-08-27 checkpoint)

> Resume map for the post-/compact continuation. Repo is the source of truth;
> this file is the index. Next up per the user: (1) their full human E2E test,
> (2) website UI review + change requests, (3) hackathon submission + demo
> video prep. Companions: docs/STATUS.md, docs/demo/runbook.md (+ preserved
> demo-claim table), docs/demo/video-script.md, docs/demo/workshop-brief.md,
> plan ledger in docs/superpowers/plans/2026-08-26-openverdict-build.md,
> design briefs 2026-08-27 (v1 light+Sui-blue) and 2026-08-28 (v2 globe).

## Where things stand (all pushed, latest d47dec0)

- **T8a COMPLETE**: canary 17 exit 0 on Sui testnet — 5/5 live SCHEMA_VALID
  across 3 model families, 5 commits + 5 reveals on-chain, **YES @ 9700 bps**
  (recompute == on-chain), certificate
  `0x8efdabe0900a3e4da39210394d211123ec82be6d176a51175adef7b8f41a8634`.
  All ids/request-ids preserved in the runbook table.
- **Redesign v2 LIVE**: "Agentic Resolution" three.js globe hero
  (components/globe/{land-dots,network,swarm-scene,swarm-globe}) — 2,924
  land dots, 26 nodes, 70 arc ribbons, 6 draw calls, 17.4s phase cycle
  (INGEST→GATHER→CROSS-CHECK→SEAL→SETTLE), HUD chips show REAL
  /api/claims + /api/agents rows, "Settled on Sui" only when true.
  Night slabs bookend the light + Sui-blue v1 system. Lazy-mount,
  DPR≤1.75, frameloop demand offscreen, reduced-motion collapse (+ fixed a
  repo-wide reduced-motion hydration mismatch in reveal components).
- **zkLogin onboarding VERIFIED BY THE USER** end to end. Fix chain that got
  there: Google redirect URI needs EXACTLY `http://localhost:3000/`
  (trailing slash; origins take none) → browser Sui clients moved to
  JSON-RPC publicnode (fullnode.testnet.sui.io is TLS-blocked here) →
  Enoki Portal needed the Google client id added under Auth Providers
  (error was enoki 400 invalid_client_id) → redirectUrl pinned to
  `origin + "/"` in providers.tsx so ANY page works (user may delete the
  interim `/agents` redirect entry in Google console).
- **Sign-in UX (user-directed)**: compact Google-only dialog (no wallet
  chooser; Phantom hidden). Wallet identified via isEnokiWallet +
  isGoogleWallet feature guards (security review caught name-matching
  spoofability). Explainer line removed per user.
- **Copy tightened (user-directed)**: landing/pipeline/footer at ~half the
  words, same claims. Do NOT reinflate.
- **Gonka MiniMax fixed**: extractJsonObject rewritten (strip <think>,
  top-level scan, prefer last candidate with "outcome"; old backward scan
  returned a nested trace entry) + system prompt pins the `reasoning` field.
  Live-verified SCHEMA_VALID. 236/236 vitest.
- **Canary hardening landed** (scripts/testnet-canary.ts): deterministic
  lowest-objectId cap pick, evidence re-freeze after selection (abort 21),
  acceptance-window wait (abort 20), transient-RPC retry wrapper,
  15-min commit profile; scripts/prune-registry.ts deactivated 25 stale
  registry records (32→7 active, digest EfYoDo2…). Root cause of the whole
  abort saga: serializeRunApprovals used to ALSO rebase deadlines — now
  split; rebaseDeadlinesForLocalLifecycle is separate and localnet-only.
- **Deploy**: universal Dockerfile + .dockerignore (secrets/git excluded,
  runs as node user). Railway remains the target per user; 6 uploads stuck
  at "scheduling build on Metal builder builder-nwedvx" — ONLY the
  dashboard builder flip (user) or support unsticks it; `railway config
  migrate --apply` crashes (their CLI bug), stay on railway.json.
- Docs/README fully truthed (screenshot gallery, live certificate links,
  counts 236/66).

## Running processes RIGHT NOW (survive compaction; restart block below)

- Local Sui chain (`sui start`, SUI_CONFIG_DIR=.localnet/sui-config) — the
  cockpit chain, package 0xba3ddc…, 7 agents registered.
- Docker Postgres (docker compose, db openverdict / openverdict-dev-only).
- Production-parity stack on :3000 — `node scripts/start-production.mjs`
  (next start + evidence/inference/resolution workers) with env:
  SUI_OPERATOR_SECRET_KEY=suiprivkey1qp82fu0kevmkg6j4lcm30rdtmvylpyyt82as9mzctlzs336n27r2g5zzuaq
  OPENVERDICT_AGENT_SEED=cockpit-demo-fixed-seed
  OPENVERDICT_RELEASE_MANIFEST=/Users/marcus/Projects/OpenVerdict/.localnet/release.runtime.json
  DATABASE_URL=postgres://openverdict:openverdict-dev-only@127.0.0.1:5432/openverdict
  OPENVERDICT_PUBLIC_WRITES=enabled
  Log: $SCRATCH/prod-stack.log. Restart = pkill start-production/next/workers,
  rebuild if code changed (pnpm build), relaunch same nohup line.
- Postgres DB holds 3 UNRESOLVED browser-era claims (0xe729…, 0x5590…,
  0x9b4f…) — artifacts of the worker-cadence bug, now fixed-in-code.

## OPEN ITEMS / next verifications

1. **Worker-driven scored verdict not yet re-proven**: 3 browser claims went
   UNRESOLVED (zero votes) from (a) short localnet ladder — FIXED, now
   6/8/9/12/14-minute defaults in engine.ts — and (b) worker gas contention
   (3 workers share the operator signer; equivocation stalls; ledger lists
   per-worker gas isolation as future work). The user's next form submission
   is the live test: expect commits+reveals+score in ~15 min. If reveals
   still starve, options: widen further, or single-writer worker mode.
2. **Railway builder flip** (user, dashboard) → then add
   `https://app-production-1a8a.up.railway.app` origin + `/`-suffixed
   redirect URI in Google console + Enoki allowed origins.
3. **T9 submission package**: video script ready (docs/demo/video-script.md,
   cockpit note included); record after user signs off on v2 UI. Workshop
   brief has judge links/answers.
4. UI review iterations from the user on v2 (globe hero etc.).
5. Flagged, optional: lucide-react unused dep; components/ui/progress.tsx
   unused; parallel jury inference; per-worker gas coins.

## Environment facts (do NOT relearn)

- *.sui.io TLS-blocked on this machine (curl/node/browser).
  publicnode JSON-RPC works: https://sui-testnet-rpc.publicnode.com (browser
  clients now use it too). Faucet needs the user's browser.
- pglite is single-writer: dev server + CLI/workers cannot share it —
  worker topology REQUIRES the Postgres DATABASE_URL path.
- `next dev` (3001) and `next build/start` share .next — don't rebuild while
  a design agent's dev server iterates.
- Bash run_in_background is sandboxed (no network); the working detached
  pattern is foreground-unsandboxed `nohup zsh -c '…' & disown` + Monitor
  on an exit file.
- IDE diagnostics in this session LAG edits badly — trust
  `pnpm typecheck` / `lint` / `build` only.
- OAuth: origins WITHOUT trailing slash, redirect URIs WITH; Enoki portal
  must list the Google client id; app pins redirect to origin+/.
- Localnet jury aborts: 7=deadline passed, 20=acceptance not reached
  (selection + half-to-commit), 21=evidence not bound (re-freeze after
  selection binds seats). Registry E_REGISTRY_FULL=4.
- GonkaRouter: had a ~1h raw-502 outage on 08-27; 403 on python-urllib UA
  (curl fine); 4096-token output cap; devshard-… request ids.
- Operator 0xff3538d73840319aa0439ca047118b584a423b48c94ac0776f6cef25d73b9e1a
  holds ~20 SUI (devrel top-up). Relay wallet key: .testnet/relay.key.
- .env (gitignored, NEVER commit) has all 9 secrets incl. Gonka key +
  Enoki public key + Google client id + operator token.

## Resume protocol after /compact

Read this file + docs/STATUS.md + the plan ledger. Verify the :3000 stack
answers (/api/status); if dead, relaunch per the block above. Then continue
the three user tracks: E2E test support, UI iterations, submission/demo prep.
