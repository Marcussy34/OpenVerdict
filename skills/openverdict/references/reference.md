# OpenVerdict protocol reference for narration

Every statement here is taken from the repository (README, `docs/PRD.md`, `docs/demo/runbook.md`, `docs/CHECKPOINT-2026-08-30.md`, `move/openverdict/sources/jury.move`, `move/openverdict/sources/settlement.move`, `lib/protocol/truthScore.ts`, `lib/verify/run-proof.ts`, `lib/engine/engine.ts`, `lib/gonka/promptSpec.ts`, `lib/gonka/adapter.ts`, `lib/research/firecrawl.ts`, `app/api/fact-checks/route.ts`, `app/api/_lib/guard.ts`, `lib/claim-extraction/handler.ts`, `app/claims/[id]/page.tsx`, `components/weather/weather-strip.tsx`, `docs/superpowers/specs/2026-09-03-ov-cli-design.md`) as of 2026-09-03. Quote it; do not extend it. Numbers that describe timing are the testnet ladder of that date and can change with a deploy; the dossier's timeline is the record for one claim.

## The protocol in one paragraph

OpenVerdict is a decentralized adversarial AI jury protocol for factual disputes, not an agent swarm. Five juror seats are drawn on-chain from three model families, each juror researches independently, casts a commit-reveal secret ballot, and a 4-of-5 quorum settles the claim. A split jury cross-examines the deadlock in a bounded debate over a frozen record and votes once more under seal; a jury that is still split finalizes as UNRESOLVED, an honest outcome. Gonka is the only mind, Sui is the only judge, Walrus is the only memory, and SUI is the working currency. The system certifies the process, not universal truth: manipulation cannot hide.

## The three pillars and why each is irreplaceable

| Pillar | What it provides | Why it is irreplaceable |
| --- | --- | --- |
| Gonka (GonkaRouter): the only mind | Every reasoning pass: claim extraction, five independent research runs, each debate turn, each table vote. Three model families behind one gateway, with a request id, devshard id and fingerprint kept for every call. | A jury is only as independent as its minds. Identical models share training blind spots and alignment priors, so five copies of one model debating is one opinion five times. The committee rule mandates three families (DeepSeek, Kimi, MiniMax) with at most two seats per family, so no single architecture or vendor can dictate the quorum. One gateway serving three families makes that rule enforceable and pins each juror's model in a manifest; the request ids are the receipts a verifier re-checks against Gonka's public lookup. |
| Sui: the only judge | The clock and the court: claims and deadlines as objects, the jury drawn by native randomness under family limits, commit-reveal enforced in Move, evidence roots frozen before any reveal, the immutable certificate and truth score, payout tickets, the demo pool that settles on the certificate, zkLogin seat staking. | Nobody picks the judges (native randomness) and nobody edits the result (Move rules, immutable objects). The verdict is not a number a judge is asked to trust; it is something the chain acts on: it settles the pool and pays the seats. |
| Walrus + Seal (Mysten): the only memory | The public record: claim text, every page a juror opened, evidence manifests, sealed and revealed run bundles, debate transcripts, failure records, all content-addressed and hash-pinned on Sui. Seal time-locks each reveal key so sealed bundles open after the deadline without the operator. | "Anyone can recompute" is only true if the bytes are public and cannot be swapped. Walrus gives the bytes an address the on-chain hash commits to; Seal removes the operator from the reveal path. Without this pillar the verification checks have nothing to run on. |

Remove one pillar and the app fails:

| Pillar removed | Substitute | What breaks | Why the substitute fails | What is left |
| --- | --- | --- | --- | --- |
| Gonka | One vendor API, or five separate vendor keys | The three-family jury, the two-seats-per-family cap, the manifest-pinned model ids, the request-id receipts | One vendor is one mind voting five times, steerable by whoever controls it. Five keys turn one enforceable rule into five private promises nobody can audit as one | A truth score that still prints a number and no longer means anything |
| Sui | A database run by the operator | The random jury draw, the deadlines, the vote commitments before reveal, the evidence root frozen before any reasoning, the immutable certificate, the payouts, the pool settlement | Every one of those becomes a line the operator can edit: pick friendlier jurors, reopen a vote, swap evidence after the fact, change the result, delete the log | A verdict people are asked to trust, instead of one the chain acts on |
| Walrus + Seal | The operator's own storage bucket, keys held by the operator | The bytes behind every on-chain hash; the operator-free opening of sealed bundles after the deadline | Files in the operator's bucket can be rewritten or withdrawn; the on-chain hashes then point at nothing anyone can fetch. Without Seal, the party with a motive to hide a bad run is the one holding the key | A story about evidence, with no record to check it against |

Why they only work together: Gonka produces the work and the receipts. Sui commits to that work before it is revealed and enforces what happens next. Walrus keeps the bytes those commitments point at, and Seal makes them openable without the operator. The verification walks that chain end to end: fetch from Walrus, hash, compare to Sui, re-ask Gonka. Cut any link and the chain does not get shorter; it breaks.

## Lifecycle with the current timings (testnet ladder, 2026-09-03)

Times are offsets from the submission (the POST). The claim's own deadlines are in `GET /api/claims/<id>` under `deadlines`.

