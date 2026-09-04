---
title: Audit guide
description: Three ways to check a verdict yourself: with any agent, with Claude Code, or with the public ov command line.
order: 4
---

Auditing a verdict needs no key, no wallet, no database and no permission. Every
input is public: Sui JSON-RPC, the Walrus aggregator, GonkaRouter's public
receipts and the app's own read routes. Pick whichever of the three paths below
fits the tool in front of you.

## A worked audit, end to end

Everything below is real. This is claim
`0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6` on Sui
testnet, settled on 2026-09-03.

```bash
pnpm ov audit 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 --quiet
```

**The claim.** The statement was "Humans use only ten percent of their brains."
It ran in direct-review mode, finished in one round, and settled as NO with a
Truth Score of 200 basis points, displayed as 2.00.

**The jury.** Five seats, drawn by on-chain randomness inside committee
`0xcb8560e363f87e690ef55e1a7d4d49c039cc0efe8b43179e1b49e36dfcfe39b6`:

| Model | Seats |
| --- | --- |
| `deepseek-ai/DeepSeek-V4-Flash-0731` | 2 |
| `moonshotai/Kimi-K2.6` | 1 |
| `MiniMaxAI/MiniMax-M2.7` | 2 |

Three distinct families, at most two seats each, five distinct owners. That is
the diversity rule holding in practice.

**The evidence.** One phase, root
`0x532792caa77893b49cd95d19703da9f50c7053a8cc3a67c86f9a9d0723501740`, with the
manifest on Walrus at blob `T9-7bdVdYwexoURkc5SSDQfJ59KEFqdH3G0SEeSVQnk`.
Fetch it yourself:

```bash
curl -s https://aggregator.walrus-testnet.walrus.space/v1/blobs/T9-7bdVdYwexoURkc5SSDQfJ59KEFqdH3G0SEeSVQnk
```

Recompute the Merkle root over its leaves and you get the root above. That is
audit check S4.

**One juror run.** The DeepSeek seat's run
`0x75897c615937984977b4c102b7789c959b1dcbc4a2a37cd3f3f7937c4dbc4411` carries:

| Hash | Value |
| --- | --- |
| `promptHash` | `0x7257117d5b4d02b8c8de5e70d62f6856143d7f20225084a111645f3557a40b14` |
| `inputHash` | `0x3886c106f485bd55a4bab642000c554e4119da328714d1070f45a68a310b9ff8` |
| `outputHash` | `0xa39c26738b503fd0d2932de3039d5a893fee7a7e54ccc1cb1eea9ad403bcea91` |
| `toolTranscriptHash` | `0x634016d384a799badc31639fdfc2e706a3b3e7033ba6cfcd69ae28a4889ad307` |
| `runHash` | `0x5fc502e3e1a5938288b70f1cef286e78214c79ececfd58daa0e6f75357e22afd` |

Its gateway request id is `devshard-70083-36`. The run approval
`0xf8cd7ad8394eacfd376abaf80baf0e6dae94b044db1a8aa4d44c92e761dce9d5`, in
transaction `2wp9XAHmN3ngGYcyR2oPZw1KUHVqy8iHSutVEbFjTQuJ`, carries **the same
run hash**, and it landed before the commitment. That is check R16.

**The commitment.** In transaction
`9FX7D4njYMFKfzc7qHq2cEUHaZ6tnoLnU7grpt6gWvzo` the seat committed
`0x4aa39c4875fec9523343ac4f6a2c12d06ce4af14282c8272337b65776cc4d642`, with no
vote visible anywhere. The reveal followed in
`FBx1vdQEU3HSTX5eRFdrTmDgt9JbSTkoTuf4Gg1S5uyY`, publishing the outcome, the
confidence and the salt. Rebuilding the preimage from those inputs plus the
claim, profile, seat, phase and evidence root reproduces that exact commitment.
That is check C2, the one no human does by hand.

**The score.** All five jurors voted NO:

| Confidence (bps) | Truth probability (bps) |
| --- | --- |
| 9500 | 500 |
| 10000 | 0 |
| 10000 | 0 |
| 9500 | 500 |
| 10000 | 0 |

