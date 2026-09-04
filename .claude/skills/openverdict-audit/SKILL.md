---
name: openverdict-audit
description: Audit, verify, explain and answer questions about an OpenVerdict verdict from public data only, and drive a new verification end to end through the public ov CLI (weather, extract, submit, watch, audit, trace); use whenever the user pastes an OpenVerdict claim, run, report or queue link (app.openverdict.info/claims/... or /fact-check/queue/...) or a bare 0x claim id, asks to audit, verify, explain or question a verdict, resolution certificate, jury, juror run, vote commitment or truth score, says "verify this claim", "fact-check this", "submit a claim", "is the jury healthy", "check the weather" or "watch this claim", or pastes an article URL or a paragraph to verify.
---

# OpenVerdict audit

## What this skill does

This skill runs the public auditor (`scripts/audit-claim.ts`) on one OpenVerdict claim, reads the Markdown dossier it writes, presents the verdict in plain English, and then answers questions from the dossier, the JSON dump and the bundled `reference.md` and `faq.md`. It uses only public sources (the app's public API, Sui JSON-RPC, the Walrus aggregator, GonkaRouter's public receipts) and needs no key, no database and no wallet. Since 2026-09-03 it also drives the whole journey through the public CLI `ov` (launcher `ov.sh`): check the jury's weather, extract a checkable claim from a page or a paragraph, submit it, watch the jury live from the terminal, then audit the verdict (see "Verify a new claim end to end").

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

Two launchers live in the skill folder. Both are symlink-safe (each resolves its physical directory with `pwd -P` and finds the repo three levels up), both start the repo's own tsx through `node` directly (no pnpm needed on the judge's machine), and both exit 2 with a plain message when `node` or `node_modules` is missing ("run pnpm install in <repo>"): relay that message and stop.

- `run.sh`: the audit, as above (`scripts/audit-claim.ts`).
- `ov.sh`: everything else. It runs the public CLI `scripts/ov.ts` from the repo root (the same program as `pnpm ov`): `bash "<skill dir>/ov.sh" <command> [options]`. Commands: `weather`, `board`, `extract`, `submit`, `queue`, `status`, `watch`, `audit`, `trace`, `help`. Global options: `--base <url>` (default `https://app.openverdict.info`), `--json` (one JSON document on stdout, no prose; `watch` prints one JSON line per event plus a final summary), `--no-banner`, `--no-color`, `--timeout <duration>` where relevant (durations accept `30s`, `9m`, `1h`). The banner (the OpenVerdict wordmark, the tagline, the base host and the command) goes to stderr, never to stdout, so `--json` output stays parseable; skip it with `--no-banner` or `OV_NO_BANNER=1`. Before each command, tell the user in one line what you are about to run.

