# OpenVerdict — demo runbook

How to take the product from a clean checkout to a live, demoable state.
Filled-in ids for the preserved demo claim are appended at the bottom as each
milestone completes.

## 0. Prerequisites

Node ≥22, pnpm, Sui CLI ≥1.52. `pnpm install` at the repo root.

## 1. Offline proof (no network, no keys)

```bash
pnpm test && pnpm test:move   # 996 TS + 89 Move (plus 4 in move/openverdict_seal)
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
   Since 2026-09-01 (sui CLI 1.78, network protocol 135) the CLI publish
   speaks gRPC that this machine's path cannot serve; use instead:
   `sui move build --dump-bytecode-as-base64 --no-tree-shaking --path
   move/openverdict > bytecode.json` then
   `pnpm tsx scripts/publish-openverdict-bytecode.ts bytecode.json`
   (SDK publish over the JSON-RPC fallback; dry-run it first). Also:
   the validator caps structs at 32 fields and local move tests never
   check that; Claim sits exactly at the cap, so new scalar state goes
   inside ChallengeReason.
3. Canary: one full direct-review lifecycle against testnet, fake adapter
   unless `GONKA_ROUTER_API_KEY` is set. First run registers the 7 agents;
   later runs reuse them.
4. Publish the real juror manifests. Each agent's on-chain `manifest_hash`
   must be the blake2b256 of the manifest document on Walrus that embeds
   the exact prompt spec and tool policy, otherwise `juryRun` fails closed
   ("does not match the engine prompt spec"). The script publishes the
   current document version (v5 = prompt spec v4 + tool policy v4 since
   2026-08-30 21:33; v2 on 2026-08-29, v3 and v4 on 2026-08-30 before it):
   `pnpm tsx scripts/publish-agent-manifests.ts --dry-run`, then without the
   flag (7 `update_agent_manifest` txs signed by the agent keys, 7 Walrus
   blobs paid by the operator's WAL). Re-running is idempotent: profiles
   whose hash already matches are skipped. On the hosted stack run it inside
   the container: `railway ssh -s app -- sh -c 'cd /app && node
   node_modules/tsx/dist/cli.mjs scripts/publish-agent-manifests.ts --dry-run'`.
5. Bind the hosted engine: `pnpm tsx scripts/seed-testnet-agents.ts`
   (with the production `DATABASE_URL`) rebuilds the agent rows from the
   chain + Walrus documents and refuses placeholder manifests.
6. Seal policy (2026-08-30): the reveal-key escrow needs the
   `openverdict_seal` package on chain and a `seal` section in the release
   manifest. `pnpm tsx scripts/publish-seal-policy.ts --dry-run`, then
   without the flag (inside the container use `--bytecode
   move/openverdict_seal/bytecode.json`; the Mac cannot reach the fullnode),
   then record `packageId`, threshold 1 and Mysten's two testnet key servers
   under `seal` in `config/release.testnet.json`. Current package:
   `0xf54eb61116372f8506ca332457b2fee61231a559e44923429f54fab355d0f0c5`.
7. Record explorer links below.

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
`NEXT_PUBLIC_*` baked at build time through Dockerfile ARGs, including
`NEXT_PUBLIC_APP_URL=https://app.openverdict.info` and
`NEXT_PUBLIC_SITE_URL=https://openverdict.info`, which drive the two-host
redirects in `proxy.ts`, the header hand-off and the metadata). Railway
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
research: every seat runs a support search and a challenge search, opens
pages on both sides (up to three per turn), and must cite pages it found
itself from at least two sites with a counter-evidence summary (juror
research v2 with batched opens, 2026-08-30). Optional knobs:
`GONKA_HEDGE_AFTER_MS` (default 25000; a slow call is repeated to the same
model and the first valid reply wins), `GONKA_RESEARCH_TIMEOUT_MS`.
Run one jury round; verify five real `devshard-…` ids across the three model
families. Every run's proof is at `GET /api/claims/<id>/runs/<runId>/proof`
(sealed blob plus its Seal escrow before reveal, plaintext bundle plus key
after, or a failure record for a seat that never committed) and can be
recomputed in the browser on `/verify` (Run proof tab, 15 checks), re-run
against the recorded model, or opened through Seal after the deadline.

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
   and a few WAL (every claim costs about 0.26 SUI plus 0.06 WAL).
   The testnet faucet (`faucet.testnet.sui.io`) is not reachable from the
   developer Mac (`*.sui.io` TLS); use the faucet web UI or a host that can.
