# AGENTS.md

How an agent uses OpenVerdict. For how to develop the codebase, read
[README.md](./README.md) and [CLAUDE.md](./CLAUDE.md) instead.

## What OpenVerdict is

OpenVerdict is a decentralized adversarial AI jury protocol for factual
disputes: five juror seats drawn on-chain from three model families (DeepSeek,
Kimi, MiniMax, all served through GonkaRouter) research a claim independently,
cast commit-reveal secret ballots, and cross-examine each other when round one
deadlocks. Verdicts settle on Sui as immutable resolution certificates that
anyone can recompute from public data, and every page a juror opened, every
sealed and revealed run bundle and every evidence manifest lives on Walrus.
Production runs at https://app.openverdict.info on Sui testnet.

## The two ways in

**The public CLI `ov`** is the recommended path. After `pnpm install` it needs
no API key, no wallet and no database: it reads and writes only the public API.

```bash
pnpm install
pnpm ov help
```

**The raw public API** is documented in [docs/API.md](./docs/API.md). Base URL
`https://app.openverdict.info/api`. Every read route is open; the write routes
sit behind a public-writes flag plus rate limiting.

For Claude Code specifically, the skill in
[`.claude/skills/openverdict-audit/`](./.claude/skills/openverdict-audit)
wraps both. It loads on its own inside the repo, and `ln -s "$(pwd)/.claude/skills/openverdict-audit" ~/.claude/skills/openverdict-audit`
makes it available from any folder.

## The journey

Every command takes `--json` for machine output (one JSON document on stdout,
NDJSON for `watch`), `--base <url>` to point at another deployment, and
`--no-banner`. The banner goes to stderr, so `--json` stdout stays parseable.

### 1. Weather: is the jury available?

```bash
pnpm ov weather
```

One line per row (DeepSeek, MiniMax, Kimi, Web search), then `clear` or
`not clear`, then how old the probe is. Clear means the last probe is under
five minutes old and all four rows answered, so a submission launches at once.
Not clear means at least one row failed, so a submission is queued instead of
started. No recent probe means the weather is unknown, and unknown never holds
a submission back.

### 2. Extract: turn a page or a paragraph into a checkable claim

```bash
pnpm ov extract --url https://example.org/article
pnpm ov extract --text "<paragraph of 40 to 20000 characters>"
pnpm ov extract --file ./notes.txt
```

A GonkaRouter model returns up to three candidate claims in source order, each
with the reason it is check-worthy and the quote it came from, plus the
detected language and the model id. `no checkable claim found` means the
source held nothing falsifiable: ask the person for a statement instead.

### 3. Submit: start a verification

```bash
pnpm ov submit "The first Bitcoin halving happened in November 2012." \
  [--url <https url>]... [--text "<evidence text>"] [--criteria "<text>"]
```

Two outcomes. HTTP 200 returns a claim id and the link
`https://app.openverdict.info/claims/<id>`: the jury starts now. HTTP 202
returns a queue id and the link `/fact-check/queue/<id>`: the weather was not
clear, so the engine holds the submission and launches it on the first clear
probe. Queued launches are spaced ten minutes apart and a queued item expires
after six hours.

### 4. Status and queue: one-shot state

```bash
pnpm ov status <claim id or link>
pnpm ov queue <queueId>
pnpm ov board --limit 20
```

`status` prints the statement, the state in plain words, seats committed and
revealed out of five, the attempt out of three, the next deadline, and the
result with its certificate link once settled. `queue` prints QUEUED,
LAUNCHED (with the claim), EXPIRED or CANCELLED plus the current weather.
`board` lists every claim, newest first.

### 5. Watch: follow the jury live

```bash
pnpm ov watch <claim id, claim link or queue id> --for 9m [--since <sequence>]
```

One dated line per event, `HH:MM:SSZ  <what happened>  <detail>`. History
replays first, so the first call shows everything so far. Exit codes: 0 the
claim finalized, 3 the attempt voided or the verification gave up, 4 the watch
stopped before the end because `--for` ran out. On exit 4 read the last line
for `last sequence N` and call again with `--since N` so nothing prints twice.
Expect two calls for a one-round verdict and about four for a two-round one.

### 6. Audit: recompute the whole public record

```bash
pnpm ov audit <claim id or link> --quiet --json audit.json --out audit.md
```

