# OpenVerdict — demo runbook

How to take the product from a clean checkout to a live, demoable state.
Filled-in ids for the preserved demo claim are appended at the bottom as each
milestone completes.

## 0. Prerequisites

Node ≥22, pnpm, Sui CLI ≥1.52. `pnpm install` at the repo root.

## 1. Offline proof (no network, no keys)

```bash
pnpm test && pnpm test:move   # 234 TS + 66 Move
pnpm e2e:localnet             # spawns a local Sui network, deploys, runs 3 full
                              # lifecycles + sponsored deposit, exits 0 on success
```

## 1b. Cockpit demo state (local, one command)

```bash
pnpm tsx scripts/cockpit-demo.ts   # ~3 min: localnet + deploy + 2 demo claims
```

Prints `STATE READY` plus exact env exports and leaves the chain running; then

```bash
SUI_OPERATOR_SECRET_KEY=<printed> OPENVERDICT_AGENT_SEED=cockpit-demo-fixed-seed \
OPENVERDICT_RELEASE_MANIFEST=.localnet/release.runtime.json pnpm dev
# pkill -f "sui start" when finished
```

Produces claim #1 FINALIZED (unanimous-lean YES, Truth Score 8850 bps, minted
certificate) and claim #2 SEALED mid-jury (five Blake2b-256 commitments
on-chain, unrevealed) so the report page, live observer, event stream, agents
directory and status page all render real chain-backed data.

## 2. Testnet deploy (T8a)

Operator address (generated 2026-08-27, key held in local .env only):
`0xff3538d73840319aa0439ca047118b584a423b48c94ac0776f6cef25d73b9e1a`

1. Fund it: paste the address at https://faucet.sui.io (any browser/network) —
   the only human-network step. NOTE: this machine's network path mangles TLS
   to *.sui.io Mysten endpoints; the deploy scripts fall back to
   `https://sui-testnet-rpc.publicnode.com` (JSON-RPC) which works from here.
2. `pnpm tsx scripts/deploy-testnet.ts` (adapts the localnet deploy; writes
   packageId/registryObjectId into config/release.testnet.json).
3. Canary: one full direct-review lifecycle against testnet, fake adapter
   unless `GONKA_ROUTER_API_KEY` is set. First run registers the 7 agents;
   later runs reuse them.
4. Publish the real juror manifests (proof chain v2, 2026-08-29). Each
   agent's on-chain `manifest_hash` must be the blake2b256 of a v2 manifest
   document on Walrus that embeds the exact prompt spec, otherwise `juryRun`
   fails closed ("does not match the engine prompt spec"):
   `pnpm tsx scripts/publish-agent-manifests.ts --dry-run`, then without the
   flag (7 `update_agent_manifest` txs signed by the agent keys, 7 Walrus
   blobs paid by the operator's WAL). Re-running is idempotent: profiles
   whose hash already matches are skipped.
5. Bind the hosted engine: `pnpm tsx scripts/seed-testnet-agents.ts`
   (with the production `DATABASE_URL`) rebuilds the agent rows from the
   chain + Walrus documents and refuses placeholder manifests.
6. Record explorer links below.

## 3. Live URL (T8)

Single host (2026-08-30): the website, its API and the three engine workers
run together on Railway, project `openverdict-workers`, service `app`
(Dockerfile build, `scripts/start-production.mjs` launches the web plus the
evidence, inference and resolution workers). The database is the Railway
Postgres service `Postgres` in the same project, reached over the private
network (`DATABASE_URL` is the reference `${{Postgres.DATABASE_URL}}`; no
public access; daily and weekly volume backups are scheduled; to reach it
from a laptop use `railway ssh -s app` or add a public TCP proxy in the
service's networking settings). Hosts: https://openverdict.info (landing,
plus www) and https://app.openverdict.info (dashboard; `proxy.ts` rewrites
the root of `app.` hosts to `/app`). DNS: the zone stays on Vercel
nameservers; apex ALIAS, www CNAME and app CNAME point at the Railway
domain targets, and Railway ownership is proven by `_railway-verify` TXT
records. Neon (both resources and the integration) and the Vercel project
were deleted on 2026-08-30; the Vercel account only keeps the domain and
its DNS zone now, so never remove the domain there without moving DNS
first. Env per
`.env.example` (operator key, agent seed, manifest=testnet, Gonka key,
Firecrawl key, operator token, `PORT=3000`, `OPENVERDICT_PUBLIC_WRITES=
enabled`, `OPENVERDICT_TRUST_PROXY=1`, `WALRUS_UPLOAD_RELAY_URL`,
`NEXT_PUBLIC_*` baked at build time through Dockerfile ARGs). Railway
reaches Mysten endpoints normally; the local TLS interference does not
apply there. Deploy: from a clean checkout of the commit
(`git checkout --detach <sha>` in a worktree) run `railway up -s app -d`,
then wait for SUCCESS in `railway deployment list -s app`. Worker ticks are
serialized with a transaction-level advisory lock; never switch it back to
a session lock, the pooler strands those.

