# OpenVerdict — Product Status Snapshot

> Last updated: 2026-08-29. Source of truth for claims below: the code and its
> test suites (`pnpm test`, `pnpm test:move`), not this file.

## What the product is right now

A complete, tested implementation of the OpenVerdict verification engine —
Sui Move protocol, TypeScript engine + CLI, and read-only observer — running
end-to-end against a fake (deterministic) inference adapter, with the localnet
operational proof and public deployments in flight.

## Layer inventory

| Layer | Where | State | Evidence |
| --- | --- | --- | --- |
| Protocol (Move) | `move/openverdict` — 8 modules: agent_registry, claim, evidence, jury, settlement, demo_fact_checker, demo_binary_pool, display_meta | ✅ | 66/66 `sui move test`; commit–reveal enforced on-chain; immutable certificates; one-time payout tickets; Object Display metadata |
| Cross-language contract | `lib/protocol` + `tests/integration/parity.test.ts` + `tests/parity_tests.move` | ✅ | 6 blake2b256/BCS vectors asserted byte-identical in BOTH suites |
| Inference adapter | `lib/gonka` | ✅ | Live-verified GonkaRouter API (4096-token cap, `devshard-…` ids, visible retries, redaction); prompt spec v1 (`promptSpec.ts`) hashed over canonical JSON and bound into every juror manifest; gateway ids (`x-request-id`, `x-devshard-id`, `system_fingerprint`) kept as audit pointers; deterministic fake for offline juries |
| Evidence pipeline | `lib/evidence`, `lib/walrus` | ✅ | SSRF suite (DNS-first, per-hop revalidation, streaming caps); Merkle manifests; local + SDK Walrus stores + retention; SDK store writes raw blobs (`writeBlob`/`readBlob`, no quilts) so every blob id on chain is a content address a verifier can fetch |
| Engine | `lib/engine` (contract.ts seam), `lib/sui` (builders per entry point, SuiGateway + fake), `lib/storage` (drizzle/pglite/pg), `lib/events` (phase-gated serializer) | ✅ | Full lifecycle: direct review + optimistic; `juryRun` fails closed unless every seat's manifest `promptHash` equals the live prompt spec hash; each run's bundle (exact prompt, input, raw response, validated output, audit) is sealed with AES-256-GCM before `approve_run` and the commit, and the plaintext bundle plus key is published as the reveal argument blob; `runProof` / `agentManifestDocument` seams; 261/261 vitest incl. lifecycle, seal-then-reveal and zkLogin registration tests over FakeSuiGateway |
| CLI | `cli/` (`openverdict`, PRD §27.3 surface) | ✅ | `--json` NDJSON, preflight prints, stable exit codes |
| Workers | `workers/` | ✅ | evidence / inference / resolution loops, graceful shutdown |
| Observer + fact-check UI | `app/`, `components/` — 26 routes | ✅ | Builds/typechecks/lints; SSE with resume; strict pre-reveal redaction; client-side `/verify` incl. a Run proof tab that recomputes prompt/input/output/run hashes and decrypts the sealed blob with WebCrypto; `GET /api/claims/[id]/runs/[runId]/proof`, `GET /api/agents/[id]/manifest`; manifest panel on `/agents/[id]` |
| API guards | `app/api/_lib/guard.ts` | ✅ | Operator bearer token, public-write flag, trusted-proxy-gated rate limits |
| Wallet + zkLogin onboarding | `components/wallet`, `components/agents` | ✅ | dapp-kit v2 + Enoki (env-gated); zkLogin-backed agent registration (T7b): SDK signature verification, blake2b backing hash, one-social-account-one-seat, guarded POST /api/agents/register |
| Localnet E2E + sponsorship | `scripts/localnet-e2e.ts`, `scripts/cockpit-demo.ts` | ✅ | `pnpm e2e:localnet` exits 0 (3 lifecycle paths, sponsored deposit, CLI parity, recomputed Truth Score); cockpit harness leaves a finalized + a sealed claim live for the observer |

## What is NOT true yet

