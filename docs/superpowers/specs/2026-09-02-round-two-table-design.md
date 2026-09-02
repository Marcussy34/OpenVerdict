# Round two at the table (design, 2026-09-02 afternoon)

Status: brainstormed with the owner on 2026-09-02 between 14:00 and 15:00
after the first two full lifecycles on the reset instance (claims
`0x1d53f02c…` fasting, UNRESOLVED 2125 bps after a spoken debate and a
second research round; `0x0a9bdd1f…` red wine, consensus UNSURE, UNRESOLVED
5000 bps in one round). The owner set the direction in their own words:
"first round to compile evidence and then sealed commit and vote; strong
majority settles the case; if not, round two: each jury brings their first
round's compiled evidence and decision, puts it on the table, discussion
and debate, then try to reach a conclusion; if no conclusion, mark
unresolved (further steps are future work)". Decisions recorded from that
conversation: all-or-nothing attempts ("if anyone has errors or issues the
entire verification is scrapped, launch a new one"), relaunch policy (a):
automatic, weather-gated, capped at two relaunches; no escalation this
week (UNRESOLVED with the truth score is the end state); implementation
fork A: manifest v6 pins the table-vote prompt. Approved by the owner with
full delegation ("please proceed and build out everything").

## Vision

A verification is a jury of five that researches independently, votes
under seal, and settles on a strong majority. When the five split, they
come to the table with the evidence they compiled and argue it out in
public until nobody moves, then vote again under seal on what is on the
table, without leaving the room to research again. Every step is either
five-for-five or void: a verdict never carries an empty chair. What the
table cannot settle is marked unresolved, with the score, never forced.

## Protocol boundary (what stays fixed)

- The Move package is untouched: five seats, three model families, at
  most two seats per model, `REQUIRED_MATCHING` four of five, commit and
  reveal, `create_second_round_seats`, evidence roots per phase, the
  certificate. No package upgrade this week.
- Every vote is backed by a sealed run bundle whose prompt specification is
  pinned in the juror's on-chain manifest, verifiable byte for byte. The
  table vote is a new kind of run and therefore a new manifest version
  (v6) that pins its prompt. Old bundles (v3 to v5) and old manifests (v2
  to v5) keep verifying.
- Models never fetch. The table vote has no tools at all; the debate cites
  only round-one evidence.
- The chain has no mid-flight cancel (`settlement::cancel_claim` works only
  in the CREATED state). A voided attempt therefore lapses on-chain without
  a certificate; the void is an engine fact, recorded, evented and shown.
  An on-chain void is roadmap (package upgrade).

## Lifecycle

1. **Attempt 1, round one.** Five seats research (unchanged), commit,
   reveal.
2. **Void rule.** The attempt is voided the moment any seat fails at a
   binding step: a research run that ends without a valid output (provider
   error, timeout, invalid schema, no valid inference), a seat with no
   commit at the commit deadline, a seat with no valid reveal at the
   reveal deadline, or, in round two, a failed table-vote run, missing
   commit or missing reveal. Debate turns are not binding steps: a skipped
   turn (provider error, bad JSON, window exhausted) is recorded and the
   debate continues.
3. **Threshold.** Five valid reveals with four matching outcomes settle the
   claim (FINALIZED_REVIEWED, or UNRESOLVED when the matching outcome is
   UNSURE), in about ten minutes, as today.
4. **The table.** Five valid reveals without four matching open the
   discussion: up to three exchanges in seat order, every turn a public
   argument with citations and a public, non-binding stance. The debate
   ends early when a full exchange passes with no seat changing its
   stance ("nobody moved").
5. **The table vote.** Each of the five jurors runs one sealed table-vote
   run (no tools) over the evidence on the table, commits, reveals. Four
   matching: verdict. Otherwise UNRESOLVED with the truth score.
6. **Relaunch.** A voided attempt is relaunched automatically as a new
   claim with the same statement, text and URLs, once the three model
   families answer a health probe, up to two relaunches (three attempts).
   If the probe keeps failing for six hours the verification gives up and
   is shown as "could not be completed: a juror family is unavailable".

## Components

1. **Verification attempts (storage + engine).** New table
   `verification_attempts` (same `record_json` pattern and idempotent
   `CREATE TABLE IF NOT EXISTS` migration as every other table): one row
   per claim with `verificationId` (the first attempt's claim id),
   `claimId`, `attempt` (1 to 3), `parentClaimId`, `status`
   (`ACTIVE | VOIDED | SETTLED | GAVE_UP`), `voidReason`, `voidedSeatId`,
   `voidedModelId`, `voidedAt`, `relaunchedAs`, the original fact-check
   request (`claim`, `text`, `urls`) needed to relaunch, `createdAt`,
   `updatedAt`. Every claim created through the fact-check path gets an
   attempt row (attempt 1) at creation; direct operator claims get one too
   so the page can always show the chain.
2. **Void detection (engine + resolution worker).** `engine.voidAttempt(claimId, reason)` marks the row VOIDED, emits `verification_voided`
   (phase = the current phase, visibility PUBLIC_NOW, payload: attempt,
   seat, model, reason category and message), and makes the claim dead to
   every worker (`isDead` treats VOIDED as terminal for the engine). Triggers:
   the inference failure path (`persistInferenceFailure`) for research and
   table-vote runs; the resolution worker at the commit and reveal deadlines
   when a seat is missing. In-flight runs of the other seats are left to
   finish and are stored as usual; nothing further is committed for a
   voided claim.
3. **Relaunch worker (inside the resolution worker tick).** For every
   `VOIDED` attempt without `relaunchedAs` and with `attempt < 3`: probe the
   three families (one tiny completion each, engine-executed, 60 s
   timeout, results cached for two minutes and shared across claims); when
   all three answer, create the next attempt through the same engine path
   the fact-check API uses (server-derived deadlines), link both rows,
   emit `verification_relaunched` on the old claim (payload: new claim id,
   attempt). A voided attempt at `attempt = 3`, or a probe that has failed
   for six hours since the void, becomes `GAVE_UP` with an event.
4. **Debate with stances and convergence (engine).** Deliberation prompt
   spec V3 returns `{argument, citations, stance, confidenceBps}`; V2 stays
   byte-identical for old turns. The debate plan grows to three exchanges;
   after each full exchange the engine compares every seat's latest stance
   with the previous one (exchange one against the round-one vote) and
   stops when nothing changed, recording `converged_after_exchange` on the
   transcript. Turn instructions extend V2 with "say whether the debate has
   moved you and why, and give your current stance". The discussion window
   is 840 s (up to fifteen 60 s turns plus the 120 s evidence freeze lead).
5. **Table-vote run (engine + protocol).** New prompt spec
   `TABLE_VOTE_PROMPT_SPEC_V1` (provider gonkarouter, temperature 0, JSON
   object, output budget 2048 tokens): the juror decides the claim now,
   using only the evidence on the table. Input (`TableVoteInput`): protocol
   version, run id, agent role, claim statement and resolution criteria,
   the phase-two evidence manifest (round-one pages of every seat, the
   round-one public record, the debate transcript), `priorRound` (the
   round-one public record), `debate` (every spoken turn with seat,
   exchange, argument, citations, stance), `self` (seat index, role, round
   one outcome and confidence, the juror's own round-one validated output),
   and the output contract. Output: the standard `OracleInferenceOutput`.
   Validation: outcome valid, confidence in range, every evidence id in
   the phase-two manifest, reasoning within the length bound; no research
   rules (no challenge search, no both-sides opens). Any failure voids the
   attempt (component 2).
6. **Run bundle v6 (protocol + verify).** `PublicRunBundleCoreV6`: version
   6, `promptSpec: TableVotePromptSpecV1`, no tool policy, empty transcript
   (`EMPTY_TOOL_TRANSCRIPT_HASH`), input, request, attempts, raw response,
   validated output, audit, run hash, verify recipe (system prompt is the
   spec's system prompt alone). Sealing, commitment, escrow and reveal are
   unchanged. The verifier (`lib/verify/run-proof.ts`) accepts v6: prompt
   hash, system prompt, input hash, output hash, tool transcript hash (must
   equal the empty hash), citations against the manifest, run hash, sealed
   core and seal escrow run; challenge search, both sides opened, citation
   sites, counter-evidence summary and opens per turn are reported as
   not applicable (ok with detail "table vote: no research"). Reexecution
   supports v6 (re-issue the vote prompt).
7. **Manifest v6 (engine + scripts).** `AgentManifestDocumentV6` = v5 plus
   `tableVotePromptSpec` and `tableVotePromptHash`; `AgentManifest` gains
   `tableVotePromptHash`. The engine guard for phase-two runs mirrors the
   research guard: the seat's manifest document must be v6 and its table
   vote hash must equal the engine spec hash, else `EngineValidationError`
   ("run pnpm tsx scripts/publish-agent-manifests.ts"). Phase-one research
   keeps accepting v5 documents until the republish lands, so the deploy
   and the republish can happen in either order without breaking round one.
   `scripts/publish-agent-manifests.ts` publishes v6 for the seven testnet
   jurors (Walrus write, `update_agent_manifest`, DB row); the restore
   script parses v6.
8. **Ladder (engine).** Hosted: evidence cutoff +60 s, first commit +450 s,
   first reveal +570 s, discussion +1410 s, second commit +1650 s (240 s:
   five short vote runs plus their approve and commit transactions on the
   operator lane), second reveal +1770 s. Localnet: the same shape on its
   own scale. One-round verdicts stay at about ten minutes; a table verdict
   ends about 29.5 minutes after the POST.
9. **Contract and API (`lib/engine/contract.ts`, `app/api`).** `ClaimInspection`
   gains `verification: { verificationId, attempt, maxAttempts: 3, status,
   void?: { seatId, modelId, reason, message, atMs }, relaunchedAs?,
   previousAttempts: Array<{ claimId, attempt, status, voidReason? }> }`,
   `deliberation` turns gain `stance` and `confidenceBps`, the inspection
   gains `debateConvergedAfterExchange?: 1 | 2 | 3`, and phase-two runs are
   marked `kind: "TABLE_VOTE"` in the public run proof. New event kinds:
   `verification_voided`, `verification_relaunched`, `verification_gave_up`,
   `debate_converged`.
10. **Claim page and grid (`app/`, `components/`).** Attempt pill ("Attempt
    2 of 3") in the stage pill area; a voided banner with seat, model,
    reason and links to the previous and next attempts; stance and
    confidence on every debate turn in the chat dock with a "debate
    converged after exchange N" divider; round-two seats and their run
    inspector labelled "Table vote" with no research trail; the claims grid
    shows VOIDED and GAVE_UP attempts as "Voided" (never "Expired") and links
    to the live attempt; the report page lists the attempt chain.

## Data flow

Round one is unchanged until a failure or the reveal deadline. On a seat
failure the engine voids (component 2) and the relaunch worker (3) creates
attempt N+1 when the weather probe passes. On five valid reveals without a
threshold the resolution worker opens the discussion at the reveal
deadline as today; the inference worker runs the debate (4) and the
transcript freezes as phase-two evidence with stances and the convergence
marker. At the discussion deadline the resolution worker creates the
second-round seats as today; the inference worker runs table-vote runs (5)
instead of research runs, builds v6 bundles (6), and the commit and reveal
path is unchanged. Finalization is unchanged: four matching reveals settle,
otherwise UNRESOLVED. The page reads the attempt chain, stances and run
kinds through the contract (9).

## Error handling

- A voided claim never proceeds; workers skip it; its runs and events stay
  readable. A relaunch that fails to create the claim (Sui or Walrus error)
  is retried on the next tick with the existing per-claim backoff and does
  not consume an attempt.
- The weather probe is engine-executed, never through a juror manifest,
  and its results are not evidence; they are logged.
- A table-vote run that returns invalid JSON or out-of-manifest evidence
  fails closed exactly like a research run, and voids the attempt.
- Old claims (pre-v6 manifests, v5 bundles, V1 or V2 debates) keep
  rendering and verifying; the verifier and the page branch on versions.

## Testing

- Unit: convergence detection (moved, not moved, missing turn), void
  triggers per failure category, relaunch policy (probe pass, probe fail
  and give-up clock, attempt cap), table-vote validator, bundle v6 build
  and hash recipe, manifest v6 build and parse, ladder values.
- Engine with the fake gateway and PGlite: (a) seat failure in round one
  voids and relaunches after the fake probe passes, attempt rows and events
  correct, the voided claim is skipped by workers; (b) split round one,
  debate converges after exchange two, five table votes, four matching,
  certificate; (c) split round one, table splits, UNRESOLVED; (d) third
  attempt voided ends GAVE_UP; (e) old V2 turns and v5 bundles still load.
- Verifier: v6 proof passes the applicable checks and marks the research
  checks not applicable; a tampered v6 output fails outputHash.
- Manual: fresh deploy between claims, republish v6 manifests, `/api/agents`
  shows `tableVotePromptHash` for all seven, canary claim on a 3/3 window
  watched end to end.

## Out of scope (recorded as roadmap)

On-chain void, escalation to a second jury, committee expansion, a Kimi
roster change, research prompt changes (V4 stays), the two-family demo.
