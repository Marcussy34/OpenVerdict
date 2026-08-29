# Session checkpoint — 2026-08-29 (pre-compaction #4, supersedes 08-28)

> Resume map. Repo is the source of truth; this file is the index.
> **THE BIG CHANGE: production is LIVE and healthy at https://openverdict.info.**
> Active work at compaction: an UNFINISHED brainstorm on consolidating 15
> routes to 7 (see "UX consolidation" below — designed, NOT approved, NOT
> started). User has ~1 week left, has NOT yet reviewed what was built, and
> explicitly wants architecture/functionality changes and possible pivots to
> stay on the table. Do not treat the current build as settled.
> Companions: docs/STATUS.md, docs/demo/runbook.md, CHECKPOINT-08-27/08-28.

## STATE AT 03:00 local (2026-08-30): Railway is the only host, two hosted bugs fixed, fast mode built

**Read this first; it supersedes the #6 section below.** Commits tonight,
all on main and pushed: `ba1262e` (epoch conversion + app-host proxy),
`5e5f6d6` (pooler-safe worker tick lock + deadline gating), `c55949a`
(fast ladder + parallel reveal publication + Walrus SDK reset). Railway
`app` runs `5e5f6d6` (deployed 02:55). `c55949a` is NOT deployed yet: deploy
it only when no claim is mid-phase (a restart during a jury run loses seats),
then submit a fast test claim and time it.

### What happened after compaction #6 (in order)
1. Gate + commit `ba1262e`, deployed 02:39 (deployment `0a4ed9bd…`).
   A Codex worker that had gone idle was still writing to the same files;
   its late additions (a 60 s cache test for the Walrus clock, a lower-bound
   assertion, and later `client.walrus.reset()` before `stakingState()`)
   were reviewed and kept. Lesson: `pgrep -f "codex-companion.mjs task"`
   AND the app-server keep running after the client is killed; cancel via
   the registry (`codex-companion.mjs cancel <job>`) when the job is listed.
2. Railway custom domains needed ownership TXT records because the trashed
   old project still claimed the hostnames: `_railway-verify`,
   `_railway-verify.www`, `_railway-verify.app` (Vercel DNS ids
   rec_8c3046fa…, rec_527f2750…, rec_f7c93ede…). All three verified.
3. DNS switch done (owner said "go"): apex ALIAS `jp12gpeh.up.railway.app`
   (rec_c61852b5…), www CNAME `fx4ky0p1.up.railway.app` (rec_c1e23cec…),
   app CNAME `2g3sfc2h.up.railway.app` (rec_ffc66959…). Both Vercel
   nameservers answer Railway. Domains removed from the Vercel project via
   `DELETE /v9/projects/open-verdict/domains/<domain>` (NOT `vercel domains
   rm`, which would drop the zone); the project stays for the Neon
   integration. app.openverdict.info has a valid certificate; apex/www
   certificates were still VALIDATING at 02:45 (re-check with
   `railway domain status <domain> -s app --json`).