- Live testnet canary COMPLETE (2026-08-27): full lifecycle with live GonkaRouter juries — 5/5 SCHEMA_VALID across 3 model families, YES @ 9700 bps recomputed == on-chain, certificate `0x8efdabe0…1a8634` (see docs/demo/runbook.md table).
- Live GonkaRouter inference VERIFIED 2026-08-27: account catalog = deepseek-ai/DeepSeek-V4-Flash-0731, MiniMaxAI/MiniMax-M2.7, moonshotai/Kimi-K2.6 (3 families); real completion returned id `devshard-…` (the OpenAI-compatible endpoint id shape — preserved verbatim as the Gonka Request ID). Full live jury round runs at the testnet canary.
- Multi-process production stack PROVEN 2026-08-28: a claim submitted through
  the public API/form reached a SCORED verdict fully worker-driven — 5/5
  commits + reveals, round-1 threshold, certificate `0x76264101…` on localnet
  in under 4 minutes. Getting there fixed a six-layer concurrency stack
  (commits f313c2e…fe1b6a1): advisory-lock tick serialization, cross-process
  profile→signer self-healing, stale-gas retry, per-claim worker error
  isolation, in-gateway approveRun serialization (previously only the E2E
  harness proxy had it), and factory-rebuilt transaction retries.
- HOSTED ON RAILWAY 2026-08-30 (single host, web + the three engine
  workers in one service `app`): https://openverdict.info is the landing,
  https://app.openverdict.info opens the dashboard directly (`proxy.ts`
  rewrites the root of `app.` hosts to `/app`). The DNS zone stays on Vercel
  nameservers (apex ALIAS and www CNAME point at Railway). Since 2026-08-30
  15:00 the database is a Railway Postgres service in the same project
  (`Postgres`, private network only, daily and weekly volume backups). Neon
  hit its free plan's 5 GB monthly egress the same afternoon; both Neon
  resources, the Neon integration and the Vercel project `open-verdict`
  were deleted at 14:55 (owner's request). The domain `openverdict.info`
  and its DNS records remain in the Vercel account, which is the only
  thing Vercel still does for the product. The workers inspect only live
  claims, poll every 2 s while a claim is in flight and every 15 s
  otherwise, and a submission wakes them at once through a shared wake
  file. `/api/status` reports suiHealthy, gonkaMode live, walrusMode
  testnet, dbHealthy. Two hosted-only bugs found
  and fixed the same night: retention epochs were sent to Move as Walrus
  epochs (E_RETENTION_EXPIRED on every freeze; now converted to Sui epochs,
  `lib/sui/retention-epoch.ts`), and the worker tick lock was a session
  advisory lock that Neon's transaction pooler stranded (workers silent;
  now `pg_advisory_xact_lock` inside a transaction). Hosted end-to-end run:
  see docs/CHECKPOINT-2026-08-29.md for the latest claim ids and results.
