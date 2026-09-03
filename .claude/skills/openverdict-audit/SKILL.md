---
name: openverdict-audit
description: Audit, verify, explain and answer questions about an OpenVerdict verdict from public data only; use whenever the user pastes an OpenVerdict claim, run, report or queue link (app.openverdict.info/claims/...) or a bare 0x claim id, or asks to audit, verify, explain or question a verdict, resolution certificate, jury, juror run, vote commitment or truth score.
---

# OpenVerdict audit

## What this skill does

This skill runs the public auditor (`scripts/audit-claim.ts`) on one OpenVerdict claim, reads the Markdown dossier it writes, presents the verdict in plain English, and then answers questions from the dossier, the JSON dump and the bundled `reference.md` and `faq.md`. It uses only public sources (the app's public API, Sui JSON-RPC, the Walrus aggregator, GonkaRouter's public receipts) and needs no key, no database and no wallet.

The protocol in one line: OpenVerdict is a decentralized adversarial AI jury protocol for factual disputes; jurors from three model families research independently, cast commit-reveal secret ballots and cross-examine deadlocks on Gonka, and verdicts settle on Sui as certificates anyone can recompute.

## How to run

Claude Code prints this skill's base directory when the skill loads. Use that path for `<skill dir>` below (the folder may be a symlink; `run.sh` resolves the real repo itself). Use the session scratchpad directory for `<scratch>` when one is listed in the system prompt, else `/tmp`.

```bash
bash "<skill dir>/run.sh" "<link or id>" --quiet --json "<scratch>/audit.json" --out "<scratch>/audit.md"
```

Before running, tell the user in one line what you are about to do and that it takes about ten seconds on a settled claim (up to a minute or two when a public source is slow). With `--quiet` only the verdict card reaches the terminal; the full dossier is written to `--out`, so read that file next. Give the Bash call a long timeout (600000 ms): the auditor reads the event stream until `claim_finalized` or eight seconds of silence, then queries Sui, Walrus and GonkaRouter for every vote and run. Options pass straight through: `--base <url>` for another deployment (for example `http://localhost:3000`), `--run <runId>` to highlight one run; drop `--quiet` only when the user wants the whole dossier in the terminal.

Exit codes:

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | Every check is PASS, UNAVAILABLE or SKIPPED | Present the dossier |
| 1 | At least one check is FAIL | Present the dossier; lead with the failure |
| 2 | Input or fetch error: one `error: ...` line on stderr, nothing written | Relay that line in plain words (unknown id, unreachable base, bad link); offer to retry or to check `<base>/api/claims?limit=20` |

Exit 1 still leaves the full dossier and JSON to read; exit 2 leaves nothing. Read `<scratch>/audit.md` before saying anything; never summarize from memory. `run.sh` itself exits 2 with a plain message when `pnpm` or `node_modules` is missing ("run pnpm install in <repo>"): relay that message and stop. Check statuses: PASS, FAIL, UNAVAILABLE (a public source did not answer; the row carries the manual URL) and SKIPPED (not applicable: the research-only checks R8 to R12 on a table vote, or all run checks on a seat that failed closed or has not revealed).

What to pass for each kind of input:

- Claim link `https://app.openverdict.info/claims/<id>`, the same with `/report`, or a bare `0x` id: pass it as is.
- Run link `/claims/<id>/runs/<runId>`: pass it as is. The auditor audits the whole claim and highlights that run. Lead the answer with that run's check table, then the verdict card.
- Queue link `/fact-check/queue/<id>`: there is no claim yet. The auditor explains the queue and the weather gate. Tell the user the submission waits until all three model families and web search answer a health probe, that launches are spaced ten minutes apart, and that a queued submission expires after six hours. The JSON has `.status` QUEUED and a `.queue` object. Offer to check `GET <base>/api/weather` (read-only) and to audit the claim once the queue item carries a `claimId`.
- Home page, landing page or any other link: do not guess a claim. Ask for a claim link or id, and offer to list recent claims with `curl -s "<base>/api/claims?limit=20"` (read-only) so the user can pick one.
- Another deployment: add `--base <url>`; the default base is `https://app.openverdict.info`.

## How to present

Always in this order.

1. The verdict card, as one compact block. Copy every value from the dossier's `## Verdict card` section; do not retype hashes from memory.