3. `/api/status` reports suiHealthy, dbHealthy, gonkaMode live, walrusMode
   testnet; `railway logs -s app -d --lines 200` is quiet between claims
   (the workers skip finished and stuck claims, so a tick never spends a
   live claim's reveal window on dead ones).
4. Timeline of a hosted verification with the fast ladder (measured on
   claim #16, 2026-08-30 08:22, the first hosted YES verdict, certificate
   `0x62036142…`): POST returns after ~45 s (statement and criteria on
   Walrus, create_claim at ~t+20 s, statement artifact), committee at
   ~t+65 s, freeze ~t+100 s, research runs 4 to 72 s per seat, commits
   from the acceptance floor (~t+150 s) to ~t+200 s, advance ~10 s after
   the commit deadline (t+269 s), five reveals inside the 120 s reveal
   window (bundle writes are serialized on the operator lane, ~15 s each,
   then the reveal transactions go out in parallel: all five by t+337 s),
   certificate ~20 s after the reveal floor (t+404 s, 6.7 min). Under that
   ladder a round two ended at ~t+765 s (about t+1220 s today).
   From juror research v2 (17:10) until 22:26 the commit window was 330 s
   (about 230 s of research, the advance ~t+360 s, the certificate ~t+495 s,
   about 8.5 min, a round two ending ~t+860 s).
   Under the version 5 manifests (batched opens, 21:33) claim #22
   measured the same shape: commits by t+227 s, reveal phase t+380 s, four
   reveals by t+411 s, certificate t+502 s (8.4 min); opening three pages
   in one turn shortened the trails (5 to 8 steps instead of 8 to 10)
   without lengthening the research. Since 22:26 (commit `bb79bec`; the
   owner keeps every juror at equal selection weight and accepts slower
   verdicts so that Kimi finishes) the commit window is 450 s: a seat has
   about 350 s of research, commits start at the acceptance midpoint
   (~t+245 s), the advance lands ~t+480 s, the certificate ~t+620 s
   (about 10 min), and a round two ends ~t+1220 s, about 21 min, since the
   Seal release (it was ~t+980 s before the round-two fix). Measured on claim #24
   (22:27, "The Bitcoin block reward halved to 3.125 BTC in April 2024"):
   reveal phase t+531 s, round two opened after the discussion window,
   final state t+977 s (16.3 min) as UNRESOLVED with truth score 9667:
   both rounds revealed only three of five seats (round one lost the Kimi
   seat to a 113 s call cut at the seat bound after four calls of 20, 21,
   48 and 53 s, and a MiniMax seat to "no answer within maxTurns"; round
   two lost a MiniMax and a Kimi seat to the round-two seat bound 30 s and
   7 s into a call), so the longer window is not a cure for a slow node,
   only more room. Finding from #24: round two has always been a 120 s
   sprint (second commit deadline minus 60 s minus the discussion
   deadline) against about 350 s in round one, which is why every
   two-round claim so far (#18, #19, #24) ended UNRESOLVED; the fix, a
   second commit deadline at +1080 s and a second reveal at +1200 s, is
   live since the Seal release of 23:13 (two-round claims take about
   21 min, one-round verdicts stay at about 10 min; no live claim has
   needed a second round since). 2026-09-02: the discussion window itself
   was 60 s (+570 s to +630 s) and the debate never spoke, because the
   discussion opens only at the reveal deadline and a turn needs its 60 s
   budget plus the 120 s evidence-freeze lead before the discussion
   deadline; the window is now 720 s (discussion +1290 s, second commit
   +1740 s, second reveal +1860 s), so a two-round claim takes about
   31 min and one-round verdicts still about 10 min. Later the same day,
   round two at the table replaced the second research round: the ladder
   is now evidence cutoff +60 s, first commit +450 s, first reveal +570 s,
   discussion +1410 s (an 840 s window, room for three exchanges), second
   commit +1650 s (240 s: five short table-vote runs plus their approve
   and commit transactions on the operator lane), second reveal +1770 s,
   so a table verdict lands about 29.5 min after the POST (one-round
   verdicts unchanged at about 10 min). On 2026-09-03 the first commit
   window grew to 600 s (all-or-nothing attempts need every seat to
   finish; the night's voids were seats still retrying shed calls at the
   deadline), so the ladder is now first commit +600 s, first reveal
   +720 s, discussion +1560 s, second commit +1800 s, second reveal
   +1920 s: a one-round verdict about 12 min after the POST, a table
   verdict about 32 min. Do not redeploy while a claim is live: a container
   restart drops every in-flight research run (those seats fail closed).
5. Model health: Kimi-K2.6 on GonkaRouter was slow or failing most of the
   night (calls longer than the seat budget), then answered in 40 to 72 s on
   claim #15 (08:05, all five seats valid); DeepSeek-V4-Flash answers in 4
   to 30 s and MiniMax-M2.7 in 5 to 35 s. Four matching reveals out of five
   are needed for a verdict in a round (`REQUIRED_MATCHING = 4`), so a
   round survives at most one lost seat. GonkaRouter serves exactly three
   models (`GET /v1/models`), and the committee rules (at most two seats
   per model, three families per committee, seven active agents for the
   draw) put at least one Kimi seat on every committee. Every juror has
   the same selection weight (10000) by the owner's decision; a
   five-minute trial of 3000 for the Kimi profiles on 2026-08-30 was
   reverted (txs `91ir2QVb…` and `A7BEYRdu…`); the simulation showed 3000
   would cut two-Kimi committees from about 57% to 16% if that lever is
   ever wanted. Change weights with
   `node node_modules/.cache/set-eligibility.mjs <weight> <profileId...>`
   (operator key in the environment; run it inside the container when the
   Mac cannot reach the RPC) and verify with `weights.mjs`. The registry
   holds 32 eligibility records, exactly `MAX_ELIGIBLE_SNAPSHOT`: retire
   an inactive profile before registering a new agent. Since 2026-08-31
   (commit `85ce5ad`) a model call that has not answered after 25 s is
   hedged: the same request goes to the same model again and the first
   valid reply wins; in the attempt log and the bundle the loser shows
   as `HEDGE_ABANDONED` (not a failure) and a winning backup as kind
   `HEDGE`. Tune with `GONKA_HEDGE_AFTER_MS` (0 disables). A seat that
   still fails keeps its research trail: its run proof carries `failure`
   (status, message, transcript, attempts) and the claim page shows it.
6. What to show on a run page (juror research v2, 2026-08-30 afternoon):
   the provenance strip (requested versus served model, devshard, vLLM
   fingerprint, gateway and Gonka request ids, tokens, latency, links to
   the run approval, commitment and reveal objects on SuiVision and their
   transactions on Suiscan, the sealed and revealed blobs on Walrus); the research trail
   with a support search and a challenge search, the pages opened on each
   side, and any engine refusal (`CHALLENGE_REQUIRED`,
   `CORROBORATION_REQUIRED`) shown as an event; per turn, "what the model
   was sent" and "what the model said" with the node that answered; the
   system prompt and budgets with their hashes; evidence for and against
   the claim, the reasoning trace, the counter-evidence summary and the
   citations; and the full public bundle as JSON next to the recomputed
   hash checks. Jurors whose manifest is still version 3 show the v1 trail
   (one side is enough for them); the seven testnet jurors carry version
   5 manifests since the republish of 2026-08-30 21:33 (version 4 from
   16:33 to 21:33). Under version 5 (policy v4) a juror may open up to
   three pages in one turn: the trail shows each page as its own step
   labelled "page N of M opened together". Below the hash checks, "Re-run
   this juror" resends the revealed run's exact messages to the recorded
   model at temperature 0 and shows the fresh verdict, output hash, served
   model, node ids and latency next to the recorded ones (a match
   corroborates; a difference is a reason to look closer, not proof of
   tampering; the button costs one model call and is rate limited). Below
   it, "Seal escrow" (runs sealed after the Seal release): the policy
   package, the two Mysten key servers, the identity (claim, seat, phase)
   and the deadline the escrow opens at; "Open through Seal" recovers the
   AES key from the key servers with a throwaway keypair (no wallet, no
   gas) once the deadline has passed, and shows "Matches the revealed key"
   or, for a seat that never revealed, the recovered core's outcome with
   its hash checked against the sealed core hash. Before the deadline the
   key servers refuse ("The key servers refuse until the reveal deadline
   passes"), which is the point.
   Demo claims: #26 `0x089c6c7c…` (NO 200, certificate `0x975b3ae1…`,
   10.2 min, 5 of 5 with both Kimi seats; the first claim with hedged
   calls: open the Kimi run `0xfc39cf25…` to see a HEDGE attempt as the
   winning request), #25 `0xbdab0011…` (YES 9860, certificate `0xff3191bc…`,
   the first claim with Seal escrows and the first 5-of-5 with both Kimi
   seats under the 450 s window: open any run for the Seal block; its
   escrows opened at 2026-08-30 15:24:09Z, so "Open through Seal" works
   on every seat), #22 `0x387a344b…` (YES 9950, certificate `0x7c2fcb4b…`,
   the first v5 verdict: every revealed run shows pages opened together;
   open the DeepSeek run for a three-page batch), #21
   `0x5629faca…` (YES 9750, certificate `0x8a5ab5ad…`, the first v2
   verdict: open any of its four revealed runs), #16 `0x9169c707…` (YES
   9860 under v1), #18 `0xb526116e…` and #19 `0xe46d6997…` (two-round
   UNRESOLVED with v2 trails).