4. Hosted statement-only claim `0xddd66882d2cedf7b22c3568b54feb99b978c46d61c578b3fe4f6588990bc6ab4`
   ("The Sui mainnet launched in May 2023.", old 30/45 min ladder, commit
   deadline 03:11, reveal 03:26 local) exposed HOSTED BUG #2: the worker
   tick serializer used `pg_advisory_lock` (session lock) through Neon's
   transaction-mode pooler (`DATABASE_URL` host `…-pooler…`). The pooler
   moves the server connection holding the lock to other clients and routes
   the unlock elsewhere, so the lock strands and all three workers block
   silently (proof: pg_stat_activity showed the granted holder idle with a
   foreign query and three waiters for 7 minutes). Fix in `5e5f6d6`:
   `BEGIN; pg_advisory_xact_lock; ...; COMMIT` (verified through the pooler
   with two clients). A stranded session lock SURVIVES an app restart (it
   lives on the pooler's server connection): terminate it once with
   `pg_terminate_backend(<holder pid>)` (holder = granted row in pg_locks
   for objid 1869640753). Done at 02:58; scratch loop `claim-state.py` in the
   scratchpad prints one state line for a claim URL.
5. Fast mode (`c55949a`): hosted ladder evidence +20 s, proposal +25 s,
   challenge +30 s, commit +210 s, reveal +270 s, discussion +330 s, second
   commit +480 s, second reveal +540 s. Floors from Move: `finalize_claim`
   needs now > first_reveal_deadline (settlement.move), `lock_committee`
   needs now >= selection + (commit - selection)/2 (jury.move:812),
   `advance_phase` needs now > commit deadline (claim.move:323). Resolution
   worker now waits for each floor (2 s margin) instead of submitting
   aborting txs each tick (those aborts fail at dry-run, so they cost no
   gas, only RPC noise). Reveal bundles upload in parallel, then reveal txs
   run sequentially. NOT done (follow-ups): page uploads still block each
   research open (~14 s each, up to 4 per seat); the inference worker still
   calls lockCommittee before the acceptance floor (dry-run abort, harmless);
   per-turn max_tokens is bound into the prompt spec hash, so changing it
   means a spec v3 + manifest republish.
6. Docs updated: STATUS.md (hosting + fast mode bullets), runbook §3
   (Railway single host, deploy procedure, pooler warning), README table row.
7. Hosted claim `0xddd66882…` after the lock was freed (02:58): evidence
   froze on chain (epoch fix proven with real Walrus), five research runs,
   two SCHEMA_VALID (DeepSeek 19 s: search, open, answer; Kimi 45 s: search,
   open x2, answer; both sealed + approve_run on chain), three failed closed
   with toolCallCount 0: the models answered from memory with invented
   citations (MiniMax x2, DeepSeek x1). Two commits landed 03:00 (lock +
   commit_vote proven hosted) but 2 < 3 threshold, so this claim goes to
   discussion at 03:26 and round two (old ladder: freeze 03:41, commit
   03:56, reveal 04:11). Scratch tools: `dump-runs.cjs <claimId>` (run
   `NODE_PATH=<repo>/node_modules`, env from rollout.env) prints
   transcripts and failure reasons from the DB.
8. Fix for the failure mode (`787a156`): the research loop refuses a YES or
   NO before any SEARCH-origin page is opened with a `RESEARCH_REQUIRED`
   tool error (at most two per run), then normal validation/repair. Spec
   §4.4 updated. Full gate green (348 tests, lint, build).
9. `787a156` deployed 03:13:47 after the old claim's reveals landed
   (advance 19 s after the commit deadline, both reveals 33 s later; the
   deadline gating and hosted reveal_vote are proven). The first fast-claim
   POST then FAILED at the API: create_claim was rejected by validators as
   "Object 0xdba0339f… already locked by a different transaction 7hrAHm…".
   That digest is our own Walrus `system::certify_blob` for the statement
   upload, executed 200 ms earlier; the fullnode's coin index still served
   the consumed gas version. Fix in `a07a136`: executeAndWait treats
   "already locked by a different transaction" like "reserved for another
   transaction" (rebuild + fresh gas versions, 5 attempts, 400 ms x attempt).
10. `a07a136` also moves discovered-page uploads off the research loop's
    critical path: WalrusStore.blobIdFor (SDK computeBlobMetadata; local
    blake2b address) gives the content address first, the model gets the
    page at once, the write runs in the background, each seat awaits the
    uploads of the pages it opened before sealing (a failed write fails the
    seat closed), juryRun lets the rest settle. Tests: "hands a research
    page to the model before its Walrus upload finishes..." and "fails a
    seat closed when the upload of a page it opened fails"; full gate 351.
11. `a07a136` deployed 03:28:22 (after `0xddd66882…` entered DISCUSSION at
    03:26:15, 15 s after its reveal deadline). All three fast-claim POSTs
    then failed on stale owned objects (gas coin `0xdba0339f…`, WAL coin
    `0x21305b77…` "provided version doesn't match").
12. ROOT CAUSE (operator tx history + logs): the evidence worker retried a
    phase-two freeze for the residue claim `0xdb9c7bae…` (DISCUSSION, its
    discussion deadline passed 03:12) every tick, and each attempt uploaded
    a manifest to Walrus (register_blob + certify_blob, two txs on the gas
    and WAL coins) before the freeze aborted (`assert_can_freeze_evidence`
    code 6). The operator's coins moved every few seconds, so every other
    transaction raced stale versions, and the gateway retry only knew the
    old "Object ID ... is not available for consumption" wording. Fixed in
    the next commit: evidence worker freezes phase one only until the
    commit deadline and phase two only until the discussion deadline;
    engine.evidenceFreeze refuses a closed window before any upload;
    executeAndWait retries "object ... is unavailable for consumption",
    "needs to be rebuilt because object ...", "provided version doesn't
    match for object ..."; the Walrus write retry covers the last wording.
    Gate: 353 tests, lint, build. Residue `0xdb9c7bae…` stays in DISCUSSION
    forever (no phase-two evidence; Move has no exit), harmless now.
13. `61e6378` deployed 03:37:33. The old claim's phase-two freeze at 03:41
    did NOT land: the freeze was scheduled at discussionDeadline minus the
    configured lead (OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS = 5000 on Railway)
    but needs a ~15 s Walrus manifest write first, so Move rejected it after
    the deadline (claim.move:507). `0xddd66882…` is now dead in DISCUSSION
    (residue #3; its round-one proofs stay viewable: 2 YES reveals, report
    PENDING). Fix committed next (`fix(workers): freeze phase-two evidence
    as soon as discussion opens`): the worker freezes phase two right when
    the claim enters DISCUSSION (never after the deadline); the lead
    setting is gone from .env.example (the Railway variable is ignored).
    Background chains must stay under the Bash tool's 10-minute cap; the
    03:36 chain was killed at 03:45 before it could submit.
14. `4a1b7e8` deployed 03:49 (deployment 9a6da52a). Fast claim #2
    `0xa3da18a20428fde03292e557ae7901223c91cd01390e2becdba59ee71de3672b`
    was accepted first try (create_claim no longer trips on the stale gas
    wording) and reached COMMIT_1 with 5 seats at t+45 s, then DIED:
    "evidence-worker: skipped: cutoff passed with no accepted artifact".
    Cause: the ladder was computed at the START of the request, the
    request spends ~35 s on the statement/criteria Walrus writes before
    create_claim, and the statement artifact is ingested (another write)
    only after the claim exists, so the 20 s cutoff had passed before the
    workers saw the claim and the first freeze found no artifact. Residue
    #4 (COMMIT_1 forever; the worker's window gate keeps it quiet).
15. Fix (commit "measure the hosted ladder from the create_claim
    transaction"): createClaimRecord computes the default ladder right
    before create_claim (explicit deadlines from claimCreate unchanged);
    cutoff +60 s, commit +180 s, reveal +240 s, discussion +300 s, second
    round +450 / +510 s; the evidence worker waits 60 s past the cutoff
    before giving up on a claim without artifacts. Gate 353 tests, lint,
    build. Deploy in flight (03:54); then POST fast claim #3 and write
    scratchpad/fast-claim.json; monitor b2kw3jihu only accepts a file
    newer than its start.

16. `64f82d8` deployed 03:56 (deployment 58e5ae4d). Fast claim #3
    `0x790eaa972c06f3738b002b92aa1b7166363c5ddb09e9d8a752436768605202d6`
    ("The Ethereum Dencun upgrade activated on mainnet in March 2024."):
    POST 43 s, ladder measured at the tx (cutoff 19:57:16Z, commit
    19:59:16Z, reveal 20:00:16Z, discussion 20:01:16Z), freeze at t+65 s,
    THREE valid seats (DeepSeek 23 s and 21 s, Kimi 57 s after one invalid
    turn; page opens 3 to 4 s now), two MiniMax seats lost to a Walrus write
    racing a sibling's write on the WAL coin ("already locked by a different
    transaction", not covered by the Walrus retry). NO commits: votesCommit
    runs only after every seat finished, and Kimi ended at 19:59:51Z, so
    lock_committee hit jury.move E_DEADLINE_PASSED (code 7). Phase-two
    freeze then landed 13 s into DISCUSSION (fix proven), but round two can
    never open: create_second_round needs a locked committee, and finalize
    needs a reveal phase, so the claim is dead in DISCUSSION (residue #5;
    Move has no exit for "no commit at all in round one").
17. Fix (commit "bound every seat by the commit deadline, retry locked
    Walrus writes"): juryRun gives each seat deadline = commit deadline
    minus 60 s (SEAT_COMMIT_MARGIN_MS); runResearchLoop stops with TIMEOUT
    before a turn past it and passes the time left as the model call
    timeout (GonkaCompletionRequest.timeoutMs, adapter takes the minimum
    with the research timeout); the Walrus write retry covers "already
    locked by a different transaction" and "reserved for another
    transaction" with five attempts. Gate 354 tests, lint, build. Deploy in
    flight (04:07). Uncommitted: resolution worker now logs why round two
    did not open before trying finalize.

### Next steps
- Deploy is live: POST fast claim #4, record scratchpad/fast-claim.json,
  watch monitor b2kw3jihu (or re-arm) to a certificate; then record the
  measured time-to-certificate in STATUS.md and the runbook.
- Then deploy `c55949a` (clean worktree checkout, `railway up -s app -d`),
  submit a fast claim, time it, and record timings here and in STATUS.md.
- Residue on testnet: `0x1936ddd3…` (orphan), `0xdb9c7bae…` (REVEAL_1 with
  no roots, will settle UNRESOLVED after its reveal deadline).
- Memory: add the pooler lock lesson and the DNS layout.

## STATE AT COMPACTION #6 (2026-08-30 ~03:05 local): epoch fix + Railway cutover mid-flight

**Read this first; it supersedes everything below for "what to do next".**
Tip of main pushed: `9a403cb` (statement-only claims). Uncommitted in the
tree (all manager-authored, all mine to commit): `proxy.ts` + `lib/web/`
(host routing, tests 3/3), the EPOCH FIX (below), and this file.

### The bug being fixed (blocks every hosted claim with real Walrus)
Move compares retention epochs with the SUI epoch (`walrus_end_epoch >=
ctx.epoch()`, E_RETENTION_EXPIRED = 4, evidence.move:56 new_evidence_bundle,
jury.move:436 approve_run, jury.move:523 reveal_vote). The engine passed the
blob's WALRUS end epoch (hundreds) against Sui's counter (~900). Canaries
passed only because the local store has no endEpoch (MAX_LOCAL_WALRUS_EPOCH).
Two Codex attempts produced nothing (one ran read-only, one got lost in
tooling), so the manager implemented it directly:
- `lib/sui/retention-epoch.ts` (+ test, 5 cases): `toChainRetentionEpoch`
  = suiCurrent + max(1, ceil(walrusEpochsLeft * walrusEpochMs / suiEpochMs)).
- `lib/walrus/store.ts`: `WalrusEpochInfo`, optional `epochInfo?()`.
- `lib/walrus/real.ts`: `epochInfo()` from `client.walrus.stakingState()`
  (`epoch`, `epoch_duration` ms), 60 s cache. Local store: none.
- `lib/sui/gateway-types.ts`: `ChainEpochInfo`, `epochInfo()` on SuiGateway.
- `lib/sui/gateway.ts`: `epochInfo()` from
  `client.core.getCurrentSystemState().systemState` (`epoch`,
  `parameters.epochDurationMs`), 60 s cache, `#epochCache`, EPOCH_CACHE_MS.
- `lib/sui/fake.ts`: public `epoch` field (default 900 / 86_400_000) +
  `epochInfo()`; `lib/sui/index.ts` exports retention-epoch.
- `lib/engine/engine.ts`: private `chainRetentionEpoch(walrusEndEpoch)`
  (MAX sentinel when the store has no clock), applied to freezeEvidence,
  approveRun (`chainRetainedUntil`; DB record keeps `retainedUntil` = Walrus
  epoch) and revealVote (`argumentWalrusEndEpoch`).
- `lib/engine/engine.test.ts`: `engineSetup` option `walrus?: WalrusStore`;
  test "sends Sui retention epochs on chain when the Walrus store has a
  clock" (store endEpoch 250, clock 240, gateway epoch 900 → expects 910 in
  freeze, 5 approve, 5 reveal calls; DB run keeps 250).
Gate status at compaction: see the line "GATE AT COMPACTION #6" below (fill
from the last typecheck/vitest run; if missing, run `pnpm typecheck` and
`pnpm vitest run lib/sui lib/walrus lib/engine lib/web`).
If a diagnostic mentions `serializeRunApprovals` (scripts/localnet-e2e.ts)
it proxies the gateway generically (Proxy get), so `epochInfo` passes through.

### Host routing (owner decision 02:50)
`openverdict.info` = landing, `app.openverdict.info` = dashboard opened
directly (public page; sign-in only changes what a visitor can do).
`proxy.ts` (Next 16 "proxy", formerly middleware; matcher "/") rewrites the
root of any `app.` host to `/app` using `lib/web/host-routing.ts`
(`rewritePathForHost`, honours x-forwarded-host). Owner has added
https://app.openverdict.info AND https://app-production-b800.up.railway.app
to Google OAuth origins and Enoki allowed origins.

### Railway cutover state (owner: "move everything to railway", DNS "go")
- Project `openverdict-workers` (`6bfed6c6-7cc0-4631-984b-15ab765e02b0`),
  workspace "Predictefy's Projects". Service `app` = full mode (web +
  evidence/inference/resolution workers), 22 variables incl. PORT=3000,
  OPENVERDICT_PUBLIC_WRITES=enabled, OPENVERDICT_TRUST_PROXY=1,
  NEXT_PUBLIC_* (baked via Dockerfile ARG), FIRECRAWL_*, WALRUS_UPLOAD_RELAY_*.
  Service `workers` DELETED. `app` is currently OFFLINE on purpose
  (`railway down`) because the epoch bug made its evidence worker submit a
  doomed freeze tx every 2 s (gas burned on aborts; operator 14.60 SUI).
- Railway domain https://app-production-b800.up.railway.app (verified
  earlier: site, /api/status, 7 agents, claim pages). Custom domains
  registered on `app`: openverdict.info → CNAME `jp12gpeh.up.railway.app`,
  www.openverdict.info → `fx4ky0p1.up.railway.app`, app.openverdict.info →
  `2g3sfc2h.up.railway.app`. Vercel DNS (zone on Vercel nameservers): the
  `app` CNAME to Railway is ALREADY created (rec_ffc66959b9f9ef1fcc29d66c);
  apex + www still default ALIAS to Vercel (site still served by Vercel).
- Deploy from a clean worktree: `git -C scratchpad/railway-tree checkout
  --detach <sha>` then `cd` there and `railway up -s app -d`. Scratchpad =
  /private/tmp/claude-501/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e/scratchpad.
- Vercel: project open-verdict (keep it: owns the Neon integration); env has
  FIRECRAWL_* and WALRUS_UPLOAD_RELAY_* already.

### Resume protocol (in this order)
1. `git status --short`; `pnpm typecheck`; `pnpm vitest run lib/sui lib/walrus lib/engine lib/web`; fix anything red in the manager-authored files above.
2. `pnpm vitest run` (full), `pnpm lint`, `pnpm build`.
3. Commit everything except files owned by the owner's other session (only commit what `git status` shows from this list: proxy.ts, lib/web/*, lib/sui/retention-epoch*.ts, lib/sui/{gateway,gateway-types,fake,index}.ts, lib/walrus/{store,real}.ts, lib/engine/{engine,engine.test}.ts, docs/CHECKPOINT-2026-08-29.md); message without em dashes or Co-Authored-By; push.
4. Redeploy Railway `app` from the clean worktree at the new sha; wait for SUCCESS; verify https://app-production-b800.up.railway.app/api/status and https://app.openverdict.info (TLS may take minutes after Railway validates).
5. Submit a statement-only claim on the Railway URL (POST /api/fact-checks {"claim": "...", "urls": []}); confirm evidence freezes on chain (evidence worker log has no abort-4 lines) and seats run.
6. DNS switch: `vercel dns add openverdict.info '' ALIAS jp12gpeh.up.railway.app --scope marcus-tans-projects-0956f18f` and `vercel dns add openverdict.info www CNAME fx4ky0p1.up.railway.app --scope ...`; check `railway domain status <id>` for verification/certificate; verify https://openverdict.info and https://www.openverdict.info serve Railway (compare a response header or the /api/status body); then remove the domain from the Vercel project (`vercel domains rm openverdict.info` or project settings) BUT keep the project.
7. Hosted claim `0xdb9c7bae…` is stuck at COMMIT_1 (never frozen); once the fix is live the evidence worker will freeze it if its state still allows (it may be past deadlines; if it is, leave it as residue).
8. Then: fast mode (spec in the "OWNER ASK" bullet below), per-host signer, docs (STATUS, runbook: Railway single host), memory update.

GATE AT COMPACTION #6 (03:12 local): `pnpm typecheck` CLEAN; `pnpm vitest run
lib/sui lib/walrus lib/engine lib/web` = 12 files / 103 tests passing
(incl. the new retention-epoch tests and the engine "sends Sui retention
epochs on chain" test); eslint clean on proxy.ts, lib/web, lib/sui,
lib/walrus, lib/engine. NOT yet run: full `pnpm vitest run`, `pnpm lint`,
`pnpm build`. Uncommitted tree = exactly the manager-authored files listed
above (the owner's other session has committed its landing edits; tip
before ours is `9a403cb`). Editor diagnostics claiming PromptSpecV2 vs V1
errors at engine.ts ~2307/2443 are STALE (tsc is clean); ignore them.

## STATE AT 23:10 local (2026-08-29): juror research v1 build in flight (historical)

**Read this first.** Proof chain v2 is complete and proven (see "Rollout
results" below: manifests v2 live on chain, canary certificate `0x464d397a…`).
The owner then approved the next build: **juror research v1** (jurors search
and open pages through the engine, cite only pages they opened, transcript
hashed into the run hash and sealed until reveal). Spec:
`docs/superpowers/specs/2026-08-29-juror-research-design.md`. Plan:
`docs/superpowers/plans/2026-08-29-juror-research.md` (Tasks 1 to 7; Task 6
docs already done by the manager: PRD item 9, CLAUDE.md rule, STATUS,
runbook, `.env.example`, this file).

Execution state:
- Task 1 (shared contracts) LANDED 23:14 (worker `codex-research-t1`),
  reviewed and accepted by the manager; manager fixed the stale fixture
  `lib/gonka/fixtures.test-utils.ts` (`promptVersion: "1"`). Expected
  typecheck debt until Task 5: `lib/engine/engine.ts` (v2-only manifest
  narrowing, later also `promptSpec()` return type), `lib/engine/server.ts`
  (fake adapter members), `scripts/seed-testnet-agents.ts:59`.
- Tasks 2, 3, 4 dispatched 23:15 in parallel to Codex workers
  `codex-research-t2` (`lib/research/**`), `codex-research-t3`
  (`lib/gonka/{types,adapter,adapter.test,fake,fake.test}.ts`),
  `codex-research-t4` (`lib/verify/**`, `components/claim/run-proof.tsx`,
  `app/verify/page.tsx`, `app/agents/[id]/page.tsx`). `pgrep -f
  "codex-companion.mjs task"` is the truth; reports arrive as teammate
  messages. Never `--resume-last` while several run.
- Task 4 (verifier + UI) LANDED 23:27 (worker `codex-research-t4`),
  reviewed and accepted: nine ordered checks for v3 bundles in
  `lib/verify/run-proof.ts`, research trail + citations UI in
  `components/claim/run-proof.tsx`, v3 budgets on `/agents/[id]`; 5/5
  verifier tests. Its v3 test fixture bridges the still-v2-typed
  `sealRunBundle` until Task 5 widens it.
- Task 3 (adapter `complete()`, v2 accessors, fake scripted actions) LANDED
  23:33 (worker `codex-research-t3`; its wrapper's 10-minute timeout killed
  Codex while it wrote the summary, edits were complete on disk, a fresh
  report-only turn re-verified: 89/89 lib/gonka tests). Reviewed and
  accepted. Stale job `task-mteizcc9-tldyj9` cancelled in the registry.
  Typecheck debt for Task 5 now also includes `scripts/localnet-e2e.ts:810`
  (adapter object missing the new members).
- Task 2 (`lib/research/**`) code on disk and green (39/39) at 23:37;
  manager reviewed `loop.ts`, `citations.ts`, `firecrawl.ts` (accepted);
  worker `codex-research-t2` report still pending at 23:42.
- Task 5 (engine, storage, server, scripts) dispatched 23:41 to Codex worker
  `codex-research-t5` (large; wrapper timeout raised to 25 min).
- Live probe `scripts/_tmp-research-probe.mts` (TEMPORARY, delete after)
  started 23:42: runs `runResearchLoop` per model family against Firecrawl
  cloud + GonkaRouter with an in-memory page store; log in
  `scratchpad/research-probe.log`. Purpose: confirm the three families obey
  the action protocol before the manifests are republished.
- Live probe RESULT (23:52, `scratchpad/research-probe.log`): all three
  families obey the action protocol (search, open, answer; real devshard
  ids) but every seat failed validation: MiniMax mis-copied a 66-char
  evidence id (62 hex chars) so its citation was "not opened"; MiniMax and
  Kimi quotes were "not found in the opened page" (paraphrase, or markdown
  and punctuation differences); DeepSeek's 5th model call hit the 120 s
  timeout after ~20k tokens of context (two 6,000-char slices). Fix = Task 2b
  hardening (page refs p1..pN accepted anywhere an evidence id is expected,
  citation may give url only, punctuation and markdown tolerant quote
  matching, pageSliceChars 4000, research call timeout 240 s, sharper prompt
  and repair text), then re-probe before republishing manifests.
- Task 2b (hardening: page refs, tolerant quote matching, 4,000-char slices,
  240 s research timeout, prompt text) dispatched 23:58 to Codex worker
  `codex-research-t2b` (owns lib/research, lib/gonka/{promptSpec,adapter}
  and their tests, plus two `ref` fields in lib/protocol/types.ts). Task 5
  was at the "verifying" phase (11 min in) at the same time; the two own
  disjoint files. Task 2's Codex job is gone from the registry (finished);
  its subagent report never arrived, the code was reviewed and accepted.
- After Task 2b: re-run `scripts/_tmp-research-probe.mts` (still present,
  delete after the final probe), expect valid answers with found citations
  from all three families before republishing manifests.
- 00:10 (08-30): Task 5 and Task 2b both LANDED (their Codex processes
  exited; wrapper reports never arrived, the tree was verified directly).
  Manager fixed the one seam: Task 2b made `ref` required on `StoredPage`,
  so `PageStorePage = Omit<StoredPage, "ref">` is now exported from
  `lib/research/loop.ts` and used by the engine's page store; the verifier
  v3 fixture got `ref: "p1"`. Manager reviewed Task 5's juryRun integration
  (ResearchLoopError for empty-attempt failures, GonkaRunError otherwise,
  validated-output hash in the audit, sealed blob cited as tool blob,
  Firecrawl key required in live mode, fake provider in fake mode).
  FULL GATE: `pnpm typecheck` clean, `pnpm vitest run` 36 files / 332 tests,
  `pnpm lint` 1 pre-existing warning, `pnpm build` exit 0.
- Probe 2 (hardened prompt, refs, tolerant quotes, 4,000-char slices, 240 s
  research timeout) started 00:12: `scratchpad/research-probe-2.log`.
- Probe 2 RESULT (00:20, `scratchpad/research-probe-2-PASS.log`): ALL THREE
  families returned valid cited verdicts. DeepSeek: search, open, one repair
  (first quote not found), valid answer YES 9500, 111 s. MiniMax: search,
  open, cached re-open, YES 10000 with two found citations, 17 s. Kimi:
  search, open, YES 9900, 32 s. Transcripts 5 to 6 KB. The temp probe
  script was deleted afterwards.
- Rollout started 00:22 (`scratchpad/publish-v3.log`): dry run, live publish
  of 7 v3 manifests (new prompt + tool policy hashes), dry run again (expect
  7 skipped), seed. Then the canary under the research loop.
- 00:35 v3 manifests LIVE on testnet (`scratchpad/publish-v3.log`): all 7
  profiles updated (prompt spec v2 + tool policy v2 hashes), dry run after =
  7 skipped, seed rebuilt 7/7 rows. Walrus blob / digest per index:
  0 `HlJ0IizmIWrIJgStneMwabuhTszkvkLJ5Ght0IyilZw` / `3Zy9ovY4X6hn1nwcVA8ww7E7Y2xHsK46BGkqCrxnY1cx`;
  1 `7aVmEBRt0CZu9c9TumwAKV4CTI0jxfmh9l-DbV8P2mM` / `LDfwVDkFSEcpPE7txnAev2C7hpHdokCLKQgUrNNqG8j`;
  2 `CzbeGF8sm7RU8trHw_NbHbQd8AUrRs3ciYBbiFVD_fw` / `G8QZSUVNSPvnh5Ydi5y2zPqe2VAKgZZjCrCN1vpYD4W6`;
  3 `inECrZ2MCTSCtfdx6bei2Prnk1BfDY9kHMhsE3pkyXY` / `DmXATZrj3TPCoB1qMKNYrj5xZvcerrULsZscpXfLVZan`;
  4 `b4eNb3nGN24lEH--k39jnZMl4mxhhyv1WKizFpTgaw8` / `6Wy2TjR3W9NqpKS1UzJnNFwbetD2GEJn5jaaAR1zzns9`;
  5 `U-JGQ9OEi8wmDQIn3t553xsg_7bFvIwMuR9HQIXcw0k` / `BeCDozNeNKmds5GgrQ6mocPwAHeD8XgzaudfyYjgbGGt`;
  6 `jQqf6EDhKpvXElhntWU9ukkSnSPl8QuPgddA87pvbUc` / `G9xDFK5or3mrECUqti9m6PXdf6tDqrFkhx4h6QsQYwuf`.
- OWNER AUTHORISED (00:33): commit + push, and the Railway workers service
  with `FIRECRAWL_API_KEY` in its env, "when you see fit". Plan: canary 3
  (research loop, started 00:41, `scratchpad/canary-3.log`) must pass, then
  one commit + push, then `railway up` of the same tree into the existing
  `openverdict` project (Predictefy workspace) as service `workers` with
  `OPENVERDICT_ROLE=workers` (start script now skips the web in that role;
  railway.json switched to the DOCKERFILE builder, no healthcheck).
- Canary 3 progress: claim
  `0x8b218a32d7b02ad356361a4ce4e9dfaf0290d1bb7caaac61a2b93bc0e40b392f`,
  committee digest `EQxhmCb7THc5Z19wZdSkkGjvNaqDhoSrBgPoBNCdv5H9`, 5 of 5
  seats SCHEMA_VALID under the research loop (Kimi `devshard-65732-1110`
  and `devshard-65725-643`, MiniMax `devshard-65298-3360`, DeepSeek
  `devshard-65800-756` and `devshard-65801-420`), 5 commits; reveal window
  at ~01:08, finalize after.
- OWNER ASK (01:02): resolve claims in under 5 minutes. Analysis: models take
  20 to 110 s per seat (parallel); Walrus writes ~30 s each (pages before the
  model sees them, sealed bundle before commit, reveals SEQUENTIAL); the
  hosted default ladder (defaultDeadlines: commit +30 min, reveal +45 min)
  is the real wall; claim.move enforces only increasing deadlines plus the
  floors, no minimum window. "Fast mode" follow-up (next unit after the
  deploy): hosted ladder evidence +20 s / commit +3.5 min / reveal +4.5 min
  (second round +8 / +9), parallel reveal uploads, page uploads awaited at
  the end of the loop instead of per open, small max_tokens for action
  turns, windows tuned from canary transcript timings. Trade-off: slow
  seats miss the commit (fail closed), 4-of-5 still settles.
- CAUTION before the first hosted end-to-end run: every canary used the
  LOCAL Walrus store; five seats writing to REAL Walrus in parallel with one
  operator signer is untested (possible gas-object contention on the SDK's
  register/certify txs). If it trips, serialize real-store writes with a
  mutex or fund a dedicated Walrus gas coin.
- Railway (01:15, owner authorised, "proceed as you see best"): the old
  `openverdict` project is in the trash (deletedAt 2026-08-30T09:43Z, CLI
  says "Project is deleted"), so a NEW project `openverdict-workers`
  (id `6bfed6c6-7cc0-4631-984b-15ab765e02b0`, workspace "Predictefy's
  Projects" `66ba4140-2d17-4bd7-8b7e-0df23579b4a4`, environment production)
  was created and linked to this directory; service `workers` created with
  13 variables (OPENVERDICT_ROLE=workers, OPENVERDICT_RELEASE_MANIFEST,
  DATABASE_URL, SUI_OPERATOR_SECRET_KEY, OPENVERDICT_AGENT_SEED,
  GONKA_ROUTER_BASE_URL/API_KEY, GONKA_REQUEST_TIMEOUT_MS,
  GONKA_RESEARCH_TIMEOUT_MS=240000, GONKA_MAX_RETRIES, FIRECRAWL_API_KEY,
  FIRECRAWL_API_URL, OPENVERDICT_EVIDENCE_FREEZE_LEAD_MS). Not deployed yet:
  `railway up -s workers -d` runs after the commit (respects .gitignore, so
  .env and .testnet stay local). railway.json uses the DOCKERFILE builder,
  no healthcheck (workers expose no HTTP).
- CANARY 3 PASSED (01:22): 5 commits, 5 reveals, finalized YES, truth score
  9460 bps == recomputed 9460, certificate
  `0x742e47c100d610c9ffc3fe900c81e723bd697778481fbf5cc880aebb43bd4cae`
  (https://suiscan.xyz/testnet/object/0x742e47c100d610c9ffc3fe900c81e723bd697778481fbf5cc880aebb43bd4cae),
  finalize digest `5mcmqUC3w4KLXJrpVNpbfHhcB1UUg3H55oxVWob4tWh2`. Juror
  research v1 is proven end to end on testnet with live Firecrawl and
  GonkaRouter.
- Canary 3 transcripts decrypted from `.testnet/walrus-local` (01:24):
  all 5 sealed bundles decrypt with the revealed keys and match the revealed
  cores; `transcriptHash(bundle.transcript) == audit.toolTranscriptHash` for
  all 5; every citation `found=true`. Per-seat research time (first step
  start to answer): MiniMax 25 s (1 search, 1 open, one repaired answer),
  DeepSeek 41 s (search, cached open, answer) and 90 s (2 searches, 3 opens,
  one repair), Kimi 101 s and 146 s (up to 2 searches, 3 opens, 6 turns).
  Cached opens (a page another seat already stored) do not consume the open
  budget. Note: the audit copy INSIDE the sealed core carries empty blob ids
  (the sealed blob id is only known after sealing); the database audit row
  and the on-chain approve_run carry the sealed blob as run and tool blob
  (engine test asserts it).
- Tip moved under us: the owner's other session committed `app/icon.svg`
  as `19cc76a feat(landing): add the tab favicon`; our tree sits on top.
- COMMITTED 01:27 as `9b58256 feat: proof chain v2 and juror research v1`
  (92 files, +12110 / -683) on top of `19cc76a`; pushed to origin main
  (Vercel builds from it); `railway up -s workers -d` started right after.
- RAILWAY WORKERS LIVE 01:37: deployment `81979b39-bc33-4751-848a-921abebcca8b`
  SUCCESS (Dockerfile build); logs show exactly one launch each of
  evidence-worker, inference-worker, resolution-worker, no web process, no
  errors (pg SSL-mode warnings are benign), no restart loop. The hosted
  back office exists for the first time.
- Vercel production Ready on `9b58256` at 01:40 (`open-verdict-o91vbssfr`,
  44 s build); `/api/status` healthy (suiHealthy, gonkaMode live, walrusMode
  testnet, dbHealthy).
- HOSTED WRITE BUG FOUND 01:45 (first hosted submission ever attempted):
  `POST /api/fact-checks` on Vercel failed twice with the Walrus SDK error
  "Too many failures while writing blob ... to nodes" while uploading the
  submitted text. Cause: a serverless function cannot fan a blob out to
  ~100 storage nodes (the SDK aborts once a third of the shards fail). No
  claim residue (the write precedes the claim record). Remedy: the Walrus
  UPLOAD RELAY (docs: for clients that cannot open many connections).
  Probe from this machine through
  `https://upload-relay.testnet.walrus.space` with the operator key: write
  in 13.6 s (direct fan-out takes ~30 s), tip 105 MIST, read back exact.
  `createRuntimeRealWalrusStore` now passes `uploadRelay` when
  `WALRUS_UPLOAD_RELAY_URL` is set (max tip `WALRUS_UPLOAD_RELAY_MAX_TIP_MIST`,
  default 1000); both variables set on Vercel production and on the Railway
  `workers` service (skip-deploys, redeploy after the commit).
- Relay wiring committed as `9ca5d57 fix(walrus): optional upload relay for
  constrained hosts` and pushed (01:52). `components/landing/manifesto.tsx`
  was modified in the tree by the owner's other session and was deliberately
  left out. Railway redeploy runs from a clean worktree of HEAD in the
  scratchpad (`scratchpad/railway-tree`, `git worktree add --detach`), so the
  other session's uncommitted edit never reaches the image.
- 01:56 Vercel Ready on 9ca5d57 (`open-verdict-3zm4kq1hz`); Railway
  redeploy `b8ad7841` SUCCESS (three workers launched, relay env present).
- HOSTED SUBMISSION, THIRD ATTEMPT (01:57): the relay fixed the Walrus write
  and the request created the FIRST hosted claim ever,
  `0x1936ddd30c00c7641465dd2ed5577385f022827a603873fe86466be350182b70`
  (default hosted ladder: evidence cutoff +5 min, commit +30, reveal +45),
  but the evidence ingestion then failed with a Sui rejection: "Transaction
  needs to be rebuilt because object 0xdba0339f... version 0x3b61c93d is
  unavailable for consumption, current version 0x3b61c96a" (45 versions
  stale). Cause: the Walrus SDK builds and executes its own register and
  certify txs with the shared operator signer and has no rebuild-on-stale
  retry (lib/sui/execute.ts has one for gateway txs only); the Vercel
  function, the Railway workers and tonight's local scripts all move the
  same coins. Result: the claim exists with zero artifacts; the evidence
  worker logs "evidence cannot be frozen without an accepted artifact" every
  tick for it (isolated, noisy; the claim is testnet residue).
- Hotfix dispatched 02:04 to Codex worker `codex-walrus-retry`: retry
  `writeBlob` up to 3 times on "unavailable for consumption" / "needs to be
  rebuilt" errors in `lib/walrus/real.ts` (+ tests). Follow-ups recorded:
  (a) statement-only claims (freeze should not need a submitted artifact now
  that jurors research), (b) stop retrying a claim whose evidence cutoff
  passed with no artifact (mark it failed once), (c) longer term a separate
  signer per host so coins are never shared across processes.
- Hotfix LANDED 02:16 (worker `codex-walrus-retry`, reviewed): `put()`
  retries `writeBlob` up to 3 times on "unavailable for consumption",
  "needs to be rebuilt", "ObjectVersionUnavailableForConsumption" (cause
  chain searched), delay 750 ms x attempt, injectable sleep; 29/29 walrus
  tests, typecheck and lint clean. Committed and pushed right after.
- HOSTING DECISION (owner, 02:10): consolidate everything on Railway; Vercel
  only until then. Facts gathered: `openverdict.info` uses Vercel
  nameservers (ns1/ns2.vercel-dns.com), so the move is DNS records in Vercel
  DNS (ALIAS apex + CNAME www to the Railway service), reversible, CLI-able,
  needs the owner's go for the switch itself. Railway passes service
  variables into Dockerfile builds only through `ARG` lines, so the build
  stage must declare `ARG NEXT_PUBLIC_ENOKI_API_KEY`,
  `ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `ARG NEXT_PUBLIC_SUI_NETWORK` and
  export them before `pnpm build`. Plan: prove the hosted flow on the split
  first, then run the full app (role unset) on Railway with a Railway
  domain, verify, then switch DNS, then retire Vercel.
- 02:20 hotfix commit `202be80` pushed; Vercel rebuilding; Railway redeploy
  `075d69fd` from the clean worktree. Codex worker `codex-statement-only`
  dispatched 02:22 for follow-ups (a) statement-only claims (the statement
  becomes the guaranteed first artifact, `statement:<claimId>:<phase>`,
  `urn:openverdict:claim-statement`) and (b) the evidence worker skips a
  claim once its cutoff passed with no accepted artifact (in-memory set,
  logs once, `EngineNoEvidenceError`).
- Both hosts green on `202be80` (Vercel `open-verdict-wk18lrm3m`, Railway
  `075d69fd` SUCCESS). HOSTED SUBMISSION SUCCEEDED (fourth attempt): the
  live site returned claim
  `0xdb9c7baef74326b379535ef38b478697955fb37cf487e8fb7538312644efb71d`
  (state 3 REVIEW_REQUESTED, evidence cutoff +5 min, default hosted ladder
  commit +30 / reveal +45, so resolution takes about 45 minutes). A monitor
  polls `/api/claims/<id>` for state changes; the Railway workers must
  freeze evidence, select the committee, run the research loop, commit,
  reveal, finalize.
- CONSOLIDATION STARTED 02:35 (owner: "move everything to railway"):
  Dockerfile build stage declares ARG/ENV for NEXT_PUBLIC_ENOKI_API_KEY,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_SUI_NETWORK; railway.json
  health-checks /api/status. Railway service `app` created in project
  `openverdict-workers` with 21 variables (the workers' set plus
  OPENVERDICT_PUBLIC_WRITES=enabled, OPENVERDICT_TRUST_PROXY=1,
  OPENVERDICT_OPERATOR_TOKEN, NEXT_PUBLIC_ENOKI_API_KEY,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_SUI_NETWORK=testnet,
  SUI_NETWORK=testnet; no OPENVERDICT_ROLE, so it runs web + 3 workers).
  Plan: deploy `app` from the clean worktree, give it a Railway domain,
  verify site/API/claim there, retire service `workers`, then on the
  owner's "go" add openverdict.info + www as Railway custom domains and
  switch Vercel DNS (ALIAS apex, CNAME www); keep the Vercel PROJECT (it
  owns the Neon integration), only remove the domain from it.
- 02:07 Railway `app` deployment `69a8d82b` SUCCESS from `197cb7c` (web +
  evidence/inference/resolution workers in one container, "Ready in 138ms");
  Railway domain generated: https://app-production-b800.up.railway.app
  (domain id `62a1ca5c-a5f4-415a-900e-87242e26fcdd`, port 3000). Service
  `workers` DELETED (only `app` runs workers now).
- Hosted claim `0xdb9c7bae…`: committee `0xd1daa5b7…` drawn 18:05:53Z with
  5 ACCEPTED seats, state COMMIT_1 at 02:06 local; phase-1 artifacts: 1
  (`urn:openverdict:submitted-text`). Processing continues on the `app`
  workers (the `workers` container was retired mid-flight; the advisory
  lock releases on disconnect).
- 02:12 HOSTED RESEARCH RUNS DONE: claim `0xdb9c7bae…` shows 5 commitments
  at COMMIT_1, meaning five research seats ran on Railway against REAL
  Walrus (relay + stale retry, five seats in parallel on one signer) and
  committed. The resolution worker's `advance_phase` abort code 7
  (E_DEADLINE_NOT_REACHED) every tick is expected until the commit floor
  (created + 30 min, about 02:27 local); reveal floor at +45 (about 02:42).
- Railway URL returned 502: the domain was created for port 3000 but Railway
  injects its own PORT; fixed by setting service variable PORT=3000 on
  `app` (redeploy in progress). Verify https://app-production-b800.up.railway.app after it.
- 02:18 Railway URL VERIFIED after PORT=3000: https://app-production-b800.up.railway.app
  serves `/api/status` healthy, homepage 200, `/agents` (7 jurors),
  `/claims` (2), `/verify`, and the hosted claim page, all 200 in under
  0.6 s. Statement-only follow-up committed as `9a403cb` and pushed;
  Railway `app` redeploy `4bcfded3` in progress from it.
- DNS facts for the switch: Vercel DNS zone has default records only (CAA
  x3, `*` ALIAS cname.vercel-dns-017.com, apex ALIAS
  b87ac0cd64dd3aed.vercel-dns-017.com). Switch plan once the owner says go:
  `railway domain openverdict.info -s app` and `railway domain
  www.openverdict.info -s app` (Railway prints the CNAME target), then
  `vercel dns add openverdict.info '' ALIAS <target>` and `vercel dns add
  openverdict.info www CNAME <target>`, verify Railway serves the domain
  with TLS, then `vercel domains rm`/project domain removal (keep the Vercel
  project itself: it owns the Neon integration).
- 02:30 ROOT CAUSE of every hosted freeze failure: Move compares a Walrus
  epoch with the Sui epoch (`walrus_end_epoch >= ctx.epoch()` in
  evidence.move:56, jury.move:436 and :523, E_RETENTION_EXPIRED = 4). The
  engine passes the blob's WALRUS end epoch (hundreds) against the SUI epoch
  counter (~900), so freeze_evidence aborts on every hosted claim with real
  Walrus; canaries passed only because the local store yields
  MAX_LOCAL_WALRUS_EPOCH. The evidence worker retried the doomed tx every 2 s
  (gas burned on aborts: operator 15.18 → 14.60 SUI tonight incl. canaries)
  and that coin churn is what broke the other transactions (stale-object
  rejections). Mitigation: `railway down -s app` (service Offline, Vercel
  still serves the domain). Fix dispatched 02:33 to Codex worker
  `codex-retention-epoch`: lib/sui/retention-epoch.ts converts Walrus end
  epochs to Sui epochs using both chains' current epoch and epoch duration
  (store.epochInfo(), gateway.epochInfo()), applied to freeze, approve_run,
  reveal; DB keeps Walrus epochs. Hosted claim `0xdb9c7bae…` is stuck at
  COMMIT_1 (never frozen; no runs); the "5 commitments" in the API were
  seat statuses, not votes.
- DNS SWITCH (owner said go 02:31; Google OAuth + Enoki origins for the
  Railway URL already allowed by the owner). Railway custom domains added on
  `app`: openverdict.info → CNAME jp12gpeh.up.railway.app, www →
  fx4ky0p1.up.railway.app, app.openverdict.info → 2g3sfc2h.up.railway.app
  (certificates validate once DNS resolves). Owner wants the distinction
  openverdict.info (landing) vs app.openverdict.info (the app); today
  app.openverdict.info returned Vercel DEPLOYMENT_NOT_FOUND (unassigned), so
  its CNAME was created immediately (no regression); apex + www records
  switch only after the epoch fix is deployed and the Railway app verified.
- Next: land the epoch fix, redeploy `app`, verify on the Railway URL and on
  app.openverdict.info, then switch apex + www (ALIAS/CNAME in Vercel DNS),
  verify TLS + sign-in + a claim, remove the domain from the Vercel project
  (keep the project: Neon integration), then fast mode, per-host signer.
  (engine, storage, server, scripts, engine tests) to one Codex worker; then
  Task 7 rollout by the manager (publish v3 manifests, seed, live probe,
  canary).
- Provider decision: Firecrawl CLOUD with a dedicated account (owner created
  it, 1,400 credits; key saved to local `.env` as `FIRECRAWL_API_KEY`, never
  printed). Self-hosted Firecrawl (AGPL, docker compose, needs SearXNG for
  search) is a configuration-only switch later (`FIRECRAWL_API_URL`).
- Hosting decision: Railway for the workers (recommended, owner said "okay got
  it" to the explanation; deployment NOT yet authorised), Firecrawl self-host
  would go on a VPS, not Railway.
- Still NOT authorised by the owner: git commit/push (deploys Vercel), Railway
  service creation. Ask before either.
- Working tree: everything from proof chain v2 plus the research docs is
  uncommitted; never reset/clean; workers were told the same.

## STATE AT COMPACTION #5 (2026-08-29 ~22:00 local): proof chain v2 mid-flight

**Historical; superseded by the 23:10 section above and "Rollout results".**
Tip is still `0dc4e4e` (the user's other agent committed the landing video).
Nothing from this session is committed. The user said "do what's best, the
most architecturally perfect solution" for provable prompts, so the whole
proof chain v2 was built by Codex workers under the plan
`docs/superpowers/plans/2026-08-29-proof-chain-v2.md` (Tasks 1 to 7; read it).

### Work landed in the tree (uncommitted), reviewed by the manager

| Unit | Files | Verdict |
|---|---|---|
| Task 1 core (worker `codex-task1-core`) | `lib/gonka/promptSpec.ts` (+test), `lib/engine/agentManifestDocument.ts` (+test), `lib/engine/runBundle.ts` (+test), `lib/protocol/types.ts` (shared types), `lib/gonka/{adapter,fake,types,audit,index}.ts`, `lib/engine/{engine,contract,index}.ts` | Reviewed, correct. Fail-closed prompt binding in `juryRun` (engine.ts ~546), `runProof` + `agentManifestDocument` engine methods, zkLogin registration uses the v2 document builder. |
| Task 3 step 1 Sui (worker `codex-task3-sui`) | `lib/sui/{builders,gateway,gateway-types,fake,sui.test}.ts` | Reviewed, correct: `buildUpdateAgentManifestTransaction`, `gateway.updateAgentManifest` signed by the agent key, fake bumps version. 31 tests pass. |
| Task 7 Walrus raw blobs (worker `codex-task7-walrus`, implemented directly, not via Codex; accepted) | `lib/walrus/{real,real.test,store}.ts`, `lib/engine/server.ts` (`createRuntimeRealWalrusStore` now calls `createRealWalrusStore` with `OPENVERDICT_SUI_GRPC_URL` override) | Reviewed, correct. Store uses `writeBlob`/`readBlob`; tests assert no quilt calls. |
| Manager edits | `cli/src/index.test.ts` (fake engine gained `runProof`/`agentManifestDocument`), `lib/engine/server.ts` (`createDynamicFakeAdapter` gained `promptSpec`/`promptSpecHash`), `PRD.md` section 1.1 item 8, diagrams 05/06 text | Done. |

### Work still running at compaction (check first when resuming)

- **Task 2 sealing** (worker `codex-task2-seal`, Codex pid was alive): owns
  `lib/engine/engine.ts` (juryRun upload block ~1455-1600, `votesReveal`
  ~665-700, `runProof` ~1134), `lib/engine/contract.ts` (`RunProof.sealed`),
  `lib/engine/engine.test.ts`, `lib/storage/*`. Storage columns already
  landed: `seal_key_hex, seal_iv_hex, core_hash, sealed_blob_id,
  sealed_object_id, revealed_blob_id, revealed_object_id` (+ `audit.bundleCore`).
  At compaction the engine still published the plaintext core at inference
  time (grep `sealRunBundle` in engine.ts to see whether sealing landed).
  A follow-up was sent to this worker: registerZkBackedAgent must pass the
  evidence policy LABEL (`OPENVERDICT_EVIDENCE_POLICY_V1`, export
  `EVIDENCE_POLICY_V1_LABEL` from agentManifestDocument.ts) instead of the
  hex `evidencePolicyId(manifest)`, otherwise the zk path double-hashes.
- **Task 3 scripts** (worker `codex-task3-scripts`, Codex pid was alive):
  `scripts/lib/testnet-agents.ts` (new, reviewed: reads AgentProfile fields
  from chain), `scripts/publish-agent-manifests.ts` (new, reviewed: dry-run
  flag, idempotent, uses `OPENVERDICT_SUI_GRPC_URL`), `scripts/seed-testnet-agents.ts`
  (v2, not yet reviewed), `scripts/{testnet-canary,localnet-e2e,cockpit-demo}.ts`
  (modified, not yet reviewed). Open typecheck error at compaction:
  `scripts/lib/testnet-agents.ts:46` TS7022 (`page` implicitly any; add an
  explicit type to the `page` const).
- **Task 4 UI** (worker `codex-task4-ui`, Codex finished, subagent verifying):
  `app/api/claims/[id]/runs/[runId]/proof/route.ts`, `app/api/agents/[id]/manifest/route.ts`,
  `components/claim/run-proof.tsx`, `lib/verify/run-proof.ts` (+test),
  `app/{claims/[id],verify,agents/[id]}/page.tsx`. Reviewed: browser recompute
  of promptHash/inputHash/outputHash/runHash + WebCrypto AES-GCM decrypt of
  the sealed blob; `deriveRunId` mirrors engine `deterministicId`. Open
  typecheck error: `app/agents/[id]/page.tsx:98` (`agent` possibly null inside
  the async closure; capture `agent.agentProfileId` before the closure).
- **Process incident:** around 21:50 local the concurrent Codex turn
  processes (Tasks 2, 3, 4) were killed externally at the same moment, about
  10 minutes into their runs (reported by the UI worker; cause unknown, the
  shared app-server survived). Completeness was verified afterwards by grep
  and tests: Task 2 sealing + reveal publication + `RunProof.sealed` + seal
  tests present; Task 3 seed v2 (`parseAgentManifestDocument`, placeholder
  refusal) + canary/e2e/cockpit on the document builder present; Task 4
  routes, component, `lib/verify` (tests pass) present. The ONLY casualty:
  the Task 2 follow-up (evidence policy label) never ran; the manager then
  applied it directly (`EVIDENCE_POLICY_V1_LABEL` exported from
  agentManifestDocument.ts, used by `evidencePolicyId()` and by
  registerZkBackedAgent; typecheck clean, engine tests 25/25). Still missing
  from that follow-up: the extra test assertion that the saved zk manifest's
  evidencePolicyHash equals evidencePolicyId(manifest); add it during review. Lesson recorded by the UI worker: `codex-companion
  --resume-last` is UNSAFE with concurrent workers (shared job registry,
  resolves to the most recent job of any worker and throws while stale jobs
  are marked running); recover by starting a fresh task that is handed the
  current diff and told to verify/complete rather than redo.
- **Final snapshot right before compaction (the one live Codex process is
  the UI worker's recovery run that verifies/completes Task 4):**
  `pnpm test` = 30 files / 260 tests passing; `pnpm typecheck` = CLEAN
  (manager fixed `app/agents/[id]/page.tsx:98` by capturing
  `agent.agentProfileId` before the closure); `pnpm lint` = 1 pre-existing
  warning; `pnpm build` not yet run;
  sealing IS wired in engine.ts (`sealRunBundle` / `revealedBlobId` present);
  `scripts/lib/testnet-agents.ts` typecheck slip fixed by its worker;
  52 changed or new files outside `docs/diagrams`. Verify with
  `pgrep -f "codex-companion.mjs task"` and `grep -n EVIDENCE_POLICY_V1_LABEL lib/engine/*.ts`.

### Rollout results (2026-08-29 ~22:35 local, after compaction #5)

Gate before rollout: `pnpm test` 30 files / 261 tests, `pnpm typecheck`
clean, `pnpm lint` 1 pre-existing warning, `pnpm build` exit 0 (route table
includes `/api/agents/[id]/manifest` and `/api/claims/[id]/runs/[runId]/proof`).
Manager review of the Task 2 engine diff and the Task 3 scripts diff: accepted.
One fix applied during review: `registerZkBackedAgent` always uses the
policy LABEL and fails closed if `blake2b256(label) != evidencePolicyId(manifest)`
(a release manifest overriding `evidencePolicy.id` is rejected before any
upload); tests "fails closed when the release manifest overrides the evidence
policy id" plus the evidencePolicyHash assertions in the zk registration test.

`scripts/publish-agent-manifests.ts` LIVE (second attempt; the first died on
the very first Walrus write with `NotEnoughBlobConfirmationsError: Too many
failures while writing blob` while vitest + tsc were hogging the machine, the
SDK aborts once more than a third of the shards fail; rerun in isolation
succeeded, nothing partial was left behind because the write precedes the tx):

| idx | AgentProfile | manifest_hash (v2 document) | Walrus blob | update_agent_manifest digest |
|---|---|---|---|---|
| 0 | `0x3632472833db8ee832a9c3456397e4ac80f77bb2972d3f7d46d0bbd8a894278e` | `0x68a8dd0d78c0c059f5f9bff71b36c2c83c8a51ef9e0b56b63ba4ac9fa9d1caf7` | `wZ8Z5j4-MTY_-33o6RcdFFOLcR0raXIZFcx_CvPUgDM` | `AoFYhmSvVeTe5BPdfdjEjyg395HdihALBDxqbVeEPrxn` |
| 1 | `0xddcd12983e42ae006311222ee4c08b6627d07872f6ecc13c9554852ea30e2bbc` | `0xce302b168fd37d3424d8679c05c42724498acf5cb509a1c7350afc78ba58d93c` | `pf9rm9kzqUp_gO0efq4t6Y0CAR8ONaXJO3QnQ56cDDU` | `8XMHTAbmqnzydhC1sG4w96nY7T2i33ni8BGSCoYZTy14` |
| 2 | `0x1d5158475e43d2f0527b6e5755d761ac11f26a3e50861587ec48a33433b1c577` | `0x2dd8f0febe5abefbfc9cda941548a400ca67feaf4d25da6bf8947e439c0a468a` | `jtBkavLG37yy0ORIvS34b-J0ySXPaXbBAnQCFFTDtIk` | `2rTQ6CYd3LdpVKCtWH4j1vRX5gYjsWGnivuPh8PKSRBU` |
| 3 | `0x044ef4ad36671dedb3ec926a529a2f26d935ab26c026ca2dc73d580cc8ea3325` | `0x8629a323df410206eadb1feec53e98d60bc76439405921c5988ccf0610559be9` | `vwOjTZEvj0bSqqmFdvKXZ8IObgyhMgL-pjlT-leAOPA` | `DjmjJaTXm3R1Vhxr4V5oALogRZQB2zQ4zo9fgrKdd3S5` |
| 4 | `0x67110c91189f426316985f253292a17ba64ef8d54d34600b32adc3e5ee25c1ec` | `0x47e3cb4f8a9c05ce3cb54a283a2b1db0e7d9d0b482bb690aad254e1e1cd9288e` | `i_5X7TNrpNm3LuJ1ERjNHYri8jhTdPEVZOh0lFWVSmw` | `68ixwChb3bkX7rnWaTRniehQXzAEG7bWEhJxVhWcEKcU` |
| 5 | `0x19e6bda3a5f04bb4947e4896a1c6eaadaf2cf2fd0907b69b052b97b80230f63e` | `0x089f0763f7e18bf8ab1a59d0e13b001c24ea3cf46c86cc4a1b0a5d92b1f17db2` | `ErK9YeI0gwpMOb6zPE8KUvCYvXrVcPcrw9xq_pvq9ZE` | `72WwcC7Lcb3vAe8CjLhLgRe69JW5f52hviHUsrP7xbBc` |
| 6 | `0x6ef1974fc6bd98b230eb4606119535150503cef14646473fc0d4261e235aec76` | `0x4b2e3deb86a87d37717c5eab032667e17d86f8300e2200fba84c5cfe958590ea` | `-V5xQKxnjZLtqKNkP64fArZ2uePoZg7ciFUCuzUMO7k` | `5m3HNFcLSL6ueNrcT8tVibGmPjPyRB5c5v3qt7WDXYQw` |

Verification: a second `--dry-run` reported all 7 rows `skipped` (on-chain
`manifest_hash` == blake2b256 of the deterministic document). The production
Neon rows were rewritten as version "2" by the publish itself; the repository
reads the newest row per profile (`DISTINCT ON ... ORDER BY
registered_checkpoint DESC, created_at DESC`), so the v1 placeholder rows are
shadowed, not duplicated. The deployed HEAD types `version` as a plain string
with no runtime validation, so the live site keeps serving the 7 jurors.
`seed-testnet-agents.ts` (production `DATABASE_URL`): first attempt
`AggregateError [ETIMEDOUT]` from pg-pool at `migrate` (Neon cold start),
retry rebuilt all 7 rows from chain + Walrus documents with matching hashes
(roles 0-2 SOURCE_AUTHENTICITY / DeepSeek-V4-Flash-0731, 3-4 SKEPTIC /
MiniMax-M2.7, 5-6 SKEPTIC / Kimi-K2.6).
Canary attempt 1 (22:37): created claim
`0xd174c1f9c77284006c5acf1407ce54ae89800522c36a0aa35b1e1ea1d1be7193`, then
died on `TypeError: fetch failed` inside `getBalance` on the publicnode
JSON-RPC while the seed script shared the same endpoint; the claim is
orphaned on testnet (harmless). Attempt 2 (22:41 to 23:02, in isolation)
COMPLETED under proof chain v2 with live GonkaRouter:
claim `0xa24ec090704381283de484b8619b179fe241e5de5e6daacfd03ccf6598df8b4e`,
committee digest `7AJXrKi4z5JCizGZ2Cm36xw4UDwa8caHMoYZkM6aYtwS`, 4 of 5 seats
`SCHEMA_VALID` (DeepSeek-V4-Flash `devshard-65729-541` and
`devshard-65704-2007`, MiniMax-M2.7 `devshard-65275-1844`, Kimi-K2.6
`devshard-65728-68`); the fifth Kimi seat `0x19e6bda3…` got `PROVIDER_ERROR`
(transient `fetch failed` to GonkaRouter, fail closed, no vote); 4 commits, 4
reveals (plaintext bundles + keys as reveal arguments), finalized YES, truth
score 9625 bps == recomputed 9625, certificate
`0x464d397ab31e23814c9b4789474e426a2907fb9ecaafd81984702a5b85a15e82`
(https://suiscan.xyz/testnet/object/0x464d397ab31e23814c9b4789474e426a2907fb9ecaafd81984702a5b85a15e82),
finalize digest `He3gvUTwLdzrpytP2CYuEQN3YpfyXHnnDfBBhVzv6gvV`. The prompt
binding check passed for all seats (manifest promptHash == live spec). The
canary uses the LOCAL Walrus store (`.testnet/walrus-local`) and PGlite
(`.testnet/pglite`), so its sealed and revealed blobs are local files.

### Not started yet

- Task 5 docs: DONE except the checkpoint lines above (STATUS.md layer rows,
  runbook steps 4 and 5 in section 2, Known gaps updated).
- Task 6 rollout (manager only), in order:
  1. Full gate: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
  2. Env for local scripts (never commit, values live in the scratchpad):
     `set -a; source .env; source /private/tmp/claude-501/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e/scratchpad/rollout.env; set +a`
     (rollout.env holds `DATABASE_URL` pulled from Vercel, `OPENVERDICT_SUI_GRPC_URL=https://public-rpc.sui-testnet.mystenlabs.com`,
     `OPENVERDICT_RELEASE_MANIFEST=config/release.testnet.json`; `.env` holds the Sui keys, agent seed, Gonka key).
  3. `pnpm tsx scripts/publish-agent-manifests.ts --dry-run`, then live
     (7 `update_agent_manifest` txs signed by the agent keys, each holds
     0.024 to 0.036 SUI; operator holds 15.18 SUI + 5.000 WAL). Verify with
     `sui_getObject` that all 7 profiles carry the new `manifest_hash`, then
     `pnpm tsx scripts/seed-testnet-agents.ts` must reconstruct the same rows.
  4. Deploy: production deploys from git, so this needs a commit + push,
     which the user has NOT yet authorized (standing rule: never commit
     unless asked). Ask, then `vercel redeploy` is not needed (push builds).
  5. `scripts/testnet-canary.ts` (explicit short deadlines: commit +15 min,
     reveal +18; about 20 min, about 0.1 SUI, live GonkaRouter) with the
     env above; inspect one sealed blob and one revealed bundle; try the
     browser recompute on the report page.
  6. Update this file with certificate id and blob ids.
- Evidence discovery unit (proposed, NOT approved): statement required;
  URLs and context optional and labelled `USER_SUBMITTED`; engine-side
  recorded search (Firecrawl or similar) fetches top results through the
  SSRF-safe retriever, labels them `DISCOVERED`, freezes everything before
  inference; prompt spec bump means republishing manifests. User asked which
  design is fairest; this was the recommendation. DIVE (the predecessor,
  github.com/derek2403/cannes2026) never fetched anything: its "research" is
  the prompt line "Research independently. Cite sources with URLs" plus a
  regex that harvests URLs from the model text (run-session.ts:188).

### Facts established this session (do not relearn)

- GonkaRouter live probe: body `id` = `devshard-<n>-<seq>`, headers
  `x-request-id` and `x-devshard-id`, `system_fingerprint` `vllm-…`; no Gonka
  chain record id. Gonka runs inference in devshards (on-chain escrow
  sessions, off-chain per-request billing), so brokers expose no per-request
  ledger record. Recorded as audit pointers only.
- Operator `0xff3538d7…9e1a` holds 5.000 WAL after tx
  `5wsBonnaCKCvtRJpoDjsjK62EgphV4U1AWbFYAKJwGm1` (exchange
  `0x8259…ef9f::wal_exchange::exchange_all_for_wal`, object `0xf4d1…9073`,
  1:1). Before that it held none: no hosted Walrus write could have worked.
- `*.sui.io` fails TLS from this Mac (curl, openssl, Node: "wrong version
  number"). Use `https://public-rpc.sui-testnet.mystenlabs.com` for gRPC and
  `https://sui-testnet-rpc.publicnode.com` for JSON-RPC locally. Vercel is
  unaffected. A raw Walrus write takes about 29 s, a quilt write 28 to 43 s.
- Walrus quilt bug (fixed by Task 7): `writeFiles` blob ids address the quilt
  container; only `writeBlob`/`readBlob` round-trip bytes.
- Probe pattern that works: write a temp `scripts/_tmp-*.mts` inside the
  repo (so `@mysten/*` resolves), run with `pnpm tsx`, delete it after.
  Scratchpad holds `gonka-probe.mjs`, `balances.mts`, `coins.mts`,
  `get-wal.mts`, `rpc-exchange.mjs`, the DIVE clone under `dive/`, and
  `vercel-link/` (linked project + pulled production env).
- Deadline floors, pre-reveal exposure, select_committee 7-to-32 rule,
  reputation inert: see the sections below (still accurate).
- Codex workers show as "idle" in ListAgents while their Codex process runs;
  that is the harness pausing, not a failure. Their reports arrive later as
  teammate messages. `pgrep -f "codex-companion.mjs task"` is the truth.

### Decisions still owed by the user

1. Worker host (nothing on Vercel advances claims): container from the
   Dockerfile recommended, laptop for the demo as fallback.
2. Shorter demo deadline ladder for the hosted site (default needs 45 min).
3. Evidence discovery unit (above): yes / no / shape.
4. UX consolidation 15 to 7 routes (designed, not approved).
5. Google Auth Platform audience "In production" and Enoki Save: confirm.
6. Authorize the commit + push that deploys the proof chain v2 to Vercel.

## Production is live (tip 94a9a37)

```
https://openverdict.info          200, apex + www both serve (NO redirect between them)
/api/status  suiHealthy ✓ gonkaMode live walrusMode testnet dbHealthy ✓ paused false
/api/agents  7 jurors, 3 model families
/api/claims  200, docket empty (no claim has run through the hosted app yet)
```

- Domain `openverdict.info` bought, NS delegated to Vercel (`ns1/ns2.vercel-dns.com`),
  verified at the `.info` registry. Both apex and `www` attached + verified.
- Vercel project `open-verdict`, team `marcus-tans-projects-0956f18f`,
  stable alias `open-verdict-nine.vercel.app`.
- Neon `neon-teal-book` provisioned + connected (prod/preview/dev), injects a
  real `DATABASE_URL` (us-east-1 pooler). Migrations self-run at engine.ts:138.

## FOUND 2026-08-29 evening: production CANNOT finish a claim (no worker host)

Verified directly (grep of app/api, workers/, scripts/): the API routes call
only `status`, `factCheckStart`, `claimCreate`, `listClaims`, `inspect`,
`report`, `events`, `listAgents`, `registerZkBackedAgent`. Every lifecycle
method (`selectCommittee`, `evidenceFreeze`, `juryRun`, `votesCommit`,
`votesReveal`, `advance`, `finalize`) is called ONLY from `workers/*.ts`,
`cli/`, and `scripts/`. The three workers are launched only by
`scripts/start-production.mjs` (Dockerfile, railway.json). Vercel never runs
it; there is no cron and no tick route; the engine has no in-process loop (the
`while (true)` at engine.ts:1142 is the SSE generator). `factCheckStart`
(engine.ts:203) creates the Claim on Sui, ingests the evidence, and returns.

Consequence: a claim submitted on openverdict.info is created on Sui and then
waits at REVIEW_REQUESTED forever. Options (user's call): (a) run ONLY the
workers in a container (Railway / Fly / Render via the Dockerfile) against the
same DATABASE_URL + env, keep Vercel for the site; (b) laptop for the demo
window: `DATABASE_URL=<neon> pnpm tsx workers/<evidence|inference|resolution>-worker.ts`
x3 with the production env; (c) Vercel Cron + a tick route: fragile, one tick
can hold a 120 s model call per juror. Recommendation: (a), (b) as fallback.

New diagrams (colour, excalidraw-diagram skill, each verified against code):
`docs/diagrams/01-architecture-overview`, `02-user-flow`,
`03-runtime-swimlane`, `04-engine-and-workers`, `05-data-placement`,
`06-protocol-artifacts`, `07-production-topology`, and `00-end-to-end-poster`
(the all-in-one the user found too dense; kept for reference). `.excalidraw`
source + `.png` for each. The four older monochrome diagrams are unchanged.

## The 5 stacked deploy faults fixed tonight (each hid the next)

| Commit | Fault |
|---|---|
| `152f5b1` | Five distinct wiring failures collapsed into one opaque `engine_not_wired` 503. Now logged server-side. **This is what made everything else diagnosable — keep it.** |
| `065fadb` | `??` treats a blank env var as a real value. Vercel stores value-less vars as `""`, so `OPENVERDICT_RELEASE_MANIFEST=""` reached `existsSync("")`. Added `readEnv()` (blank/whitespace = unset) + 4 tests. Also gitignored `.vercel/`. |
| `06dc288` | Manifest path arrives at runtime, so Next's tracer never bundled `config/release.testnet.json`. Added `outputFileTracingIncludes: {"/*": ["./config/*.json"]}`. |
| `4662347` | `/* webpackIgnore: true */` on the `@mysten/walrus` dynamic import hid it from the tracer → "Cannot find package". Dropped it, added to `serverExternalPackages`. |
| `6fd98b6` | PGlite fallback mkdir'd on a read-only serverless root (`EROFS /var/task/.pglite`). Added `PGLITE_DATA_DIR` override. |
| `94a9a37` | `buildServerEngine` passes NO `initialAgents`, so a hosted deploy could never have jurors and any draw died on "live mode requires the registered manifest". New `scripts/seed-testnet-agents.ts`. |

## Agent seeding — VERIFIED against chain, do not redo

`scripts/seed-testnet-agents.ts` reads the 7 AgentCaps already registered on
testnet under the deterministic owners from `OPENVERDICT_AGENT_SEED` and writes
matching manifests into Neon. **Registers nothing, spends no SUI.** Canonical
cap per owner = lowest objectId (agrees with testnet-canary.ts + prune-registry.ts).

Verified 7/7 against `sui_getObject`: owner address, `manifest_hash`,
`model_hash`, `role_hash`, `human_backing_hash`, object type, `active:true`
all match. Split: 3× DeepSeek-V4-Flash (SOURCE_AUTHENTICITY), 2× MiniMax-M2.7
+ 2× Kimi-K2.6 (SKEPTIC). Satisfies minDistinctModels 3 / maxSeatsPerModel 2.

**Known placeholders in the seeded manifests** (local metadata, no on-chain
counterpart): `registeredAtMs` = seed time not real registration time;
`registeredCheckpoint: 0`; `publicKey` holds the owner ADDRESS not a key
(mirrors testnet-canary.ts). Also `reputation: {}` was stored while chain
carries real values (all 10000 bps, resolved_runs 0) — offered to fix, user
did not take it up.

## zkLogin / Google / Enoki — state

- Google OAuth client configured by the user. Origins (no trailing slash) and
  redirect URIs (WITH trailing slash) both cover: `http://localhost:3000`,
  `https://open-verdict-nine.vercel.app`, `https://openverdict.info`,
  `https://www.openverdict.info`. Enoki portal has the same 4 origins.
- **UNCONFIRMED, ASK THE USER:** whether Google Auth Platform → Audience was
  switched from *Testing* to *In production*. In Testing only ≤100 explicitly
  listed test users can sign in AND consent expires every 7 days. Publishing
  is one click with no review because zkLogin requests only `openid`
  (non-sensitive). Unverified apps still show the "Advanced → Go to" screen
  and cap at 100 new users. Also unconfirmed: whether Enoki's Save was pressed.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is now BAKED into the production bundle
  (verified by grepping chunks for `apps.googleusercontent.com`), so Enoki
  sign-in is reachable. It was blank before, which made all the console work inert.
- Enoki is skipped when `!isEnokiNetwork(network)` → **localnet has no Google
  sign-in**. Production is testnet so this is fine.

## UX consolidation — DESIGNED, NOT APPROVED, NOT STARTED

Brainstorm (superpowers:brainstorming, architectural path) got as far as a
design presented in chat. User never answered "does this shape look right"
before the conversation moved to domains. **Nothing implemented. No spec file
written.** Resume by re-presenting and getting approval.

Decision already made by the user: **optimize for hackathon judges first** —
consolidate NAVIGATION, keep the evidence of engineering visible.

Trust tiers (derived from `app/api/_lib/guard.ts`, corrected mid-session):

| Tier | Gate | Covers |
|---|---|---|
| Watch | none | whole docket, live juries, verdicts, evidence, verification, status |
| Ask | *currently none*, user WANTS zkLogin | submit a claim (`POST /api/fact-checks`) |
| Judge | zkLogin | `POST /api/agents/register` |
| Operator | Bearer token | claim create, evidence admin |

Proposed 15 routes → 7:

```
/            landing (unchanged)
/app         console: submit + live docket   (absorbs /fact-check + /claims)
/claims/[id] one claim surface: observer when live, report when settled,
             evidence drawer, verifier panel  (absorbs /observe + /evidence/[id])
/agents      registry, zkLogin gate on "back an agent"
/learn       PROMOTED into the nav (currently orphaned — this is the onboarding fix)
/verify      blank-slate tool, footer
/legal       one page, 3 anchors (absorbs /privacy /terms /risk)
/status      footer
```
Nav 5 chips → 3: Console · Jury · Learn.

The 7 fragmentation problems found: two competing front doors (`/` and `/app`,
the latter not even in nav and its 5 desk cards duplicate the nav); one claim
spread over 3 URLs with the liveliest screen 2 clicks deep; submit is a
dead-end `router.push`; `/learn` orphaned (linked from only 2 places);
`/verify` detached from what it verifies; `/status` operator-facing but in
primary nav; 3 legal routes for 201 lines.

**Open design questions:** (a) does `/agents/[id]` stay a route for
deep-linking or collapse to an expanding row; (b) how hard the submit gate
should be — recommendation was zkLogin default + `OPENVERDICT_PUBLIC_WRITES`
as the demo-day circuit breaker, plus localStorage draft rescue because the
OAuth redirect is pinned to origin+"/" and will otherwise eat a typed claim.

## ERC-8004 / ERC-8126 framing (researched, use in the pitch)

**Sui has NO native agent identity/reputation standard.** Mapped docs.sui.io
for "agent" → nothing relevant; ecosystem search → only generic NIST/CSA/IETF
work. Both ERCs are real: `ERC-8004: Trustless Agents`, `ERC-8126: AI Agent
Verification`.

ERC-8004 defines Identity + Reputation + Validation registries. Its Validation
Registry explicitly lists "stakers re-running the job... **trusted judges**".
Mapping: Identity ≈ `AgentProfile` + `AgentCap` (richer — bonded, human-backed);
Validation ≈ the entire OpenVerdict jury; Reputation ≈ the inert struct.

Defensible pitch line: *Ethereum is standardising this via ERC-8004/8126; Sui
has no equivalent; OpenVerdict implements that architecture natively on Sui,
and the piece those standards leave pluggable — the validation layer — is our
whole protocol.* **NEVER claim "ERC-8004 compliant"** — different chain,
different interfaces, capability-shaped not ERC-721-shaped.

## Known gaps / candidate next work

- **`Reputation` is inert.** 7 dimensions declared; grep shows it is written
  ONLY by `initial_reputation()` at agent_registry.move:153 and :509. No
  update path exists. This is exactly ERC-8004's Reputation Registry and is
  the only unticked box in that mapping. Wiring it = new Move + redeploy +
  new packageId (invalidates the manifest and production). Advice given: do
  NOT touch Move with a live package unless the user decides it is worth it.
- Selection is deliberately unweighted by reputation (comment at
  agent_registry.move:53). That is a defensible non-goal, not an omission.
- **No claim has ever run through the HOSTED app.** The 08-27 canary ran
  locally. A live end-to-end costs ~0.1 SUI and minutes; user was offered and
  deferred. This is the last unproven link.
- **Pre-reveal vote exposure via Walrus: FIXED IN TREE 08-29 late (proof
  chain v2, uncommitted at the time of writing).** `juryRun` now seals the
  run bundle core (exact prompt, input, raw response, validated output,
  audit, runHash) with AES-256-GCM (`lib/engine/runBundle.ts`) and uploads
  ONLY the ciphertext before `approveRun`; the plaintext bundle plus the key
  is published as the reveal argument blob (`votesReveal`). Keys and IVs stay
  in `inference_runs.seal_key_hex/seal_iv_hex`. Verified by the engine test
  "seals each run before commit and publishes plaintext only at reveal".
  The earlier description (raw response and bundle uploaded at
  engine.ts:1455-1517 before the commit) is what HEAD `0dc4e4e` still does
  until this work is deployed.
- **Jurors judge from submitter-picked 500-character excerpts and cannot
  search (found 08-29 late; being CLOSED by juror research v1).** Spec
  `docs/superpowers/specs/2026-08-29-juror-research-design.md`, plan
  `docs/superpowers/plans/2026-08-29-juror-research.md` (Tasks 1 to 7).
  DIVE, the predecessor, never searched either (prompt line plus URL regex).
  The worker host env needs `FIRECRAWL_API_KEY` (dedicated account, key saved
  in local `.env` on 08-29, never printed) and optionally `FIRECRAWL_API_URL`.
- engine.ts:615 TODO: `vote_packages.salt_hex` is plaintext hex; encrypt
  before production.
- `select_committee` requires 7 to 32 active registry records (jury.move:220),
  which is why exactly 7 agents exist. Draws are weighted by
  `EligibilityRecord.weight` (default 10000, AdminCap-set), NOT by reputation.
- Explorer reports (Move, adapters/data) are in this session's transcript; the
  web and engine explorers went idle without delivering.
- `components/landing/claim-form.tsx` still in tree, rendered nowhere.
- `.env.example` still defaults SUI_NETWORK / NEXT_PUBLIC_SUI_NETWORK to
  `localnet`, contradicting "testnet is the demo network" (STATUS.md:53).
- `docs/demo/runbook.md:70` still scripts "submit a fact-check (no wallet
  needed)" — contradicts the intended zkLogin submit gate.