1. Submit. A statement (or a URL that a GonkaRouter model distills into one checkable claim) is posted. The claim, its budget and its deadlines go live on Sui; the statement and the resolution criteria are archived on Walrus. The demo tier is free to the requester. On bad weather the API refuses the submission and nothing is stored (see the weather gate).
2. Committee drawn. As soon as the claim asks for review, `select_committee` uses Sui's native `Random` to draw five seats and two reserves from the registry under the diversity rules, in the same call. Each seat is a `JurySeat` object transferred to the juror's owner address, and the claim enters the round-one commit window.
3. Evidence frozen. Submitted sources (cutoff at +60 s) are fetched through an SSRF-hardened fetcher, cleaned, hashed, stored publicly on Walrus, and their Merkle root is frozen into an `EvidenceBundle` object on Sui, inside the commit window and before any model reasons. Every seat and the round tally are bound to that root before any commit.
4. Acceptance window: one minute after selection. A seat accepts or declines; a declined seat is replaced from the reserves only if the replacement keeps the diversity rules. The committee then locks. Round-one commits start after this floor. Round two has no acceptance floor.
5. Round one research, once the root exists (about +70 s). Each juror researches alone through the engine (see the research rules). Its sealed run bundle goes to Walrus, its run hash is fixed on Sui as a `RunApproval`, then the seat commits.
6. First commit deadline at +600 s. Every seat must have committed. A reveal may start as soon as all five seats have committed, or after the deadline.
7. First reveal deadline at +720 s. Reveals are checked on-chain against the commitments. Four matching reveals of five settle the claim in round one (the common case). A one-round verdict lands about 12 minutes after the POST (measured: 10.6 minutes on the claim "Humans use only ten percent of their brains.", 5 of 5 seats).
8. Discussion (only without a quorum). It opens on the fifth reveal (the Move rule also allows the reveal deadline, but under the all-or-nothing policy a missing reveal voids the attempt instead); the discussion deadline at +1560 s is only the bound. Revealed jurors argue over the frozen record, up to three exchanges, stopping early when nobody moves. A dissenting seat opens each exchange and the sides speak alternately by seat index; a seat that is asked a question speaks next and answers it first. The transcript is frozen as phase-two evidence on Walrus and round two opens the moment that bundle is linked.
9. Second commit deadline at +1800 s: five table votes, each a single sealed GonkaRouter call with no tools, approved and committed. Second reveal deadline at +1920 s. A table verdict lands about 32 minutes after the POST.
10. Finalize. `finalize_claim` reads the bounded tally, mints the immutable `ResolutionCertificate`, closes the tally, and creates the payout tickets. Only a locked committee and a tally bound to the frozen evidence root can finalize.

Any juror error at a binding step voids the whole attempt (see attempts).

## The research rules a juror follows