- FAST MODE 2026-08-30 (measured through eleven hosted claims overnight):
  the hosted ladder is measured from the `create_claim` transaction
  (evidence cutoff +60 s, commit +240 s, reveal +360 s, discussion +420 s,
  second round +600 / +720 s). Seats commit as they finish (a per-claim
  commit pump from the chain's acceptance floor), reveal bundles publish
  one at a time on the operator lane (about 15 s each, which is why the
  reveal window is 120 s) and the five agent-signed reveal transactions
  then go out in parallel, research page writes run off the model's
  critical path, every operator-signed operation of a process runs on one
  lane, the resolution worker waits for each Move deadline floor instead
  of sending aborting transactions, and it skips finished or stuck claims
  so a live claim's reveal window is never spent on dead ones. Observed on claim #15 (08:05): POST returns after ~45 s,
  committee t+57 s, freeze t+74 s, research 5 to 72 s per seat with all
  five seats valid, commits t+174 to t+208 s, advance t+275 s; a reveal
  costs ~20 s, so the reveal window is now 120 s. FIRST HOSTED VERDICT,
  claim #16 (08:22, `0x9169c707…`): five valid seats (research 4 to 29 s),
  commits by t+201 s, REVEAL_1 at t+269 s, all five reveals by t+337 s,
  finalized YES with truth score 9860 at t+404 s (6.7 min from POST),
  certificate
  `0x62036142117e5dc3b1c6949ff338d55c2a0da5b5396ccfcc68428a2cefe49ecc`.
  Earlier hosted certificates: `0xfb68f1ff…`, `0x677ec538…`, `0x82684a50…`, `0xb554098e…`,
  `0xef4383de…`, `0x9f58e980…`, `0xfbdab9dd…`, `0x3dc599e7…`, `0x3a5f337d…`,
  `0xc51065e4…` (all UNRESOLVED: fewer than four matching reveals per
  round, for lost seats, for reveals that missed a 60 s window, and on
  claim #17 for GonkaRouter serving DeepSeek requests from a MiniMax
  devshard, which the adapter fails closed because a juror's run must
  come from its declared model). Two chain rules shape the outcome:
  `REQUIRED_MATCHING = 4` (four matching reveals of five resolve a round)
  and committee diversity (three model families, so the slowest family is
  always seated). Operational: agent wallets pay for seat transactions and
  must stay funded (see the runbook checklist).
- PROOF CHAIN V2 PROVEN ON TESTNET 2026-08-29 late: the seven juror manifests
  on chain are real v2 documents on Walrus (prompt spec embedded, hashes
  match, `scripts/publish-agent-manifests.ts`), and a live canary ran under
  the sealed-bundle flow: 4 of 5 seats `SCHEMA_VALID` (one transient provider
  error, fail closed), 4 commits, 4 reveals, YES at 9625 bps recomputed ==
  on-chain, certificate `0x464d397a…5e82`; every sealed blob decrypted with
  its revealed key and matched the revealed core. Not yet deployed (commit +
  push pending owner approval).
- JUROR RESEARCH V1 BUILT 2026-08-30 (spec
  `docs/superpowers/specs/2026-08-29-juror-research-design.md`, plan
  `docs/superpowers/plans/2026-08-29-juror-research.md`): jurors search and
  open pages through the engine (Firecrawl v2 REST), cite only pages they
  opened (refs `p1..pN`, exact quotes with tolerant normalisation), the
  transcript is hashed into the on-chain run hash and sealed until reveal.
  Gate: typecheck clean, 332 vitest tests, build exit 0. Live single-seat
  probe: DeepSeek, MiniMax, and Kimi each returned a valid cited verdict. The
  seven v3 manifests (prompt spec v2 + tool policy v2) are live on testnet.
  Canary under the loop (2026-08-30 01:22): 5 of 5 live seats SCHEMA_VALID
  with real searches and opened pages, 5 commits, 5 reveals, YES at 9460 bps
  recomputed == on-chain, certificate `0x742e47c1…4cae`.
- Landing redesign v3 SHIPPED 2026-08-28 (Sharplink-style: Archivo type,
  #0E76FF/#F3F3F3, globe hero docking into a live stat card, sticky protocol
  stack, FAQ, footer claim form + rising wordmark; commit 83322e1).
- Unaudited; hackathon-grade trust model (single run-attestor + evidence-freezer capabilities, documented).

## Keys only the user can provide

| Key | Unlocks |
| --- | --- |
| `GONKA_ROUTER_API_KEY` | Live multi-model juries + real Gonka Request IDs (submission requirement) |
| `NEXT_PUBLIC_ENOKI_API_KEY` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | "Continue with Google" social onboarding |
| Mainnet funding decision | Mainnet canary (testnet is the demo network until then) |

## Diagrams

`docs/diagrams/` — architecture, claim lifecycle, jury round, onboarding tiers.
All black-and-white with paired light/dark exports; sources are `.excalidraw`.

Colour series added 2026-08-29 (verified against the code, one topic each):
`01-architecture-overview`, `02-user-flow`, `03-runtime-swimlane` (one claim
through browser, workers, GonkaRouter, Sui, Walrus, Postgres with the deadline
floors), `04-engine-and-workers`, `05-data-placement`, `06-protocol-artifacts`
(commitment, output contract, Truth Score, wire codes, clock),
`07-production-topology`, plus `00-end-to-end-poster` (everything on one
canvas). Each has a `.png` next to its `.excalidraw` source.

## Plan of record

`docs/superpowers/plans/2026-08-26-openverdict-build.md` (status ledger at top).
Spec of record: `PRD.md` (see §1.1 implementation addendum for where code
corrected spec).
