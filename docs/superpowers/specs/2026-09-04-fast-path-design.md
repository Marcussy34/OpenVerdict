# Fast path: shorter runs and a live research feed (design, 2026-09-04)

Owner: "please do everything end to end, such that everything is optimized"
(14:05, after the timing breakdown of claim 0x273220b5). Goal: a one-round
verdict in about five minutes, a two-round verdict in about fifteen, and a
console that shows each juror's tool calls as they happen. The protocol
does not change; the plumbing around it does.

## Where the time goes today (claim 0x273220b5, 2026-09-03)

| Step | Took | Why |
| --- | --- | --- |
| claim created to committee drawn | 36 s | the draw waited for the evidence worker's Walrus archive (shared tick lock), then the draw transaction and its bookkeeping |
| seat acceptance | 60 s | ACCEPTANCE_WINDOW_MS in jury.move |
| model answer to on-chain approval | 12 s alone, 78 to 99 s when four seats finished together | every Walrus write and every operator transaction runs on one in-process lane (lib/sui/operator-lane.ts): sealed uploads and approvals queue behind each other |
| reveal window open to five reveals | 115 s | five revealed-bundle uploads on the same lane, one after another, before the five reveal transactions |
| transcript freeze before round two | up to 120 s | DEFAULT_EVIDENCE_FREEZE_LEAD_MS; the freeze waits for the lead even after the debate converged |

Model time (research two to four minutes per seat, in parallel; each debate
turn one call) is the floor and stays.

## Changes

### 1. Walrus writer lanes (lib/walrus, lib/sui/signers, a funding script)

Today `createRealWalrusStore.put` wraps every write in `runOnOperatorLane`
because register and certify transactions spend the operator's gas and WAL
coins, and two in flight collide. Replace with a pool of writer keypairs:

- `SignerRegistry` gains `listWalrusWriters(): BoundWriter[]` derived from
  `OPENVERDICT_AGENT_SEED` with the label `WALRUS_WRITER` and index 0..K-1,
  K = `OPENVERDICT_WALRUS_WRITERS` (default 4, 0 disables the pool). Same
  derivation style as the agent slots (`deriveTestOnlyKey`).
- `lib/walrus/lanes.ts`: `WriteLanes` holds one promise chain per writer; `put`
  picks the lane with the fewest queued writes; a write on a lane signs with
  that writer. If a lane's writer lacks SUI or WAL (a balance check at
  startup and on failure), the write falls back to the operator lane exactly
  as today. The operator lane keeps only protocol transactions.
- `scripts/fund-walrus-writers.ts` (`pnpm walrus:writers`): prints each
  writer's address and balances; with `--fund` transfers SUI and WAL from the
  operator to every writer below the floor (defaults 0.3 SUI and 0.5 WAL;
  the operator holds about 37 SUI and 5 WAL on testnet). Never prints keys.
- Reads (`get`) are unchanged. The local store used by the E2E is unchanged.

Expected: five sealed uploads or five revealed uploads run four-wide, about
20 s instead of 100; approvals no longer wait behind uploads.

### 2. Per-worker tick locks and per-process operator gas (workers/runtime, lib/sui/execute)

The three workers are separate processes (scripts/start-production.mjs) and
share one advisory lock per tick so their operator transactions never
collide on the operator's single gas coin. Give each process its own coin
and its own lock:

- `TICK_LOCK_KEY` becomes a per-worker key (name hashed into the key), so the
  resolution worker's draw no longer waits behind the evidence worker's
  archive. Two replicas of the same worker still exclude each other.
- The operator's SUI is split into at least three gas coins (the funding
  script above also does `--split-gas 3` when the operator holds fewer than
  three coins of at least 1 SUI). Each worker process pins a distinct gas
  coin: `pinKnownGas` (lib/sui/execute.ts) takes the coin whose index is
  `OPENVERDICT_OPERATOR_GAS_SLOT` (start-production.mjs sets 0, 1, 2 for the
  three workers; the web process uses 3 when a fourth coin exists, else it
  keeps the shared-lock behaviour). Owned inputs other than gas are already
  distinct per worker (RunAttestorCap for approvals, EvidenceCap for
  freezes). The existing retry with fresh object versions stays as the
  safety net for any collision.

Expected: the committee is drawn about two seconds after the claim lands.

### 3. Fixed waits (jury.move, engine mirror, evidence worker)

- `ACCEPTANCE_WINDOW_MS` 60_000 -> 20_000 in jury.move; the TS mirror
  `COMMITTEE_ACCEPTANCE_WINDOW_MS` follows; the E2E harness wait follows.
  Package upgrade (compatible: a constant).
- Phase-two freeze: freeze the transcript as soon as the deliberation has
  converged or its last exchange completed, instead of waiting for
  `discussionDeadline - lead`; the lead (now 30 s default) stays only as the
  fallback bound for a debate that is still running. The evidence worker's
  late fallback debate keeps working.

### 4. Timing instrumentation (engine events)

Every emitted event that closes a step carries a `timing_ms` object in its
payload, PUBLIC_NOW, integers in milliseconds:

- `committee_selected`: `{ draw }` (transaction submit to settled).
- `run_approved`: `{ model, seal, escrow, upload, approve }` for that seat.
- `vote_committed`: `{ commit }`. `vote_revealed`: `{ upload, reveal }`.
- `evidence_frozen`: `{ archive, freeze }`. `claim_finalized`: `{ finalize,
  total_from_created }`.

`ov watch --verbose` prints them as "(model 19 s, upload 8 s, approve 3 s)";
`ov trace` adds them to the receipt line. The dossier is unchanged.

### 5. Live research feed (research loop, events, console, CLI)

`lib/research/loop.ts` `onStep` grows to
`{ kind: "search" | "open" | "answer"; ordinal; intent?; query?; urls?; resultDomains?; pageCount? }`
("answer" fires when the model returns its final action, with no content).
The engine emits, for every step, a `research_step` event, PUBLIC_NOW, kind
not reveal-gated, payload
`{ claim_id, jury_seat_id, agent_profile_id, run_id, phase, ordinal, kind, intent?, query?, urls?, result_domains?, page_count? }`.
Queries and URLs are public web material; the answer, the vote and the
reasoning stay sealed until reveal, exactly as today. The rationale: jurors
never see the console, independence is between jurors, and the operator
already sees everything, so showing the tool calls live changes no trust
assumption. `RESEARCH_TICK` keeps being emitted for older clients.

Console: each juror lane on the claim page lists its live steps as they land
("searched (challenge) ...", "opened mit.edu, apa.org", "drafting the
answer") with the sealed-vote badge until reveal. `ov watch` prints one line
per step ("12:47:31Z  juror 3 (MiniMax) searched (support) \"...\"",
"... opened 3 pages: mit.edu, ...", "... is drafting its answer"). The skill's
"While watching" templates gain the three lines.

## Rollout

1. Move tests, engine tests, worker tests, full localnet E2E (the acceptance
   wait changes; the E2E uses the local Walrus store, so writer lanes are
   exercised on testnet only).
2. `pnpm walrus:writers --fund --split-gas 3` on testnet (operator pays).
3. Package upgrade (acceptance window), config commit.
4. Deploy between claims with `OPENVERDICT_WALRUS_WRITERS=4` and the gas slots
   set by start-production.mjs. First live claim after the deploy is the
   measurement: the timing payloads say what each step took.