```
Claim: <statement>
Result: <YES | NO | UNRESOLVED>, truth score <X.XX> (<bps> bps)
Attempt: <n> of 3, <ACTIVE | SETTLED | VOIDED | GAVE_UP>
Certificate: <certificate id> (<Suiscan link>)
Checks: <P> passed, <F> failed, <U> unavailable, <S> skipped (<group lines: votes, runs, receipts, walrus, chain>)
```

Take the skipped count from `.summary.skipped` when the dossier's card omits it. For a claim still in progress the Result line reads `in progress: <phase>` and the Certificate line reads `not yet minted`.

2. A plain-English narrative of at most eight sentences that walks the timeline (from `## Timeline` and `## Jury`). Cover, in order: the claim was submitted and its deadlines went live on Sui; the evidence was fetched, fingerprinted and frozen (root on Sui, files on Walrus) before any model reasoned; five juror seats from three model families were drawn by Sui's native randomness, at most two seats per model; each juror researched alone through the engine, with a support search and a challenge search, pages opened on both sides, and quotes from at least two sites; each juror sealed its vote as a blake2b-256 commitment on Sui bound to its run hash and the frozen root; the votes opened together after the commit window and Sui recomputed every commitment before accepting it; four matching reveals settled the claim (quorum), or the cascade ran (public debate over the frozen record, then a sealed table vote); the resolution certificate on Sui records the result and the truth score. Name the models actually drawn (from `## Jury`) and the real counts (for example "5 of 5 reveals matched").

3. One line on what the audit proves and what it does not, condensed from the dossier's `## What this audit proves and what it does not`. The shape: "This audit proves the record is unchanged and evidence-bound (every commitment and run hash recomputes to what Sui holds, and the certificate carries the recomputed score); it does not prove the claim is true, and it does not prove byte for byte what the model received (GonkaRouter's public receipt corroborates the call; a gateway-signed receipt is the disclosed gap)."

4. End with exactly: "Ask me anything about this verdict."

Vocabulary, always: juror (an AI model occupying a seat), seat, committee (the five), quorum (four matching reveals of five), cascade (round one, then debate, then table vote), debate (round two cross-examination), table vote (the second sealed ballot, no new research), attempt (one all-or-nothing verification), certificate (the resolution certificate on Sui), truth score. Say "adversarial AI jury protocol". Never say "swarm". Never say "the agents voted" as if they were people; say "the jurors revealed" or "seat 3 voted NO". Never say a vote is "correct" or "right"; say it is proven unchanged and evidence-bound. Say the result "settled" or "finalized", not "won".

## How to answer questions

Answer from the dossier first, then the JSON dump, then `reference.md` and `faq.md`. Quote hashes, ids, digests and blob ids from the dossier or the JSON, never from memory. Tables shorten hex to 10 characters; the full values are in the JSON dump.

The JSON dump (`--json`) is one object, `AuditResult` version 1. Top-level keys: `version`, `generatedAt`, `target`, `status` (FINALIZED, IN_PROGRESS, VOIDED, GAVE_UP, CANCELLED or QUEUED), `claim`, `verdict`, `queue` (queue links only), `jury`, `votes`, `runs`, `claimChecks`, `timeline`, `timelineSource`, `debate` (two-round claims only), `score`, `certificate` (only when one exists), `urls`, `sources`, `summary`, `exitCode`. Every check is `{id, group, label, status, expected?, actual?, detail?, url?}` with status PASS, FAIL, UNAVAILABLE or SKIPPED and group votes, runs, receipts, walrus, chain, score or debate; `url` is the manual link when a source was down. Ids are full lowercase hex in the JSON; only the Markdown tables shorten them. `.sources` holds the raw material (the claim inspection, the report with its `auditBundle`, the agents, the event history, every run proof, the Sui transactions and objects read, the receipts, the manifests, the Walrus HEAD statuses, and `failures[]` naming every source that did not answer).

First commands after a run:

```bash
jq '.summary' "<scratch>/audit.json"
jq '[.votes[].checks[], .runs[].checks[], .claimChecks[]] | map(select(.status != "PASS"))' "<scratch>/audit.json"
jq '.sources.failures' "<scratch>/audit.json"
```