7. Attempts: a voided attempt (any seat failing a binding step in either
   round) relaunches automatically once the three model families answer a
   health probe, up to two relaunches (three attempts total); the claim
   page's attempt pill reads "Attempt N of 3" and a voided banner names
   the seat, model and reason with links to the previous and next attempt.
   A voided attempt lapses on-chain without a certificate: the settlement
   contract has no mid-flight cancel once a claim leaves the CREATED
   state, so the void is an engine fact only, not a chain state. Republish
   agent manifests to v6 before a live demo (manifest v6 pins the
   table-vote prompt): in the container run `pnpm tsx
   scripts/publish-agent-manifests.ts --dry-run`, check the seven printed
   hashes (manifest hash and table vote hash) match what you expect, then
   run it again without `--dry-run` to publish live, then confirm
   `GET /api/agents` shows `tableVotePromptHash` for all seven.

## 4c. Emergency: a model family is down and no claim can launch

The draw needs three model families, so one family going away stops every
submission (GonkaRouter stopped serving Kimi K2.6 on 2026-09-05 at 01:39).
Degraded mode lowers the requirement to two families for as long as that
lasts, and every certificate, report and audit drawn under it says so. Run it
in this order, and reverse it in the opposite order when the family returns.

1. Confirm it is the provider and not us: `pnpm cli fact-check start` is not
   the test. Read `GET https://app.openverdict.info/api/weather` and check the
   family's row says `down`, then call the model directly through
   GonkaRouter. A row that says `slow` is not a reason to degrade anything.