Fixed in the prompt spec and tool policy (version 4, hashed into the juror's on-chain manifest, document version 6):

- Two search intents: `support` looks for evidence that the claim is true as stated; `challenge` looks for evidence that it is false, disputed, outdated or misstated. At least one search of each is required before a YES or NO.
- Pages are opened by the engine, never by the model; up to three pages in one turn; every page is archived on Walrus (raw and canonical copies) and hashed into the transcript.
- Budgets: 4 searches, 5 opens, 10 turns.
- The two-site rule: a YES or NO needs citations from at least two different sites, at least one of them a page the juror found through its own search, and a completed challenge search whose most credible result was opened. Otherwise the juror must answer UNSURE.
- A citation is an exact sentence of 20 to 300 characters copied from the page text the juror received. Quotes are checked against the archived page.
- The answer must name the strongest evidence against the verdict (the counter-evidence summary).
- Temperature 0, JSON only, strict schema.

## The research trail

What one juror's run looks like from the inside, as the public run proof records it (`GET <base>/api/claims/<claimId>/runs/<runId>/proof`, field `bundle`). `ov trace <claimId>` prints exactly this; `--full` prints it verbatim.

1. The pinned system prompt (`bundle.promptSpec.systemPrompt`, hashed into `promptHash` and from there into the run hash on Sui). It states the three actions, the method, the output contract and the budgets. It is identical for every juror of a round, so the trail prints it once.
2. The claim JSON (`bundle.input`): the statement, the resolution criteria, the relevant deadline, the frozen evidence manifest with its root, the submitter's material as context only, the seat's role, and the output contract.
3. A loop of turns. Each turn is one JSON action from the model, answered by one tool result:
   - `{"action":"search","query":"...","intent":"support"|"challenge"}` returns `{"tool":"search","results":[{"n","title","url","snippet"}]}`;
   - `{"action":"open","urls":[...],"from":0}` (or a single `"url"`) returns `{"pages":[{"evidenceId","ref","url","from","chars","totalChars","truncated","text"}]}`, or `{"url","error"}` for a page that could not be read;
   - `{"action":"answer","output":{...}}` ends the run. The output is the validated output the vote commitment binds: outcome, confidenceBps, evidenceFor, evidenceAgainst, unsupportedClaims, decisiveEvidence, reasoning, publicReasoningTrace (each entry a check, its evidence ids, its assessment SUPPORTS, CONTRADICTS, MIXED or INSUFFICIENT, and its finding), citations (evidence id, url and one verbatim quote) and counterEvidenceSummary.

   Pages are opened by the engine, never by the model, and each opened page is archived on Walrus and hashed into the transcript (`bundle.transcript`), whose hash is bound by the run hash.

Budgets, from the pinned tool policy v4 (`DEFAULT_TOOL_POLICY_V4` in `lib/gonka/promptSpec.ts`, copied into every bundle as `bundle.toolPolicy` and hashed as `toolPolicyHash`):

| Budget | Value |
| --- | --- |
| `maxSearches` | 4 |
| `maxOpens` | 5 |
| `maxOpensPerTurn` | 3 |
| `maxTurns` | 10 |
| `maxLoopMs` | 600000 (ten minutes) |
| `resultsPerSearch` | 5 |
| `snippetChars` | 200 |
| `pageSliceChars` | 4000 (one slice per open; `from` reads further) |
| `maxPageChars` | 60000 |
| `minCitationDomains` | 2 |
| `minOpensPerSide` | 1 |
| `requireChallengeSearch` | true |
| `tools` | search, open |
| `provider` | firecrawl |

When a budget is exhausted the tool answers with an error (for example `BUDGET_OPENS`) and the juror must answer with what it has. A round-two table vote (bundle version 6) has no transcript and no budgets of this kind: it is one no-tools call over the frozen record and the debate transcript, under the pinned table-vote prompt.

## What each hash binds

All hashes are blake2b-256 (`@noble/hashes` in TypeScript equals `sui::hash::blake2b256` in Move; the cross-language parity vectors are pinned in both test suites). "Canonical JSON" means the canonical serialization the engine uses for hashing.

| Hash | Over what | Where it lives |
| --- | --- | --- |
| Prompt hash | Canonical JSON of the prompt spec: the exact system prompt, temperature, token cap, output format | The juror's manifest document on Walrus, whose hash is on chain; the run bundle; the run record |
| Tool policy hash | Canonical JSON of the tool policy: search and open budgets, the two-sided rules, the two-site rule | The juror's manifest document; the run bundle |
| Input hash | Canonical JSON of the input the juror received: the claim statement, resolution criteria, submission kind and URLs, and the evidence manifest with its root | The run bundle; the run record |
| Output hash | Canonical JSON of the validated output: outcome, confidence, evidence for and against, unsupported claims, decisive evidence, reasoning, public reasoning trace, citations, counter-evidence summary | The run record; the vote commitment preimage; the `RevealedVote` object |
| Tool transcript hash | Canonical JSON of the research transcript: every search with its intent, every page opened with its evidence id, every citation check, the counts | The run record |
| Evidence root | Merkle root over BCS leaves (evidence id, content hash, canonical hash), one manifest per phase, items sorted by evidence id | The `EvidenceBundle` object on Sui; bound to every seat and tally before a commit; inside the run record and the vote commitment |
| Run hash | BCS of `RunRecordV1`: run id, claim object id, agent profile id, jury seat id, phase, attempt, provider id, model id, Gonka request id, prompt hash, input hash, output hash, tool transcript hash, evidence root, requested-at and completed-at timestamps | The `RunApproval` object (consumed by the commit), the `JurySeat`, the reveal inputs, the `RevealedVote` |
| Sealed core hash | The plaintext of the sealed run bundle | `seal.coreHash` in the bundle; the sealed blob is cited on chain in the `RunApproval` before the commit |
| Vote commitment | BCS of `VotePreimageV1`: claim id, agent profile id, jury seat id, phase, outcome, confidence (bps), evidence root, output hash, run hash, salt | The `JurySeat` and the `VoteCommitted` event; recomputed by `reveal_vote` |

The chain of binding: the sealed bundle is stored and cited on chain, the run hash (which contains the Gonka request id and the transcript hash) is approved, the commitment binds the vote to that run hash and to the frozen root, and only then can a reveal happen. A vote cannot be revealed against a run whose request id was not committed first.

## Commit-reveal

- Commit: `commit_vote` consumes the seat's `RunApproval` (one-time, recipient-owned), stores the run hash and the 32-byte commitment on the seat, and emits `VoteCommitted`. It requires an accepted seat with the evidence root bound and a time before the commit deadline.
- Reveal: `reveal_vote` takes the outcome, confidence, output hash, run hash and salt, rebuilds `VotePreimageV1` with the seat's own claim id, profile id, seat id, phase and evidence root, recomputes blake2b-256 over its BCS bytes, and aborts with `E_COMMITMENT_MISMATCH` unless it equals the stored commitment. It also requires the run hash to equal the approved one, the reveal window to be open (all seats committed, or past the commit deadline) and not closed. The seat is consumed and an immutable `RevealedVote` is frozen.
- Why: no juror can anchor on or herd around another juror's reasoning before sealing its own stance. In a naive model swarm the first answer becomes everyone's prompt context; here nobody sees a ballot until all are sealed. Salts never reach the inference provider.
- What a verifier recomputes: the commitment from the reveal transaction's inputs (the check no human can do by hand), the run hash from the revealed bundle, and the truth score from the revealed votes. `/verify` does it in the browser; the auditor does it from the command line.

## The acceptance window

Seats have one minute after selection to accept or decline (`ACCEPTANCE_WINDOW_MS` = 60000 in `jury.move`, never past the commit deadline). The committee can lock once the window has passed, and the lock, the commits and the certificate can follow as soon as the jurors finish. Before 2026-09-03 the window ran to the midpoint of the commit window, which held every fast round for minutes. A declined seat is replaced by a reserve only if the replacement keeps every diversity rule; the reserves are one skeptic and one source-authenticity juror.

## All-or-nothing attempts and relaunch

- A verification is one attempt. Any juror error at a binding step voids the whole attempt: a failed run (`INVALID_SCHEMA`, `CITATION_INVALID`, `TIMEOUT`, `PROVIDER_ERROR`), a seat that missed the commit deadline (`MISSING_COMMIT`), a seat that missed the reveal deadline (`MISSING_REVEAL`), or a committee that could not be drawn before the first commit deadline (`MISSING_COMMITTEE`, the draw kept aborting). Nothing partial is ever finalized; no vote is ever invented for a failed seat, and the failure record (status, message, research trail, attempts) stays public on Walrus and on the claim page.
- A voided attempt lapses on-chain without a certificate: the settlement contract has no mid-flight cancel once a claim leaves CREATED, so the void is an engine fact, public on the claim page, not a chain state.
- Relaunch: the engine relaunches automatically once all three model families answer a health probe (and web search has credits), up to three attempts in total. Relaunches are spaced ten minutes apart. The relaunched claim is a new claim object linked both ways (`attemptChain.relaunchedAs`, `previousAttempts`). The claim page shows "Attempt N of 3" and a voided banner naming the seat, model and reason.
- Give up: after three voided attempts (`ATTEMPTS_EXHAUSTED`), or when a family stays unavailable for six hours after a void (`WEATHER_TIMEOUT`). Every attempt, voided or not, stays public.
- Provider resilience inside an attempt: a call that has not answered after 25 s is hedged (the same request goes to the same model again and the first valid reply wins); shed or timed-out provider calls are retried with backoff inside the seat window; a research call times out after 90 s. Every attempt, retry, repair and hedge lands in the audit trail.

## The cascade and the frozen-record rule

- Round one, every claim: independent research, sealed votes, reveal. Four matching reveals of five settle YES or NO. Four or more UNSURE reveals finalize UNRESOLVED without a debate.
- Discussion, only on a deadlock: the revealed jurors bring their round-one evidence and vote to the table and argue it out, streamed live; every turn is its own GonkaRouter run with a current stance and confidence. Up to three exchanges; the debate stops early when nobody moves (`debate_converged`).
- A debate turn is a conversation move, not a brief. Under deliberation prompt spec V4 (hash `0xe6d2b47d3c63255da2b5815c4e056d160b85aa46053c5031311b1fe5a86d9270`, the default since 2026-09-04) each turn carries `answering` (the seat number whose point it answers, `null` only when it opens the debate), `theirPoint` (that point restated, at most 240 characters), `analysis` (at most 900, the new reasoning), `question` (`{seat, text}` or absent, one pointed question to a named seat), `position` (at most 240, stated last: hold, raise, lower or change) and `specVersion` `"4"`, beside the fields every turn has: `ordinal`, `exchange`, `stance`, `confidenceBps`, `citations[]`, `status` and `argument`. `argument` is the analysis and the position joined, so it still reads as the whole turn. Turns from spec V1 to V3 carry none of the six new fields; say so rather than calling them incomplete.
- Seat numbers: from V4 on a seat number is the juror number, so "Seat 3" in a turn is juror 3 and the report's Answers column reads "juror 3". A V1 to V3 transcript numbers seats from 0, so juror n holds seat n minus one; the report says which convention a transcript uses.
- The order is the debate, not the seating: a dissenting seat opens each exchange (the SKEPTIC seat when the jury is unanimous, else the lowest seat index of the smallest side), the sides then alternate by seat index, and a seat that is asked a question speaks next and answers it first. A question to a seat that already spoke in that exchange is carried to its next turn, and the last exchange asks for no new questions. Every debater still speaks exactly once per exchange.
- A turn that breaks the contract is SKIPPED with the label that names the broken part: `INVALID_OUTPUT` (shape or missing keys), `INVALID_LENGTH` (a field over its bound), `INVALID_ANSWERING` (an unknown or own seat, or answering nobody when the debate is already open), `INVALID_QUESTION` (a question to an unknown or own seat), `INVALID_CITATIONS` (a citation outside the frozen record), plus `PROVIDER_ERROR`, `TIMEOUT` and `WINDOW_EXHAUSTED`. A skipped turn is a silent seat, never a repaired one.
- The frozen-record rule: a juror may cite only evidence ids from the frozen record (the phase-one manifest, or pages from that juror's own revealed research trail). A turn that cites anything else is rejected, so no new or invented facts enter the debate. The transcript is frozen into the phase-two evidence on Walrus; the round-one public record is frozen with it.
- Round two, the table vote: a fresh commit-reveal round with no new research. Each juror re-votes on the frozen record plus the debate transcript in one sealed chat completion, no tools, under a prompt pinned in the juror manifest (`TABLE_VOTE_PROMPT_SPEC_V1`, hash `0x0fde6e8cd3989a8a33c5ae72c81cc2314965e53b7b41da0e5be2618a339d0333`). A table vote may reference only evidence ids frozen in the phase-two manifest. Its run is sealed, approved, committed, revealed and verified like a research run, just without a research trail.
- Still split: the claim finalizes UNRESOLVED. The system never forces fake certainty. Escalation beyond the table is roadmap.
- Why the debate does not amplify hallucinations the way swarms do: the evidence is frozen before the debate starts and a juror may cite only ids from that record; turns are capped at three exchanges and stop early; the second vote is a sealed ballot over the frozen record, not a negotiated consensus; and a missing quorum exits cleanly to UNRESOLVED.

## The truth score

Formula (as printed by the report API): confidence is read as the juror's probability that its own vote is correct; mean(YES confidence, NO (10000 minus confidence), UNSURE 5000) over valid reveals, rounded half-up; displayed as basis points divided by 100.

- Only the final valid round counts: round one when it settled, round two when the table voted.
- "Valid" means the reveal matched its commitment. A mismatched reveal cannot land on chain at all (`reveal_vote` aborts), so every recorded reveal enters the mean; the flag exists so the report can print exactly the terms the score used.
- Half-up integer arithmetic: `(sum + count / 2) / count`, identical in `truthScore.ts` and in `jury::truth_score_bps` on chain.
- Equal weights in v1 (every juror at selection weight 10000), on purpose, because no juror has a track record yet. A Brier-score weight is the recorded roadmap.
- How to read it: 95 means very confident the claim is true, 5 very confident it is false, around 50 genuinely uncertain. An UNRESOLVED claim still carries the score as the average belief.

Worked example (the settled claim "Humans use only ten percent of their brains.", 2026-09-03): five NO votes at 9500, 10000, 10000, 9500 and 10000 map to 500, 0, 0, 500 and 0. Sum 1000, count 5, mean 200 bps, score 2.00. The certificate's `truth_score_bps` is 200.

Payment is not tied to the score: seats are paid for valid work, never for agreeing with the majority, because paying for agreement manufactures herding, punishes honest UNSURE votes and corrupts UNRESOLVED as an outcome.

## Seal escrow (reveal keys without the operator)

- Each juror's sealed work file (the sealed run bundle, AES-256-GCM) goes to Walrus and is cited on chain before the commit. Its key is the reveal key.
- At commit time the reveal key is Seal-encrypted under an on-chain time-lock policy (`move/openverdict_seal/sources/reveal_lock.move`, testnet package `0xf54eb61116372f8506ca332457b2fee61231a559e44923429f54fab355d0f0c5`, threshold 1 over Mysten's two testnet key servers). The identity encodes the claim, the seat, the phase and the reveal deadline.
- After the reveal deadline anyone recovers the key from the key servers with a throwaway keypair (no wallet, no gas) and opens the sealed bundle; the operator is not needed. Before the deadline the key servers refuse, which is the point.
- At a normal reveal the key is published in the revealed bundle; the "Sealed core" check decrypts the sealed blob with it and compares the plaintext hash to `seal.coreHash`, and the "Seal escrow binds this run" check verifies the escrow identity against the run.
- Escrow is insurance only; it can never cost a seat its vote (four dedicated Move policy tests).
- Testnet caveat, disclosed: Seal keys and salts are stored in plaintext in the engine's Postgres; encrypt at rest before any mainnet use.

## Stake: what stands behind a seat

- A seat is opened by its staker in one transaction that posts the bond: at least 0.1 SUI (`MIN_STAKE_MIST` 100,000,000 in `agent_registry`), real money, not a signature. The transaction also names the operational signing key that runs the seat.
- The staker is recorded as the seat's payout recipient, so that seat's jury reward tickets (`REASON_JURY_REWARD`) are minted to the staker. The bond stays locked while the seat is active; slashing it for proven protocol violations is specified in the PRD and not yet enforced on chain.
- Only the staker can unstake. `request_unstake` deactivates the seat at once, `complete_unstake` returns the whole bond after the 24 hour delay, and a pause never blocks that exit.
- Anyone can stake, on as many seats as they like: a browser wallet, an operator key, or a Google sign-in through Sui zkLogin (Enoki). The gas is sponsored through Shinami, so 0.1 SUI is the whole cost, and zkLogin only makes staking possible for people without a wallet.
- Diversity lives in the draw, not in the staker: at most two seats per model family, three families per committee, at most one seat per operational signing key, and no cap per staker. A staker chooses nothing about how a seat votes (model, prompts, tools and evidence are all pinned), so capping stakers protected nothing. Never read a staker hash as an identity claim: it says nothing about who is behind an account, and OpenVerdict never claims otherwise.
- Seats registered before real stake shipped carry no staker record; their bond was posted by the operator and their rewards go to the seat owner.
- The team's seven demo jurors are the starting roster. The decentralization ladder: stakers open seats (their stake, their bond, their earnings, the team's compute), then self-hosted juror workers with their own GonkaRouter keys, verified by the engine exactly as the team's own runs (run hashes, receipts, re-execution).
- Reading claims, watching juries, checking proofs and submitting a claim need no sign-in, no wallet, no gas.

## The weather gate

- Weather: the engine probes the three model families through GonkaRouter with a research-shaped request, plus the web search provider's credit balance (row `research:firecrawl`, shown as "Web search"), at most once every two minutes; a probe older than five minutes is stale. Weather is "clear" only when the probe is fresh and every row is ok. `GET /api/weather` is public.
- Submit on clear or unknown weather: the claim launches at once. Submit on bad weather: the API refuses it with 503 `WEATHER_NOT_CLEAR` and a `Retry-After` of 120 seconds, and nothing is stored. There is no queue: a refused submission is simply made again later.
- Why: the Move rules require three families in every committee, so a claim cannot start while a family is down; GonkaRouter serves exactly three models, so a fourth family is impossible. Launching anyway would burn one of the three attempts on a seat that is bound to fail.

## The weather gate, operationally

What the engine does, step by step (`lib/engine/engine.ts`):

- The probe. The resolution worker calls `weatherTick` on every tick; it probes only when the stored probe is older than two minutes (`WEATHER_PROBE_INTERVAL_MS` 120000). Each of the three families is probed through GonkaRouter with three parallel research-shaped calls (400 output tokens, `PROBE_CONCURRENCY` 3, one minute per family, `RELAUNCH_PROBE_TIMEOUT_MS` 60000), and a family is ok only when all three lanes answer: a single small call squeezes through a saturated family that then sheds five jurors working at once. The web search row (`research:firecrawl`, shown as "Web search") is a free credit check (`GET /v2/team/credit-usage`, ok when at least `FIRECRAWL_MIN_CREDITS` 50 remain, 15 s timeout). Every row stores ok, latency and a status (the HTTP status as text, `TIMEOUT` or `ERROR`; the research row can carry a detail such as the credit count).
- Stale and clear. The report is stale when there is no probe or the newest one is older than five minutes (`WEATHER_STALE_MS` 300000). It is clear only when it is not stale and every row is ok. `GET /api/weather` returns `{probedAtMs, stale, clear, families[]}` with `Cache-Control: no-store`.
- Submit. `factCheckSubmit` validates the request, then reads the weather. Clear or stale (unknown weather never holds a submission): the claim launches at once and the API answers 200 `{claimId}`. Not clear: the API answers 503 `{error: "WEATHER_NOT_CLEAR", message, weather}` with `Retry-After: 120`, and nothing is written.
- Relaunch. A voided attempt relaunches through `relaunchTick` under a ten-minute spacing and the same probe cache (a fresh probe at most every two minutes, shared with `weatherTick`), only while every cached row is ok, up to `MAX_VERIFICATION_ATTEMPTS` 3, and gives up after six hours since the void (`RELAUNCH_GIVE_UP_MS`, reason `WEATHER_TIMEOUT`) or when the third attempt voids (`ATTEMPTS_EXHAUSTED`). That ladder is the attempt chain, not a queue: the claim already exists on chain.
- Why the spacing is ten minutes: round-one research runs from about +70 s to +600 s, so ten minutes keeps two engine-launched juries from researching at the same time; three juries side by side drew a 429 storm from the shared gateway on 2026-09-03 at 01:48.
- Why web search is part of the weather: a jury with no web search answers UNSURE on everything; five seats did so on 2026-09-03 at 05:00 on a 402 from the search API.

The weather strip (the fact-check page, the voided panel on a claim page) shows one chip per row: "healthy" when ok under 30 s of latency, "slow" when ok and slower, "down" when not ok, "no recent probe" when stale, with "probed N s ago" and the legend "A jury needs all three model families and web search."

## Submitting: the public limits and responses

`POST /api/fact-checks` (`app/api/fact-checks/route.ts`), guarded by `app/api/_lib/guard.ts`:

- Public writes must be enabled on the deployment (`OPENVERDICT_PUBLIC_WRITES=enabled`, set on the hosted app); otherwise every public write answers 403 `{error: "writes_disabled", message: "public submissions are disabled"}`.
- `claim`: required, trimmed, 5 to 1000 characters.
- `text`: optional, trimmed, up to 20000 characters (submitted evidence text).
- `urls`: optional, up to 5 entries, each `https://` and at most 2048 characters (the evidence retriever's own boundary).
- `resolutionCriteria`: optional, up to 2000 characters.
- Responses: 200 `{claimId}`; 503 `{error: "WEATHER_NOT_CLEAR", message, weather}` with `Retry-After: 120` when a model family or web search is down; 400 `{error: "validation_error", message}` with the exact rule broken; 403 `writes_disabled`; 429 `{error: "rate_limited", message: "too many submissions, retry later"}`; 503 `engine_not_wired`; 500 `internal_error`. Two different answers share the 503, so branch on the `error` field and never on the status alone. The `message` of a refusal is always one sentence naming the families that are down by their display name (DeepSeek, MiniMax, Kimi, Web search): "Kimi is down.", "DeepSeek and Kimi are down.", "DeepSeek, Kimi and Web search are down."
- Rate limit: a fixed 60 s window in process memory. A global ceiling of 60 requests per minute across all clients comes first (spoofed headers cannot route around it); behind a trusted proxy (`OPENVERDICT_TRUST_PROXY=1`, set on the hosted app) each client IP also gets 5 per minute. Keys are hashed, never raw IPs. The limiter is best effort and per instance; an edge limiter is the production item. `POST /api/extract-claim` uses the same guard, so extractions count against the same buckets.
- The POST returns only after the statement and criteria are written to Walrus and `create_claim` has run on Sui (measured about 45 s on claim #16, 2026-08-30; the request's own Walrus writes come before the transaction).

`POST /api/extract-claim` (`lib/claim-extraction/handler.ts`): body `{url}` (http or https, at most 2048 characters) or `{text}` (40 to 20000 characters), exactly one of the two. A GonkaRouter model returns up to three check-worthy claims in source order, each `{claim, reason, quote}` (claim at most 1000 characters, quote at most 300), plus `language`, `claim` (the first candidate), `sourceUrl`, `modelId`, `gonkaRequestId` and `gatewayRequestId`; opinions, predictions, questions and compound claims are rejected by the prompt. Errors: 400 `INVALID_URL` or the validation sentence "Request body must contain exactly one valid HTTP or HTTPS url string or one text string from 40 to 20,000 characters.", 404 `NO_CLAIM_FOUND` ("The source did not yield a valid factual claim."), 502 `FETCH_FAILED` ("The source page could not be fetched safely."), 403 and 429 as above.

## Expected durations (the hosted ladder, 2026-09-03)

`defaultDeadlines` in `lib/engine/engine.ts`, offsets from the claim's creation on Sui:

| Deadline | Offset | Window it closes |
| --- | --- | --- |
| Evidence cutoff | +60 s | Submitted sources are fetched and frozen after this |
| Proposal, challenge | +65 s, +70 s | The optimistic pathway's deadlines (unused by a direct review) |
| First commit | +600 s | Round one: 10 minutes for the acceptance minute, the research and five commits |
| First reveal | +720 s | 2 minutes; the reveal opens earlier when all five have committed |
| Discussion | +1560 s | Up to 14 minutes of debate, ending early when nobody moves; the freeze of the transcript needs a 120 s lead before this deadline |
| Second commit | +1800 s | 4 minutes: five table-vote runs plus their approve and commit transactions |
| Second reveal | +1920 s | 2 minutes |

Inside those windows: seats have one minute after selection to accept (`COMMITTEE_ACCEPTANCE_WINDOW_MS`), a seat's own research bound is the commit deadline minus 60 s (`SEAT_COMMIT_MARGIN_MS`), a research call times out after 90 s and is hedged after 25 s, and a debate turn has a 60 s budget (`PER_TURN_BUDGET_MS`).

What to say: a one-round verdict lands about 11 to 12 minutes after launch (the engine's own estimate is about 12 minutes; measured 10.6 minutes on the settled claim "Humans use only ten percent of their brains." on 2026-09-03: first commit at +4.0 min, reveal open at +8.5 min); a two-round verdict about 32 minutes after launch. The POST itself takes under a minute before the claim id exists.

## The live research feed

While a juror researches, the engine publishes one `research_step` event per step it records: the search with its intent and its query and the sites the results came from, the open with the URLs and how many pages, and the moment the juror starts drafting its answer. The events are public as they land, not held to the reveal, because a query, a result site and a URL are public web material: jurors never see the console, independence is between jurors, and the operator already sees everything, so nothing about the trust model changes. What the juror read into those pages, the answer it wrote, its vote and its reasoning stay sealed until the reveal exactly as before. `ov watch` prints one line per step ("juror 3 (MiniMax) searched (support) ...", "juror 3 (MiniMax) opened 3 pages: mit.edu, apa.org", "juror 3 (MiniMax) is drafting its answer") and the claim page's Live view drives each juror card's status line from the same events, listing the steps in order when the card is expanded, under its sealed vote. The older content-free `RESEARCH_TICK` pulse is still emitted alongside it for clients that only knew that.

## What the console shows at the same time

The console is a read-only projection of the same public record the CLI reads (the event stream `GET /api/claims/<id>/events`, Sui objects, Walrus blobs); the CLI's lines and the page's animation come from the same events.

- The claim page `<base>/claims/<id>` has two views of the same record, switched at the top left. Live (the default while a verification is running) reads it as a conversation: the claim as the first message, then one line per public event in the same words `ov watch` prints, with five juror cards where the jury is drawn. Each card names the model and the role, carries a live status line ("searching for evidence against the claim", "reading mit.edu, apa.org", "drafting the answer", "vote sealed", "revealed NO at 95 percent") and expands to that juror's research steps, plus its answer, citations and receipt once it has revealed. A small graph preview inside the Live view opens the second view. Graph (the default once a claim has settled) is the deliberation canvas: during research the jurors show locked pulses and their live research steps in the seat inspector; at the reveal the graph blooms into the real searches, pages and citations; at settlement the certificate lands. Any node opens the inspector; after settlement Play replays the run, and the Live view has its own Replay at 20x with Skip to end. The stage pill at the top centre names the round in both views: "Jury forming", "Round 1 · research & sealed votes", "Round 1 · votes revealing", "Deliberation · jurors argue their case", then the round-two labels and the finalized state; next to it the "Attempt n of 3" pill and a LIVE chip while the stream is connected (SYNCING while it reconnects). In a second round the debate dock at the bottom centre of the Graph view shows each turn with the seat's avatar, the exchange badge, stance chips and citation chips, and a convergence divider when nobody moved.
- A voided attempt on the claim page: a panel with the failure sentence ("Attempt n of 3 voided: Seat k (<model>) failed: ..."), the line "All-or-nothing: no partial verdict is ever finalized. The engine relaunches automatically once all three families and web search answer.", the compact weather strip, "gives up at HH:MM" (the void time plus six hours) until the relaunch appears, and links to the previous and the next attempt. After a give-up the line reads "This verification gave up; submit the claim again to start a fresh one."
- The console home `<base>/app` (the board) lists the claims with their state, and the fact-check page carries the weather strip under the input, which says a jury needs all three model families and web search.

## Correlated failure and why three families

- Disclosed limitation: five LLM jurors are correlated even across model families; diversity constraints reduce but cannot remove shared failure modes (PRD section 32.4).
- The rule in Move (`jury.move`): at most two seats per model, at least three distinct models in every committee (one model per family today, so three families), a skeptic seat and a source-authenticity seat present, no two seats with the same owner (one operational signing key, one seat), no juror who created, proposed or challenged the claim. There is no staker cap.
- The families: DeepSeek (DeepSeek-V4-Flash), Kimi (Kimi-K2.6) and MiniMax (MiniMax-M2.7), all served through GonkaRouter, the only inference host in the code. The served model must equal the manifest model (`X-Gonka-No-Fallback: true`; a mismatch is a provider error, never a vote).
- The roster today: seven active jurors (three DeepSeek, two MiniMax, two Kimi), so every committee carries at least one Kimi seat.

## Hallucination handling

- Citations must match opened pages: a juror may cite only pages it opened in that run or ids from the frozen evidence manifest. A quote must be an exact sentence from the archived page text; a quote the engine cannot find in the page is blanked in the validated output and recorded in the transcript as not found. A YES or NO without a valid citation fails closed and is never counted.
- Strict schema: outputs are validated against a strict JSON schema. An invalid answer gets at most two repair rounds (the engine sends the errors back); if it is still invalid the run fails (`INVALID_SCHEMA` or `CITATION_INVALID`), the seat fails in public, and the attempt is voided.
- Unsupported claims: when a model writes prose where an evidence id belongs in `unsupportedClaims`, the engine drops those entries, records the repair in the transcript's answer step, and emits a public `output_repaired` event (since 2026-09-02). The vote, the confidence and every other evidence array still fail closed.
- The debate: a turn that cites anything outside the frozen record is rejected (`SKIPPED` with a failure status); no new or invented facts enter the record.
- Models never fetch, never hold keys, never sign; every URL a juror sees is fetched by the engine and recorded. Search results and page text are treated as data, never as instructions.
- What remains: LLMs may still misinterpret evidence or fall for subtle prompt injections; three-family diversity, temperature 0 and structured validation mitigate this, and AI inference cannot provide absolute mathematical correctness (risk disclosure). The truth score is a protocol result, not universal truth.

## What the operator can and cannot do

Cannot, without breaking hashes anyone can check:

- Pick the jurors: Sui's native randomness draws the seats under the diversity rules.
- Change a vote after its commitment: the Move contract recomputes the commitment at reveal; a changed vote does not open.
- Swap evidence after the freeze: the root is on chain before any reveal; every seat and tally is bound to it.
- Edit the result or the score: the certificate is an immutable Sui object minted from the bounded tally.
- Invent a vote for a failed seat: the failure is a public record and voids the whole attempt.
- Substitute a model: the served model must equal the manifest model, and GonkaRouter's public receipt names the model, node and time for each recorded request id, which sits inside the committed run hash.
- Rewrite a bundle or a page: every byte is content-addressed on Walrus and hash-pinned on Sui.
- Keep a sealed bundle closed after the deadline: Seal opens it without the operator.
- Steer a seat's prompt: prompts and tool policies are hashed into on-chain manifests.

Can, in the V1 hackathon build (disclosed):

- Run the pipeline upstream of the commitment: the engine executes the research, holds the run attestor and evidence freezer capabilities (single team-held capabilities; multi-attestor is production work), and operates all seven jurors.
- Decide when claims launch (the weather gate), pause, deploy, or fail to run at all. Every attempt and void is public, so a stalled claim is visible.
- Hold Seal keys and salts in plaintext on the testnet database.
- Nothing yet proves that the model received exactly the recorded bytes: the re-execution check ("Re-run this juror") is soft corroboration, the GonkaRouter receipt cross-check is live on every revealed run, a gateway-signed receipt is on GonkaRouter's roadmap, and an attested forwarder (Sui Nautilus) is the full closure.

Summary phrase from the README: the operator is detectable rather than impossible, unable to forge the record without breaking hashes anyone can check. The dashboard is a read-only projection: stop it and the CLI continues; it has no signer and no mutation endpoint.

## What a judge needs to reproduce an audit

The public repository, Node 22 or newer, pnpm, and `pnpm install`. Then `pnpm audit:claim <link or id>` (no key, no database, no wallet), or the same through this skill in any agent that reads the Agent Skills format. In the browser, `/verify` recomputes commitments and truth scores from revealed fields and runs the 15 checks on any revealed run. `pnpm test` and `pnpm test:move` (Sui CLI) run the 601 TypeScript and 77 Move tests, including the cross-language parity gate.

## Costs (testnet, 2026-09-03)

Reading, watching and verifying are free: no account, no wallet, no gas. The demo tier is free to the requester (a rate-limited subsidy, not the business model; in future, claims are paid in SUI and staked seats share earnings). On the operator's side a claim costs about 0.26 SUI plus 0.06 WAL in transactions and Walrus storage; every seat transaction is signed and paid by the juror's own keypair. Inference is paid in GonkaRouter credits and web search in Firecrawl credits; the docs give no per-claim figure for those. "Re-run this juror" costs one model call and is rate limited.

## What mainnet would change

The protocol does not change: the same Move rules, hashes and checks. What changes is that real value sits behind the claims, so the disclosed V1 limitations must close first: encrypt Seal keys and salts at rest; an edge rate limiter (the in-process limiter is per instance and best effort); socket-level IP pinning in the evidence fetcher (a residual DNS rebinding window exists today); reviewed owners for the upgrade, admin, pause, evidence and attestor capabilities, with the attestor signer in a KMS or isolated signer (PRD section 35); multi-attestor for the run pipeline; a third-party audit (the Move packages are unaudited). The PRD sequences a capped mainnet demo after a canary, then production after review. Everything today is capped, team-funded demo value.

## Glossary

- Juror: an AI model occupying a seat; not a free-floating worker process. Read "agent" in older docs and Move type names as "juror".
- Seat: an on-chain `JurySeat` object governed by an `AgentCap`; one per juror per phase.
- Committee: the five seats drawn for a claim, plus two reserves; locked after the acceptance window.
- Quorum: four matching reveals of five (`REQUIRED_MATCHING` = 4).
- Cascade: round one, then debate, then table vote.
- Debate, cross-examination, discussion: round two's public argument over the frozen record.
- Table vote: the second sealed ballot, no new research.
- Attempt: one all-or-nothing verification; at most three per claim.
- Void: an attempt ended by a juror error at a binding step; public; relaunched when the weather clears.
- Give up: no more attempts (three voided, or six hours of bad weather after a void).
- Resolution certificate: the immutable Sui object with the result and the truth score; what other applications consume.
- Truth score: the mean of the final round's revealed beliefs, 0 to 100 (0 to 10000 bps).
- YES, NO, UNSURE: a juror's vote. UNRESOLVED: a claim result, never a vote.
- Commitment: blake2b-256 over the BCS vote preimage, locked on Sui before any reveal.
- Reveal: the on-chain opening of a vote, checked against its commitment; produces a `RevealedVote`.
- Run: one juror's recorded conversation with GonkaRouter plus its research transcript; sealed on Walrus before the commit, revealed after.
- Run hash: the hash of the run record, fixed on Sui as a `RunApproval` before the commit.
- Evidence root: the Merkle root of a phase's evidence manifest, frozen in an `EvidenceBundle` on Sui.
- Manifest: the on-chain juror manifest (model, prompt spec hash, tool policy hash, table-vote prompt hash), version 6 today.
- Sealed bundle, revealed bundle: the encrypted and the plaintext run record on Walrus.
- Seal escrow: the time-locked copy of a seat's reveal key held by Mysten Seal key servers.
- Gateway request id: GonkaRouter's `x-request-id` (`req-...`), the key to the public receipt. Gonka request id: the completion id (`devshard-<n>-<seq>`), kept verbatim. Devshard: the Gonka node that served the call.
- Receipt: GonkaRouter's public metadata for a past request (model, devshard, time, outcome, tokens).
- Weather: the health probe of the three families and web search; clear or not.
- Weather gate: a submission needs all three model families and web search up at that moment, and is refused with 503 when they are not.
- zkLogin: Google sign-in resolving to a Sui address, so someone without a wallet can stake on a seat; authentication only. Staker: the account that posted a seat's bond, holds its `StakePosition`, receives its jury rewards and alone can unstake. Staker hash: blake2b-256 of that address, recorded on the profile, never an identity claim.
- Payout ticket: a one-time, recipient-bound claim on jury rewards or refunds, minted at settlement.
- Operator: the team running the engine; holds the run attestor and evidence freezer capabilities in V1.
