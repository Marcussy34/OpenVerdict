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
  system_fingerprint; no signed receipt yet (on their roadmap; the public
  receipts lookup is live and integrated since 2026-08-31, see 3h).
  Intermittent failures all day (all models), and once served DeepSeek
  requests from a MiniMax node (the adapter fails such runs closed; since
  2026-08-31 X-Gonka-No-Fallback pins the model at the gateway).
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

## 3d. CLOSING STATE 2026-08-31 02:00 (pre-compaction #9): read this and continue as if nothing happened

Everything built tonight is committed, pushed, deployed and proven; the
tree is clean; no Codex job, monitor or background task is running.

- main = `3428469` (docs sync; code last changed in `af2e77c` for UI copy,
  `2bbb33f` failed-seat panel, `85ce5ad` hedge + failure records,
  `b7ff700` Seal escrow + round-two window, `9e2dd98` batched opens +
  re-execution). Live deployment `a6cc3ad2` (SUCCESS 01:53, healthy).
- Owner decisions in force: all inference on GonkaRouter only (three
  models exist, no fourth family); every juror at equal selection weight
  (10000); slower verdicts are fine so Kimi can finish (450 s commit
  window, second round +1080/+1200 s); Nautilus deferred (Marlin Oyster
  is the no-AWS path when wanted); hedging approved and live; docs synced
  at the owner's request (a proposed improvement list was declined for
  now: judges' guide, e2e:localnet regression run, uptime alert, Walrus
  Sites verifier, permissionless reveal, keys at rest).
- Waiting on the owner: (1) a browser click on "Open through Seal" and
  "Re-run this juror" (claims #25 `0xbdab0011…` or #26 `0x089c6c7c…`);
  (2) sending the GonkaRouter message (signed receipts, request lookup,
  Kimi capacity, substitution, fourth model; drafted in chat, the formal
  version at the end of the attested-inference spec); (3) the submission
  format and deadline; (4) whether to pursue Nautilus via Marlin Oyster.
- Demo claims: #26 NO 200 (hedge), #25 YES 9860 (Seal, 5 of 5), #23 NO
  140, #22 YES 9950 (batched opens), #21 YES 9750, #24 UNRESOLVED (two
  failed seats per round, before the round-two fix). Not yet exercised
  live: the round-two window, the failed-seat panel (needs a future
  failed seat).
- Balances 01:35: operator 1.95 SUI / 2.41 WAL (about seven claims),
  agents about 0.59 SUI. Firecrawl app key about 800 credits; CLI key in
  `~/.zshenv` (fingerprint 3cdcdc21054f). Sui CLI 1.52.2.
- Scratchpad tools (`/private/tmp/claude-501/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e/scratchpad`):
  claim-state.py, proof-scan.py (revealed runs), proof-escrow-scan.py (all
  committed seats), prompt-*.txt (worker briefs), firecrawl.key,
  railway-tree (deploy worktree), gate-*.log; repo-ignored
  node_modules/.cache: verify-proof.mts <proof.json> (local verifier),
  seal-recover-proof.mts <proof.json> (recovery through the key servers
  from the Mac via JSON-RPC), seal-e2e-probe.mts, seal-servers.mts,
  hashes.mts, balances.mts, coins.mts, weights.mjs, prevtx.mjs,
  set-eligibility.mjs, manifest-check.mts, proof-*.json.
- Lessons: Codex turns die silently after verification shell commands
  (cancel, keep files, finish by hand; brief workers to verify once at the
  end; stagger dispatches); railway commands need the linked repo cwd; the
  Mac cannot reach fullnode.testnet.sui.io (use publicnode JSON-RPC or run
  inside the container); never redeploy during a live claim; an Explore
  agent fed the current facts finds stale docs fast.
- Memory (mcp memory) entities "OpenVerdict juror research v1" and
  "OpenVerdict production topology" hold the same facts as dated
  observations; the newest is "DOCS AUDIT APPLIED 2026-08-31 02:05".

## 3e. DONE 2026-08-31 02:30: the two hosts are set up properly (owner: "I think it's not fully set up")

Audit result before the fix: DNS, TLS, HTTP to HTTPS, Google OAuth
redirect URIs and the Enoki allowlist were already right for apex, www and
app. What was missing: `NEXT_PUBLIC_APP_URL` was unset on Railway (the
header never handed visitors to app.openverdict.info and the whole console
was duplicated on the apex), www was a duplicate, the console home wore
the landing's transparent dark header (browser URL "/" on the app host),
the claims API was oldest-first (the landing showed an Aug 29 UNRESOLVED
claim as "latest verdict", the console listed day-old claims as latest and
counted ten stranded discussion claims as "in deliberation"), and there
were no titles, Open Graph cards, robots, sitemap or security headers.

