# Session checkpoint — 2026-08-27 (pre-compaction handoff)

> Written so any session (or post-/compact continuation) can resume with zero
> conversational context. Repo state is the source of truth; this file is the
> map. Companion docs: docs/STATUS.md, docs/demo/runbook.md, plan ledger in
> docs/superpowers/plans/2026-08-26-openverdict-build.md, PRD §1.1 addendum.

## Where the product stands

- ~80 commits on `main`, all pushed to github.com/Marcussy34/OpenVerdict.
- Code-complete + operationally proven OFFLINE: `pnpm e2e:localnet` **exits 0**
  (verified twice independently): 3 lifecycle paths on a real local chain,
  sponsored deposit, CLI parity, recomputed-vs-on-chain Truth Score.
- Gates when tree is green: 222/222 vitest, 66/66 Move, typecheck, lint, build.
- **Tree currently typecheck-RED on purpose** (see Uncommitted below).
- LIVE ON TESTNET: package `0xb411210a52dad799b9b4a53e3a44b30c3c8b8a3b1981795f830166533a474c1d`,
  registry `0x9036764a06e5a0c1df445665fd7fc5ddb3326a30603e1eb188347ab8096afe05`,
  publish digest `6RfnhZDHzk7NNNvCJqT5Cf2Z4aUjddbA6hJ9WsMe7ULL`
  (suiscan.xyz/testnet). ~21 agent profiles registered across canary attempts.
- Live GonkaRouter VERIFIED with the user's key: catalog =
  deepseek-ai/DeepSeek-V4-Flash-0731, MiniMaxAI/MiniMax-M2.7,
  moonshotai/Kimi-K2.6; request ids look like `devshard-…` on
  /v1/chat/completions (preserved verbatim). Canary 7 captured REAL request
  ids with 3/5 SCHEMA_VALID before deadline abort.

## Credentials & config (all in gitignored `.env`, 9 vars)

- Operator `0xff3538d73840319aa0439ca047118b584a423b48c94ac0776f6cef25d73b9e1a`
  (SUI_OPERATOR_SECRET_KEY) — **BALANCE ~0.0025 SUI = THE BLOCKER** for the
  live canary. Agents (fixed OPENVERDICT_AGENT_SEED, 7 deterministic
  addresses) hold ~0.097 total.
- GONKA_ROUTER_API_KEY (live, working), GONKA_REQUEST_TIMEOUT_MS=240000.
- NEXT_PUBLIC_ENOKI_API_KEY (public key, ZKLOGIN feature, DEVNET+TESTNET),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID (239114829141-….apps.googleusercontent.com).
- OPENVERDICT_OPERATOR_TOKEN (generated, also set on Railway).

## In-flight tracks at checkpoint time

1. **T7b zkLogin-backed registration** — Codex worker `codex-zkseat` running
   (dispatched with full spec; seam already in lib/engine/contract.ts).
   It reports back as a teammate message; gate + merge + commit its diff, THEN
   the tree goes green again.
2. **Cockpit demo harness** — `scripts/cockpit-demo.ts` third run in flight
   (monitor watches `$SCRATCH/cockpit.exit`; SCRATCH =
   /private/tmp/claude-501/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e/scratchpad).
   On success it prints STATE READY + env exports; then: run `pnpm dev` with
   those env values and screenshot all pages via Chrome tools into
   docs/screenshots/, fix visual issues, commit. Fixes already applied during
   iteration: faucet-readiness probe, 10s acceptance-window waits after
   selectCommittee.
3. **Railway** — project `openverdict` (id 86552004-2d37-45bd-8a08-34ae91fef9ca)
   in workspace "Predictefy's Projects" (personal workspace trial expired);
   services Postgres + app; ALL env vars set incl.
   DATABASE_URL=${{Postgres.DATABASE_URL}}; domain
   **https://app-production-1a8a.up.railway.app**. Three `railway up` builds
   stuck at "scheduling build on Metal builder" — check
   `railway logs --build --service app`; if still stuck, flip builder in the
   dashboard (Settings→Build) or retry `railway up --service app --detach`.