2. Upgrade the package, once, if degraded mode is not deployed yet. Build the
   bytecode with `sui move build --dump-bytecode-as-base64 --no-tree-shaking
   --path move/openverdict > bytecode.json` (sui 1.78.1 no longer accepts
   `--ignore-chain`; `--no-tree-shaking` is the offline equivalent), then run
   `pnpm tsx
   scripts/upgrade-openverdict-bytecode.ts bytecode.json` with
   `SUI_OPERATOR_SECRET_KEY` in `.env`. It prints the operator, the current
   and original package ids, the UpgradeCap, the new package id and the
   digest, and rewrites `packageId` and `originalPackageId` in
   `config/release.testnet.json`. Redeploy the app so it targets the new
   package id, and only between claims.

3. Lower the rule, one transaction:
   `OPENVERDICT_RELEASE_MANIFEST=config/release.testnet.json pnpm cli registry
   diversity --required 2 --per-model 3`. It signs with the operator key and
   the `adminCapObjectId` in `config/release.testnet.json`, and emits
   `JuryDiversityChanged`. Two families are only accepted with three seats per
   family: five seats cannot be filled otherwise, and the CLI and the Move
   entry both refuse `--per-model 2`.

4. Add the seats degraded mode needs, before touching eligibility. This is
   the step that is easy to get wrong. The draw takes five seats AND two
   reserves, all of them active, and the two reserves must carry different
   roles, one SKEPTIC and one SOURCE_AUTHENTICITY, with owners outside the
   five. Today three families and a cap of two seats per model force the
   committee's role split; at three seats per model that constraint is gone,
   so a committee can take three seats of one role and leave no reserve of it.
   Anything under seven active seats aborts every draw with
   `E_INSUFFICIENT_DIVERSE_AGENTS`, and seven with a thin role mix strands the
   reserve pair on most draws.

   Read the registry, not the app's agent list:
   `OPENVERDICT_RELEASE_MANIFEST=config/release.testnet.json pnpm cli registry
   roster`. It prints the draw rule, the active count against the seven a draw
   needs, one line per model family with its active roles, and one line per
   seat with its profile id, role, active flag and weight. The app's
   `/api/agents` is wider: it keeps rows from earlier package versions, and
   those registries are not the one `select_committee` reads. Only the roster
   command's list can be trusted for this step and for step 5's profile ids.

   As of 2026-09-05 the registry holds 10 records, 9 active: DeepSeek 4 active
   (3 SOURCE_AUTHENTICITY, 1 INVESTIGATOR) plus 1 inactive SKEPTIC, MiniMax 3
   active (2 SKEPTIC, 1 SOURCE_AUTHENTICITY), Kimi 2 active SKEPTIC. Taking
   Kimi out leaves exactly 7 with a fragile reserve pair, so add four seats
   first: a SKEPTIC and an INVESTIGATOR on DeepSeek, an INVESTIGATOR and a
   SOURCE_AUTHENTICITY on MiniMax. That leaves 11 active seats with both
   reserve roles present on both families.

   The seven original operator seats were registered by
   `scripts/testnet-canary.ts`, which calls `agent_registry::register_agent`
   once per agent slot with an operator-paid bond; it rebuilds the whole
   roster and is not a per-seat tool. The supported way to add one seat today
   is the stake path, which is the same prepare-and-confirm flow the browser
   card runs and which also writes the engine's roster row:

   ```bash
   pnpm stake:seat --base https://app.openverdict.info \
     --model deepseek-ai/DeepSeek-V4-Flash-0731 --role SKEPTIC
   pnpm stake:seat --base https://app.openverdict.info \
     --model deepseek-ai/DeepSeek-V4-Flash-0731 --role INVESTIGATOR
   pnpm stake:seat --base https://app.openverdict.info \
     --model MiniMaxAI/MiniMax-M2.7 --role INVESTIGATOR
   pnpm stake:seat --base https://app.openverdict.info \
     --model MiniMaxAI/MiniMax-M2.7 --role SOURCE_AUTHENTICITY
   ```

   Without `--key` on testnet the script derives a throwaway staking key and
   funds it with 0.2 SUI from the operator, so the operator pays either way.
   Run this after step 3: the stake endpoint checks the seat against the
   registry's current rule, and under the old pair it would refuse the third
   seat on a model. Then run `pnpm cli registry roster` again and check the
   two healthy families hold at least seven active seats between them with a
   spare SKEPTIC and a spare SOURCE_AUTHENTICITY outside any five that could
   be drawn.