Shipped in commit `62cb7f9` (deployment `2ec605fb`, SUCCESS 02:24, no claim
was live): Codex wrote `redirectForHost` + proxy + headers (14 tests),
Gemini wrote the metadata files and the stranded display, the lead wired
the header, the Dockerfile ARGs, the repository ordering and the
`useNow` clock hook. Verified live with a curl redirect matrix (www 308 to
apex with path and query, apex console paths 308 to the app host, apex
`/app` to the app root, landing and `/api` untouched, Railway host
untouched), the five headers on both hosts, per-route titles, the OG image
(47 KB PNG), robots and sitemap, and screenshots (landing leads with claim
#26 NO; console header readable, "In deliberation 0", latest claims #26 and
#25; stranded claim shows "Discussion · expired" with its note). Gate:
typecheck, lint (0 errors), 448 tests, production build.

Open (needs the owner): none for the hosts. Note the stray local
`sui start` process from an earlier localnet run (pid 67740) if the Mac
gets slow; the e2e:localnet regression run is still the next verification
step when wanted.

## 3f. DONE 2026-08-31 02:50: a fact-check is one claim statement (owner decision)

The owner asked why the form still wanted evidence URLs, pasted context and
resolution criteria when the jurors research the web themselves, then
decided: statement only, and no user-set criteria (the lead's
recommendation: one public rubric for every claim; the API and CLI keep the
optional fields). Shipped in commit `59d989f` (deployment `7cc6ed22`,
SUCCESS 02:49, no claim live): `/fact-check` is a single statement field
with coaching copy ("one falsifiable sentence with the who, what and
when"), the "What happens next" rail says claim frozen then five jurors
research the open web for and against, the console desk, timeline and
privacy copy follow, the engine's default rubric now reads "decide whether
the statement is true as written as of the evidence cutoff; weigh primary
sources for and against found through your own research; the submitter's
material is context only; YES or NO only when credible sources agree,
otherwise UNSURE", PRD addendum item 16 and STATUS record it. Verified
live: the page markup has no URL, context or criteria fields and carries
the new copy; screenshot checked. Note: `components/landing/claim-form.tsx`
(also reduced to one row) is not mounted anywhere on the landing; dead
component, left in place.

## 3g. DONE 2026-08-31 morning: canvas shipped end to end, hardened, live

Overnight under full delegation (owner asleep, then reviewing): the
deliberation canvas is the claim page in production. Commits `c31f4a7`
(canvas page, report move, observer redirect, avatars, Play/Pause icons),
`f54e081` (per-edge link distances), `55a9676` (full-viewport stage without
the global chrome, quick-nav pill, immutable proof cache, parallel Walrus
proof reads), `bd53ca9` (auto-fit view; X-Gonka-No-Fallback enforced and
fallback notices audited). Deployments through `c7f25f24` (SUCCESS 15:18).
Facts that matter later: a revealed proof costs two Walrus testnet reads
(about 40 s cold per claim, warmed per container into an in-memory
immutable cache; I warm the three demo claims after each deploy); the
GonkaRouter team confirmed model substitution is an availability fallback,
announced via X-Gonka-Fallback, and X-Gonka-No-Fallback: true pins the
exact model (a saturated upstream then 429s, which retry and hedge absorb);
firecrawl's headless screenshots throttle requestAnimationFrame, so a
RAF-driven canvas must be verified in a real browser (chrome-devtools MCP),
where it renders perfectly (auto-fit framed graph, avatars, verdict chips,
failed seat, certificate, replay). Still open for the owner: send the
remaining GonkaRouter asks (signed receipts, request lookup by id, Kimi
capacity for demo day), and a fresh claim submission to see sealed pulses
live (every claim so far predates RESEARCH_TICK).

## 3h. DONE 2026-08-31 afternoon: canvas interactivity and the gateway receipt check

Owner-driven iteration with the owner awake and clicking: draggable nodes
(pin where dropped, simulation reheats; `use-force-layout` exposes
startDrag/dragTo/endDrag), crisp rendering (all translate3d layers became
plain 2D transforms; promoted layers rasterized once and rescaled as
textures, which was the blur), the genesis is an opaque circular node with
an accent icon and the full statement wrapped beneath it (collision 62,
fit padding 140), and the right inspector exists only while a node is
selected (background click clears it; verified with a real input event).
The GonkaRouter team shipped their public request lookup the same day we
asked: every revealed run's proof now carries a "Gateway receipt" block
(relay route `app/api/gateway-receipts/[requestId]` with an immutable
cache, component `components/claim/run-proof-receipt.tsx`) comparing the
gateway's own record (model, devshard, completed-at, outcome, tokens,
ttft, duration) against the sealed bundle, and printing the direct
`api.gonkarouter.io/v1/receipts/<id>` URL so third parties bypass us (no
CORS upstream yet). Commits `a7b017f`, `e27c102`, `72eeb08`, `6eb49e5`;
deployments through `b15b9b8d`. Signed receipts: their roadmap, they
propose the format. No reply to the Gonka team is needed; nothing pending
on their thread. Verified live via chrome-devtools each deploy; demo-claim
proof caches warmed after every container restart.

## 3i. CLOSING STATE 2026-08-31 16:45 (pre-compaction #10): read 3d through 3i and continue as if nothing happened

- main = `48c6220`, pushed, tree clean; live deployment `b15b9b8d`
  (SUCCESS 16:12), /api/status healthy. No Codex or Gemini job, no
  background build running. One persistent session monitor still watches
  the claims feed and narrates any new claim end to end.
- The product today: statement-only submission; the claim page is the
  interactive deliberation canvas (avatars, drag, crisp 2D transforms,
  opaque genesis circle with the full statement beneath, inspector only
  while a node is selected, auto-fit until the user pans, replay 1x/10x/60x,
  sealed pulses wired but never yet seen live because every claim predates
  RESEARCH_TICK); audit view at /claims/[id]/report; observer redirects;
  Gateway receipt cross-check on every revealed run; X-Gonka-No-Fallback
  pinned on every juror call. All docs synced (README, PRD 16+17, STATUS
  16:20, runbook, specs, plan ticked, memory).
- Deploy ritual (unchanged plus one step): check no live claim, commit,
  push, `git -C <railway-tree> checkout --detach <sha>`, `railway up -s app
  -d`, poll `railway deployment list -s app --json` to SUCCESS, then WARM
  THE PROOF CACHES for the three demo claims (in-memory per container; the
  warm script pattern is in 3g/memory; cold is 40 to 90 s per claim).
  Verify canvases in a REAL browser via chrome-devtools MCP (firecrawl
  headless throttles RAF and renders them broken); always close the tabs,
  it is the owner's Chrome.
- Demo claims: tariffs `0x21aa5a7bdd80…` (YES 9525, certificate
  `0xc842…e0a8`, four seats plus an honest INVALID_SCHEMA failed seat),
  #25 `0xbdab0011dadff…` (Seal), #26 `0x089c6c7c6d09f…` (hedges).
- GonkaRouter thread: closed, nothing pending. Receipts lookup live and
  integrated (no CORS upstream, hence the relay); signed receipts on their
  roadmap (they propose the format); Kimi capacity planned around judging
  days; no reply needed.
- Waiting on the owner only: a fresh claim to show sealed pulses live, a
  faucet top-up before a heavy demo day (operator ~1.95 SUI, ~7 claims;
  2.4 WAL), the submission format when known, Nautilus still deferred.
- Keys: GEMINI_API_KEY in ~/.zshenv (fingerprint 502aee78e649, Nano Banana
  Pro works; avatar generators in scratchpad/avatars/gen*.sh). Firecrawl
  CLI key fingerprint 3cdcdc21054f. Never print keys.
- Worker lessons added tonight: the codex-worker bridge's foreground call
  can hit its own 10-minute timeout while the Codex job keeps running
  server-side (poll `status --all --json`, cancel only after 10 minutes of
  no progress); the agy job registry misreports finished jobs as
  failed/missing, judge by the diff and run the gate yourself; one wave-2
  stall was finished by hand (React Compiler forbids ref writes and
  setState-in-effect: derive instead).

## 3j. UI TOUCHUP PASS 2026-08-31 afternoon (owner-directed, post-compaction #10)

Two deploys, both verified live in the owner's Chrome. Main = `449a0f4`,
deployment `deafc65c` healthy. 465 vitest, 70 Move.

Commit `7f20a9f` (deployment `66a0d1e5`): the inspector became an absolute
OVERLAY so opening/closing it never resizes the canvas (node positions
verified byte-identical across a select); drag its left edge to resize
(320-680px, `resizePointerRef` + pointer capture); `.ov-inspector-dark` in
globals.css remaps the theme tokens so the shared proof components render
dark inside the panel without forking; all run-proof* grids converted to
container queries (`@container` on RunProof + RunProofDetails roots,
`@xs/@sm/@lg/@2xl` variants) so cells fit any panel width, including the
report and /verify pages unchanged at full width. Stage banner top-centre
(StageBanner in the canvas page: live on-chain state via CLAIM_STATE map,
or replay-time stage from graph milestones; motion remount per change).
Juror family now comes from `CommitmentStatus.modelId`, populated by
`engine.inspect()` from each seat's registered agent manifest, so failed
seats show their real mascot (the owner's "?" bug: seat `0xd1a772…5349`,
INVALID_SCHEMA, never emitted an inference_completed event). Short seat id
under every juror node + in the seat inspector header. Brighter canvas
type with drop shadows; bright dark-stage OUTCOME_STYLE; failure nodes
labelled. Replay presets 1x/10x/30x (was 60x). New nodes seed at a
positioned neighbour (use-force-layout) so they grow out of their anchor.

Commit `449a0f4` (deployment `deafc65c`): edge svg got `overflow-visible`
(svgs clip to their box; every edge with an endpoint outside the viewport
rectangle silently vanished once the fitted view spread the graph; probe
after fix: 82 lines, 23 with endpoints outside the box, all drawn).
Claim-node dossier panel (statement, verdict + Truth Score + certificate
chip, resolution criteria, jury tally, mode, evidence cutoff, on-chain
ids, Suiscan + report links). Certificate node renders a framed
resolution certificate (outcome-toned frame, big verdict, Truth Score,
quoted statement, jury line, finalized time, on-chain record, object + tx
explorer links). Failure nodes explain themselves per status
(FAILURE_EXPLANATIONS: INVALID_SCHEMA / CITATION_INVALID / PROVIDER_ERROR
+ fail-closed note).

Owner Q&A settled: rounds end "late" because commit-reveal runs on the
per-claim deadline schedule (~10 min), not on juror completion; windows
can be tightened at claim creation if the owner wants snappier demos
(offered, not yet requested). No juror-to-juror edges by design in round
1 (independence); discussion-round cross edges are a future rendering
when a claim actually reaches DISCUSSION.

Verified live (real Chrome, page-12 probes + screenshots): banner
FINALIZED · YES; 5/5 mascots, 5 seat tags, no "?"; 30x present, 60x gone;
INVALID_SCHEMA label; svg overflow visible with all 82 edges; select
opens inspector with zero node movement; claim dossier + certificate
panel assertions all true. Proof caches warmed after each deploy (3 demo
claims, 14 proofs, ~45 s cold each set).

Round 3 (commit `62b0571`, deployment `a0341543`, verified live):
HashChip gained an href mode (chip opens Suiscan object/tx or the Walrus
aggregator; copy moved onto the copy icon; external icon always visible),
wired across the report page (claim/committee/certificate/vote objects,
agent profiles, finalize tx, artifact blobs) and the canvas inspector
panels; `lib/web/explorer.ts` is the one home for explorer URLs. The
evidence sides panel renders short evidence chips under linked titles
instead of raw 64-char badges. The inspector aside no longer scrolls
itself: an inner `ov-scroll` region does (handle spans the full edge at
any scroll depth, verified while scrolled to 800px), horizontal overflow
is clipped, and `scrollbar-width: thin` + `scrollbar-color` on the scope
theme every nested scrollbar. Report drops "(PRD §26.3)". Probe result
worth keeping: the dark scope was never broken; secondary badges compute
rgba(243,243,243,0.09) in-panel, and the "light pills" were the oversized
evidence-id badges themselves. Verified: 15 Suiscan links + 1 Walrus link
on the report, 4 explorer chips in the claim dossier, no horizontal
overflow, thin scrollbars, resize handle reachable while scrolled.

Round 4 (commits `cf8b82e` + `67fa207`, deployment `b7b8efe0`, verified
live): /fact-check rebuilt as an explorer-style landing per the owner's
reference: above the fold only the title ("Fact-check a claim"), one
line ("No wallet, no account, no gas."), a single search-bar form with
the submit button inside it (Enter submits, Shift+Enter newline, helper
copy and counter appear only once typing starts), and a micro strip;
below it a Recent fact-checks list (top 8 claims, statement + short id +
relative time via useNow, outcome + Truth Score chip, StateBadge, 15 s
refresh) and ONE closed "How a fact-check runs" details holding all the
educational copy. Submission hook, validation, offline alert and ?claim=
prefill unchanged. Two lessons: (1) NEW ROUTING RULE from the owner: UI
work stays with the lead, Codex is backend/architectural only; the
already-dispatched UI worker was stood down, but its Codex turn kept
writing (5 patch rounds) after the stand-down message: always
`codex-companion.mjs cancel` the turn directly and re-check `git status`
before editing the same file. Its overwrite was preserved to the
scratchpad and the committed file restored. (2) GET /api/claims returns
a `{ claims: [...] }` envelope, not a bare array; the list fix is
`67fa207`. Verified in Chrome: 8 rows rendering, skeletons gone, helper
hidden until typing, old side panel gone.

Round 5 (commit `e034562`, deployment `f42f71dd`, verified live): the
product speaks open-verification language and the landing got bigger and
emptier per the owner's reference. /fact-check hero: "Verify any claim"
at text-5xl/6xl over "No wallet, no account, no gas.", a max-w-3xl bar
with a taller input, one-sentence placeholder faded to 45%, and the
button "Verify claim"; the experimental tag, micro strip and auditable
line are deleted. List heading "Recent verifications", expandable "How
verification runs". Nav is Verify / Claims / Agents / Audit / Status:
claim submission owns "Verify", the independent run auditor at /verify
is "Audit" (collision resolved deliberately). Same rewording applied to
the canvas quick-nav, claims directory action ("New verification"),
report panel ("Public verification report & audit bundle"), timeline,
privacy, learn and the submission error string. Routes and API paths
(/fact-check, /api/fact-checks) are unchanged for link stability;
internal type names (FactCheckReport) untouched. Verified in Chrome:
hero, faded placeholder, VERIFY CLAIM button, nav labels, no user-facing
"fact-check" text anywhere on the page, 8 explorer rows rendering.

Round 6 (commits `fd68b6d`..`9ad0e50` + diagram `776293d`, deployment
`6b8796fc`, all verified live): the hackathon-track amendments and the
discussion round. POST /api/extract-claim (Codex-built, line-reviewed):
pasted URL -> SSRF-guarded engine fetch -> first Gonka model at
temperature 0 -> one falsifiable claim + Gonka/gateway request ids; the
verify bar detects URLs, extracts, and shows source/model/request-id
provenance. Two live-found defects: a 300-token output cap starved
reasoning models into empty replies (raised to 1500, verified live:
simple.wikipedia/Bitcoin -> "In June 2021, El Salvador became the first
country in the world to make Bitcoin a legal tender.",
devshard-67806-387); slightly malformed model JSON still 422s, so a
follow-up (commit `e62e446`, deployment `14bfeded`, line-reviewed) added
exactly one REPAIR completion (promptSpec repair language, jsonMode,
prior content appended, ids from the accepted reply) and
selectProseWindow (start at the first line with >= 160 trimmed chars,
head fallback, 12k cap). Verified live: the FULL en.wikipedia
Bitcoin article, whose lead sits ~30k chars deep, now returns "On 31
October 2008, a white paper authored by Satoshi Nakamoto titled
'Bitcoin: A Peer-to-Peer Electronic Cash System' was posted to a
cryptography mailing list." (devshard-67842-201). 485/485 vitest.
Worker process lesson recorded: codex-companion --resume-last resumes
whatever thread is newest in the shared runtime; send fresh
self-contained briefs instead. ROUND-2 DISCUSSION
(Codex-built, line-reviewed): split first rounds now inject the revealed
round-1 public record (seat index, model, outcome, confidenceBps, public
reasoning trace) into every round-2 juror input and freeze it canonically
as phase-2 evidence artifact round-1-public-record:<claimId>; fail-closed
on missing reveals; phase-1 inputs byte-identical (hash-asserted); specs,
Move, BCS untouched. Landing names GonkaRouter in the hero statement,
productivity paragraph, manifesto and a new banner strip (verified in
served HTML; the manifesto string is letter-split by its animation so
grep the source, not the DOM). docs/GONKA-INTEGRATION.md written for
judges with a live example; high-level architecture diagram at
docs/diagrams/openverdict-architecture.{excalidraw,png} (3 render-fix
passes). Owner decisions recorded: keep "juror", never "swarm" (the
discussion round strengthens jury language; influence flows only through
the recorded public record); queue after this: optimistic quick-verify
exposure, read-only juror track record, zkLogin re-registration of the
demo jurors. 481/481 vitest, 70 Move.

Round 7 (commits `9b31c95`..`3a109c9`, deployment `7c270d32`, verified
live): the owner's canvas refinement burst. Landing hero blurb tightened
and widened (four lines, "research and cite each claim on Gonka's
decentralized inference network"). Verify bar rebuilt as one flat
items-center row (icon, input, button siblings; input padded to the
button's 48px) so alignment is structural. BRANCH SEMANTICS: research
steps no longer chain; every search branches from its juror ("action"
seat->search edges only), every page hangs off the most recent earlier
search that surfaced its URL, direct opens branch from the juror;
assertions pin no-chaining. PENTAGON SPAWN: juror nodes carry seatIndex
and seed at fixed 72-degree slots (verified live in replay at the
committee frame: gaps exactly [72,72,72,72,72]); branch-out seeding now
excludes jurors. AVATAR IDENTITY: one shared picker
(avatarAssetNumber keyed by agentProfileId) drives both the canvas node
and the inspector header, verified live (minimax-2.png on both).
TRAIL HOVER: hovering a research-trail step lights its canvas branch via
a CanvasHighlight context (no-op on report/audit pages), verified live
(41 elements dim on hover). 486/486 vitest. One interrupted ship was
re-run after folding in the avatar fix per the owner's flow.

## 3k. CLOSING STATE 2026-08-31 23:25 (pre-compaction #11): read 3d through 3k and continue as if nothing happened

Main = `997d22d`, pushed, tree CLEAN. Live deployment `7c270d32` healthy
on Railway (single container: web + API + 3 workers, Railway Postgres).
486/486 vitest, 70 Move. Zero live claims (10 old stranded DISCUSSION
claims are skipped by workers and safe to deploy over). Proof caches
warmed post-deploy (scratchpad/warm-proofs.mts, run it after EVERY
deploy). Deploy ritual unchanged: gate (typecheck/lint/test/build) ->
TARGETED git add -> commit/push -> railway-tree checkout --detach <sha>
-> railway up -s app -d -> background status watcher -> warm ->
real-Chrome verify (chrome-devtools MCP, close tabs after). Never
deploy while a non-stranded claim is live; check /api/claims first.

Today's shipped record: rounds 1-7 in section 3j (canvas touchups,
explorer landing, open-verification rename with nav Verify/Audit, URL
claim extraction on Gonka with repair round + prose windowing, round-2
revealed-record discussion injection, landing Gonka weave, architecture
diagram, branch semantics, pentagon spawn (verified 72-degree gaps),
shared avatar identity by agentProfileId, research-trail hover lighting
canvas branches). docs/GONKA-INTEGRATION.md carries two live examples
with checkable request ids. PRD addendum item 18 records extraction +
discussion + naming. Track fit: everything closed except the owner's
2-minute video.

OPEN DECISIONS AWAITING THE OWNER:
1. Approved queue, not started: optimistic quick-verify exposure
   (UI + one API field; protocol/engine already support
   OPTIMISTIC_SETTLEMENT), read-only juror track record on /agents
   (computed from public records, keep equal-weight selection), zkLogin
   re-registration of the 7 demo jurors (mechanism live; current demo
   jurors use TESTNET_DEMO_ALLOWLIST backing).
2. Offered, undecided: bare-search clarity line in the search panel
   ("N results found, none opened"); tighter per-claim deadline windows
   for snappier demos; bps -> percent relabeling for user-facing chips.
3. Future rendering: discussion-round cross-juror edges on the canvas
   when a claim actually reaches DISCUSSION (round-2 inputs already
   carry the revealed record).
4. Recorded decisions: "juror" stays, "swarm" rejected (twice, with
   reasoning); routes /fact-check and /api/fact-checks keep URLs.
5. Owner's own items: the live end-to-end test (never run today), the
   2-minute video, faucet top-up before a demo day, hackathon
   submission form/deadline.

WORKER ROUTING (owner rule, enforced): UI/frontend = the lead directly;
Codex = backend/architectural only; brief workers with fresh
self-contained tasks (never blind --resume-last: it grabs the newest
thread in the shared runtime); on stand-down, cancel via
codex-companion.mjs cancel and re-check git status before touching the
same files. Scratchpad tools: warm-proofs.mts, extract-repro.mts (live
extraction debug harness with logging adapter), railway-tree (deploy
worktree), factcheck-codex-overwrite.tsx (preserved race artifact),
cannes2026/ (DIVE comparison clone). Key fingerprints unchanged (Gonka
key in .env + Railway, never print). MCP memory entity "OpenVerdict
production topology" mirrors all of this.

## 3l. POST-COMPACTION ROUND 2026-09-01 00:10 (owner-directed)

Three deploys tonight, all verified in a real browser, tree clean and
pushed after each. Live deployment: `c3f7916e` (main `2b79dd1`).

- Wave word, v1 then v2: /fact-check hero "claim" first got a flowing
  gradient plus sine underline (`2b71164`); owner redirected ("the entire
  word will be like a wave, not additional animation around it"), so v2
  (`caf22bf`) removed the underline and made the letters themselves
  undulate: per-letter spans, one keyframe driving bob + gradient crest,
  negative delay stagger (-0.22s * --i), aria-label on the wrapper,
  static gradient under prefers-reduced-motion. Verified live: 5 letters,
  staggered delays, clip text, no ::after. v3 followed on owner direction
  ("keep the word still"): the bob was removed, only the staggered gradient
  color wave cycles through the still letters.
- Explorer link sweep (`05fbf21`), owner: "everything that can be found
  on chain is a clickable explorer link". Added hrefs: timeline finalize
  tx (Suiscan tx), Seal policy package + identity claim/seat + key
  servers (Suiscan objects), canvas seat-inspector certificate chip,
  report frozen EvidenceBundle id, evidence page blob id (Walrus
  aggregator) + blob object id. Verified live on claim 0x21aa5a7b…:
  report 17 collapsed / 76 expanded Suiscan links, canvas cert chip ok.
  Left unlinked by design: pure hashes (content/prompt/policy/core),
  evidence ids, run ids. Content-hash answer for the owner: page hash =
  blake2b256(bytes), lives in evidence_artifacts.content_hash, the
  revealed run bundle, the evidence manifest (Walrus), and is anchored
  on-chain only via the frozen manifest merkle root.
- README thesis (`2b79dd1`): recomputability stance paragraph atop
  "What is auditable" (independence before the fact, integrity after,
  two honest caveats, "manipulation cannot hide").
- Operator funded by owner: 51.7 SUI confirmed via balances.mts
  (agents ~0.6 each). Faucet open item CLOSED.
- Incident, RITUAL CHANGE: the warm-proofs script browned out the
  container twice (zero bytes served for minutes; owner hit it live:
  "why is the app not loading"). Concurrent per-seat recomputes were the
  trigger; a sequential + 3s-gap rewrite STILL degraded the site (6s+
  stalls, owner: "its a bit slow"). Killing the warmer restored <1s
  responses within seconds both times. Verdict: the single Railway
  container cannot rebuild proofs and serve traffic at any concurrency.
  RITUAL: do NOT run warm-proofs after deploys any more; first viewer
  of a run-proof panel pays the recompute instead. Real fixes, owner's
  choice, none started: (a) scale the Railway service, (b) persist
  proof bundles at finalization (engine writes them once to Postgres,
  API serves static reads; Codex-scale backend task), (c) accept the
  first-viewer cost. The sequential warmer stays in scratchpad for
  quiet-hours use only.

## 3m. POST-MIDNIGHT ROUND 2026-09-01 01:05 (owner-directed burst)

Two deploys, live: `5f8841f9` (main `95f4441`). Earlier `f614929e`.

- "More in live claims" dead button had TWO layers: (1) the hero
  choreography panel kept pointer-events-auto for the whole runway
  (d69c4ed releases it once the hero type exits, style handed back when
  choreography turns off); (2) the transparent z-10 runway wrapper
  itself still swallowed hits over the reveal section pulled up under
  it (95f4441: wrapper pointer-events-none, panel re-enables its own).
  Verified live: clickable at runway fractions 0.35/0.6/0.9/1.15.
- /learn wired into the console (7c2a9b3): CONSOLE_PATHS + Learn nav
  entry + routing tests updated. Verified: apex 308 -> app host, 200 in
  0.46s, nav present. Page content verified accurate (temperature 0 is
  z.literal(0) in the agent manifest schema; families match
  release.testnet.json).
- Canvas vibrancy (eb2656f): family halos (FAMILY_STYLE.glow), blue
  aurora + dot lattice ground, EDGE_STYLE palette (citation green
  #43e5a0, action #7db4ff, result #9ecbff, default white; typed
  DEFAULT_EDGE_STYLE avoids TS18048), glowing claim disc, green-haloed
  certificate, blue page chips. Verified on the tariffs claim: 55 edges
  = 11 action + 19 result + 11 citation + 14 default.
- Scaling verdict (owner asked to scale): Railway limit is ALREADY
  24 vCPU / 24 GB, peak use 1.5 vCPU. Nothing to scale; the stall is
  the web process's single-threaded event loop doing proof recomputes.
  railway scale = replicas only (unsafe: duplicate singleton workers).
  Real fix = persist proof bundles at finalization; owner has NOT yet
  said go on that.
- Protocol change IN FLIGHT: owner approved early reveal-open
  (readiness-first, deadline fallback; same for settlement). Codex
  worker "reveal-early-worker" dispatched with a full brief (RoundTally
  committed counter, commit_vote gains &mut RoundTally, reveal gate
  now-or-all-committed, settlement all-revealed-or-deadline, Move +
  builders + engine + both suites). Review the diff when it reports;
  then package republish + re-register 7 jurors + config update, all
  lead-owned. NEVER blind --resume-last on the bridge.
- Icons question answered: all iconsax via @/components/icons, zero
  emoji in UI trees, avatars are generated PNGs.
- /learn rewritten plain-English (7ddd94e, deploy 8b84c26a) on the
  owner's Limitless reference: Get started header, One-question
  overview, pipeline as how-it-works, commit-reveal as Lock/Wait/Open
  (struct code removed), friendly invariant cards, Truth Score in
  percent (bps gone), no-account section, 6-row Key facts table,
  ~747 words total. Pipeline stage 03 title softened to "Sealed votes"
  (0280bf3, deploy 0f8e877f, shared with /fact-check). Verified live:
  jargon regex (canonicalise|SSRF|preimage|Blake2b|bps|BCS) fully
  clean, nav Learn active.
- /claims and /agents joined the explorer look (1f817ca, deploy
  1a047e53), owner: "very cluttered... only show what's important on
  preview". Both pages: one-word ov-display hero, centered counted
  filter chips (rounded-full), single row-list in the verify page's
  RecentFactChecks anatomy, details behind the click. Claims adds one
  flat bar (search + Verify-a-claim button); agents adds the micro
  truth-line (7 registered / 7 active / 3 families), JurorAvatar faces
  per row (avatarKey=agentProfileId), Active chip; zkLogin registration
  card stays as the page's one action. Dropped: PageHeader banners,
  4 StatTiles, ClaimCard/AgentCard grids, agents search + active-only
  toggle (7 rows need neither). Gate lesson: setState cannot run
  synchronously in an effect (React Compiler); the async-init ignore
  pattern is the house style for fetch-on-mount. Verified live: 31
  claim rows / 6 chips; 7 agent rows, all avatars loaded.

## 3n. OVERNIGHT COMMAND 2026-09-01 02:10 (owner asleep, full delegation)

Owner: "make the best decision... I leave you in charge as team lead and
lead orchestrator... update me in the morning with a full breakdown."
Decisions locked in the pre-sleep design talk:

- ARCHITECTURE: validator-slot model (NOT DIVE's bring-your-own-agent).
  Standardized manifest-pinned jurors; backing = identity + stake + the
  gate on the earning faucet; Gonka decentralizes computation, backing
  decentralizes control of the five votes; the two compose. Seat rewards
  ALREADY exist on-chain (settlement.move: committee_budget/valid_count
  to seat owners, REASON_JURY_REWARD). Treasury fee absent = to build.
- OVERNIGHT QUEUE (strictly serialized around worker file conflicts):
  P0 economics docs (DONE, 9ad6f1b). P1 reveal-early worker A lands ->
  my review + pnpm test + sui move test. P2 worker B: treasury fee bps
  in Move (AFTER A commits; same files). P3 ONE republish carrying A+B:
  publish package, new registry, re-register 7 jurors, config update,
  deploy, then a REAL E2E claim on the new package to prove early
  reveals live. P4 worker C: proof persistence at finalization. P5
  worker D: backing surface + computed track record + earnings in the
  read path; then my UI pass (Human-backed chips, track record,
  earnings, N/5 backed). P6 docs/STATUS/report. Owner explicitly chose
  DOCS-ONLY for optimistic quick-verify exposure: do NOT ship that UI.
- Owner morning actions: back 1-2 jurors via Google zkLogin, video.
- Autonomy granted: full sequence including republish + re-registration
  + deploys while asleep, with the no-live-claims guard (my own E2E
  test claim excepted, under my control).
- Worker A (reveal-early) still in flight at write time; fallback
  status watcher brsee8z2a polls its Codex job every 3 min.

### 3n progress, 04:25

- Reveal-early worker froze in Codex verify phase (hung vitest); work
  was complete on disk: reviewed, committed 98f5bfc (69/69 Move, 495 TS).
- Treasury fee worker delivered clean: reviewed, committed 39c1b84
  (73/73 Move). Publish then FAILED: Claim hit 34 fields against the
  validator's 32-field struct limit (local move tests never check
  validator config). Fix af2498e packs the fee policy inside
  ChallengeReason; Claim is exactly 32 again. LESSON: any new scalar
  Claim state must go inside a packed sub-struct.
- Publish toolchain: brew sui 1.52 -> 1.78 (protocol 88 vs 135); CLI
  publish now speaks gRPC that publicnode rejects, and this Mac cannot
  reach *.sui.io, so scripts/publish-openverdict-bytecode.ts (5e06bbc)
  publishes prebuilt bytecode through the SDK JSON-RPC fallback. Build
  bytecode offline with: sui move build --dump-bytecode-as-base64
  --no-tree-shaking. Dry-run first via sui_dryRunTransactionBlock.
- Proof-persist worker also froze in verify; store/route/tests were
  done, the engine surface was not: lead wrote the storage adapters and
  the never-rejecting sequential warm hook (42e0aef). 500/500 TS.
- PUBLISHED package v3: 0xa9f3c2dbdfad3ff900b9d2f4df605621d619a9e7575034f508eb5d39263c5bc7,
  registry 0x4020f3cbe51c1cdf6d004696e7cdf0d19f67fde2572b72a5f39a51d119f8ebab,
  tx 8MCKzNsM7tF3MVdzFLo9Z85CE8Gw83Tk5qC5CHS1KEPb. Canary registered
  all 7 jurors on the new registry; its live claim drew 2/5 valid seats
  (4am Gonka weather + citation fail-close) and correctly used the
  deadline fallback. Config committed be54d48; deploy 6f9331e5 in
  flight. Remaining: in-container publish-agent-manifests + 
  seed-testnet-agents, production E2E claim (5/5 early-reveal demo),
  backing-surface worker (running), lead UI pass, docs, morning report.

### 3n progress, 05:45 (backing loop shipped)

- Backing-surface worker delivered the read path (reviewed, 5b8d086):
  AgentDirectoryEntry gains backing {ZKLOGIN|ALLOWLIST|UNKNOWN,
  fail-closed}, trackRecord {seatsServed, committed, revealed,
  agreedWithCertificate} computed from public records via batched
  listAll* reads, earnedMist = lifetime REASON_JURY_REWARD ticket sum
  per owner. 501/501 TS.
- Lead UI pass (298eb1a): /agents rows carry backing chip + one
  public-record line + earnings; directory previews active jurors only.
- Two post-deploy defects found and fixed: (1) seed documents carry
  provider label "testnet-demo-allowlist" while the engine writes
  "demo-allowlist"; both now map to ALLOWLIST (e32cf32). (2) LESSON:
  repository tables deserialize record_json (jsonb), so a column-only
  SQL UPDATE is invisible; canonical deactivation must patch BOTH
  (record_json || '{"active": false}'). 35 old-package manifest rows
  retired that way.
- Deploys ca3649f2 (backing UI) + 1fd625f0 (label fix) verified in
  browser: exactly 7 jurors, Allowlist chips, track lines, earnings
  0.011-0.047 SUI. Copy nit for later: "1 seats" plural.
- E2E attempt #1 (0x4f409921, Sui mainnet) died 0/5 in a Gonka storm
  (3 PROVIDER_ERROR, 2 TIMEOUT), proving the deadline fallback live;
  now stranded state 6. E2E attempt #2 launched after a clean DeepSeek
  probe: 0xfcc609e9b3748f532cded0f9bbab9c868c04e646f33edaed0a64d6ab0ac53570
  (Ethereum genesis block, July 30 2015), in research at write time.

### 3n CLOSING, 06:20 (overnight command complete)

Main = e32cf32 + docs commits, pushed, tree clean. Live deployment
1fd625f0 on package v3. 501/501 TS, 73/73 protocol Move (+4 seal).
All three Codex workers reviewed and landed; two required takeover
after verify-phase hangs (standing playbook in 3n progress notes).
Shipped and verified live: early reveal-open + treasury fee on-chain,
7 jurors re-registered with v5 manifests, backing/track-record/
earnings visible on /agents (Allowlist chips, 0.011-0.047 SUI each),
proof persistence in Postgres with warm-at-finalize.
E2E storms: claims 0x4f409921 and 0xfcc609e9 both lost 5/5 seats to a
sustained GonkaRouter degradation (juror-sized requests shed across
all three families, small probes fine); both stranded state 6,
deadline fallback and fail-closed proven live. The 5/5 early-reveal
demo is one healthy claim away.
OWNER MORNING ACTIONS: back 1-2 jurors via Google zkLogin on /agents;
submit one claim when Gonka clears (that run = early-reveal demo +
video footage); everything else unblocked. Morning report artifact
published (link in the session transcript).
Copy nit queued: "1 seats" pluralization on agent rows.

### 3n addendum, afternoon 2026-09-01

- CREATION OUTAGE root-caused and fixed: claim creation 500'd with
  "MoveAbort ... balance::destroy_zero in 5th command" after working
  three times overnight. Cause: the Walrus blob-registration PTB (runs
  BEFORE create_claim) with stale Walrus client state carried across a
  testnet epoch roll in the long-lived container; a container restart
  (any deploy) cures it instantly (retry returned 201 immediately after
  deploy 3a702623). HARDENING QUEUED: refresh Walrus system state or
  rebuild the client when a write aborts with a MoveAbort, not only on
  version conflicts (lib/walrus/real.ts retry classifier).
- UI batch 5ca6e70 live: flat canvas ground (dot lattice only), zkLogin
  card says Back a juror agent / Backing, agent detail links (profile
  object, owner + operational owner accounts via new suiAccountUrl,
  manifest blob via aggregator; pure hashes stay chips), pinned
  distinct avatars for the 7 jurors (PINNED_AVATARS map in avatar.tsx;
  re-pin after any re-registration; hash fallback for unknowns).
- E2E #3 (0xec68ad81, "Sui uses Move"): creation clean, but Gonka
  flaked mid-run again: 2/5 seats (3 PROVIDER_ERROR); the two healthy
  seats committed AND revealed correctly; round advanced on the
  deadline fallback and will strand. Seat success rate ~40% right now,
  so a clean 5/5 is ~1% per attempt: retries paused behind a weather
  sentry (heavy probe every 20 min; fire the claim when it passes).
- Chrome devtools MCP disconnected this session: verification is
  API-level; owner eyeballs the UI directly.

### 3n addendum 2: FIRST FULL v3 LIFECYCLE COMPLETE (afternoon)

Claim 0xec68ad8144cde2ffd0b022b5b0a56eda8be5bb5f92635e14a070dcb51673e8dc
("Sui uses the Move programming language") ran the ENTIRE two-round
lifecycle on package v3 and finalized UNRESOLVED (state 11, truthScore
9950 recorded honestly, certificate 0x3ab2ceab..., finalize tx
C1PuXthov5ChAkqLjJCKHLbbjCrEp56WY4RcARxJZgsd). Gonka took 3/5 seats in
BOTH rounds (provider errors), so both phases advanced on the deadline
fallback; the discussion escalation ran the round-1 public record into
the phase-2 jurors (first production round 2 ever). VERIFIED ON-CHAIN:
treasury ticket reason 8 = 500_000 MIST to the operator (exactly
500 bps of the 10_000_000 committee budget) and two reason-2 jury
rewards of 4_750_000 MIST each ((budget - fee)/2, perfect split).
Warm-at-finalize verified: revealed runs' proofs served in 207-302ms.
The claim is terminal: the deploy path is clear again. The 5/5
early-advance showcase still waits on the weather sentry (b2ykoev7x).

## 3o. CLOSING STATE 2026-09-01 16:05 (pre-compaction #12): read 3n through 3o and continue as if nothing happened

Main = e07471d, pushed, tree CLEAN. Deploy 13bbcc8a IN FLIGHT at write
time (commit e07471d: round-2 replay timing fix, failed-seat trail
expansion, sealed-node explainer panel); watcher was running; if the
next session finds it unverified, check deployment status then confirm
on the live canvas of claim 0xec68ad8144cde2ffd0b022b5b0a56eda8be5bb
5f92635e14a070dcb51673e8dc (should replay 5 jurors first, 10 at
escalation; failed seats show real trails instead of locks; remaining
locks explain themselves). 501/501 TS + 73/73 protocol Move. All
claims terminal (deploys safe). Chrome-devtools MCP DISCONNECTED this
session: verify via API/curl or the owner's own eyes.

TODAY'S FULL LEDGER (all reviewed, committed, pushed): overnight
9ad6f1b economics docs, 201470a+7c628dc+86d0ead+62bf6a3+a6bf7b5+080f888
checkpoint records, 98f5bfc reveal-early protocol, 39c1b84 treasury fee,
af2498e 32-field repack, 42e0aef proof persistence, 5e06bbc SDK publish
script, be54d48 config v3, 5b8d086 backing read path, 298eb1a agents
directory UI, e32cf32 allowlist label map; afternoon 5ca6e70 (flat
canvas + Back-a-juror card + agent detail explorer links + PINNED_AVATARS)
and e07471d (replay/trails/sealed panel). Package v3
0xa9f3c2dbdfad3ff900b9d2f4df605621d619a9e7575034f508eb5d39263c5bc7,
registry 0x4020f3cb..., 7 jurors re-registered, manifests v5, DB seeded.

PROVEN LIVE ON v3: full two-round lifecycle claim 0xec68ad81...
(UNRESOLVED honest verdict, certificate 0x3ab2ceab..., tx C1PuXthov5...),
FIRST treasury fee mint (reason 8, 500000 MIST = exact 500bps), jury
rewards 4750000 MIST x2, warm-at-finalize proofs in 207-302ms.

STILL OPEN / OFFERED (do not relitigate silently):
1. 5/5 early-reveal live demo: weather-gated; Gonka drops juror-sized
   requests intermittently (seat success ~40 percent). Weather sentry
   was KILLED by the user's interrupt; offer to restart stands. Owner
   can also just submit from /fact-check.
2. Offered, undecided: R2 badge + decagon offset for round-2 seats;
   restart sentry; "1 seats" pluralization nit; retired jurors visible
   in raw API (directory filters active).
3. Queued hardening: lib/walrus/real.ts must refresh system state /
   rebuild client when a write aborts with MoveAbort (epoch-roll
   lesson: stale Walrus pricing kills claim creation until restart).
4. Owner actions: back 1-2 jurors via Google zkLogin on /agents
   (card now says "Back a juror agent"); run the demo claim when Gonka
   is healthy; record the 2-minute video.

ARTIFACT: morning report at
https://claude.ai/code/artifact/50cf84a3-45bb-4ed3-8705-c5962a03da80
(update by republishing scratchpad/morning-report.html same path).
Deploy ritual: gate -> targeted add -> commit/push -> railway-tree
checkout -> railway up -> watcher -> verify -> docs/memory. NO warm
step. cwd RESETS between Bash calls: always cd first. MCP memory
entity "OpenVerdict production topology" mirrors everything.

## 3p. EVENING 2026-09-01: LIVE DELIBERATION SHIPPED

Two deploys, both SUCCESS, all gates green (tests grew 501 -> 511):
- 3ad25805 (commit 708c729): canvas five-pack. LIVE/SYNCING chip on the
  stage pill (SSE-driven), kind-labeled sealed ticks (search vs page, dashed
  border), trails ray OUTWARD per juror (BFS ownership homes in
  force-layout), two-round decagon (round-2 seats interleave odd spokes,
  round-1 keeps its angles), R2 badges.
- 7b62353c (commit 13fdd32): PUBLIC DELIBERATION. Revealed round-1 jurors
  debate the split during DISCUSSION: two exchanges in seat order, each turn
  one single-shot Gonka run (DELIBERATION_PROMPT_SPEC_V1, no tools), strict
  two-key validation + citation allowlist, fail-closed SKIPPED turns
  (PROVIDER_ERROR/TIMEOUT/INVALID_OUTPUT/INVALID_CITATIONS/
  WINDOW_EXHAUSTED), immutable deliberation_turns table, PUBLIC_NOW
  DELIBERATION_TURN events stream live, transcript becomes hashed phase-2
  evidence artifact (urn:openverdict:deliberation-transcript) and the
  phase-2 freeze WAITS for the debate to settle. inference-worker drives
  DISCUSSION claims. UI: DeliberationChat dock bottom-centre (avatars,
  exchange badges, citation chips, replay support, hide/show). Chrome:
  nav pill removed from canvas, All-claims back link in rail, collapse tab
  at rail edge.
Protocol notes: transcript is OPTIONAL in artifactsForPhase so
pre-feature claims keep verifying (my review caught the worker's hard
throw; verified live on 0xec68ad... verify=true: all recomputations green,
0 issues); zero-reveal claims no longer strand in DISCUSSION (empty record
proceeds; the two 8/31 stranded claims stay stranded, freeze window long
past). Codex worker deliberation-engine ran 16:45-17:09 gpt-5.6-sol max
(verified via rollout turn_context); zombie registry job task-mtho9ep9
(dead pid, 13h stale) cancelled.
Claims today: 0xc2cf5469... (Bitcoin genesis) UNRESOLVED, storm-crippled
(R1 1/5 revealed, R2 4/5 failed): second full two-round lifecycle on v3.
DEMO PENDING: first live debate needs a CONTESTED claim (splits round 1)
plus 2+ surviving reveals. 23:5x weather: total storm for juror-sized
requests (all three families HTTP 000 at 100s) while tiny probes pass
(200 in 1s). Sentry restart offer stands.

## 3q. CLOSING STATE 2026-09-01 ~18:30 (pre-compaction #13): read 3p then 3q and continue as if nothing happened

Main = 95397d3, pushed, tree CLEAN, PRODUCTION = 95397d3 (deploy 5ff6caf5
SUCCESS, claim page verified 200). Four deploys tonight, every gate
511/511 tests + build: 3ad25805 (708c729 canvas five-pack), 7b62353c
(13fdd32 DELIBERATION, see 3p), a68d2ec4 (3dc0345 rail toggle: ONE tab
sliding left-[320px]/left-0 with the panel, arrow flips, in
CollapsibleRail), 5ff6caf5 (95397d3 SATELLITE rework).

SATELLITE MODEL (owner: "same agents, different round, one disc per
agent"): GraphNode.satellite flag + GraphEdge kind "round";
deliberation-graph builds ringSeatByAgent from phase-1 commitments; a
phase-2 seat whose agent is on the ring gets satellite:true and edge
round(parentSeat -> seat) instead of a claim spoke; fresh R2-only agents
still take ring slots (decagon only then). force-layout: satellites
excluded from ring homes/jurorCount/twoRounds; BFS traverses THROUGH
satellites; first-hop branches per juror fan +-0.5 rad max (spacing
1.2/(n-1)) so R1 trail, verdict, and R2 chain never stack; link round
distance 96 strength 0.8; collision satellite 22. Canvas: satellite disc
size-10, EDGE_STYLE.round purple #b3a7ff, R2 badge keys off seatIndex>=5.

DELIBERATION CHAT UI: components/viz/deliberation-chat.tsx dock
bottom-centre; page merges claim.deliberation + DELIBERATION_TURN
PUBLIC_NOW events by ordinal, replay filters atMs<=t, live pulse when
state===DISCUSSION; stage label "Deliberation · jurors argue their case".
Canvas chrome: nav pill REMOVED, "All claims" back link atop LeftRail.

WEATHER at ~18:25 (probes, heavy juror-sized): DeepSeek 200/76s,
MiniMax 200/11s, Kimi 000/120s (down). Tiny probes always 200/1s: not an
outage, capacity shedding. Committee must seat >=1 Kimi, so best case
now = 4 healthy + 1 dead seat. A contested claim splitting the 4
survivors STILL fires the debate.

PAUSED DECISION (owner went to sleep/compact before answering): fire the
contested demo claim NOW ("Moderate coffee consumption reduces the risk
of cardiovascular disease.") vs restart the weather sentry and wait for
Kimi. THE FIRST LIVE DEBATE HAS NOT RUN YET: the feature is deployed but
never exercised on a live claim. Do NOT fire unbidden; ask on resume.

Unchanged open items: owner actions (zkLogin backing on /agents, demo
run, 2-min video, submission); "1 seats" plural nit; retired jurors in
raw agents API; Walrus MoveAbort refresh hardening queued. Codex worker
verification path: ~/.codex/sessions/YYYY/MM/DD rollout turn_context
(deliberation run was gpt-5.6-sol max); zombie registry job cancelled
via codex-companion cancel. Deploy ritual unchanged (NO warm step; cwd
RESETS between Bash calls: ALWAYS cd first). Morning-report artifact
50cf84a3-45bb-4ed3-8705-c5962a03da80 republishes from
scratchpad/morning-report.html.

## 3r. TRUTH REFRAME SHIPPED 2026-09-01 ~20:35

Production = 98f6ffd (deploy 8e829c49 SUCCESS; verified live: /api/status
healthy + gonkaMode live, /learn serves "GonkaRouter only, by protocol rule"
and "One account, one seat", landing FAQ serves "Who actually runs the
jurors?", /agents serves "Back a jury seat", /claims 200). Gate 512/512
vitest (one NEW test: non-Gonka host refused) + typecheck/lint/build.
Deploy-safety check first: all 7 state-6 claims confirmed stranded
(secondCommit deadlines 15-64 h past).

WHAT SHIPPED (16 files): (1) Gonka-exclusivity invariant enforced in code:
lib/gonka/adapter.ts refuses any base URL host outside gonkarouter.io,
lib/verify/reexecute.ts same guard, lib/gonka/fake.ts now omits baseUrl
(injected fetch never leaves process, so the default URL is inert and the
invariant has NO escape hatch). (2) Seats-not-personas: zklogin card
reframed to "Back a jury seat" + role picker REMOVED (fixed
BACKED_SEAT_ROLE="INVESTIGATOR" still sent, API unchanged); role label
dropped from agents list row, seat-seal cards (prop kept in type),
jury-marquee, report summary; agent detail "Persona & role" -> "Registered
label" + honest helper; agent-card h3 -> "{family.name} juror". (3)
Reputation honesty: detail panel + agent-card relabelled static-in-v1
(counters registered at baseline, never updated, equal selection weight).
(4) Learn: KEY_FACTS Gonka-only row, "One account, one seat". Landing FAQ:
new item "Who actually runs the jurors?" (engine executes, verifiability
not decentralized execution, Nautilus roadmap). (5) README: item 2
"Reputation-weighted" -> "Diversity-constrained" + equal-weights truth,
Gonka-exclusivity paragraph in Idea, host-pin noted in track-fit + sponsor
tables, economics ROADMAP paragraph (requester-pays SUI + delegated seat
backing, majority-only pay REJECTED), counts 512. (6) PRD §1.1 items 19
(reframe + invariant, supersedes reputation-weighted phrasing) and 20
(economic direction of record, NOT implemented, judges-Q&A answer). (7)
STATUS: 3 new bullets (economics recorded, truth reframe, deliberation
shipped), Last updated 2026-09-01, counts 512.

CONTEXT: owner supplied the Gonka track mandate verbatim (all AI reasoning
MUST run on gonkarouter.io; multi-model consensus encouraged; claim
extraction URL/tweet/text; Truth Score 0-100 + reasoning trace;
transparency UI with per-step Gonka Request IDs) - VERIFIED all satisfied.
DIVE (github.com/derek2403/cannes2026) analyzed in full (clone in
scratchpad/cannes2026): same team's earlier prototype (PRD 7.1); its debate
is parallel stateless prompts w/ 400-500-char cross-visibility, simulated
commit-reveal, decisions in local JSON, replay-theater UI; OpenVerdict
anchors decisions on-chain instead. Gap list vs DIVE vision: reputation
never updates (BIGGEST, weight frozen 10_000), market loop invisible
(demo_binary_pool + /risk exist), PoP positioning, optional debate roles.
Economic staking model: owner decided ROADMAP ONLY.

UNCHANGED: first live debate never exercised; demo-claim decision still
paused (do NOT fire unbidden); owner actions (zkLogin backing, demo, video,
submission); weather sentry off.

## 3s. SUI x GONKA POSITIONING SHIPPED 2026-09-01 ~20:55

Production = d2143dc (deploy 001cb5c7 SUCCESS; verified live: landing FAQ
"Who pays, and who earns?", /learn "SUI: requesters fund claim budgets",
/api/status healthy gonka live). Gate 512/512. Earlier the same evening:
d70cf1c amended PRD SECTION 2 in place ("diversity-constrained committee,
equal selection weights in v1"), the one straggler a repo-wide sweep found.

WHAT SHIPPED (positioning only, on-chain surface unchanged): README
one-liner rewritten (requesters fund claims in SUI, standardized seats,
GonkaRouter-only inference, Sui settles verdict/payouts/record); "model in
one line" paragraph (Gonka the only mind, Sui the only judge, SUI the
working currency); economics roadmap paragraph promoted to subsection
"Next rung: delegated seat backing (recorded direction, not yet on-chain)";
track-fit framing line ("one build, both tracks"); Sui track table gains
"Economic loop in SUI" row (all-true: create_claim vaults, PayoutTickets,
fee reason codes, demo pool, /risk). Landing FAQ gains "Who pays, and who
earns?" (requester-pays real, seat rewards real, delegated backing labelled
documented direction, majority-only pay rejected). /learn KEY_FACTS gains
Currency row. PRD item 20 records the adoption; STATUS bullet added.
coinType verified 0x2::sui::SUI in release.testnet.json.

LESSONS (recurred tonight): (1) NEVER pipe a deploy-safety check through
head: the first stranded check showed only 7 of 12 state-6 claims (head -8
truncation) and the 98f6ffd deploy went out with 5 unverified (all later
verified stranded, no harm). (2) zsh does NOT word-split unquoted $vars:
`for id in $ids` looped once over the whole blob; use a single python
script for multi-fetch checks. All 12 state-6 claims verified stranded
before THIS deploy (secondCommit 16-65 h past).

UNCHANGED: first live debate never exercised; demo-claim decision paused
(do NOT fire unbidden); owner actions (zkLogin backing, demo, video,
submission); staking/pay-per-verification = docs only, owner deferred.

## 3t. FIRST LIVE DELIBERATION-PHASE LIFECYCLE 2026-09-01 ~22:15

Owner approved fire-on-clear earlier ("okay lets do that"); sentry cleared at
21:51 (DeepSeek+MiniMax 200, Kimi 000) and the contested claim fired:
0xc6d4f4ae0753...a92c6438 "Moderate coffee consumption reduces the risk of
cardiovascular disease." (submit POST returned an unparseable response but
the claim landed; watch that on camera). FULL two-round lifecycle live:
R1 2/5 revealed (Kimi 0x856e YES@7500, MiniMax 0x9afb YES@7500; both DeepSeek
seats + 1 Kimi TIMEOUT) -> DISCUSSION -> deliberation turns persisted: 4/4
SKIPPED WINDOW_EXHAUSTED -> R2 fresh 5 seats, 2/5 revealed (Kimi YES@8200,
MiniMax YES@8200; DeepSeek x2 + Kimi failed) -> UNRESOLVED state 11,
truthScore 8200, certificate 0x4cd2dd52f875...fa1c27e1. verify=true: all
recomputations true, issues []. Note DeepSeek 0-for-4 seats despite healthy
probes; Kimi delivered 2 reveals despite dead probes: weather is per-request.

ROOT CAUSE, debate never spoke: deadline-driven R1 (any failed seat blocks
the all-committed early-reveal) resolves at the reveal deadline (+570s);
discussionDeadline is +630s (engine.ts:4053, engine-set per claim at create;
a 540/720 variant sits at engine.ts:4007); deliberation window ceiling =
discussionDeadline - freezeLead 120s (engine.ts:3420) which is already past
at entry -> every turn WINDOW_EXHAUSTED. With >=1 Kimi seat forced per
committee and storms constant, nearly every R1 is deadline-driven, so the
debate can only speak today if all 5 seats commit early.

PENDING OWNER DECISION (do not implement unbidden): stretch the discussion
window for NEW claims (e.g. discussion +840s..900s, shift or keep +1080s
second commit; engine-only change at engine.ts:4053, deploy required) vs
wait for a fully-healthy early-reveal round. Recommended: stretch.

ALSO THIS WINDOW: pitch deck cut to 4 slides per owner spec (title; problem
3 points + Polymarket/Kalshi and Meta-ends-fact-checking examples; solution
3 points; one-liner slide "OPENVERDICT IS A decentralized court for factual
claims WHERE multi-model AI juries research, vote in secret, and debate in
public on Gonka AND every verdict settles on Sui as a certificate anyone can
recompute"), artifact e6d45cf2-788c-457a-9dc0-ce6067891a77 label simple-cut;
spoken expansions + judge Q&A crib committed at docs/demo/pitch-talk-track.md
(dates need re-verification before stage; cutoff Jan 2026). Video script at
docs/demo/video-script-2min.md (08de5dd). Artifact watches were dropped by a
/login account change mid-session; republish re-armed under current account.

## 3u. NAMING OF RECORD + IDENTITY SWEEP 2026-09-01 ~23:35

OWNER NAMING RULE (binding for all portrayal): top-level identity =
"decentralized verification protocol for factual claims"; "oracle" reserved
for integrator/market-slot contexts ("we fill the oracle slot"); jury/court
are EXPLANATION-layer metaphors only ("the models argue their case like
jurors"), never the leading identity; "factual claims" is the scope word
(bounded, falsifiable, evidence-settleable; opinions and unresolved future
events out of scope until they become factual questions). Owner confirmed
the one-liner slide text word for word as true.

STATE: an owner-side commit (f1f884c, before 8f625a7) had already swept
engine->protocol across README title area, og image, package.json, STATUS
and the GitHub description; CLAUDE.md first line likewise. This window
finished the sweep: landing FAQ item 1 identity sentence court->protocol
(panel-of-jurors explanation kept), README one-liner gains "for factual
claims", PRD 1.1 item 21 records the naming rule (commit 19be80e, gate
green, deploy 9b6bc18a in flight at checkpoint time; verify FAQ line live
after SUCCESS). GitHub repo description set via gh: "Decentralized
verification protocol for factual claims: independent AI models research
and debate on Gonka; verdicts settle on Sui as recomputable certificates."
Deck artifact 6d743d22-c3c8-4c7f-8df4-c2715b673990 (label protocol-first) +
talk track dcdcc28 already carry the rule, incl. Q&A crib naming entry.
Push hiccup: one transient github.com:443 connect failure, retried clean.

UNCHANGED PENDING: discussion-window stretch decision (engine.ts:4053,
recommended, awaiting owner go); owner actions (zkLogin backing, video via
docs/demo/video-script-2min.md, submission); staking = docs-only.

## 3v. REPO PRUNE 2026-09-02 ~00:15 (commit 6e22434)

Tracked files 401 -> 358; gate 512/512 after. DELETED (git history keeps
all): checkpoints 08-27/28/29 (THIS file is now the only checkpoint), all
plans except 2026-08-26-openverdict-build.md, docs/demo/video-script.md
(the -2min one is current) and workshop-brief.md, all docs/screenshots/*
(README no longer embeds any; owner's rename commit f1f884c had already
dropped the section), all diagrams except the three README-embedded sets
(architecture / claim-lifecycle / jury-round: png + dark png + excalidraw
each). STATUS claim-ids pointer now -> docs/demo/runbook.md. .gitignore now
ignores artifacts/, output/, tools/; local scratch (output/, tools/, empty
artifacts/, tsconfig.tsbuildinfo) removed from disk. All specs kept (PRD
addendum cites them). Deck artifact 6d743d22 unwatched per owner ("close
the claude artifact"); actual deletion is owner-side in the gallery; the
in-repo copy docs/demo/pitch-deck.html is now canonical.

## 3w. ROOT SLIM 2026-09-02 ~00:30

PATH CHANGES (update your reflexes): the spec of record is now
docs/PRD.md (was ./PRD.md) and the TS<->Move parity gate is
lib/protocol/parity.test.ts (was tests/integration/parity.test.ts; the
tests/ directory no longer exists and vitest no longer globs it). All
other root files are tool-pinned and must stay (Next proxy.ts, pnpm
trio, shadcn components.json, Railway Dockerfile/railway.json, etc.),
explained to owner and accepted. Gate identical after the move: 512
tests / 51 files.

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
