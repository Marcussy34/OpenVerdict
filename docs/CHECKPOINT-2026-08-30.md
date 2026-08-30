# Session checkpoint, 2026-08-30 21:15 local (pre-compaction #8), updated 22:00 after the v5 rollout

> READ THIS FIRST after a compaction. It supersedes the top sections of
> docs/CHECKPOINT-2026-08-29.md (which keeps the full night-and-day log,
> items 1 to 56). Repo is the source of truth; this file is the index and
> the resume protocol. Companion docs: docs/STATUS.md, docs/demo/runbook.md,
> docs/superpowers/specs/2026-08-30-juror-research-v2-design.md,
> docs/superpowers/specs/2026-08-30-attested-inference-design.md.

## 0. Standing rules (owner + CLAUDE.md), verbatim intent

- Every reply starts with "Mr. Marcus,". Never use an em dash anywhere
  (chat, code, docs, commit messages, worker prompts): comma, colon,
  parentheses or a period instead. Never add Co-Authored-By lines.
- Never print API keys, secret keys, seeds or tokens; they live only in
  `.env`, the scratchpad `rollout.env`, and Railway variables. Never commit
  `.env` or scratchpad files. Compare keys only by sha256 fingerprint.
- Models never fetch, never hold keys or transaction authority; every URL
  they see is engine-executed and recorded; salts and seal keys never leave
  the engine; unverifiable output never becomes a vote (fail closed).
- Icons: iconsax via `@/components/icons`; shadcn/ui; Tailwind only.
- Never run git clean/reset/stash on the owner's changes. Commit and push
  under the owner's standing delegation ("you make the best architectural
  decision, I'll leave you in charge", "keep building"), which is still in
  force. Ask before anything irreversible or outward-facing that the owner
  has not already decided (DNS moves, deleting accounts, spending money).
- The shell cwd resets to /Users/marcus/Projects after every command: use
  `cd /Users/marcus/Projects/OpenVerdict && ...` or absolute paths.
  Background Bash is capped at 10 minutes; long waits use Monitor.
- Owner's product goal: a demo-able product live on Sui testnet + Walrus,
  GonkaRouter jurors, everything transparent and auditable, jurors that
  weigh both sides, a verdict in minutes.

## 1. Where everything runs (all verified today)

- Railway project `openverdict-workers` (id 6bfed6c6-7cc0-4631-984b-15ab765e02b0),
  service `app` (id 7624bc4b…): web + API + the three workers in one
  container (Dockerfile, `scripts/start-production.mjs`). Deploy from the
  clean worktree `/private/tmp/claude-501/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e/scratchpad/railway-tree`:
  `git -C <tree> checkout -q --detach <sha> && cd <tree> && railway up -s app -d`,
  then poll `railway deployment list -s app --json` until SUCCESS (about
  3 to 4 minutes; run `railway` commands from the linked repo directory).
  Latest deployment `a6cc3ad2` = commit `af2e77c` (2026-08-31 01:56, the docs sync).
  Never redeploy while a claim is live.
- Service `Postgres` (id b31b2b5f…, private host postgres.railway.internal,
  volume instance 41608886…, daily + weekly backups scheduled). The app's
  `DATABASE_URL` is the reference `${{Postgres.DATABASE_URL}}`. Neon and
  the Vercel project are DELETED. The domain openverdict.info and its DNS
  zone remain in the Vercel account (nameservers): never remove them.
- Run anything that needs the database or the operator key INSIDE the
  container: `railway ssh -s app -- sh -c '<cmd>'` (works after
  `ssh-keyscan ssh.railway.com >> ~/.ssh/known_hosts`, already done;
  stdin is forwarded). Node scripts: `cd /app && node node_modules/tsx/dist/cli.mjs <script.ts>`.
- Hosts: https://openverdict.info (landing), https://app.openverdict.info
  (dashboard, `proxy.ts` rewrites `/` to `/app`). `/api/status` must show
  suiHealthy, dbHealthy, gonkaMode live, walrusMode testnet.