## 4. Live inference (T8b — needs user key)

Set `GONKA_ROUTER_API_KEY` (free credit for new accounts at
gonkarouter.io/dashboard) and flip the manifest `gonka.mode` to `live`.
Also set `FIRECRAWL_API_KEY` (dedicated Firecrawl account) so jurors can
research: every seat searches and opens pages through the engine and must cite
a page it found itself (juror research v1, 2026-08-29).
Run one jury round; verify five real `devshard-…` ids across ≥3 model families.
Every run's proof is at `GET /api/claims/<id>/runs/<runId>/proof` (sealed
blob before reveal, plaintext bundle plus key after) and can be recomputed in
the browser on `/verify` (Run proof tab).

## 4b. Before a live demo on the hosted app (checklist)

1. Agent wallets: every seat transaction (accept, bind, commit, reveal) is
   signed and paid by the agent's own keypair. List owners with
   `curl https://openverdict.info/api/agents` and check each with
   `suix_getBalance`; below ~0.1 SUI a juror fails its bind and its commit
   aborts with `E_EVIDENCE_NOT_BOUND`. Top up from the operator (about
   0.6 SUI each lasts a night of claims): copy
   `fund-agents.mjs` (see the checkpoint doc) into `node_modules/.cache`
   and run `node node_modules/.cache/fund-agents.mjs 0.6 <owner...>` with
   `SUI_OPERATOR_SECRET_KEY` in the environment.
2. Operator: `suix_getAllBalances` for the operator address; keep a few SUI
   and a few WAL (every claim costs roughly 0.1 SUI plus Walrus storage).
   The testnet faucet (`faucet.testnet.sui.io`) is not reachable from the
   developer Mac (`*.sui.io` TLS); use the faucet web UI or a host that can.
