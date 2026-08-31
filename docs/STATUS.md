# OpenVerdict — Product Status Snapshot

> Last updated: 2026-08-31 16:20. Source of truth for claims below: the code
> and its test suites (`pnpm test`, `pnpm test:move`), not this file. The
> dated bullets under "What is NOT true yet" are the change log, newest first.

## What the product is right now

A live, demo-able verification engine on Sui testnet: https://openverdict.info
(landing) and https://app.openverdict.info (dashboard). A submitted claim gets
a five-seat jury drawn on chain with native randomness from seven registered
jurors spanning GonkaRouter's three model families; every juror searches the
web through the engine, reads pages on both sides (up to three per turn),
cites them, commits a sealed verdict and reveals it; the chain settles a
resolution certificate with a truth score about 10 minutes after submission
(about 21 minutes when a second round is needed). Every prompt, model reply,
request id, node id, page, hash, Sui object and Walrus blob is public after
the reveal; reveal keys are also escrowed under a Mysten Seal time-lock policy
so a sealed bundle opens after its deadline without the operator; a browser
verifier recomputes 15 checks per run, re-runs a juror against the recorded
model, and opens bundles through Seal; failed seats keep their research trail.
Hosted on one Railway container (web, API, three workers) with Railway
Postgres. Tests: 464 vitest, 70 Move.

## Layer inventory