- Sui testnet package `0xb411210a52dad799b9b4a53e3a44b30c3c8b8a3b1981795f830166533a474c1d`,
  registry `0x9036764a…`, AdminCap `0x525aed28…`, operator
  `0xff3538d7…`. Balances at 2026-08-31 01:35: operator 1.95 SUI / 2.41 WAL
  (about 0.26 SUI + 0.06 WAL per claim, so about seven more claims; the
  Seal policy publish and the evening's claims spent the rest), agents about
  0.59 SUI each. Top up the operator before a demo day: the faucet is not
  reachable from the Mac (*.sui.io TLS), use the faucet web UI or another
  host. Seal policy package `0xf54eb611…` (UpgradeCap `0xbc0f64f8…`).
- GonkaRouter (api.gonkarouter.io, OpenAI-compatible): all three juror
  models priced $0.0012 per 1M tokens; a claim uses about 190k tokens.
  Replies carry x-request-id, x-devshard-id, id devshard-<n>-<seq>,
  system_fingerprint; NO signed receipt. Intermittent failures all day
  (all models), and once served DeepSeek requests from a MiniMax node (the
  adapter fails such runs closed).
- Firecrawl: the APP key (same in `.env` and Railway, sha256 fingerprint
  edf48c293213) belongs to the account with 957 credits, refreshing
  Sep 29, about 30 credits per claim. The CLI key for terminal lookups
  was replaced 2026-08-30 23:15 by the owner's new key (fingerprint
  3cdcdc21054f, 1,400 credits): it lives in `~/.zshenv` as
  FIRECRAWL_API_KEY (every zsh picks it up) and in the scratchpad file
  `firecrawl.key`; never print it. The old CLI key (bc0ede425993) is gone.
- Costs per claim: about 10 cents cash today (all Firecrawl), 30 to 40
  cents on mainnet prices; inference is a fraction of a cent.

## 2. Protocol and code state (main at the latest docs commit after `2bbb33f`, pushed; see `git log`)

- 2026-08-31 additions: hedged requests (`85ce5ad`, GONKA_HEDGE_AFTER_MS
  25 s, attempt kind HEDGE, HEDGE_ABANDONED), failed-seat records and the
  "Seat failed before commit" panel (`85ce5ad`, `2bbb33f`), proven on claim
  #26 `0x089c6c7c…` (NO 200, 5 of 5, 10.2 min, five hedges). Seal escrow
  proven on claim #25 `0xbdab0011…` (YES 9860, 5 of 5). Second commit
  deadline +1080 s, second reveal +1200 s (not yet exercised live).

- PROTOCOL V4 / MANIFEST V5 IS LIVE since 21:33 (commit `9e2dd98`,
  deployment `db421474`): an open action may name up to three urls
  (`maxOpensPerTurn` 3), fetched in parallel, one transcript step per page
  with `batch {size, position}`, one `open_many` tool result; bundle core
  v5; verifier check "opens per turn within policy"; the seven jurors
  carry v5 manifests (prompt hash `0x7257117d…`, policy hash
  `0x8da9ec66…`; the v3 hashes did not move). The re-execution check is
  live: `POST /api/claims/<id>/runs/<runId>/reexecute` and the "Re-run
  this juror" block (proven 21:38 on claim #21's DeepSeek run: YES 9500
  again, served model matches, output hash differs as expected). First v5
  verdict: claim #22 `0x387a344bd5b23c50638421875e0dbaa483597eb2064c05741b5059b1fa121785`
  (YES 9950, certificate `0x7c2fcb4b…`, 8.4 min; DeepSeek run
  `0x6b646088…` with a three-page batch passed all 14 local checks of that build (15 since the Seal escrow check);
  proofs saved as node_modules/.cache/proof-387a344b-{1..4}.json,
  fetcher scratchpad/proof-scan.py, verifier
  `pnpm exec tsx node_modules/.cache/verify-proof.mts <proof.json>`).
- Juror research v2 (prompt spec v3 + tool policy v3: search intent
  support/challenge; CHALLENGE_REQUIRED, CORROBORATION_REQUIRED,
  counterEvidenceSummary; 4 searches, 5 opens, 10 turns; minCitationDomains
  2; minOpensPerSide 1; manifest document v4, bundle core v4, verifier v4
  checks) was live from 16:33 to 21:33 and is superseded by the v5 line
  above; its loop rules still apply under policy v4. The jurors carried v4
  manifests from 16:33 (published inside the container with
  `scripts/publish-agent-manifests.ts`, dry run first) and v5 since 21:33.