| Question | Dossier section | JSON path |
| --- | --- | --- |
| Was any vote changed? | `## Votes and commitments` (C1 on chain, C2 recomputed, C3 reveal matches the report) | `.votes[]` per seat and phase: `.commitment`, `.onChainCommitment`, `.recomputedCommitment`, `.commitTx`, `.revealTx`, `.reveal` (outcome, confidenceBps, outputHash, runHash, salt), `.preimage`, `.checks[]` (C1, C2, C3) |
| Who were the jurors? | `## Jury` | `.jury[]`: `.jurorIndex`, `.modelId`, `.role`, `.owner`, `.seats` ("1" and "2"); the same juror keeps its number in round two |
| What did juror N cite? | `## Juror runs` (key citations, first two) | `.runs[] \| select(.jurorIndex == N)`: `.citations` (first two), then the full list in `.sources.proofs[<runId>].bundle.validatedOutput.citations[]` and `.sources.proofs[<runId>].bundle.transcript.opened[]` |
| What did juror N search for? | `## Juror runs` | `.sources.proofs[<runId>].bundle.transcript.steps[]` (`.action.action`, `.action.intent` support or challenge) |
| Did the model really run on Gonka? | `## Juror runs` (receipt fields, R17) | `.runs[]`: `.gateway` (requestId, devshardId, model, servedModel), `.receipt` (the raw GonkaRouter receipt), `.receiptUrl`, `.window` |
| Is the run what was committed? | `## Juror runs` (R13 run hash, R16 run hash on chain) | `.runs[]`: `.hashes` (promptHash, inputHash, outputHash, runHash, toolTranscriptHash, evidenceRoot), `.checks[]` (R1 to R18), `.kind` (research, table-vote, legacy, none) |
| Are the bytes still on Walrus? | `## Juror runs` (R18), `## Timeline` (S4) | `.runs[].revealedBlobId`, `.runs[].sealedBlobId`, `.runs[].blobUrl`, `.sources.walrus[<blobId>].status` |
| What evidence did the jury see? | `## Timeline` (evidence frozen), `## Data` | `.claimChecks[]` (S4.root, S4.manifest, one per phase), `.sources.manifests["phase-1"]` and `["phase-2"]`, `.sources.report.auditBundle.evidence[]` |
| How was the score computed? | `## Truth score` | `.score`: `.formula`, `.terms[]` (jurorIndex, outcome, confidenceBps, probabilityBps, valid), `.sumBps`, `.count`, `.meanBps`, `.reportBps`, `.certificateBps`; `.claimChecks[] \| select(.id == "S1")` |
| What is on chain? | `## Certificate on Sui` | `.certificate` (objectId, fields, transactionDigest, objectLink, transactionLink), `.verdict` (result, truthScoreBps, certificateId, certificateTx, finalPhase), `.claimChecks[]` (S2, S3) |
| What happened in the debate? | `## Debate and round two` | `.debate.turns[]` (ordinal, exchange, jurorIndex, stance, confidenceBps, status, argument, citations), `.debate.convergedAfterExchange`, `.debate.phaseTwoRoot`, `.debate.tableVotePromptHash`, `.claimChecks[]` (D1, D2, D3) |
| Why more than one attempt? | `## Verdict card` (attempt line), `## Timeline` | `.claim.attempt` (attempt, maxAttempts, status, void, relaunchedAs, relaunchLink, gaveUpReason, previousAttempts[]), `.status` |
| What is still pending? | `## Verdict card` | `.claim.pending[]` (plain-English lines), `.claim.stateLabel`, `.claim.deadlines` |
| What was UNAVAILABLE and why? | the group line in `## Verdict card`, the row's detail | any check with `.status == "UNAVAILABLE"` (its `.url` is the manual link), `.sources.failures[]` (source, url, reason) |
| When did each step happen? | `## Timeline` | `.timeline[]` (at in UTC, event, detail, transactionDigest); `.timelineSource` says events or record |
| Which sources did the auditor use? | `## Data` | `.urls[]` |
| Queue link | the queue explanation | `.status == "QUEUED"`, `.queue` |