5. Take the down family's seats out of the draw, one transaction per seat.
   Take the profile ids from `pnpm cli registry roster` (the two active Kimi
   seats), then for each id run
   `OPENVERDICT_RELEASE_MANIFEST=config/release.testnet.json
   DATABASE_URL=<production url> pnpm cli agents eligibility <profileId>
   --active false`. `DATABASE_URL` matters: the command flips the seat on
   chain and in the engine's own roster, and the weather gate reads the
   roster. The result line says `rosterMirror: updated` when both moved, and
   `weight` with the value it preserved. `set_agent_eligibility` overwrites
   the stored weight, so the command reads the seat's current weight and
   passes it back unchanged; live seats carry 10000, and a seat rewritten to
   weight 1 would almost never be drawn again.

   Do not touch the inactive DeepSeek skeptic
   `0x81a73726...`: it went inactive through an unstake request and its bond
   is leaving. Leave it inactive through the reversal too.

6. Confirm the gate opened: `pnpm ov weather` prints a rule line reading
   "2 model families required (degraded mode), 2 active: DeepSeek, MiniMax"
   and must say clear. `pnpm cli registry roster` must show at least seven
   active seats across those two families. Then submit one
   real claim and watch it settle. Its report and its audit row `S5 Model
   families drawn` will read `families drawn: 2 (registry required 2 at the
   draw)`, and the certificate card will say "2 model families (degraded
   mode)". That is correct and must not be hidden.