- Ladder (lib/engine/engine.ts defaultDeadlines, hosted, since 22:26,
  commit `bb79bec`, deployment `327c8364`): cutoff +60 s, commit +450 s,
  reveal +570 s, discussion +630 s, second round +1080/+1200 s since the
  Seal release (was +810/+930 s from 22:26 to then, and
  330/450/510/690/810 s before 22:26; measured from create_claim). Seat
  deadline = commit minus 60 s. Reason: the owner keeps all jurors at equal
  selection weight (Kimi weights restored, registry tx `A7BEYRdu…`) and
  accepts about 10 min per verdict so that Kimi finishes its four turns.
- Transparency UI live: components/claim/run-proof.tsx,
  run-proof-research.tsx, run-proof-transparency.tsx, run-proof-types.ts;
  the proof route adds `sui` artifacts (run approval, commitment, reveal).
- Workers: only live claims are inspected, 2 s poll while a claim is in
  flight, 15 s idle, wake file on submission (lib/engine/wake.ts); dead
  claims skipped, failing claims backed off (workers/resolution-worker.ts).
- Gonka attempt log: `railway logs -s app | grep gonka-attempt` shows every
  model call (status, errorCategory, httpStatus, ids, tokens, latency).
- Demo claims: #21 `0x5629faca8dd2f0bd812c6d4e01ed99ed16184e41675379d251b5252103d5a46c`
  (first v2 verdict, YES 9750, certificate `0x8a5ab5ad…`, 8.0 min; run
  `0x76fe683f…` passes all 13 verifier checks); #16 `0x9169c707…` (v1
  verdict YES 9860, certificate `0x62036142…`); #18 `0xb526116e…`, #19
  `0xe46d6997…` (two-round UNRESOLVED with v2 trails); #20 `0x16539432…`
  (all seats hit the old seat deadline; the diagnosis behind the ladder).

## 3. DONE 22:00: the two Codex jobs (started 21:01) were reviewed, merged, deployed and proven live

Outcome: both diffs passed review (v3 behaviour byte-identical, batch
validated against seen urls, per-page budget, one step per page, verifier
v5 gate, no secrets in the re-execution response, guarded route); my own
additions were the UI type guard for v5, per-turn message addressing and
the batch label in the trail, and a clearer "not a final answer" message.
Gate: typecheck clean, 41 files / 403 tests, lint 0 errors, build OK.
Rollout: commit `9e2dd98`, deployment `db421474`, manifests v5 published
from the container at 21:33, claim #22 verdict at 21:44 (section 2). The
history below is kept for the next protocol bump.

Both ran inside the persistent Codex app-server; the codex-worker
subagent wrappers show "idle" but the jobs continue. Companion script:
`CO=$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs | sort -V | tail -1)`.
Check: `cd /Users/marcus/Projects/OpenVerdict && node "$CO" status`;
collect: `node "$CO" result <job-id>`. Never use `--resume-last` while
two jobs exist. The prompts are saved verbatim in the scratchpad:
`prompt-multi-open.txt`, `prompt-reexecute.txt`.

