# OpenVerdict audit skill: design (2026-09-03)

Owner approved in chat: "let's do that, please do it comprehensively, such that
the entire user process is already thought about. UX is key here."

## Purpose

During the demo (and for any judge later), a Claude Code session should be able
to take an OpenVerdict claim link, audit the whole public record without any
secret, and explain it end to end in plain English, then answer questions.

Two parts:

1. `scripts/audit-claim.ts`: a public auditor. Input: a claim link or id.
   Output: one Markdown dossier (stdout and a file) plus an optional JSON
   dump. It uses only public sources: the app's public API, Sui JSON-RPC,
   Walrus aggregator, GonkaRouter public receipts. No database, no keys.
2. `.claude/skills/openverdict-audit/`: a Claude Code skill (in the repo,
   symlinked globally on the owner's Mac) that runs the auditor, reads the
   dossier, narrates it, and answers questions from a bundled reference.

## User journeys

- Demo: the owner types `/openverdict-audit https://app.openverdict.info/claims/0x...`
  in any folder. Claude runs the auditor, prints a verdict card and a short
  narrative, then answers judges' questions ("how do you know the vote was
  not changed?", "who were the jurors?", "what did juror 3 cite?", "could
  the operator fake this?", "what is the truth score?").
- Judge: clones the repo, `pnpm install`, either `pnpm audit:claim <link>`
  (no Claude needed) or the skill in Claude Code.
- Inputs accepted: `https://app.openverdict.info/claims/<id>`, the same with
  `/report`, a bare `0x` claim id, a run link `/claims/<id>/runs/<runId>`
  (audits the claim and highlights that run), `/fact-check/queue/<id>`
  (explains the queue and weather gate), and `--base <url>` for another
  deployment (localhost).
- States handled with a clear message, never a stack trace: unknown id,
  claim still in progress (audit what exists, say what is pending), voided
  attempt (explain, follow `attemptChain` to the relaunched attempt and
  offer to audit it), gave up, queued submission, Sui RPC or Gonka receipt
  unavailable (check marked UNAVAILABLE with the manual URL, never FAIL).

## The auditor: sources

- `GET {base}/api/claims/{id}`: state, statement, deadlines, commitments,
  rounds, evidenceRoots, attemptChain, result, deliberation turns,
  debateConvergedAfterExchange.
- `GET {base}/api/claims/{id}/report`: label, truthScore, truthScoreFormula,
  finalRoundVotes (jurySeatId, outcome, confidenceBps, valid), agents
  (profile, owner, model, role, outcome, confidence, evidenceIds, reasoning),
  evidence, sui {claimObjectId, committeeId, certificateId,
  revealedVoteIds}, auditBundle {claim (packageId, transactionDigest),
  committee, commitments[] (phase, jurySeatId, agentProfileId, commitment,
  transactionDigest), reveals[] (revealedVoteId, runId, transactionDigest),
  runApprovals[] (runId, runHash, transactionDigest), runs[] (runId,
  agentProfileId, gonkaRequestId, promptHash, inputHash, outputHash, ...),
  certificate {result, truthScoreBps, finalPhase, finalRoundVoteIds, ...},
  evidence[] (phase, root, manifestBlobId, evidenceBundleId),
  evidenceArtifacts[]}.
- `GET {base}/api/claims/{id}/events`: SSE history (`data: {...}` lines).
  Read until `claim_finalized` or 8 s of silence, then abort the stream.
  Kinds include claim_created, evidence_frozen, committee_selected,
  run_approved, vote_committed, vote_revealed, phase_changed,
  DELIBERATION_TURN, debate_converged, output_repaired, inference_completed,
  argument_published, claim_finalized.
- `GET {base}/api/claims/{id}/runs/{runId}/proof`: run proof with the public
  bundle (v5 research, v6 table vote). Recompute with
  `recomputeRunProof` from `lib/verify/run-proof.ts` (15 checks for research
  bundles, fewer for table votes).
- Sui JSON-RPC (try in order, next on error: `https://sui-testnet-rpc.publicnode.com`,
  `https://fullnode.testnet.sui.io:443`): `sui_getTransactionBlock` with
  `showInput` and `showEvents` for every commit and reveal digest;
  `sui_getObject` with `showContent` for the certificate id. Send a browser
  User-Agent header (publicnode returns 403 to the default one).
- GonkaRouter receipts: `GET https://api.gonkarouter.io/v1/receipts/{x_request_id}`
  (public). The request id is `proof.gateway.gatewayRequestId` (the
  `req-...` id), not the devshard id.
- Walrus: `HEAD https://aggregator.walrus-testnet.walrus.space/v1/blobs/{blobId}`
  for the evidence manifest blob(s) and each revealed run blob.

## The auditor: checks

For every vote (phase 1 and, when present, phase 2):
- C1 commitment on chain: VoteCommitted event `commitment` bytes in the
  commit transaction equal `auditBundle.commitments[].commitment`.
- C2 commitment recomputed: `computeVoteCommitment` over the reveal
  transaction's inputs (outcome u8, confidence u16, output_hash, run_hash,
  salt) plus claim id, agent profile id, jury seat id, phase and the phase's
  evidence root equals C1. This is the check no human can do by hand.
- C3 reveal matches the report: outcome and confidence in the reveal inputs
  equal the report's finalRoundVotes / round entries.