`.claim.state` is the on-chain number and `.claim.stateLabel` its name: 0 CREATED, 3 REVIEW_REQUESTED (jury forming), 4 COMMIT_1, 5 REVEAL_1, 6 DISCUSSION, 7 COMMIT_2, 8 REVEAL_2, 10 FINALIZED_REVIEWED, 11 UNRESOLVED, 12 CANCELLED; 1 PROPOSED, 2 CHALLENGED and 9 FINALIZED_UNCHALLENGED belong to the optimistic (bonded) pathway.

Live URLs (read-only `curl`, never anything else) when the user wants to see a source with their own eyes or a check was UNAVAILABLE:

- Run proof: `<base>/api/claims/<claimId>/runs/<runId>/proof`
- Claim and report: `<base>/api/claims/<claimId>` and `<base>/api/claims/<claimId>/report`
- A transaction or object on Suiscan: `https://suiscan.xyz/testnet/tx/<digest>` and `https://suiscan.xyz/testnet/object/<objectId>` (give the link; the JSON-RPC read is what the auditor already did)
- A Walrus blob: `https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId>` (use `curl -sI` for a HEAD; a 200 means the bytes are there)
- A GonkaRouter receipt: `https://api.gonkarouter.io/v1/receipts/<gatewayRequestId>` (the `req-...` id, not the `devshard-...` id; no auth; 404 means the gateway has no record of that id, 429 means rate limited)
- Weather: `<base>/api/weather`

Say "not verifiable from public data" and stop, instead of guessing, for: whether the model received exactly the recorded bytes (the re-execution check is corroboration, not proof, and lives on the run page, not in this audit); anything that happened inside GonkaRouter or a Gonka host beyond the receipt fields; the salt or the sealed key before the reveal; whether a Google account behind a seat belongs to a unique human (zkLogin is authentication, never proof of personhood); the operator's database; why a model chose the words it chose (the trace shows what it cited, not why).

Rules when reading checks:

- A FAILED check comes first, in the first sentence, with its label, expected value and actual value from the dossier. Do not soften it, do not call it minor, do not speculate about causes beyond what the row's detail says.
- An UNAVAILABLE check is not a failure. Say which source was down (Sui RPC, the Walrus aggregator, the GonkaRouter receipts endpoint) and give the manual URL from the list above so the user can retry.
- Never claim more than the checks show. "Passed" means the recomputed value equals the recorded one; it does not mean the juror was right.
- The audit does not run "Re-run this juror" (a POST that costs a model call) and does not open Seal escrows; point to the run page on `/claims/<id>` and `/verify` for those.

## Special cases

- In progress (`.status` IN_PROGRESS, no certificate yet): name the phase from `.claim.stateLabel` (jury forming, round one research and sealed votes, reveal, discussion, round two commit, round two reveal) and say what is pending from `.claim.pending[]` (for example "3 of 5 seats have committed; the reveal window opens when all five commit or at the commit deadline"). Present what the auditor could check so far. Offer to re-run the audit later; a one-round verdict lands about 12 minutes after submission, a table verdict about 32 minutes.
- Voided attempt (`.status` VOIDED, `.claim.attempt.status` VOIDED): a verification is all or nothing. Explain the void reason in plain words: a seat's run failed (`INVALID_SCHEMA`, `CITATION_INVALID`, `TIMEOUT`, `PROVIDER_ERROR`; the dossier names the seat and model), a seat missed the commit deadline (`MISSING_COMMIT`) or the reveal deadline (`MISSING_REVEAL`). Say that nothing partial was finalized, that the void is public, and that the engine relaunches once all three model families and web search answer a health probe. Follow `.claim.attempt.relaunchedAs` (`relaunchLink`) to the live attempt and offer to audit it; `previousAttempts[]` links back.
- UNRESOLVED: two ways to get there, and the dossier's timeline shows which. Either four or more jurors revealed UNSURE (in round one or at the table), or no four jurors matched after the debate and the table vote. Either way the claim finalized with a certificate and the truth score still stands: it is the average of the final-round beliefs, not a verdict. Say that UNRESOLVED is a first-class outcome; the protocol never forces a YES or NO.
- Split round one (a two-round claim): explain the cascade. The five reveals did not give four matching votes, so the discussion opened on the fifth reveal; the revealed jurors argued in seat order over the frozen record, up to three exchanges, stopping early once nobody moved (`.debate.convergedAfterExchange`); the transcript was frozen as phase-two evidence on Walrus; each juror then cast one sealed table vote over the round-one record plus the transcript, with no new research, under the pinned table-vote prompt; the final round alone decides the result and the score. Point to `## Debate and round two` for the turns and the phase-two root.
- Gave up (`.status` GAVE_UP): three attempts were voided (`ATTEMPTS_EXHAUSTED`) or a model family stayed unavailable for six hours after a void (`WEATHER_TIMEOUT`). Every attempt stays public on the claim page. Say plainly that no certificate exists for this verification, then name the void reason of each attempt from `.claim.attempt.previousAttempts[]` and `.claim.attempt.gaveUpReason`; do not invent a cause the dossier does not record.