A. `task-mtftl9hp-m8hdt6` "open up to three pages per research turn":
   policy v4 (maxOpensPerTurn 3), prompt spec v4, manifest document v5,
   bundle core v5; open action accepts `urls` (1 to 3) or `url`; parallel
   fetch; one transcript step per page with a `batch` marker; open_many
   tool result; budget handling; verifier v5 (+ "opens per turn within
   policy"); publish script emits v5 documents. Files: lib/protocol/types.ts,
   lib/gonka/promptSpec.ts, lib/gonka/schemas.ts, lib/gonka/adapter.ts,
   lib/research/loop.ts, lib/research/citations.ts, lib/engine/agentManifestDocument.ts,
   lib/engine/engine.ts, lib/engine/runBundle.ts, lib/verify/run-proof.ts,
   scripts/publish-agent-manifests.ts, tests.
B. `task-mtftjjwe-g9du93` "independent re-execution check": new
   lib/verify/reexecute.ts (+ test), new
   app/api/claims/[id]/runs/[runId]/reexecute/route.ts (public POST, rate
   limited, 409 when not revealed, 502 on provider error), a "Re-run this
   juror" block in components/claim/run-proof.tsx (also on /verify).
   At 21:12 it was in its verifying phase.

### Review and rollout checklist (as executed for A and B; reuse for the next protocol bump)
1. `git status --short`; `git diff --stat`; read the diffs of loop.ts,
   run-proof.ts, reexecute.ts and the route. Check: v3 policy behaviour
   unchanged; urls validated against seen urls; budget accounting; the
   transcript keeps one step per page; verifier v5 gate; no secrets in the
   re-execution response; rate limit and public-writes guard on the route.
2. Gate: `cd /Users/marcus/Projects/OpenVerdict && pnpm typecheck && pnpm exec vitest run && pnpm lint && pnpm build`
   (one pre-existing lint warning in components/wallet/connect-button.tsx).
3. Commit (no em dashes, no Co-Authored-By), push, deploy from the worktree
   (section 1), poll to SUCCESS.
4. Republish manifests as v5 inside the container:
   `railway ssh -s app -- sh -c 'cd /app && node node_modules/tsx/dist/cli.mjs scripts/publish-agent-manifests.ts --dry-run'`
   then without `--dry-run`; confirm `/api/agents/<id>/manifest` shows
   document version 5 (agent ids from `/api/agents`).
5. Live claim: `curl -s -X POST https://app.openverdict.info/api/fact-checks -H "Content-Type: application/json" -d '{"claim":"<statement>"}'`
   records the start with `python3 -c 'import time; print(int(time.time()*1000))'`;
   poll with `python3 <scratchpad>/claim-state.py https://app.openverdict.info/api/claims/<id> <startMs>`
   every 15 s (states: 3 selection, 4 commit, 5 reveal, 6 discussion, 7/8
   round two, 9/10/11 final). Expect commits from ~t+190 s, reveal ~t+380 s,
   certificate ~t+495 s. Confirm a v5 bundle shows a batch open (three
   pages in one turn) and that the "Re-run this juror" button works on a
   revealed run.
6. Verify locally: save the proof JSON to node_modules/.cache/proof-<n>.json,
   point node_modules/.cache/verify-proof.mts at it, run
   `pnpm exec tsx node_modules/.cache/verify-proof.mts` (prints every check).
7. Docs: STATUS.md (protocol bullet + ladder), runbook §4b items 4 to 6,
   this file, memory (mcp memory entity "OpenVerdict juror research v1"
   and "OpenVerdict production topology"). Commit and push.

If a job failed or produced a bad diff: fix inline for small issues, or
resend feedback with `node "$CO" task --write --resume-last "<feedback>"`
only when a single job remains (max three rounds), else finish by hand.

## 3b. Seal escrow build: jobs landed 23:07, reviewed, package published 23:12

Result: all three diffs accepted (Move package builds, 4 Move tests pass
under my own run; lib suite 406 green with the engine work; the browser
recovery helper uses an ephemeral keypair and `onlyTransactionKind`).
Policy package published from inside the container (script and bytecode
injected over ssh; the Mac cannot reach the fullnode):
`0xf54eb61116372f8506ca332457b2fee61231a559e44923429f54fab355d0f0c5`,
UpgradeCap `0xbc0f64f8…`, digest `6LnGu71K…`. End-to-end probe
(node_modules/.cache/seal-e2e-probe.mts, JSON-RPC client injected):
parsed object id == expected full id, share indices 1 and 2, key
recovered in 3.3 s after a past deadline, future deadline refused.
`seal` section added to config/release.testnet.json. Round-two window fix
applied in engine.ts (+1080 s / +1200 s). Gate green (44 files / 420
tests), commit `b7ff700`, deployment `72ff9baf` live 23:13:46. PROVEN
LIVE on claim #25 `0xbdab0011…` (YES 9860, 5 of 5 seats, 10.4 min): every
sealed bundle carried an escrow, recovery refused before the deadline and
succeeded after it (3.5 s, key equal to the revealed key, core hash
matches), the local verifier passes 15 checks including `sealEscrow`.
Tools: scratchpad proof-escrow-scan.py (proofs of every committed seat),
node_modules/.cache/seal-recover-proof.mts <proof.json> (recovery through
the key servers from the Mac via the public JSON-RPC endpoint). Still to
do for this feature: a human click on "Open through Seal" in a browser
(my extension is not connected), and the round-two window has not been
exercised live yet. The paragraph below is the pre-landing plan, kept for
the record.

Owner's evening decisions: all jurors keep equal selection weight; slower
verdicts are fine so Kimi can finish (commit window 450 s live since 22:26);
Nautilus is deferred; "what about Seal, and the rest of the Sui stack" led
to docs/superpowers/specs/2026-08-30-seal-escrow-design.md (build now) and
docs/superpowers/specs/2026-08-30-sui-stack-map.md (ranked options). The
Mysten skills are installed at ~/.claude/skills/sui-dev-skills (use the
`sui-dev-skills` skill for any Move or SDK work). `@mysten/seal` 1.4.6 is a
dependency; lib/seal/identity.ts (+test) is the shared identity seam
(commit `2a917aa`).

Three Codex jobs started 22:48 through codex-worker subagents named
seal-move, seal-engine, seal-ui; prompts saved verbatim in the scratchpad
as prompt-seal-move.txt, prompt-seal-engine.txt, prompt-seal-ui.txt. File
ownership: move/openverdict_seal/** + scripts/publish-seal-policy.ts
(move); lib/protocol/types.ts, lib/sui/manifest.ts, lib/seal/escrow.ts,
lib/engine/{engine,contract,server,runBundle}.ts, lib/verify/run-proof.ts,
the proof route and their tests (engine); lib/verify/seal-recovery.ts,
components/claim/run-proof-seal.tsx, run-proof-types.ts, a mount in
run-proof.tsx (ui). Review checklist: identity bound to claim, seat, phase
and the claim's reveal deadline; escrow failure never costs a seat; the
verifier adds the check only when an escrow exists; the browser uses an
ephemeral keypair and `onlyTransactionKind: true`; no secrets anywhere.

After the jobs land: gate, commit; `cd move/openverdict_seal && sui move
build && sui move test`; publish the policy package on testnet with
`pnpm tsx scripts/publish-seal-policy.ts` (operator key from .env; if the
Mac's RPC writes time out again, run it inside the container with
`--bytecode move/openverdict_seal/bytecode.json`); put `seal: { packageId,
threshold: 1, keyServers: [committee 0xb012378c… with aggregatorUrl
https://seal-aggregator-testnet.mystenlabs.com, independent 0x73d05d62…] }`
into config/release.testnet.json (ids from the SDK's own guide); deploy
between claims; run a claim; confirm `sealed.escrow` on a run proof, the
local verifier's `sealEscrow` check, and "Open through Seal" on a revealed
run after its deadline; then open an unrevealed seat of an older claim.

Applied in the Seal release (`b7ff700`): round two now has the same
research room as round one (second commit +1080 s, second reveal +1200 s;
it had 120 s, +810 s minus 60 s minus discussion +630 s); runbook and
STATUS ladder lines updated. Also done later that night (section 3c): a
FAILED seat keeps its research transcript and attempts, and the claim page
shows "Seat failed before commit".

## 3c. IN FLIGHT 23:40: failed-seat transparency (two Codex jobs) and same-model hedging (one job)

Owner said "continue with everything else" after the Seal proof. Three
codex-worker subagents (failed-engine, failed-ui, hedge); prompts saved
verbatim in the scratchpad as prompt-failed-engine.txt,
prompt-failed-ui.txt, prompt-hedge.txt. File ownership: engine job owns
lib/engine/{engine,contract}.ts, lib/storage/*, lib/protocol/types.ts and
tests (InferenceFailureV1 record stored under the seat's derived run id
with the research transcript at failure time, best-effort Walrus copy,
`runProof` returns failure proofs); UI job owns
components/claim/run-proof.tsx, new run-proof-failure.tsx,
run-proof-types.ts, components/viz/seat-seal.tsx, app/claims/[id]/page.tsx
("Seat failed before commit" panel with the trail, Failed seat state);
hedge job owns lib/gonka/{adapter,types,retry}.ts, their tests and
lib/engine/server.ts (hedgeAfterMs, env GONKA_HEDGE_AFTER_MS default
25 s: a second identical request to the same model after 25 s, first
valid reply wins, the other recorded as HEDGE_ABANDONED; new attempt kind
HEDGE). Community context: two other GonkaRouter teams report the same
Kimi timeouts and node-dependent latency; the owner has a message for
the GonkaRouter team (signed receipts, request lookup, Kimi capacity,
substitution and a fourth model).

Update 00:15: the hedge job finished and was accepted (111 adapter tests);
the two failed-seat jobs stalled together at 23:40 (same app-server
session prefix; phantom "pnpm lint"), were cancelled at 00:12; the
engine job's work was complete and reviewed and is committed with the
hedge as `85ce5ad` (gate: 44 files / 431 tests, lint clean), deploying
now; the UI panel was re-dispatched on a fresh session (subagent
failed-ui-2, prompt-failed-ui-2.txt; run-proof-types.ts already carries
the failure types). Update 00:50: the fresh UI job also died after a
verification shell call (same pattern, third time; lesson in memory); its
files were complete for the panel, the mount and the seat state, and I
finished the page wiring by hand (engine.inspect now puts
`failureStatus` on each failed seat's commitment; seatStateOf reads it).
Gate green (44 files / 431 tests, build OK), committed and deployed;
claim #26 (NO 200, 5 of 5, 10.2 min) proved the hedge live with five
hedged calls and one HEDGE-winning Kimi verdict; failed-seat panels will
appear on the next seat that fails. Also
still open: a human click on "Open through Seal" and "Re-run this juror";
the round-two window unexercised live; the submission package once the
owner names the format; Nautilus via Marlin Oyster if the owner wants it.

## 4. Planned next (owner-approved direction)

- Attestation (docs/superpowers/specs/2026-08-30-attested-inference-design.md):
  the re-execution check is live (measure 2 done); the signed receipt is a request to the
  GonkaRouter team (draft text at the end of that spec; the owner sends
  it); the enclave (Nautilus, AWS Nitro "prompt forwarder" that signs
  request and response hashes) is the next multi-day milestone; the
  bundle should get an optional `gateway.receipt` slot once a format exists.
- Verdict odds (updated 22:15): GonkaRouter serves exactly three models,
  so a fourth family is impossible; the Move rules (two seats per model at
  most, three families, seven active agents for the draw) force at least
  one Kimi seat per committee and forbid deactivating anyone. The weight
  lever (Kimi at 3000, simulated 16% two-Kimi committees instead of 57%,
  abort risk 0.06%) was tried for five minutes and reverted at the owner's
  request: every juror is at 10000 (tx `A7BEYRdu…`). Tools:
  node_modules/.cache/set-eligibility.mjs (run inside the container when
  the Mac's RPC times out), weights.mjs, prevtx.mjs. The registry has 32
  records = MAX_ELIGIBLE_SNAPSHOT. What carries the load instead: the
  450 s commit window since 22:26 (verdict about 10 min) and same-model
  hedging since 00:15, both proven on claims #25 and #26 (5 of 5 seats).
- Optional: move DNS off Vercel (the last Vercel dependency); a faucet
  top-up for the operator before a long demo day.

## 5. Scratchpad tools (`/private/tmp/claude-501/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e/scratchpad`)

`claim-state.py <api url> [startMs]` (one-line claim state), `copy-db.ts`
(the Neon to Railway copy, historical), `prompt-multi-open.txt`,
`prompt-reexecute.txt`, `rollout.env` (no DATABASE_URL any more),
`canary*.log` (claim timelines). In the repo, ignored:
`node_modules/.cache/balances.mts`, `coins.mts` (operator/agent balances
via public RPC), `verify-proof.mts` + `proof-<n>.json` (local verifier),
`fund-agents.mjs`, `set-eligibility.mjs`. Full transcript of this session:
`/Users/marcus/.claude/projects/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e.jsonl`.