3. `/api/status` reports suiHealthy, dbHealthy, gonkaMode live, walrusMode
   testnet; `railway logs -s app -d --lines 200` is quiet between claims
   (the workers skip finished and stuck claims, so a tick never spends a
   live claim's reveal window on dead ones).
4. Timeline of a hosted fact-check with the fast ladder (measured on
   claim #16, 2026-08-30 08:22, the first hosted YES verdict, certificate
   `0x62036142…`): POST returns after ~45 s (statement and criteria on
   Walrus, create_claim at ~t+20 s, statement artifact), committee at
   ~t+65 s, freeze ~t+100 s, research runs 4 to 72 s per seat, commits
   from the acceptance floor (~t+150 s) to ~t+200 s, advance ~10 s after
   the commit deadline (t+269 s), five reveals inside the 120 s reveal
   window (bundle writes are serialized on the operator lane, ~15 s each,
   then the reveal transactions go out in parallel: all five by t+337 s),
   certificate ~20 s after the reveal floor (t+404 s, 6.7 min). No
   threshold in round one adds a round two: certificate at ~t+765 s.
   Since juror research v2 (17:10) the commit window is 330 s, so a seat
   has about 230 s of research, the advance lands ~t+360 s, the
   certificate ~t+495 s (about 8.5 min), and a round two ends ~t+860 s.
5. Model health: Kimi-K2.6 on GonkaRouter was slow or failing most of the
   night (calls longer than the seat budget), then answered in 40 to 72 s on
   claim #15 (08:05, all five seats valid); DeepSeek-V4-Flash answers in 4
   to 30 s and MiniMax-M2.7 in 5 to 35 s. Four matching reveals out of five
   are needed for a verdict in a round (`REQUIRED_MATCHING = 4`), so a
   round survives at most one lost seat.
6. What to show on a run page (juror research v2, 2026-08-30 afternoon):
   the provenance strip (requested versus served model, devshard, vLLM
   fingerprint, gateway and Gonka request ids, tokens, latency, links to
   the run approval, commitment and reveal objects and transactions on
   Suiscan, the sealed and revealed blobs on Walrus); the research trail
   with a support search and a challenge search, the pages opened on each
   side, and any engine refusal (`CHALLENGE_REQUIRED`,
   `CORROBORATION_REQUIRED`) shown as an event; per turn, "what the model
   was sent" and "what the model said" with the node that answered; the
   system prompt and budgets with their hashes; evidence for and against
   the claim, the reasoning trace, the counter-evidence summary and the
   citations; and the full public bundle as JSON next to the recomputed
   hash checks. Jurors whose manifest is still version 3 show the v1 trail
   (one side is enough for them); the seven testnet jurors carry version
   4 manifests since the republish of 2026-08-30. Demo claims: #21
   `0x5629faca…` (YES 9750, certificate `0x8a5ab5ad…`, the first v2
   verdict: open any of its four revealed runs), #16 `0x9169c707…` (YES
   9860 under v1), #18 `0xb526116e…` and #19 `0xe46d6997…` (two-round
   UNRESOLVED with v2 trails).

## 5. Human end-to-end walkthrough (the user's test)

1. Open the live URL → submit a fact-check (no wallet needed).
2. Watch the observer lanes run; wait for reveal; open the report.
3. `/verify`: paste a revealed vote's fields → commitment matches.
4. Connect wallet (or Google via zkLogin if Enoki keys set) → deposit into the
   demo pool → after settlement, redeem.
5. Explorer: open the claim, certificate, and payout objects (Display metadata
   should render names/descriptions).
6. CLI: `pnpm cli -- claim inspect --claim <id> --verify --json`.

## Preserved demo claim (filled as completed)

Completed 2026-08-27 by canary 17 — a full DIRECT_REVIEW lifecycle on Sui
testnet with live GonkaRouter inference (5/5 SCHEMA_VALID across all three
model families, 5 sealed commits, 5 reveals, deterministic finalize).

| Item | Value |
| --- | --- |
| Network | Sui **testnet** (package `0xb411210a52dad799b9b4a53e3a44b30c3c8b8a3b1981795f830166533a474c1d`) |
| Claim object | `0xd649cececdf546a5f886b07b0517ec45bd301de06045044e79c6642298bdb9d4` |
| Committee / seats | 5 seats, 3 model families — selection digest `EDVnWpVFjtRTqJBgv3J9dj95zL9kqSgpJAvVreaXTWHk` |
| Evidence bundle root | `0x66aeedcb8e3f633cbe5e347a5aa15e6e517d18492913ccaadd87e482432dbcfc` |
| Gonka Request IDs | `devshard-63948-430` (DeepSeek), `devshard-63625-928` (MiniMax), `devshard-63948-432` (DeepSeek), `devshard-63939-297` (Kimi), `devshard-63610-968` (MiniMax) |
| Certificate | `0x8efdabe0900a3e4da39210394d211123ec82be6d176a51175adef7b8f41a8634` — [suiscan](https://suiscan.xyz/testnet/object/0x8efdabe0900a3e4da39210394d211123ec82be6d176a51175adef7b8f41a8634) |
| Finalize digest | `3FuF8jUCkHmqN19fyFNQhTE96DsiAb4sbS4yD72Uzic3` |
| Truth Score | **YES — 9700 bps**, off-chain recompute == on-chain value |
| Pool settle / payout digests | exercised on localnet by `pnpm e2e:localnet` (sponsored deposit + payout); not part of the testnet canary |