`ov.sh` exit codes (the CLI's own):

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | Success (for `watch`: the claim finalized) | Continue the flow |
| 2 | Input or request error: one `error: ...` line on stderr | Relay it in plain words (bad id or link, unreachable base, a validation message); fix the input or `--base`; offer to retry |
| 3 | `watch` only: the attempt voided (no relaunch yet within `--for`) or the verification gave up | Explain the void or give-up in plain words (see "Verify a new claim end to end", step d) |
| 4 | `watch` only: stopped before the end (`--for` reached or the budget spent) | Read the "last sequence N" line and call again with `--since N` |
| 5 | `submit` or `extract`: rate limited (429) or public writes disabled (403) | Say which one, from the message. Rate limit: five submissions per minute per client (plus a global ceiling); wait a minute. Writes disabled: this deployment takes no public submissions; stop and offer the audit of a settled claim instead |

What to pass for each kind of input:

- Claim link `https://app.openverdict.info/claims/<id>`, the same with `/report`, or a bare `0x` id: pass it as is.
- Run link `/claims/<id>/runs/<runId>`: pass it as is. The auditor audits the whole claim and highlights that run. Lead the answer with that run's check table, then the verdict card.
- Queue link `/fact-check/queue/<id>`: there is no claim yet. The auditor explains the queue and the weather gate. Tell the user the submission waits until all three model families and web search answer a health probe, that launches are spaced ten minutes apart, and that a queued submission expires after six hours. The JSON has `.status` QUEUED and a `.queue` object. Offer to check `GET <base>/api/weather` (read-only) and to audit the claim once the queue item carries a `claimId`. With the CLI: `bash "<skill dir>/ov.sh" queue <id>` for the status, `bash "<skill dir>/ov.sh" watch <id> --for 9m` to follow it until it launches and then through the jury.
- Home page, landing page, "all the verdicts", "the board", or any link without a claim id: run the board first, `bash "<skill dir>/run.sh" --list --limit 50 --json "<scratch>/board.json"`, and present its table (claim, state, result with score, attempt, statement; full ids and links follow the table). Then offer to audit one, several, or every settled claim (states FINALIZED_REVIEWED and UNRESOLVED). For "audit all": run the auditor once per settled claim (about ten seconds each, sequentially, `--quiet` with its own `--out` and `--json` files), show each verdict card as it lands, and close with one summary table: claim, result, score, checks passed / failed / unavailable / skipped. Voided and gave-up claims can be audited too; their card explains the void or give-up instead of a result.
- Another deployment: add `--base <url>`; the default base is `https://app.openverdict.info`.

## How to present

Progressive disclosure: tier 1 is the default answer, tier 2 opens the research trail when the user asks for the reasoning, tier 3 shows the exact bytes. Never jump a tier unasked; never withhold one that was asked for.

### Tier 1: the verdict card and the eight sentences (the default)

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

4. End with three concrete offers, each mapped to a command, then the invitation as the last line. The shape (adapt the three to the claim: on a two-round claim offer the debate and the table votes, on a voided attempt offer the earlier attempts):

```
Next, I can show the research trail of every juror (ov trace <claimId>), the exact prompt and answer of one seat (ov trace <claimId> --juror 3 --full), or walk one check with its on-chain values (the dossier's Votes and commitments section). Which one?
Ask me anything about this verdict.
```

Offer only what the record holds: no trail before the reveals exist, no table votes on a one-round claim.

### Tier 2: the research trail (when the user asks for the reasoning)

Triggers: "show me the reasoning", "everything", "explain in full", "what did they find", "what did juror 3 do", or any question about what a juror searched, opened or cited.

```bash
bash "<skill dir>/ov.sh" trace <id> [--juror N] [--round 1|2]
```

It takes about ten seconds (it rebuilds the same public record as the audit) and exits 0, or 2 with one `error: ...` line on an unknown id. Present it per juror, in seat order, from the command's own output:

- what it searched: the intent (support or challenge) and the exact query, then the domains it got back;
- what it opened: the page urls with their evidence ids and how much of each page it read;
- what it cited: the quotes, verbatim, with the site;
- its answer: the outcome and confidence, the reasoning in full, and each entry of the public reasoning trace (the check, the assessment, the finding);
- its receipt line: the GonkaRouter request id, the devshard, the tokens and the time.

On a two-round claim, continue with the debate turns in ordinal order (who spoke, in which exchange, what they argued, which evidence ids they cited, which turns were skipped) and then each juror's table vote, which has no searches: one answer turn over the frozen record and the transcript.

Never invent a step that is not in the trail. A seat with no revealed run prints why ("no revealed run (the seat failed: TIMEOUT)"); say that plainly instead of guessing what it would have found.

### Tier 3: the exact input and output

For "show me the prompt", "what exactly did the model receive", "show me the raw answer":

```bash
bash "<skill dir>/ov.sh" trace <id> --juror N --full
```

`--full` prints the pinned system prompt once (it is identical for every juror of a round, with its hash), then the claim JSON the juror received, then every turn's assistant message and tool result verbatim with the page texts, then the raw completion. Present the system prompt in summary first (its rules: one JSON action per turn, the three actions, the method, the output contract, the budgets), then the input JSON, then the turns, then the raw answer. Say that the prompt hash is what the run hash binds, so the prompt shown is the prompt that was hashed on chain.

Vocabulary, always: juror (an AI model occupying a seat), seat, committee (the five), quorum (four matching reveals of five), cascade (round one, then debate, then table vote), debate (round two cross-examination), table vote (the second sealed ballot, no new research), attempt (one all-or-nothing verification), certificate (the resolution certificate on Sui), truth score. Say "adversarial AI jury protocol". Never say "swarm". Never say "the agents voted" as if they were people; say "the jurors revealed" or "seat 3 voted NO". Never say a vote is "correct" or "right"; say it is proven unchanged and evidence-bound. Say the result "settled" or "finalized", not "won".

## How to answer questions

Answer from the dossier first, then the JSON dump, then `reference.md` and `faq.md`. Quote hashes, ids, digests and blob ids from the dossier or the JSON, never from memory. Tables shorten hex to 10 characters; the full values are in the JSON dump.

The JSON dump (`--json`) is one object, `AuditResult` version 1. Top-level keys: `version`, `generatedAt`, `target`, `status` (FINALIZED, IN_PROGRESS, VOIDED, GAVE_UP, CANCELLED or QUEUED), `claim`, `verdict`, `queue` (queue links only), `jury`, `votes`, `runs`, `claimChecks`, `timeline`, `timelineSource`, `debate` (two-round claims only), `score`, `certificate` (only when one exists), `urls`, `sources`, `summary`, `exitCode`. Every check is `{id, group, label, status, expected?, actual?, detail?, url?}` with status PASS, FAIL, UNAVAILABLE or SKIPPED and group votes, runs, receipts, walrus, chain, score or debate; `url` is the manual link when a source was down. Ids are full lowercase hex in the JSON; only the Markdown tables shorten them. `.sources` holds the raw material (the claim inspection, the report with its `auditBundle`, the agents, the event history, every run proof, the Sui transactions and objects read, the receipts, the manifests, the Walrus HEAD statuses, and `failures[]` naming every source that did not answer).

First commands after a run:

```bash
jq '.summary' "<scratch>/audit.json"
jq '[.votes[].checks[], .runs[].checks[], .claimChecks[]] | map(select(.status != "PASS"))' "<scratch>/audit.json"
jq '.sources.failures' "<scratch>/audit.json"

# every juror's searches and opens, one line each (run, action, intent, query or urls)
jq -r '.sources.proofs[] | .runId as $r | .bundle.transcript.steps[] | select(.action.action != "answer")
       | [$r[0:10], .action.action, (.action.intent // "-"), (.action.query // ((.action.urls // [.action.url]) | join(", ")))]
       | @tsv' "<scratch>/audit.json" | uniq

# one juror's parsed answer (outcome, confidence, reasoning, trace, citations)
jq --argjson n 1 '. as $a | $a.runs[] | select(.jurorIndex == $n)
       | $a.sources.proofs[.runId].bundle.validatedOutput' "<scratch>/audit.json"
```

The transcript expands one `open` action into one step per page, which is why the first recipe ends with `uniq`; `ov trace` rejoins them into one turn.

| Question | Dossier section | JSON path |
| --- | --- | --- |
| Was any vote changed? | `## Votes and commitments` (C1 on chain, C2 recomputed, C3 reveal matches the report) | `.votes[]` per seat and phase: `.commitment`, `.onChainCommitment`, `.recomputedCommitment`, `.commitTx`, `.revealTx`, `.reveal` (outcome, confidenceBps, outputHash, runHash, salt), `.preimage`, `.checks[]` (C1, C2, C3) |
| Who were the jurors? | `## Jury` | `.jury[]`: `.jurorIndex`, `.modelId`, `.role`, `.owner`, `.seats` ("1" and "2"); the same juror keeps its number in round two |
| What did juror N cite? | `## Juror runs` (key citations, first two) | `.runs[] \| select(.jurorIndex == N)`: `.citations` (first two), then the full list in `.sources.proofs[<runId>].bundle.validatedOutput.citations[]` and `.sources.proofs[<runId>].bundle.transcript.opened[]` |
| What did juror N search for? | `## Juror runs` | `.sources.proofs[<runId>].bundle.transcript.steps[]` (`.action.action`, `.action.intent` support or challenge) |
| What did juror N actually do, step by step? | run `ov trace <id> --juror N` (add `--full` for the exact prompt and answer) | `.sources.proofs[<runId>].bundle.request.messages[]` (each assistant message is one turn, the user message after it is its result) and `.transcript.steps[]` |
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

Say "not verifiable from public data" and stop, instead of guessing, for: whether the model received exactly the recorded bytes (the re-execution check is corroboration, not proof, and lives on the run page, not in this audit); anything that happened inside GonkaRouter or a Gonka host beyond the receipt fields; the salt or the sealed key before the reveal; who the person or organisation behind an account that staked on a seat is (zkLogin is authentication, never proof of personhood); the operator's database; why a model chose the words it chose (the trace shows what it cited, not why).

Rules when reading checks:

- A FAILED check comes first, in the first sentence, with its label, expected value and actual value from the dossier. Do not soften it, do not call it minor, do not speculate about causes beyond what the row's detail says.
- An UNAVAILABLE check is not a failure. Say which source was down (Sui RPC, the Walrus aggregator, the GonkaRouter receipts endpoint) and give the manual URL from the list above so the user can retry.
- Never claim more than the checks show. "Passed" means the recomputed value equals the recorded one; it does not mean the juror was right.
- The audit does not run "Re-run this juror" (a POST that costs a model call) and does not open Seal escrows; point to the run page on `/claims/<id>` and `/verify` for those.

## Verify a new claim end to end

The ordered flow for a new verification. Say in one line what you are about to do before each command. Keep the user in the loop: confirm the claim text, get an explicit go before submitting, narrate what lands as it lands.

### a. Input handling

- A plain statement: use it as the claim. Confirm the exact wording with the user in one line ("I will submit: <claim>. Go?"). Never submit without an explicit go. A claim must be 5 to 1000 characters; one bounded factual statement works best (no opinions, predictions, questions or compound claims).
- An article URL, or a pasted paragraph of 40 characters or more: run the extractor, then let the user choose.

```bash
bash "<skill dir>/ov.sh" extract --url "<url>"
bash "<skill dir>/ov.sh" extract --text "<paragraph>"
bash "<skill dir>/ov.sh" extract --file "<path>"
```

Add `--json` when you want the fields (`claims[]` with `claim`, `reason` and `quote`; `language`; `modelId`; `gonkaRequestId`). A GonkaRouter model returns up to three candidates in source order. Present them as a numbered list, each with its reason and its quote, name the language and the model that extracted them, and ask which one to submit (or whether to edit one). Text must be 40 to 20000 characters and the URL must be http or https; a paragraph under 40 characters is a statement, so use it as the claim. "no checkable claim found" (404 `NO_CLAIM_FOUND`) means the source held no checkable factual claim: ask for a statement instead. `INVALID_URL` (400) and `FETCH_FAILED` (502): relay the message. Exit 5: rate limited or writes disabled, see the exit table under "How to run".

Optional evidence for the submission: `--url <https url>` (up to five, https only, at most 2048 characters each) and `--text "<evidence text>"` (up to 20000 characters) ride along with the claim as submitted sources and are frozen with the evidence; `--criteria "<text>"` (up to 2000 characters) sets the resolution criteria. Pass only what the user gave; invent none of it.

### b. Check the weather first

```bash
bash "<skill dir>/ov.sh" weather
```

If it says clear, go on. If it says not clear, say which of the four rows is down (DeepSeek, MiniMax, Kimi, Web search) and that the submission will queue: the engine launches a queued claim when DeepSeek, MiniMax, Kimi and web search all answer a probe; launches are spaced ten minutes apart; a queued item expires after six hours. Offer two choices: submit anyway (it queues and starts by itself on the first clear probe) or wait and check the weather again in a few minutes. "no recent probe" means the weather is unknown: a submission launches at once, and a family may still fail closed mid-run.

### c. Submit

```bash
bash "<skill dir>/ov.sh" submit "<claim>" [--url <https url>]... [--text "<evidence text>"] [--criteria "<text>"]
```

Only after the explicit go. The call returns once the claim exists (the statement and criteria go to Walrus, then `create_claim` runs on Sui; measured under a minute). Then:

- 200, a claim id: print the claim link `<base>/claims/<id>` and say that the console page shows the same events live for the audience (open it on the second screen). Go to step d with the claim id.
- 202, a queue id: print the queue link `<base>/fact-check/queue/<id>`, repeat the weather lines the CLI printed, and say the engine launches it when all four rows answer (ten-minute spacing, six-hour expiry). Watch the queue: `bash "<skill dir>/ov.sh" watch <queueId> --for 9m` polls it every 30 s, prints the weather changes, and follows the claim once it launches. `bash "<skill dir>/ov.sh" queue <queueId>` gives the one-shot status.
- 400: relay the validation message (claim 5 to 1000 characters, text up to 20000, up to five https urls of at most 2048 characters each, criteria up to 2000).
- Exit 5: say whether it was the rate limit (five submissions per minute per client, plus a global ceiling; wait a minute) or writes disabled (the deployment takes no public submissions; stop).

Never resubmit the same statement in a row; if the user asks again, point at the claim (or queue) link that already exists.

### d. Watch the jury live

```bash
bash "<skill dir>/ov.sh" watch <claim id, claim link or queue id> --for 9m
```

Give the Bash call a 600000 ms timeout. Each call follows the verification for up to nine minutes and prints one dated line per step (`HH:MM:SSZ  <what happened>  <detail>`); the stream replays history first, so the first call shows everything so far. Loop:

- Exit 4 (the nine minutes are up): read the last line, "still <state>; last sequence N; run again with --since N to continue", and call again with `--since N` so nothing is printed twice. Between calls, narrate what landed (see "While watching, what to say"): seats drawn with their models, evidence frozen, jurors committing (k of 5), the reveal, quorum or cascade, debate turns and stances, table votes, the final line. Expect two calls for a one-round verdict and four for a two-round one. While a queue item is still QUEUED there is no sequence yet: call again with the same queue id and no `--since`.
- Exit 3 (voided, or gave up): the line reads "attempt n voided: <reason> (<model>, phase p); relaunch pending", or names the give-up reason. Explain the reason in plain words (a seat's run failed: `INVALID_SCHEMA`, `CITATION_INVALID`, `TIMEOUT`, `PROVIDER_ERROR`; a seat missed the commit deadline: `MISSING_COMMIT`; or the reveal deadline: `MISSING_REVEAL`), that nothing partial was finalized, that the engine relaunches on clear weather as attempt n+1 of 3, and that the void stays public on the claim page. When the watch prints the relaunched claim link, follow it: call `watch` on the new id (calling it on the old id also works; the follower switches by itself when `relaunchedAs` appears). After a give-up (`ATTEMPTS_EXHAUSTED` after three voids, or `WEATHER_TIMEOUT` after six hours of bad weather after a void) there is no certificate: say so, offer the audit of the voided claim (its card explains the void) and a fresh submission later.
- Exit 0 (finalized): the last lines read "final: <result>, score X.XX, certificate 0x..." and "audit it: ov audit <id>". Run the audit flow now, `bash "<skill dir>/run.sh" <id> --quiet --json "<scratch>/audit.json" --out "<scratch>/audit.md"` (`ov.sh audit <id>` is the same auditor with the same flags), and present it exactly as in "How to present": card, timeline, the proves and does-not line, "Ask me anything about this verdict."
- Exit 2: relay the error line (unknown id, unreachable base); offer `bash "<skill dir>/ov.sh" status <id>`.

If the stream drops, the CLI reconnects up to five times on its own and replays with `--since`; you only see it in the lines.

### e. Durations to say out loud

From the hosted testnet ladder (`defaultDeadlines`, 2026-09-03), counted from the claim's creation on Sui:

- The committee is drawn about a minute in and the evidence is frozen right after; seats have one minute to accept; then the jurors research (about eight minutes of room).
- Commit window 10 minutes (+600 s); reveal window 2 minutes (to +720 s). The reveal opens as soon as all five have committed, so a fast jury reveals earlier.
- One-round verdict: about 11 to 12 minutes after launch (measured 10.6 minutes on the rehearsal claim "Humans use only ten percent of their brains.").
- Discussion: up to 14 minutes (to +1560 s), stopping early when nobody moves; then round two: 4 minutes to commit the table votes (to +1800 s) and 2 minutes to reveal them (to +1920 s).
- Two-round verdict: about 32 minutes after launch.
- A queued submission adds the wait for clear weather plus the ten-minute launch spacing; nobody can say how long that is, so say so.

## Checking the jury's health

- `bash "<skill dir>/ov.sh" weather`: one line per row (DeepSeek, MiniMax, Kimi, Web search), each "ok" with its latency or a status (`429` shedding, `TIMEOUT`, `502`, `402` no search credits, `ERROR`), then "clear" or "not clear", then "probed N s ago" or "no recent probe". Read it as: clear means the last probe is fresh (under five minutes) and all four rows answered, so a submission launches at once; not clear means at least one row failed, so a submission queues until all four answer; no recent probe means unknown, and unknown never holds a submission. The probe refreshes at most every two minutes and is research-shaped (400 tokens), so "ok" means the family can do real work, not just answer a ping. The console shows the same four chips in its weather strip ("healthy" under 30 s, "slow" above, "down", "no recent probe").
- `bash "<skill dir>/ov.sh" board [--limit n]`: the live board, newest first (claim, state, result with score, attempt, statement). Use it to find a settled claim for the audit or to see what is live right now.
- `bash "<skill dir>/ov.sh" status <claim id or link>`: one block: the statement, the state in plain words (jury forming, round one research and sealed votes, reveal, discussion, round two commit, round two reveal, finalized, unresolved), seats committed and revealed (n of 5), attempt n of 3 with its status, the next deadline relative to now ("reveal window opens in 3 min" or "passed"), the result, score and certificate link when settled, the relaunch link when voided.
- `bash "<skill dir>/ov.sh" queue <queueId>`: the queued submission: status QUEUED, LAUNCHED (with the claim id and link), EXPIRED or CANCELLED, the statement, the created and expiry times, the weather, and `launchError` when a launch failed.

Read-only `curl` stays allowed for the same data (`<base>/api/weather`, `<base>/api/claims/<id>`, `<base>/api/fact-checks/queue/<id>`).

## While watching, what to say

Report only what the lines show. Never predict a verdict, and never count partial reveals as a result ("three NO so far" is fine; "it will be NO" is not). One or two sentences per event, in the lexicon. Templates, by line kind:

- claim created: "The claim is live on Sui (transaction <digest>); its deadlines started with it."
- evidence frozen, phase 1: "The evidence is frozen: root <0x...> on Sui, the manifest on Walrus, before any juror reasons. Nothing can be slipped in or out now."
- seats drawn: "Sui's randomness drew five seats: <models in seat order>. At most two seats per model, three families."
- research, searched: "Juror n searched for evidence <support or challenge> of the claim: '<query>'. The query and the sites are public as it happens; what it makes of them stays sealed."
- research, opened: "Juror n opened <k> pages: <sites>. Every page is archived on Walrus before the juror reads it."
- research, drafting: "Juror n is drafting its answer. The answer, its vote and its reasoning stay sealed until the reveal."
- run approved: "Juror n finished its research; its run hash is on Sui and its sealed bundle is cited on chain. It can commit now."
- vote committed: "Juror n sealed its vote (k of 5). Nobody, including us, can read it yet."
- phase changed, COMMIT_1 to REVEAL_1: "All five have committed (or the commit window closed): the votes open together now, and Sui recomputes each commitment before accepting it."
- vote revealed: "Juror n revealed <outcome> at <bps divided by 100> percent confidence (k of 5). The reveal landed on Sui, which accepts only a reveal that matches its commitment."
- final, round one: "Four (or five) matching reveals settle it: quorum. Final: <result>, truth score <X.XX>, certificate <0x...> on Sui."
- phase changed, REVEAL_1 to DISCUSSION: "No four matching votes, so the cascade: the revealed jurors debate over the frozen record, in seat order, up to three exchanges."
- debate turn: "Turn k, seat n: <stance> at <bps divided by 100> percent. '<first words>'. It may cite only ids from the frozen record." A SKIPPED turn (provider error, bad output, window exhausted) is recorded and the debate goes on; a skipped turn does not void the attempt.
- debate converged: "The debate stopped after exchange n: nobody moved."
- evidence frozen, phase 2: "The transcript is frozen as phase-two evidence; round two opens on it."
- phase changed to COMMIT_2, then the commits and reveals: "Round two is the table vote: one sealed ballot per juror over the frozen record plus the transcript, no new research." Then the commit and reveal lines as above, with "table vote".
- output repaired: "Juror n's output was repaired: <field> (prose dropped where an evidence id belongs). The vote and the confidence were not touched; the repair is a public event."
- final after round two: "The table decides: <result> with <k> matching votes, truth score <X.XX>, certificate <0x...>." For UNRESOLVED: "Still split (or four or more UNSURE): UNRESOLVED, a first-class outcome. The certificate still exists and the score is the average belief."
- attempt voided: "Attempt n voided: <reason in plain words> (<model>, phase p). A seat failed closed, so the whole attempt is void: no vote is invented, nothing partial is finalized, the failure record is public. The engine relaunches when all four rows answer, as attempt n+1 of 3."
- relaunched: "Relaunched as <link>; following the new attempt."
- gave up: "The verification gave up: <reason>. No certificate; every attempt stays public on the claim page."

When a juror fails closed (a failed run, a missed commit, a missed reveal), say so the moment the line lands, name the seat and the model from the line, say that the attempt is voided as a whole and what happens next (relaunch on clear weather, attempt n of 3, give-up after three voids or six hours of bad weather after a void). The void line may arrive up to a minute after the failure, because the follower polls the claim record every 60 s alongside the stream.

Skip `RESEARCH_TICK` lines (content-free pulses; they only mean a seat is working) and mention `inference_completed` or `argument_published` in at most one short line. The `research` lines are the live feed and are worth narrating, but group them: one sentence per juror per burst, never one sentence per line.

## Demo flow B (end to end)

Only when `ov.sh weather` says clear. Have a fresh statement ready (never one submitted in the last hour) and the pre-settled rehearsal claim at hand for the audit (`0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6`, "Humans use only ten percent of their brains.", NO, truth score 2.00, 5 of 5 seats). Open `<base>/claims/<id>` on the audience screen as soon as the claim id exists: the console opens in the Live view and shows the same events as they land (the claim as the first message, one line per event, five juror cards with their live status lines, the stage pill naming the round, the LIVE chip, the "Attempt n of 3" pill). The Graph view, one click away, blooms into searches, pages and citations at the reveal, carries the debate dock in a second round, and lands the certificate at settlement.

Spoken script, in order:

"First, is the jury available? Claude asks the engine's weather: the three model families on Gonka and the web search provider, each probed with a research-shaped request within the last few minutes. Clear. If it were not, the claim would queue instead of burning an attempt."

"Now the claim. I paste one sentence; Claude confirms the wording; I say go. The statement goes to Walrus, the claim goes live on Sui with its deadlines, and the console page on the other screen picks it up."

"Watch the lines land. Sui's own randomness has drawn five seats: <read the models from the line>. The evidence is frozen before anyone reasons. Each juror now researches alone through our engine, for and against, with quotes from at least two sites. As each finishes, its run hash lands on Sui and it seals its vote: five sealed votes, and nobody can read any of them."

"The reveal: the five votes open together and Sui recomputes every commitment. Four matching reveals settle it; a split goes to a public debate over the frozen record and a sealed table vote; a jury still split ends UNRESOLVED. Claude only reports what landed; it never guesses the verdict."

When the final line lands: "Final. Claude now runs the auditor with no key and no database: it refetches the record from Sui, Walrus and GonkaRouter and recomputes every hash." Then the audit presentation from "How to present".

When the slot will not hold the live verdict: "The jury keeps working on the other screen; let us look at a claim that settled earlier today." Run the audit flow on the pre-settled claim and come back to the live one if time remains.

Timings to plan with: weather 5 s; extract (optional) 10 to 30 s; submit under a minute; committee and freeze inside the first two minutes; commits from about minute four; reveal about minute eight to ten; one-round certificate about minute 11 to 12; a split adds about 20 minutes. Plan the slot so that the audit of the pre-settled claim (about ten seconds plus the write-up, a minute in all) fits regardless.

Three judge questions for this flow, with model answers:

1. "What if Gonka is down right now?"
   "Then the claim does not launch. The engine probes DeepSeek, MiniMax, Kimi and the web search provider every two minutes with a research-shaped request; when any of them fails, a submission is queued instead of started, and it launches by itself on the first clear probe, one launch every ten minutes, or expires after six hours. Nothing is held on unknown weather. If a family fails after the launch, the seat fails closed, the attempt is voided in public and relaunched on the next clear probe, up to three attempts. Every committee must span all three families by the Move rule, so with one family down a seat is bound to fail; the queue keeps that attempt from being burned."

2. "Why did it queue?"
   "Because the last probe, less than five minutes old, showed at least one of the four rows not answering; the CLI printed which one. A committee must span all three families, and a jury without web search can only answer UNSURE, so launching now would burn one of the three attempts for nothing. The queue holds the request as submitted, starts it when all four answer, one launch per ten minutes, and expires it after six hours; the queue page and `ov queue` show the live weather next to it."

3. "Why can one seat void the whole attempt?"
   "Because a verification is all or nothing: every step is five for five or void, and a verdict never carries an empty chair. The quorum is four matching reveals of five, and that rule is about agreement, not attendance. If a seat's run fails, or a seat misses its commit or its reveal, no vote is invented for it and nothing partial is finalized; the failure record with its research trail stays public, and the engine relaunches the whole attempt when the weather clears, up to three attempts. The claim page shows attempt n of 3 with the seat, the model and the reason. A skipped debate turn is not a binding step; the debate simply goes on."

## Special cases

- In progress (`.status` IN_PROGRESS, no certificate yet): name the phase from `.claim.stateLabel` (jury forming, round one research and sealed votes, reveal, discussion, round two commit, round two reveal) and say what is pending from `.claim.pending[]` (for example "3 of 5 seats have committed; the reveal window opens when all five commit or at the commit deadline"). Present what the auditor could check so far. Offer to re-run the audit later; a one-round verdict lands about 12 minutes after submission, a table verdict about 32 minutes.
- Voided attempt (`.status` VOIDED, `.claim.attempt.status` VOIDED): a verification is all or nothing. Explain the void reason in plain words: a seat's run failed (`INVALID_SCHEMA`, `CITATION_INVALID`, `TIMEOUT`, `PROVIDER_ERROR`; the dossier names the seat and model), a seat missed the commit deadline (`MISSING_COMMIT`) or the reveal deadline (`MISSING_REVEAL`), or no committee could be drawn before the commit deadline (`MISSING_COMMITTEE`). Say that nothing partial was finalized, that the void is public, and that the engine relaunches once all three model families and web search answer a health probe. Follow `.claim.attempt.relaunchedAs` (`relaunchLink`) to the live attempt and offer to audit it; `previousAttempts[]` links back.
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
- Run nothing but `run.sh`, `ov.sh` and read-only `curl` (GET or HEAD). The only writes are `ov.sh extract` and `ov.sh submit`, each after the user's explicit go; no other POST, no re-execution, no Seal recovery, no transactions.
- Never submit the same statement twice in a row; never submit without an explicit go; the public rate limit is five submissions per minute.
- Quote hashes, ids and digests from the dossier or the JSON dump, never from memory; when unsure whether a fact is in the record, say so.
- Keep every protocol statement traceable to `reference.md`, `faq.md` or the dossier; do not invent protocol facts.
