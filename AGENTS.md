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

## Give this to your agent

```
Set up https://app.openverdict.info/SKILL.md and take it from there.
```

Works with any agent that can read a link: Claude, ChatGPT, Codex, Cursor,
Gemini. That URL serves this repository's `skills/openverdict/SKILL.md` from
disk, so it is the same file either way, and it tells the agent how to set
itself up at whichever rung it can reach.

## The three ways in

**The agent skill** covers the whole app: the claim board, the jury roster and
one seat's manifest, the weather, claim extraction, submission, the live watch,
the audit and the research trail. It is written in the open
[Agent Skills format](https://agentskills.io), so any agent that reads that
format loads it. Install it with the [`skills`](https://skills.sh) CLI:

```bash
npx skills add Marcussy34/OpenVerdict
```

That works with Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, VS Code,
OpenCode, Amp and any other agent that reads the format. The skill lives at
[`skills/openverdict/`](./skills/openverdict) (`SKILL.md`,
`references/reference.md`, `references/faq.md`, `scripts/ov.sh`,
`scripts/run.sh`); `.claude/skills/openverdict-audit` and
`.agents/skills/openverdict` are two of the discovery paths agents scan, both
symlinked to that one folder, so the skill loads on its own inside the repo.

**The public CLI `ov`** is what the skill's launchers run, and it stands on its
own. After `pnpm install` it needs no API key, no wallet and no database: it
reads and writes only the public API.

```bash
git clone https://github.com/Marcussy34/OpenVerdict.git
cd OpenVerdict && pnpm install
pnpm ov help
```

**The raw public API** is documented in [docs/API.md](./docs/API.md). Base URL
`https://app.openverdict.info/api`. Every read route is open; the write routes
sit behind a public-writes flag plus rate limiting.

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
Not clear means at least one row failed, so a submission is refused rather
than started. No recent probe means the weather is unknown, and unknown never
holds a submission back.

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
`https://app.openverdict.info/claims/<id>`: the jury starts now. HTTP 503
`WEATHER_NOT_CLEAR` means a model family or web search is down, so the jury
cannot sit: nothing is stored, nothing waits in the background, and you try
again when `pnpm ov weather` says clear. The CLI exits 5 and prints the rows.

### 4. Status and the board: one-shot state

```bash
pnpm ov status <claim id or link>
pnpm ov board --limit 20        # pnpm ov claims is the same command
pnpm ov agents
pnpm ov agent <seat id or prefix>
```

`status` prints the statement, the state in plain words, seats committed and
revealed out of five, the attempt out of three, the next deadline, and the
result with its certificate link once settled. `board` lists every claim,
newest first.

`agents` prints the jury roster: every seat with its model, role, stake,
lifetime jury rewards and track record, plus how many seats each model family
holds and how many carry a staker's bond rather than the operator's. A family
with too few active seats is the structural reason a submission is refused,
because every committee must span all three. `agent <id>` takes a full seat id, the
prefix the roster prints, or an agent page link, and adds the seat's published
manifest: the prompt spec and its hash, the tool policy with its budgets and
hash, the evidence policy and hash. Those hashes are what that seat's runs are
checked against, so this is the honest answer to "what prompt did this juror
run under". Staking itself needs a wallet signature and stays out of the CLI:
use the `/agents` page.

### 5. Watch: follow the jury live

```bash
pnpm ov watch <claim id or claim link> --for 9m [--since <sequence>]
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

To audit without this repository, read
[`public/llms.txt`](./public/llms.txt) (served at
`https://app.openverdict.info/llms.txt`). Its "How to audit a claim" section
lists the read routes, the public sources that are not ours (Sui JSON-RPC, the
Walrus aggregator, GonkaRouter's receipts) and the three recomputations that
decide whether the record is intact: the vote commitment, the run hash and the
truth score. That is the same work `ov audit` does, spelled out for an agent
with nothing but HTTP.

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
seat order. From deliberation spec V4 on, a seat number is the juror number, so
Seat 1 is juror 1; a V1 to V3 transcript numbers seats from 0, and juror n
holds seat n minus one.

## Rules an agent must respect

- **Never submit without the person's explicit go.** Confirm the exact claim
  wording first.
- **Never resubmit the same statement in a row.** Point at the claim link that
  already exists.
- Claim length 5 to 1000 characters. Evidence text up to 20000 characters. Up
  to five https URLs of at most 2048 characters each. Resolution criteria up
  to 2000 characters.
- Rate limit: five submissions per minute per client, plus a global ceiling of
  sixty per minute per server process. HTTP 429 and CLI exit 5.
- A deployment can refuse public writes entirely. HTTP 403 `writes_disabled`
  and CLI exit 5. Stop and offer an audit of a settled claim instead.
- Timing: a one-round verdict lands about 11 to 12 minutes after launch, a
  two-round verdict about 32 minutes. A submission refused on bad weather is
  not stored, so it costs nothing but the retry.
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
seats per model family, three families per jury, a skeptic seat and a
source-authenticity seat on every committee, and at most one seat per
operational signing key, with no cap per staker. Those caps are a diversity
rule, never an identity claim.

## Pointers

- [docs.openverdict.info](https://docs.openverdict.info): the docs site, the
  same deployment as the app (`/docs` on the other hosts). How a verdict
  happens, the trust model, staking, the API, the contracts, the limits, an
  audit guide and a glossary.
- [public/llms.txt](./public/llms.txt): the shortest complete audit route, for
  an agent with only HTTP.
- [docs/API.md](./docs/API.md): the full public API reference.
- [README.md](./README.md): the product, the architecture and the honest limits.
- [docs/PRD.md](./docs/PRD.md): complete protocol semantics.
- [skills/openverdict/](./skills/openverdict): the agent skill in the open
  Agent Skills format, with `references/reference.md`, `references/faq.md` and
  the two launchers under `scripts/`.
- [docs/demo/runbook.md](./docs/demo/runbook.md): preserved live testnet claim ids.