Reversal, when the family answers again, in this order: put the Kimi seats
back with `pnpm cli agents eligibility <profileId> --active true` (same
`DATABASE_URL`, and it preserves the weight the same way), then raise the rule
with `pnpm cli registry diversity --required 3 --per-model 2`, then confirm
`pnpm ov weather` reads clear with three model families required and three
active. Leave the four seats added in step 4 in place: they are staked seats
like any other, and a wider roster is what made the draw robust. Leave the
unstaking DeepSeek skeptic inactive. Claims that already settled
keep their degraded record exactly as it is: the committee carries the pair it
was drawn under, so nothing about them changes.

## 5. Human end-to-end walkthrough (the user's test)

1. Open the live URL → submit a claim (no wallet needed).
2. The claim page opens in Chat: one card per juror, the events in the same
   words, one juror trail open at a time, and every debate turn in full.
   Switch to Graph for the courtroom ring: jurors seated clockwise from
   juror 1 at the top, an empty middle, each juror's research on its own
   outer arc, and the certificate closing the ring at the bottom. Seats keep
   their places, so a juror is where you left it. Jurors sprout locked
   pulses while they research (content-free ticks), and the wedges fill with
   real searches, pages and citations at reveal. Click any node for the
   inspector (an overlay: opening it never shifts the ring; drag its left
   edge to resize it). After settlement
   press Play for the replay (10x default, 1x/30x presets). In a juror's
   proof, "Check with GonkaRouter" fetches the
   gateway's own public receipt for the recorded request id and compares
   model, devshard and timing. The full audit view is behind "Full report".
3. `/verify`: paste a revealed vote's fields → commitment matches.
4. Connect wallet (or Google via zkLogin if Enoki keys set) → deposit into the
   demo pool → after settlement, redeem.
5. Explorer: open the claim, certificate, and payout objects (Display metadata
   should render names/descriptions).