| Layer | Where | State | Evidence |
| --- | --- | --- | --- |
| Protocol (Move) | `move/openverdict` — 8 modules: agent_registry, claim, evidence, jury, settlement, demo_fact_checker, demo_binary_pool, display_meta | ✅ | 66/66 `sui move test`; commit–reveal enforced on-chain; immutable certificates; one-time payout tickets; Object Display metadata |
| Cross-language contract | `lib/protocol` + `tests/integration/parity.test.ts` + `tests/parity_tests.move` | ✅ | 6 blake2b256/BCS vectors asserted byte-identical in BOTH suites |
| Inference adapter | `lib/gonka`, `lib/research` | ✅ | Live-verified GonkaRouter API (4096-token cap, `devshard-…` ids, visible retries, hedged same-model calls after 25 s, redacting attempt log; X-Gonka-No-Fallback pinned on every call since 2026-08-31 so the gateway returns a real 429 instead of substituting a model, and any X-Gonka-Fallback notice is audited; the gateway's public receipts lookup (GET api.gonkarouter.io/v1/receipts/<x-request-id>, live 2026-08-31) is cross-checked from the run view: model, devshard, timing and outcome compared against the sealed record, relayed server-side until the gateway sends CORS); prompt specs v1 to v4 and tool policies v2 to v4 (`promptSpec.ts`) hashed over canonical JSON and bound into every juror manifest (v5 documents live); juror research loop (search with intent, batched page opens, citations, two-sided checks) through Firecrawl; gateway ids (`x-request-id`, `x-devshard-id`, `system_fingerprint`) kept as audit pointers; deterministic fake for offline juries |
| Evidence pipeline | `lib/evidence`, `lib/walrus` | ✅ | SSRF suite (DNS-first, per-hop revalidation, streaming caps); Merkle manifests; local + SDK Walrus stores + retention; SDK store writes raw blobs (`writeBlob`/`readBlob`, no quilts) so every blob id on chain is a content address a verifier can fetch |
| Engine | `lib/engine` (contract.ts seam), `lib/sui` (builders per entry point, SuiGateway + fake), `lib/seal` (reveal-key escrow), `lib/storage` (drizzle/pglite/pg), `lib/events` (phase-gated serializer) | ✅ | Full lifecycle: direct review + optimistic; `juryRun` fails closed unless every seat's manifest hashes equal its published document; each run's bundle (exact conversation, input, every attempt, validated output, transcript, audit) is sealed with AES-256-GCM before `approve_run` and the commit, the key is escrowed under the Seal time-lock policy, and the plaintext bundle plus key is published as the reveal argument blob; failed seats keep a failure record; `runProof` / `agentManifestDocument` seams; 431/431 vitest incl. lifecycle, seal-then-reveal, escrow, hedge and zkLogin registration tests over FakeSuiGateway |
| CLI | `cli/` (`openverdict`, PRD §27.3 surface) | ✅ | `--json` NDJSON, preflight prints, stable exit codes |
| Workers | `workers/` | ✅ | evidence / inference / resolution loops, graceful shutdown; live-claim triage (2 s poll while a claim is in flight, 15 s idle, wake file on submission), stranded and dead claims skipped, exponential backoff per failing claim |
| Observer + fact-check UI | `app/`, `components/` | ✅ | Builds/typechecks/lints; SSE with resume; strict pre-reveal redaction; run view with provenance strip, research trail (batched opens, both sides, refusals), per-turn conversation with the answering node, "Re-run this juror", "Open through Seal", "Seat failed before commit"; client-side `/verify` recomputes 15 checks per run and decrypts the sealed blob with WebCrypto; `GET /api/claims/[id]/runs/[runId]/proof`, `POST …/reexecute`, `GET /api/agents/[id]/manifest`; manifest panel on `/agents/[id]`; since 2026-08-31 the claim page is the deliberation canvas (live force graph: jurors with family avatars, sealed-phase pulses from content-free `RESEARCH_TICK` events, node inspector reusing the run-proof components, replay at 1x/10x/60x on terminal claims; full-viewport stage without the global chrome, quick-nav pill, auto-fit view; revealed run proofs served from an immutable in-memory cache with browser caching, first build per claim still pays two Walrus reads), the audit view moved to `/claims/[id]/report`, `/observe` redirects |
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
  rewrites the root of `app.` hosts to `/app`). Since 2026-08-31 the split
  is enforced: `www` redirects to the apex, console paths on the apex
  (`/app`, `/claims`, `/agents`, `/verify`, `/status`, `/fact-check`,
  `/evidence`) redirect to the app host with 308, the header's "Open app"
  hands visitors across (`NEXT_PUBLIC_APP_URL`, a Dockerfile build ARG), the
  header knows the console host's root is not the landing, claims list
  newest first, stranded discussion claims show as "Expired", and every
  page carries a title, Open Graph and Twitter cards with a generated image,
  `robots.txt`, `sitemap.xml` and the standard security headers (HSTS,
  nosniff, referrer policy, frame options; no CSP because wallet extensions
  and the Enoki popup inject scripts). The DNS zone stays on Vercel
  nameservers (apex ALIAS, www and app CNAMEs point at Railway; Let's
  Encrypt certificates for all three; Google OAuth and the Enoki allowlist
  cover every host). Since 2026-08-31 03:00 the public forms take one claim
  statement only (the jurors research; the API and CLI keep optional sources
  and criteria; the default rubric now names the jurors' own research and
  UNSURE on conflict). Since 2026-08-30
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
  (evidence cutoff +60 s, commit +450 s, reveal +570 s, discussion +630 s,
  second round +1080 / +1200 s since the Seal release, +810 / +930 s from
  22:26 until then, commit `bb79bec`: the owner keeps
  every juror at equal selection weight and accepts a verdict about 10 min
  after the POST so that Kimi's slower calls finish; first claim under it,
  #24 `0xaad14670…`, ended UNRESOLVED at 16.3 min with three of five seats
  in each round, the Kimi seat still timing out on a 113 s fifth call and
  a MiniMax seat exhausting its ten turns; from juror research
  v2 until then the windows were 330 / 450 / 510 / 690 / 810 s, whose six
  to ten turns per seat had not fit the earlier 240 s commit window: every
  seat of claim #20 hit the seat deadline mid-research). Seats commit as they finish (a per-claim
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
- FAILED SEATS KEEP THEIR TRAIL + HEDGED REQUESTS 2026-08-31 00:15
  (commit `85ce5ad`): a seat that fails before committing no longer
  leaves only a log line. The research loop's transcript and attempt
  records at the moment of failure are stored on the run row
  (`InferenceFailureV1`: status, message, time, transcript, attempts,
  best-effort Walrus copy) under the seat's derived run id, and the proof
  route returns them as a failure proof (no bundle, `revealed: false`),
  so the claim page shows "Seat failed before commit" with the status in
  plain English, the engine message, the Walrus copy and the full
  research trail up to the failure; the seat strip and seat cards show a
  "Failed" state from a `failureStatus` the claim inspection now carries
  (deployed 2026-08-31 00:50; applies to seats that fail from now on,
  earlier failures kept no record). Hedged
  requests: on GonkaRouter the same model answers in seconds or in one
  to two minutes depending on the node (two other teams in the
  GonkaRouter chat report the same for Kimi-K2.6), so when a model call
  has not answered after 25 s (`GONKA_HEDGE_AFTER_MS`, 0 disables) and
  enough seat time remains, the identical request goes to the same
  model again; the first valid reply wins, the other call is aborted and
  recorded as `HEDGE_ABANDONED`, and the winning backup carries attempt
  kind `HEDGE`. Same model, both attempts in the bundle, retries
  unchanged; DeepSeek and MiniMax rarely trigger it, Kimi usually does.
  PROVEN LIVE on claim #26 (00:17, `0x089c6c7c…`, "Ethereum switched from
  proof of work to proof of stake in 2021."): finalized NO with truth
  score 200 at t+609 s (10.2 min), certificate `0x975b3ae1…`, all five
  seats revealed with both Kimi seats, every seat committed by t+331 s
  (about 80 s earlier than claim #25); five hedges fired (four Kimi, one
  MiniMax), the abandoned originals had run 7 to 74 s, and one Kimi
  seat's final verdict came from a backup call (its bundle's request
  record shows attempt kind HEDGE). The hedged bundles pass every local
  verifier check.
