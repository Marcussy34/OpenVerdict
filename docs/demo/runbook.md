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

Split hosting (2026-08-30): the website and its request-side API run on
Vercel (https://openverdict.info, Neon Postgres attached); the three engine
workers run on Railway as service `workers` in project `openverdict`
(Dockerfile build, `OPENVERDICT_ROLE=workers` so the container skips the
web, same `DATABASE_URL` and keys as Vercel plus `FIRECRAWL_API_KEY`). Env
per `.env.example` (operator key, agent seed, manifest=testnet, Gonka key,
Firecrawl key, operator token; `OPENVERDICT_PUBLIC_WRITES=enabled` on Vercel
only). Both clouds reach Mysten endpoints normally; the local TLS
interference does not apply there. Deploy: push to `main` (Vercel builds),
then `railway up --service workers` from the same commit.

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