6. CLI: `pnpm cli -- claim inspect --claim <id> --verify --json`.
7. Live audit with Claude (the judges' view, no key, no database): in a
   Claude Code session run
   `/openverdict-audit https://app.openverdict.info/claims/<claimId>`.
   Inside the repo the skill loads from `.claude/skills/openverdict-audit/`;
   from any other folder link it once, from the repo root:
   `ln -s "$(pwd)/.claude/skills/openverdict-audit" ~/.claude/skills/openverdict-audit`.
   The auditor takes about ten seconds on a settled claim (event history,
   Sui JSON-RPC, Walrus, GonkaRouter receipts; measured 5 to 10 s); the
   60-second spoken script under "Demo script" in the skill's `SKILL.md`
   covers the wait and Claude's write-up. Claude then prints
   the verdict card, an eight-sentence timeline, one line on what the audit
   proves and does not, and "Ask me anything about this verdict": hand the
   questions to the judges (model answers for the three likely ones are in
   the same section). When a judge asks "show me the reasoning", Claude runs
   `ov trace <claimId>` (or `pnpm ov trace <claimId> --juror N --full`
   without Claude), which prints every juror's searches, opened pages,
   quotes, answer and gateway receipt, and with `--full` the exact prompt
   and output. Without Claude, `pnpm audit:claim <link>` prints the
   same dossier. Use a settled claim; rehearsal claim on the upgraded
   package: `0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6`
   ("Humans use only ten percent of their brains.", NO, truth score 2.00,
   5 of 5 seats, certificate
   `0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706`).
8. Verify a claim end to end through Claude (demo flow B in the skill's
   `SKILL.md`; the same journey without Claude is `pnpm ov weather`,
   `pnpm ov submit "<claim>"`, `pnpm ov watch <id>`, `pnpm ov audit <id>`).
   Before the slot: `pnpm ov weather` (or ask Claude "is the jury
   healthy?"); run this flow on stage only when it says clear, otherwise
   go straight to step 7 on the rehearsal claim. Have a fresh statement
   ready that was not submitted in the last hour (the engine has no
   duplicate check, but a duplicate on the board reads badly), and keep the
   rehearsal claim id from step 7 at hand. Open a second Claude Code
   session or the same one; the skill loads as in step 7. Spoken flow,
   with the clock counted from the moment the claim exists on Sui:
   - T minus 1 min. Say: "First, is the jury available?" Type
     `/openverdict-audit is the jury healthy?` Claude runs `ov weather`
     (about 5 s) and reads the four rows: DeepSeek, MiniMax, Kimi, Web
     search, then clear or not clear, then how old the probe is. Say:
     "Three model families on Gonka and the web search provider, each
     probed with a research-shaped request in the last few minutes. Clear.
     If it were not, the claim would queue instead of burning an attempt."
   - T minus 30 s. Paste the statement: `verify this claim: <statement>`
     (or paste an article URL: Claude runs `ov extract` in 10 to 30 s and
     lists up to three candidates with reasons and quotes; pick one by
     number). Claude repeats the exact wording and asks for a go. Say
     "go". The POST takes under a minute: the statement goes to Walrus,
     then `create_claim` runs on Sui. Claude prints the claim link.
   - T+0. Open `https://app.openverdict.info/claims/<claimId>` on the
     audience screen. Say: "The console on the other screen shows the same
     events live; Claude reads the same public stream." Claude starts
     `ov watch <id> --for 9m` and narrates each line as it lands.
   - T+1 to T+2 min. The lines "5 seats drawn: <models>" and "evidence
     frozen, root 0x..." land. Say: "Sui's own randomness drew five seats
     from three model families, at most two per model. The evidence is
     frozen on Sui before anyone reasons. Each juror now researches alone
     through our engine, for and against the claim, with quotes from at
     least two sites; the console shows only content-free pulses until the
     reveal."
   - T+4 to T+10 min. "juror n run approved" and "juror n committed (k of
     5)" land one seat at a time. Say: "As each juror finishes, its run
     hash lands on Sui and it seals its vote as a hash. Five sealed votes,
     and nobody, including us, can read any of them." If this stretch is
     too long for the slot, hand the audience the console and run step 7
     on the rehearsal claim in the same session ("let us look at a claim
     that settled earlier today"); come back when Claude's next watch call
     reports the reveal.
   - T+9 to T+12 min. "COMMIT_1 to REVEAL_1", then "juror n revealed
     <outcome> <bps> bps (k of 5)". Say: "The votes open together and Sui
     recomputes every commitment before accepting it. Four matching
     reveals settle it; a split would go to a public debate over the
     frozen record and a sealed table vote; a jury still split ends
     UNRESOLVED. Claude only reports what landed; it never guesses the
     verdict." Claude's watch call ends at nine minutes with exit 4 and
     "run again with --since N"; it calls again by itself, so expect one
     short pause here.
   - T+11 to T+12 min (one-round verdict). "final: <result>, score X.XX,
     certificate 0x..." lands. Say: "Final. Claude now runs the auditor
     with no key and no database: it refetches the record from Sui, Walrus
     and GonkaRouter and recomputes every hash." Claude runs `run.sh`
     (about ten seconds) and presents the card, the timeline, the proves
     and does-not line, then "Ask me anything about this verdict." Hand
     the questions to the judges; three model answers for this flow (what
     if Gonka is down right now; why did it queue; why can a seat void the
     whole attempt) are under "Demo flow B" in the skill, next to the
     three audit answers from step 7.
   - If round one splits: the discussion opens on the fifth reveal and
     runs up to 14 minutes, stopping early when nobody moves; the table
     vote follows (4 minutes to commit, 2 to reveal), so the verdict lands
     about 32 minutes after launch. The console's debate dock shows the
     turns as they stream. Unless the slot has 25 more minutes, switch to
     the rehearsal claim for the audit and let the live claim finish on the
     other screen.
   - If a seat fails closed: Claude reads "attempt n voided: <reason>
     (<model>, phase p); relaunch pending" (the watch polls the claim
     record every 60 s, so up to a minute after the failure). Say:
     "All or nothing: a seat failed, so no vote is invented and nothing
     partial is finalized. The void is public on the claim page with the
     seat, the model and the reason; the engine relaunches on the next
     clear probe as attempt n of 3." Switch to the rehearsal claim for the
     audit; the voided claim can be audited too (its card explains the
     void).
   - If `ov weather` was not clear and you submitted anyway: Claude prints
     the queue link and `ov watch <queueId>` polls every 30 s. Say: "A
     jury needs all three families and web search; the claim starts by
     itself on the first clear probe, one launch every ten minutes, and
     expires after six hours." Do not wait on stage; run step 7.
   Timings to plan with: weather 5 s, extract 10 to 30 s, submit under a
   minute, committee and freeze by minute two, commits from about minute
   four, reveal about minute eight to ten, one-round certificate about
   minute 11 to 12 (measured 10.6 min on the rehearsal claim), audit about
   ten seconds plus the write-up. Budget 15 minutes for the live one-round
   path with the audit, or 4 minutes for the weather, the submission and
   the first two minutes of events followed by step 7 on the rehearsal
   claim.

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
| Certificate | `0x8efdabe0900a3e4da39210394d211123ec82be6d176a51175adef7b8f41a8634`, [SuiVision](https://testnet.suivision.xyz/object/0x8efdabe0900a3e4da39210394d211123ec82be6d176a51175adef7b8f41a8634) |
| Finalize digest | `3FuF8jUCkHmqN19fyFNQhTE96DsiAb4sbS4yD72Uzic3` |
| Truth Score | **YES — 9700 bps**, off-chain recompute == on-chain value |
| Pool settle / payout digests | exercised on localnet by `pnpm e2e:localnet` (sponsored deposit + payout); not part of the testnet canary |