- SEAL ESCROW OF REVEAL KEYS 2026-08-30 late evening (design
  docs/superpowers/specs/2026-08-30-seal-escrow-design.md): at commit time
  the engine now escrows each run's AES reveal key under a Mysten Seal
  time-lock policy, so after the phase's reveal deadline anyone can obtain
  the key from Seal's key servers and open the sealed bundle without the
  operator (committed evidence can no longer be lost with the engine).
  Policy package `openverdict_seal::reveal_lock` on testnet at
  `0xf54eb61116372f8506ca332457b2fee61231a559e44923429f54fab355d0f0c5`
  (`seal_approve(id, &Clock)` peels claim, seat, phase, deadline and
  requires clock >= deadline; publish digest `6LnGu71K…`, UpgradeCap
  `0xbc0f64f8…` held by the operator). Key servers: Mysten's testnet
  committee server `0xb012378c…` (through its aggregator) and the
  independent `mysten-v1-1` `0x73d05d62…`, threshold 1. The escrow record
  (`SealEscrowV1`) rides as an unhashed field of the sealed blob the chain
  already cites; the verifier adds "Seal escrow binds this run" (identity
  = this claim, seat, phase and the claim's reveal deadline; package, key
  servers and the parsed encrypted object match); the run view and /verify
  gain an "Open through Seal" block (ephemeral keypair, no wallet) that
  recovers the key after the deadline and compares it with the revealed
  key, or opens a never-revealed seat's core. Proven end to end on testnet
  before deploy with the real package: a key escrowed under a past
  deadline was recovered in 3.3 s and matched, a future deadline was
  refused by the key servers. PROVEN LIVE on claim #25 (23:14,
  `0xbdab0011dadff49d2ec814368b23b5db1e58a7edefb141c1d6a7e22c8ee4502b`,
  "The first Bitcoin halving took place in November 2012."): finalized
  YES with truth score 9860 at t+624 s (10.4 min), certificate
  `0xff3191bc…`, ALL FIVE seats committed and revealed including both Kimi
  seats (their last calls took 115 s and 125 s and still fit the 450 s
  window). Every sealed bundle carried an escrow bound to the claim's
  first reveal deadline; before the deadline the key servers refused a
  recovery ("The key servers refuse until the reveal deadline passes");
  after it the DeepSeek run `0xbb1440b8…` passed all 15 local checks
  (including `sealEscrow`) and its key was recovered through Seal in
  3.5 s, equal to the revealed key, and the sealed core opened with a
  matching hash; a proof captured before the reveal (the "never revealed"
  case) opened the same way in 2.3 s. Second-round window fixed in the same
  release: the second commit deadline moves from +810 s to +1080 s
  (second reveal +1200 s) so round two gets the same research room as
  round one (not yet exercised live: #25 needed no round two).
- SELECTION WEIGHTS 2026-08-30 22:15: GonkaRouter serves exactly three
  models (`GET /v1/models`: DeepSeek-V4-Flash-0731, MiniMax-M2.7,
  Kimi-K2.6), so a fourth model family is not available and all inference
  stays on GonkaRouter. The committee rules (at most two seats per model,
  three families per committee, seven active agents for the draw) put at
  least one Kimi seat on every committee, and Kimi's calls on claim #22
  took 60 s, 5 s and 36 s before the fourth was cut at 97 s by the seat
  bound (a one-word probe answers in 9.4 s against 1.4 s for DeepSeek).
  For five minutes (22:15 to 22:20) the two Kimi profiles carried
  selection weight 3000 against 10000 (registry tx
  `91ir2QVbvvsi4whLbfGdkkjoXaY28EZuRrxaNvo1BZ2s`, sent from inside the
  container because the Mac could not reach the RPC; the draw simulation
  put two-Kimi committees at 16% instead of 57%), then the owner chose
  equal weights for every juror and they were restored (tx `A7BEYRdu…`);
  the longer commit window and hedged requests carry the load instead.
  The registry holds 32 eligibility records, exactly
  `MAX_ELIGIBLE_SNAPSHOT`: retire an old profile before registering a new
  agent.
- BATCHED OPENS + RE-EXECUTION CHECK 2026-08-30 evening (commit `9e2dd98`,
  Railway deployment `db421474`; design in the "Protocol v4" section of
  docs/superpowers/specs/2026-08-30-juror-research-v2-design.md and in
  docs/superpowers/specs/2026-08-30-attested-inference-design.md): under
  tool policy v4 an open action may name up to three urls; the engine
  validates the batch against the urls seen in the run, fetches the pages
  in parallel, records one transcript step per page with a batch marker
  and returns one `open_many` tool result (prompt spec v4, manifest
  document v5, bundle core v5, verifier check "opens per turn within
  policy"; v3 policies unchanged byte for byte). The seven jurors carry v5
  manifests since 21:33 (prompt hash `0x7257117d…`, policy hash
  `0x8da9ec66…`; the v3 hashes did not move, so v4 bundles keep
  verifying). `POST /api/claims/<id>/runs/<runId>/reexecute` (public, rate
  limited, revealed runs only, 120 s timeout) resends a run's recorded
  messages to the recorded model at temperature 0, and the run view's
  "Re-run this juror" block compares the fresh verdict, output hash,
  served model and node ids with the recorded ones: a match corroborates,
  a difference is a reason to look closer, not proof of tampering. Proven
  on production at 21:38: re-running claim #21's DeepSeek run
  `0x76fe683f…` returned YES 9500 again (verdict and served model match,
  output hash differs because the recorded hash covers the validated
  output), answered by devshard 66624 (gateway request
  `req-1788097096443106812-862321`, fingerprint `vllm-0.25.1-tp4-f0993dd5`)
  in 77 s. FIRST V5 VERDICT, claim #22 (21:44, `0x387a344b…`, "The
  Ethereum Merge, which switched Ethereum from proof of work to proof of
  stake, took place on September 15, 2022."): four seats valid (both
  DeepSeek, both MiniMax; the Kimi seat timed out), every run a v5 bundle
  with batched opens (each DeepSeek seat opened three pages in one turn
  after its support search and two after its challenge search; MiniMax two
  per turn), commits by t+227 s, reveal phase at t+380 s, four reveals by
  t+411 s, finalized YES with truth score 9950 at t+502 s (8.4 min from
  POST), certificate
  `0x7c2fcb4b71691ecd6253fd8b2cf40975a8cc66ba67520e83b9e8c68720d6d02c`.
  DeepSeek run `0x6b646088…` and MiniMax run `0x71edbc4f…` passed all 14
  verifier checks of that build locally, including "opens per turn within
  policy" (15 checks since the Seal escrow check was added).
- JUROR RESEARCH V2 2026-08-30 afternoon (design record
  docs/superpowers/specs/2026-08-30-juror-research-v2-design.md): every
  search carries an intent (support or challenge); before a YES or NO the
  engine requires a challenge search with one of its results opened,
  citations from at least two sites, and a counter-evidence summary, each
  with bounded nudges (`CHALLENGE_REQUIRED`, `CORROBORATION_REQUIRED`),
  and UNSURE is never blocked. Prompt spec v3, tool policy v3 (4 searches,
  5 opens, 10 turns), manifest document v4, bundle core v4 (superseded the
  same evening by prompt spec v4, policy v4, manifest v5 and bundle v5, see
  the batched-opens bullet; the loop rules still apply); agents whose
  manifest is still version 3 keep the v1 behaviour byte for byte, and
  the verifier checks v4 bundles against their own policy. The run view
  shows everything the sealed bundle records: provenance (requested versus
  served model, devshard, fingerprint, request ids, tokens, latency, Sui
  and Walrus links), the per-turn conversation with the node that
  answered, the engine's refusals, the system prompt and budgets,
  evidence for and against with the reasoning trace, every remaining
  audit field, and the full public bundle as JSON. FIRST V2 VERDICT, claim
  #21 (17:10, `0x5629faca…`, "The Bitcoin genesis block was mined on
  January 3, 2009"): four seats valid (both DeepSeek, both MiniMax; the
  Kimi seat lost), each with a support search, a challenge search, pages
  on both sides, citations from two sites and a counter-evidence summary;
  commits t+212 to t+274 s, REVEAL_1 t+398 s, four reveals by t+445 s,
  finalized YES with truth score 9750 at t+479 s (8.0 min from POST),
  certificate
  `0x8a5ab5ad7bb8e70a7b118a18d5e0ee0cbff1165ddae0b4a78195a5b19d4b079d`.
  Its DeepSeek run `0x76fe683f…` passes all 13 verifier checks of that
  bundle version (v5 bundles have 15 checks).
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