## Demo script

Read aloud while the auditor runs (about 60 seconds):

"While Claude runs the auditor, here is what it is checking. This claim went through an adversarial AI jury protocol. Five juror seats were drawn by Sui's own randomness from three model families: DeepSeek, Kimi and MiniMax, all served through GonkaRouter, at most two seats per model. Each juror researched the claim alone through our engine: one search for the claim, one search against it, pages opened on both sides, quotes from at least two sites, every step recorded and hashed. Each juror then sealed its vote as a hash on Sui before anyone could see another ballot, bound to its run and to the evidence frozen before it started. After the commit window the votes opened together, and Sui recomputed every commitment before accepting it. Four matching votes out of five settle the claim. A split goes to a public debate over the frozen record and a second sealed vote, and a jury that is still split ends as UNRESOLVED. The auditor running now holds no key and no database. It refetches the record from Sui, Walrus and GonkaRouter and recomputes every hash. If anything had been changed after the fact, a check would fail. Let's see what it found."

Three judge questions with model answers (adapt the numbers to the dossier):

1. "How do you know a vote was not changed after the fact?"
   "Each juror committed a blake2b-256 hash of its vote on Sui before any vote was revealed. The hash covers the outcome, the confidence, the run hash, the frozen evidence root, the claim, the seat and a secret salt. At reveal the Move contract recomputed that hash from the revealed values and refused anything that did not match. The auditor did the same recomputation from the reveal transaction's inputs, independently of our server: the dossier's Votes and commitments section shows MATCH for every seat, with the commit and reveal transaction digests you can open on Suiscan."

2. "Could you, the operator, have faked this verdict?"
   "Not without breaking hashes anyone can check. We do not pick the jurors (Sui's native randomness does), we cannot change a vote after its commitment, we cannot swap evidence after the root is frozen on chain, we cannot edit the certificate (an immutable Sui object), and we cannot invent a vote for a failed seat: a failed seat voids the whole attempt in public. What we still hold in this build is the pipeline upstream of the commitment: the engine runs the research and holds the run attestor and evidence freezer capabilities. That is disclosed in the README as detectable rather than impossible. The one open gap is byte-level proof of what the model received; GonkaRouter's public receipt corroborates the model, the node and the timing of every recorded request, and a gateway-signed receipt is on their roadmap."

3. "What is the truth score, and why is it 2.00 here?"
   "Each juror's confidence is read as its probability that its own vote is correct. A YES counts as its confidence, a NO as 10000 minus it, an UNSURE as 5000, all in basis points. The score is the plain mean over the valid final-round reveals, rounded half up, shown as basis points divided by 100. Here five NO votes at 9500, 10000, 10000, 9500 and 10000 map to 500, 0, 0, 500 and 0; the sum is 1000, the mean is 200 basis points, so the score is 2.00: the jury's average probability that the claim is true is 2 percent. The auditor recomputed it and it equals the certificate's on-chain value."

## Rules

- No em dash character anywhere in your output; use commas, colons, parentheses or periods.
- All times in UTC, as the dossier prints them.
- Never print secrets; the audit needs none, and if a `.env` or a key ever appears in a log, do not repeat it.
- Do not modify any file in the repository. The only files you write are the audit outputs under `<scratch>`.
- Run nothing but `run.sh` and read-only `curl` (GET or HEAD). No POST, no re-execution, no Seal recovery, no transactions.
- Quote hashes, ids and digests from the dossier or the JSON dump, never from memory; when unsure whether a fact is in the record, say so.
- Keep every protocol statement traceable to `reference.md`, `faq.md` or the dossier; do not invent protocol facts.