4. **Live testnet canary** — `scripts/testnet-canary.ts` READY (agent
   discovery/reuse, prompt hardening, JSON extraction, 240s timeouts, wide
   deadlines) but **gas-blocked**. Morning: user faucets the operator address
   (faucet.sui.io, 2–3 rounds), then:
   `nohup zsh -c 'OPENVERDICT_DEBUG_DEADLINES=1 pnpm tsx scripts/testnet-canary.ts > $SCRATCH/canary9.log 2>&1; echo $? > $SCRATCH/canary9.exit' & disown`
   Success = summary table with 5 request ids + certificate; then fill
   docs/demo/runbook.md table + STATUS/README updates.

## Uncommitted on purpose (tree red until T7b merges)

- `lib/engine/contract.ts` — T7b seam added (`registerZkBackedAgent` +
  ZkBackedRegistration types). Engine typecheck fails until the worker
  implements it. Commit together with the worker's diff.
- `scripts/cockpit-demo.ts` — iterating; commit once STATE READY run works.
- `.testnet/`, `.localnet/`, `.pglite` runtime dirs — gitignored.

## Hard-won environment facts (do NOT relearn these)

- **This machine's network mangles TLS to Mysten hosts** (`*.sui.io`,
  faucet, fullnode): curl exit 35 / node "packet length too long". WORKS:
  `https://sui-testnet-rpc.publicnode.com` (JSON-RPC). Railway's cloud is
  unaffected. Faucet needs the user's browser.
- `sui start` (CLI 1.52.2) serves **JSON-RPC only on 9000 — NO gRPC**
  ("Not Found"); localnet must use SuiJsonRpcClient (transport-agnostic
  client.core refactor merged). GraphQL flag exists but needs indexer+PG.
- Bash tool: `run_in_background` + `dangerouslyDisableSandbox` DO NOT compose
  (background stays sandboxed = no network). Pattern that works:
  foreground-unsandboxed `nohup zsh -c '…' & disown` + Monitor on an exit
  file.
- Codex worker wrappers die at ~10 min unless the companion runs as a
  detached OS process; killed clients leave phantom "running" jobs — check
  pid liveness + `updatedAt`, `cancel` the phantom, resume via continuation.
- Localnet faucet (9123) comes up AFTER the RPC (9000) — probe both.
- Move aborts hit so far: jury 7=E_DEADLINE_PASSED (commit deadline),
  20=E_DEADLINE_NOT_REACHED (acceptance window = selection + half-way-to-
  commit; wait ~10s after selectCommittee on the fast profile),
  agent_registry 4=E_REGISTRY_FULL (fixed via canary agent discovery/reuse).
- Live-model realities fixed in lib/gonka: models invent enum values (prompt
  now spells the full contract), MiniMax emits reasoning prose around JSON
  (balanced-JSON extractor `extractJsonObject`), Kimi needs 240s.
- **Unsolved oddity**: canary 7's claim got ~85s-scale deadlines despite the
  file specifying 20min; isolated probe of the identical path stored exactly
  1200s on-chain. Suspected stale process; canary runs now instrumented via
  `OPENVERDICT_DEBUG_DEADLINES=1` — check the FCS lines in the next run's log.

## Remaining ladder to "user only tests"

1. Merge T7b (restores green tree) → commit contract.ts + worker diff + cockpit-demo.ts.
2. Cockpit visual pass → docs/screenshots/ + fixes.
3. Railway build unstuck → live URL green on /api/status → user adds URL to
   Google OAuth origins + Enoki allowed origins.
4. Morning faucet → canary 9 → runbook demo table + docs sweep (STATUS,
   README status board, PRD addendum if new corrections).
5. Final verification sweep + morning summary for the user
   (walkthrough = docs/demo/runbook.md §5).