Refetches the record from the public API, Sui JSON-RPC, the Walrus aggregator
and GonkaRouter's public receipts, then recomputes every vote commitment, run
hash and truth score and checks the certificate on Sui. A settled one-round
claim produces 110 checks (the reference claim
`0x273220b5...` audits 110 of 110). Exit 0 means every check passed or a
public source was unavailable, 1 means at least one check failed, 2 means the
input or a fetch failed. A source outage marks a check UNAVAILABLE with a
manual URL, never FAIL. `pnpm audit:claim` is the same auditor.

### 7. Trace: what each juror actually did

```bash
pnpm ov trace <claim id or link> [--juror N] [--round 1|2] [--full] [--json]
```

Per juror: its searches (the intent, the query and the results it saw), the
pages it opened, its answer with reasoning, findings and quotes, and the
GonkaRouter receipt line. `--full` adds the pinned system prompt once and
every message verbatim, page texts included. On a two-round claim the trail
also carries the debate turns and the table votes. A debate turn is a
conversation move: it answers a named seat's specific point, may put one
question to a named seat, and states its position last, and a dissenting seat
opens each exchange. Describe it that way, never as jurors taking turns in
seat order.

## Rules an agent must respect

- **Never submit without the person's explicit go.** Confirm the exact claim
  wording first.
- **Never resubmit the same statement in a row.** Point at the claim or queue
  link that already exists.
- Claim length 5 to 1000 characters. Evidence text up to 20000 characters. Up
  to five https URLs of at most 2048 characters each. Resolution criteria up
  to 2000 characters.
- Rate limit: five submissions per minute per client, plus a global ceiling of
  sixty per minute per server process. HTTP 429 and CLI exit 5.
- A deployment can refuse public writes entirely. HTTP 403 `writes_disabled`
  and CLI exit 5. Stop and offer an audit of a settled claim instead.
- Timing: a one-round verdict lands about 11 to 12 minutes after launch, a
  two-round verdict about 32 minutes. A queued submission adds an unknowable
  wait for clear weather plus the ten-minute launch spacing.
- `UNRESOLVED` is a real outcome, not an error. Either four or more jurors
  revealed UNSURE, or no four jurors matched after the debate and the table
  vote. The certificate still exists and the truth score still stands as the
  average final-round belief.
- A verification is all or nothing. Any juror failure at a binding step voids
  the whole attempt in public; the engine relaunches on clear weather up to
  three attempts and gives up after six hours.
- Report only what landed. Never predict a verdict from partial reveals.

## What is public and recomputable

The audit proves the record is unchanged and evidence-bound: every vote
commitment and run hash recomputes to what Sui holds, the evidence root was
frozen before any reveal, and the certificate carries the recomputed truth
score. It does not prove the claim is true, and it does not prove byte for
byte what the model received. GonkaRouter's public receipt corroborates the
model, the node and the timing of every recorded request; a gateway-signed
receipt is the disclosed gap. Also not verifiable from public data: the salt
or the sealed key before the reveal, anything inside GonkaRouter beyond the
receipt fields, the operator's database, and who the person or organisation
behind an account is.

## Staking on a seat

Anyone can stake on a juror seat with a minimum of 0.1 SUI, using a browser
wallet or a Google sign-in through Sui zkLogin (authentication only). Gas is
sponsored through Shinami, so a Google sign-in can stake with 0.1 SUI and
nothing else. The staker receives that seat's jury reward tickets, keeps the
bond locked while the seat is active, and gets it back 24 hours after
unstaking. Use the `/agents` page in the app, or `pnpm stake:seat` from the
terminal. A staker picks the model and nothing else: research is identical for
every seat, so the engine assigns the seat's debate role, taking the least
represented role among the active seats on that model. Any account may stake
on as many seats as it likes: this is staking economics. The committee draw stays diverse on its own terms, at most two
seats per model family, three families per jury, and at most one seat per
operational signing key, with no cap per staker. Those caps are a diversity
rule, never an identity claim.

## Pointers

- [docs/API.md](./docs/API.md): the full public API reference.
- [README.md](./README.md): the product, the architecture and the honest limits.
- [docs/PRD.md](./docs/PRD.md): complete protocol semantics.
- [.claude/skills/openverdict-audit/](./.claude/skills/openverdict-audit): the
  Claude Code skill, with `reference.md` and `faq.md`.
- [docs/demo/runbook.md](./docs/demo/runbook.md): preserved live testnet claim ids.