## Environment facts (do NOT relearn)

- **`vercel env pull` REDACTS values for CLI-added vars** (proved with a probe
  var set to a known value → pulled back `""`). Integration-created vars
  (Neon's `DATABASE_URL`) DO pull real values. Never conclude "env is empty"
  from a pull.
- **Env var changes need a REDEPLOY** to take effect; `NEXT_PUBLIC_*` are
  baked at build time. `vercel redeploy <url>` rebuilds same commit + new env.
- `.vercel/` is now gitignored. To avoid writing it into the repo, link inside
  the scratchpad: `vercel link --yes --project open-verdict --cwd <scratch>
  --scope marcus-tans-projects-0956f18f`, then pass `--cwd <scratch>`.
  Account-scoped ops need no link: `vercel domains add <domain> <project>`.
- Read instrumented server errors with `vercel logs <deployment-url> --json`
  (the table view TRUNCATES the message).
- Vercel preview deploys get unique URLs NOT in the OAuth allowlist → zkLogin
  fails there with `origin_mismatch`. Test auth on prod/alias only.
- **CORRECTED 08-29 evening: commit and reveal deadlines are FLOORS on chain,
  not ceilings.** `claim::advance_phase` (claim.move:320) needs
  `now > first_commit_deadline`; `jury::reveal_vote` (jury.move:527) needs
  `now > commit deadline`; `settlement::finalize_claim` (settlement.move:116)
  needs `now > first_reveal_deadline`; `lock_committee` (jury.move:383) needs
  `now >= acceptance deadline` (halfway to commit, jury.move:812). With the
  default ladder from `defaultDeadlines` (engine.ts:2370: 5/10/15/30/45/60/75/90
  min on testnet) a hosted claim therefore needs at least 45 min, 90 with a
  second round. "Round 2 usually never runs" only means a 4-of-5 threshold at
  REVEAL_1 skips discussion (engine.ts:807-809); it does NOT settle early. The
  short canaries passed explicit deadlines. Localnet ladder is minutes-scale.
- The DB is SECURITY-SENSITIVE, not a cache: `vote_packages.salt_hex` holds
  commit-reveal salts. They cannot go on Sui without destroying juror
  independence. Answer to "why not store everything on Sui": this.
- `git status` carries a PARALLEL AGENT's landing-video WIP (docs/landing-
  background-video.md, public/media/landing/*, tools/landing-video/*). Do NOT
  commit it. Stage explicit paths ALWAYS.

## Proof chain v2 work in flight (started 2026-08-29 evening)

Plan of record: `docs/superpowers/plans/2026-08-29-proof-chain-v2.md` (read it
first). Codex workers implement, the manager reviews. Facts established while
preparing the rollout:

- **Walrus store bug (production-relevant):** `lib/walrus/real.ts` and the
  duplicate in `lib/engine/server.ts` write through `writeFiles` (quilts). The
  recorded `blobId` is the quilt container; the artifact is only readable via
  the patch id, which is never stored. `writeBlob`/`readBlob` round-trip
  exactly. Fix = plan Task 7.
- **WAL:** the operator held 0 WAL, so no hosted Walrus write could ever have
  succeeded. Exchanged 5 testnet SUI for 5 WAL via the official exchange
  (`0x8259…ef9f::wal_exchange::exchange_all_for_wal`, object `0xf4d1…9073`),
  tx `5wsBonnaCKCvtRJpoDjsjK62EgphV4U1AWbFYAKJwGm1`.
- **`*.sui.io` is unreachable over TLS from this Mac** (curl, openssl, and
  Node all fail; `public-rpc.sui-testnet.mystenlabs.com` and publicnode work).
  Earlier local canaries silently used the JSON-RPC fallback. Use the
  mystenlabs alias for local gRPC/Walrus work.
- **GonkaRouter probe:** `id` = `devshard-<n>-<seq>`, headers `x-request-id`
  and `x-devshard-id`, `system_fingerprint`; no Gonka chain record id. Gonka
  now runs inference in devshards (on-chain escrow sessions, off-chain
  per-request billing), so brokers expose no per-request ledger record.
- Production env pulled to the scratchpad for the rollout; never commit it.

## Resume protocol after /compact

Read this file top to bottom, then the plan
`docs/superpowers/plans/2026-08-29-proof-chain-v2.md`. Then, in order:

1. `git status --short` (expect only the proof chain v2 files listed above;
   the landing video is committed) and `pgrep -f "codex-companion.mjs task"`.
2. `ListAgents`; read any teammate reports that arrived; if a worker is
   still running, wait for it rather than editing its files.
3. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; fix the two
   known typecheck slips if the workers did not.
4. Review the Task 2 engine diff (`git diff lib/engine/engine.ts`: sealing at
   inference, plaintext + key at reveal, `runProof.sealed`) and the scripts
   diff, then continue with Task 5 docs and Task 6 rollout as written above.
5. Production health: `curl -s https://openverdict.info/api/status`.
6. Present the six owed decisions; do not start the UX consolidation or the
   evidence discovery unit unprompted.

Standing rules still apply: start replies with "Mr. Marcus,", no em dashes
anywhere, never commit or push without explicit authorization, never commit
`.env` or anything from the scratchpad, iconsax icons in app code.