```
sum   = 1000
count = 5
score = (1000 + floor(5 / 2)) / 5 = 1002 / 5 = 200
```

**The certificate.**
`0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706` carries
`result = NO` and `truth_score_bps = 200`, matching the arithmetic above. That
is checks S1 and S2.

Note that this claim settled under package
`0x15c6e53ce00b814c68eed17a056cce13dc59416418500a0f4dbba73fac530f65`, an
earlier upgrade than the current one. Object types keep the original package
address, so an old claim stays readable after every upgrade.

Read the whole record in the browser at
[app.openverdict.info/claims/0x2732...4ac6](https://app.openverdict.info/claims/0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6).

## 1. With any agent

`https://app.openverdict.info/llms.txt` is written for a model. It carries the
protocol summary, the routes an audit reads, the third-party sources to check
them against, and the three recomputations that decide whether a record is
intact. Point any capable agent at that file with a claim link and it has
everything it needs.

The three recomputations, verbatim from that file, are the whole of the
cryptographic argument:

1. **Vote commitment.** `blake2b256(BCS(VotePreimageV1 { claim_id,
   agent_profile_id, jury_seat_id, phase u8, outcome u8, confidence_bps u16,
   evidence_root, output_hash, run_hash, salt }))`, in that order, must equal
   the commitment Sui stored before the reveal. The salt is published nowhere:
   it is the fifth argument of the `reveal_vote` transaction.
2. **Run hash.** `blake2b256(BCS(RunRecordV1 { run_id, claim_object_id,
   agent_profile_id, jury_seat_id, phase, attempt, provider_id, model_id,
   gonka_request_id, prompt_hash, input_hash, output_hash,
   tool_transcript_hash, evidence_root, requested_at_ms, completed_at_ms }))`
   must equal the run hash in the run approval on Sui.
3. **Truth Score.** Each valid final-round reveal becomes a probability in
   basis points (YES its confidence, NO 10000 minus it, UNSURE 5000), and the
   score is `(sum + floor(N / 2)) / N` in integer arithmetic. It must equal the
   score on the Resolution Certificate.

### The routes an audit reads

| Route | What it gives |
| --- | --- |
| `GET /api/claims/<claimId>` | State, phase, deadlines, attempt |
| `GET /api/claims/<claimId>/report` | The verdict, the final-round votes and the `auditBundle`: committee, evidence roots per phase, runs, run approvals, commitments, reveals and certificate. This is the spine of an audit. |
| `GET /api/claims/<claimId>/runs/<runId>/proof` | One juror run, its hashes, its sealed and revealed Walrus blob ids, and the Sui objects behind it |
| `GET /api/claims/<claimId>/events?snapshot=1` | The resolution event log. Drop `snapshot` for the live Server-Sent Events stream. |
| `GET /api/gateway-receipts/<gatewayRequestId>` | GonkaRouter's public receipt, proxied only because the gateway sends no CORS headers |

### The sources that are not ours

- Sui JSON-RPC at `https://sui-testnet-rpc.publicnode.com` or
  `https://fullnode.testnet.sui.io:443`.
- The Sui explorer at `https://suiscan.xyz/testnet/tx/<digest>` and
  `/object/<id>`.
- Walrus at `https://aggregator.walrus-testnet.walrus.space/v1/blobs/<blobId>`.
- GonkaRouter at `https://api.gonkarouter.io/v1/receipts/<gatewayRequestId>`.
  A 404 means no record and a 429 means rate limited. Use the `req-...` id, not
  the `devshard-...` one.

## 2. With Claude Code

The repository ships a skill, `.claude/skills/openverdict-audit/`. Install it
once with a symlink:

```bash
ln -s "$PWD/.claude/skills/openverdict-audit" ~/.claude/skills/openverdict-audit
```

Then paste a claim link, a report link, a run link, a queue link or a bare `0x`
id into the session, or ask in plain words: "audit this", "verify this claim",
"is the jury healthy", "watch this claim". The skill runs the public auditor,
reads the Markdown dossier it produces, and answers questions from it.

It presents in three tiers. The verdict card and a short narrative come first.
Asking about a specific juror moves to the research trail for that seat. Asking
for everything prints the full trail with the pinned system prompt and every
message verbatim.

The skill is read-only by construction. It runs nothing but the two launchers
in its own folder and read-only requests, its only writes are the audit outputs
in a scratch directory, and it never submits anything without an explicit go
from you. It needs network access and nothing else: no key, no database, no
wallet.

## 3. With the ov command line

`ov` is the public CLI. After `pnpm install` it needs no API key, no wallet and
no database, because it reads and writes only the public API.

```bash
pnpm install
pnpm ov help
```

By default it talks to `https://app.openverdict.info`. Point it elsewhere with
`--base <url>`.

### Global options

| Option | Meaning |
| --- | --- |
| `--base <url>` | Another deployment |
| `--json` | Machine output on stdout, one JSON document, NDJSON for `watch`. For `audit` only, `--json` takes a file path rather than being a switch. |
| `--no-banner` | Skip the banner, or set `OV_NO_BANNER=1` |
| `--no-color` | No colour codes in the banner |
| `--timeout <duration>` | Per request timeout. Durations accept `30s`, `9m`, `1h`. |

The banner is written to stderr, so `--json` on stdout stays parseable.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 2 | Input or request error, with one `error:` line on stderr |
| 3 | The claim voided or gave up (`watch`) |
| 4 | `watch` stopped before the end, its timeout or budget reached |
| 5 | Rate limited or writes disabled (`submit`, `extract`) |

`ov audit` uses its own set: **0** when every check passed or was unavailable,
**1** when any check failed, **2** on an input or fetch error.

### The commands

#### `ov weather`

Is the jury healthy? One line per model family (DeepSeek, MiniMax, Kimi and web
search), then clear or not clear. Not clear means new submissions queue until
all four families answer a probe.

JSON shape: `{ probedAtMs, stale, clear, families[] }`, where each family is
`{ modelId, family, ok, latencyMs, status }`.

#### `ov board [--limit <n>]`

The public board: every claim, newest first, with state, result, score and
attempt. The limit is a whole number from 1 to 200 and defaults to 50.

JSON shape: `{ claims: [{ claimId, link, state, stateLabel, statement, result?, truthScoreBps?, attempt? }] }`.

#### `ov extract (--url <url> | --text "<text>" | --file <path>)`

Extract up to three checkable claims from a page or a paragraph. Exactly one of
the three inputs is required. Text runs 40 to 20000 characters and a URL must
be `http:` or `https:` and at most 2048 characters.

JSON shape: `{ claims: [{ claim, reason, quote }], language, claim, sourceUrl, modelId, gonkaRequestId, gatewayRequestId }`.

Exit 2 when no checkable claim was found or the page could not be fetched, exit
5 when writes are disabled or you are rate limited.

#### `ov submit "<claim>" [--text "..."] [--url <https url>]... [--criteria "..."]`

Submit a claim to the jury. The statement is 5 to 1000 characters, the optional
context text up to 20000, up to five `https:` URLs, and criteria up to 2000
characters. The public rate limit is five submissions per minute.

A 200 means the jury is forming and prints the claim id and its link. A 202
means the weather was not clear and the submission is queued; it prints the
queue id, the weather block, and the note that queued items expire after six
hours. Both exit 0.

JSON shape: the response body plus `link` and `kind`, where `kind` is `"claim"`
or `"queued"`.

#### `ov queue <queueId or link>`

A queued submission: QUEUED, LAUNCHED with its claim, EXPIRED or CANCELLED,
plus the weather.

JSON shape: `{ queueId, status, statement, createdAt, expiresAt, weather }`,
plus `claimId` when it launched and `launchError` when a launch failed.

#### `ov status <claim id or link>`

One block: the statement, the state in plain words, seats committed and
revealed, the attempt, the next deadline and the result. A short hex prefix is
resolved through the board, and an ambiguous prefix exits 2 with the
candidates listed.

JSON shape: the full claim inspection, with `claimId`, `mode`, `state`,
`statement`, `resolutionCriteria`, `deadlines`, `committeeId`,
`evidenceRoots`, `commitments`, `rounds`, `attemptChain` and `result`, plus
`deliberation` and `debateConvergedAfterExchange` on a two-round claim.

#### `ov watch <id or link> [--for <duration>] [--since <sequence>] [--verbose]`

Follow a verification live, one dated line per step, until it ends or `--for`
runs out. The default is nine minutes, chosen because a Claude Code tool call
cannot exceed ten. `--since` resumes from a sequence number and `--verbose`
adds research tick lines.

It polls a queue every thirty seconds until it launches, then follows the
Server-Sent Events stream, with a sixty-second poll of the claim alongside to
catch a void or a give-up the stream does not carry. It reconnects up to five
times with backoff.

JSON output is NDJSON: one line per event, then a summary object with `kind`
(always `watch_summary`), `claimId`, `queueId`, `state`, `stateLabel`,
`lastSequence`, `exitCode`, `result`, `attemptChain` and `reason`.

Exit 0 when the claim finalized, 3 when the attempt voided with no relaunch
inside the window or the verification gave up, 4 when the window ran out first.
The last line tells you the sequence to resume from.

#### `ov audit <claim id or link> [--json <file>] [--out <file>] [--run <runId>] [--quiet] [--trace]`

Rebuild and check the whole public record of a verdict. Accepts a claim link, a
report link, a run link, a queue link, a bare `0x` id or a hex prefix.

- `--json <file>` writes the JSON dump to that path.
- `--out <file>` writes the Markdown dossier, defaulting to
  `.audit/<claimId>.md`.
- `--run <runId>` narrows to one juror run.
- `--quiet` prints only the verdict card to stdout while the full dossier still
  goes to the output file.
- `--trace` appends the research trail, with `--juror <n>`, `--round 1|2` and
  `--full`.

The dossier headings are fixed: verdict card, timeline, jury, votes and
commitments, juror runs, debate and round two on a two-round claim, truth
score, certificate on Sui, what this audit proves and what it does not, and
data.

The JSON document is version 1 with these top-level keys: `version`,
`generatedAt`, `target`, `status`, `claim`, `verdict`, `queue`, `jury`,
`votes`, `runs`, `claimChecks`, `timeline`, `timelineSource`, `debate`,
`score`, `certificate`, `urls`, `sources`, `summary` and `exitCode`. `status`
is one of FINALIZED, IN_PROGRESS, VOIDED, GAVE_UP, CANCELLED or QUEUED, and
`summary` counts passed, failed, unavailable and skipped checks by group.

#### `ov trace <claim id or link> [--juror <n>] [--round 1|2] [--full]`

The research trail: every juror's searches, opened pages, quotes, answer and
gateway receipt, turn by turn. `--full` adds the pinned system prompt once with
its hash, the claim JSON the juror received, every message verbatim including
page texts, and the raw completion.

JSON shape: `{ claimId, statement, jurors: [{ jurorIndex, modelId?, role?, rounds: [{ phase, runId, kind, vote?, missing?, turns[] }] }] }`.

Pointing it at a queued submission is an error: there is no jury yet.

### The sibling script

`pnpm audit:claim` runs the same auditor without the banner, and adds
`--list` for the board:

```bash
pnpm audit:claim <link|id> [--base <url>] [--json <file>] [--out <file>] [--run <runId>] [--quiet]
pnpm audit:claim --list [--base <url>] [--limit <n>] [--json <file>]
```

## Reading the result

Only a `FAIL` row is blocking. `UNAVAILABLE` means a public source did not
answer and carries a manual URL so you can check it by hand; `SKIPPED` means
the check does not apply to that run, which is normal for the research-only
checks on a table vote. The check ids themselves are explained on the
[trust model](trust-model) page.

If every reachable check passes, the record supports the certificate. If any
check fails, the public record does not fully support the certificate, and the
failing rows are the place to look.