For every run:
- R1 to R15 from `recomputeRunProof` (prompt hash, tool policy hash, system
  prompt, input hash, output hash, tool transcript hash, citations, challenge
  search, both sides opened, citation sites, counter-evidence summary, opens
  per turn, run hash, seal escrow, sealed core); table-vote bundles yield
  the subset that applies.
- R16 run hash on chain: `auditBundle.runApprovals[].runHash` equals the
  recomputed run hash and the reveal transaction's run_hash input.
- R17 provider receipt: GonkaRouter receipt exists, `model` equals the
  bundle's served model, `x_devshard_id` equals the bundle's devshard,
  `created_at` lies inside the run window (requestedAtMs .. completedAtMs +
  60 s). UNAVAILABLE on 404/429/network error.
- R18 revealed blob reachable on Walrus (HEAD 200).
Claim level:
- S1 truth score: `computeTruthScoreBps` over valid final-round reveals
  equals `certificate.truthScoreBps` and `report.truthScore * 100`.
- S2 certificate on chain: the certificate object exists, its `result` and
  `truth_score_bps` fields equal the report (field names as stored in the
  Move struct; read defensively).
- S3 quorum rule: the recorded result follows the rule (four matching valid
  reveals settle YES or NO; otherwise UNRESOLVED), using the final round.
- S4 evidence root per phase equals the `evidence_frozen` event root and the
  seats' bound root; manifest blob reachable on Walrus.
- Two-round claims: D1 the debate transcript exists (turns listed with
  seat, exchange, stance, confidence, SPOKEN or SKIPPED), D2 the phase-two
  evidence root includes the transcript artifact
  (`urn:openverdict:deliberation-transcript` in the manifest), D3 every
  table-vote run binds `tableVotePromptSpecHash()`.

## Dossier format (Markdown, fixed headings so the skill can point to them)

```
# OpenVerdict audit: <statement>
## Verdict card
- Claim id, link, state, mode, attempt (n of N, status)
- Result: YES / NO / UNRESOLVED, truth score X.XX (bps), certificate id + Suiscan link
- Checks: passed P, failed F, unavailable U (one line per group: votes, runs, receipts, walrus, chain)
- One sentence: what this proves.
## Timeline
table: time (UTC), event, detail (evidence frozen root, committee selected, commits, reveals, discussion, debate turns, round two, finalized)
## Jury
table per seat: seat #, model, role, phase-1 vote and confidence, (phase-2 vote), commitment check, run checks, receipt
## Votes and commitments
per seat: commitment hex, commit tx, reveal tx, recomputed commitment, MATCH / MISMATCH / UNAVAILABLE, with the preimage fields listed
## Juror runs
per run: prompt hash, input/output/run hash, the check table (label, expected, actual, result), receipt fields, revealed blob link, key citations (url + quote, first 2)
## Debate and round two (only for two-round claims)
turns table, convergence marker, phase-two root, table-vote prompt hash check
## Truth score
the formula line, the per-vote mapped probabilities, sum, mean, result
## Certificate on Sui
object id, fields, transaction digest, Suiscan links
## What this audit proves and what it does not
fixed text with the specific numbers filled in (see skill reference)
## Data
where the JSON dump is (when --json was used), API URLs used
```

Rules: all hex shortened to 10 chars in tables with full values in the JSON;
no em dashes anywhere; UTC times; the word "juror" for an agent seat,
"committee" for the five, "quorum" for four matching votes, "cascade" for
round one -> debate -> table vote; "adversarial AI jury protocol", never
"swarm".

Exit codes: 0 all checks passed or unavailable, 1 any FAIL, 2 input or fetch
error (with a one-line reason).

CLI: `pnpm audit:claim <link|id> [--base <url>] [--json <file>] [--out <file>] [--run <runId>] [--quiet]`.
Default `--out` is `.audit/<claimId>.md` under the current working directory
(gitignored) and the dossier is also printed to stdout.

## The skill

Folder `.claude/skills/openverdict-audit/` with:
- `SKILL.md` (frontmatter name `openverdict-audit`, description mentioning
  claim links, audits, verification, judges): when to use, how to run
  (`bash <skill dir>/run.sh <link> --json <tmp>`), how to read the dossier,
  how to present (verdict card first, then narrative, then "ask me
  anything"), how to answer questions (dossier sections, JSON dump, the
  reference, live URLs), rules (never claim more than the checks show; say
  UNAVAILABLE when a source is down; keep the lexicon; no em dashes).
- `reference.md`: the protocol explained for narration: three pillars
  (Gonka inference from three model families, Sui commit-reveal and
  certificate, Walrus evidence and sealed bundles), the lifecycle, what each
  hash binds, commit-reveal, all-or-nothing attempts and relaunch, the
  cascade and the frozen-record rule, the truth score formula, Seal escrow,
  zkLogin as one-account-one-seat (never proof of personhood), the weather
  gate and queue, correlated failure, hallucination handling, what the
  operator can and cannot do.
- `faq.md`: judge questions with short answers.
- `run.sh`: resolves the physical skill directory (`pwd -P`, so the global
  symlink works), finds the repo root three levels up, runs
  `pnpm --dir <repo> exec tsx scripts/audit-claim.ts "$@"`, and prints a
  clear message if node_modules is missing.
Global install: `ln -s <repo>/.claude/skills/openverdict-audit ~/.claude/skills/openverdict-audit`.
Docs: README section "Audit a claim with Claude" and docs/demo/runbook.md step.
