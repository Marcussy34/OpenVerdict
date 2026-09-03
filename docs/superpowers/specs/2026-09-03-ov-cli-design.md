# `ov`: the public OpenVerdict CLI (design, 2026-09-03)

Owner approved in chat: "okay let's do it. make sure when the cli runs also it
has that cool openverdict name + logo in ASCII". Companion to
2026-09-03-audit-skill-design.md. Goal: an agent (or a person) can drive the
whole journey from a terminal: check the weather, extract claims from a page,
submit a claim, watch the jury live, audit the verdict. The web console stays
the visual monitor. Public API only, no keys, no database.

## Entry points

- `pnpm ov <command> ...` (package.json script `ov`: `tsx scripts/ov.ts`).
- `.claude/skills/openverdict-audit/ov.sh <command> ...`: same launcher style
  as run.sh (physical dir via `pwd -P`, repo three levels up, starts
  `node node_modules/tsx/dist/cli.mjs scripts/ov.ts` from the repo root).
- Library in `lib/ov/` (fetch-injected, testable): `api.ts` (public API
  client), `banner.ts`, `commands/*.ts` or one `commands.ts`, `render.ts`,
  `watch.ts` (the event follower state machine).

## Banner

Printed to stderr at the start of every command (never to stdout, so `--json`
output stays parseable), skipped with `--no-banner` or when `OV_NO_BANNER=1`.
Colour only when stderr is a TTY or FORCE_COLOR is set; `--no-color` turns
it off. Shape (about 8 lines): a figlet-style "OpenVerdict" wordmark next to
a small ASCII mark (a shield with a check, echoing the verify page icon),
then one tagline line "adversarial AI jury protocol  |  jurors on Gonka,
settled on Sui, evidence on Walrus" and one context line with the base host
and the command. ASCII only (no box-drawing that breaks in plain terminals),
no em dash character anywhere. `ov` with no command prints the banner and
the help.

## Global options

`--base <url>` (default https://app.openverdict.info), `--json` (machine
output on stdout, one JSON document, no prose), `--no-banner`, `--no-color`,
`--timeout <duration>` where relevant (durations accept `30s`, `9m`, `1h`).
Exit codes: 0 success, 2 input or request error (one `error: ...` line on
stderr), 3 the claim voided or gave up (watch), 4 watch stopped before the
end (timeout or budget), 5 rate limited or writes disabled (submit, extract).

## Commands

### `ov weather`
GET {base}/api/weather. Human output: one line per family (DeepSeek,
MiniMax, Kimi, Web search): ok with latency, or the status (429, TIMEOUT,
402 ...), then "clear" or "not clear" and "probed N s ago" (or "no recent
probe" when stale). Explain in one line what not clear means: submissions
queue until all four answer.

### `ov board [--limit n]`
GET {base}/api/claims. Reuse `listBoard` and `renderBoard` from
lib/audit/audit-claim.ts (already implemented).

### `ov extract (--url <url> | --text "<text>" | --file <path>)`
POST {base}/api/extract-claim with `{url}` or `{text}` (text 40 to 20000
characters). Response: `{claims: [{claim, reason, quote}], language,
claim, sourceUrl?, modelId, gonkaRequestId?, gatewayRequestId?}`.
Human output: numbered candidates with the reason and the quote, the
language, the model that extracted them, and the next step
(`ov submit "<claim>"`). Errors: 400 INVALID_URL / validation (print the
message), 404 or NO_CLAIM_FOUND style bodies (print "no checkable claim
found"), 403 writes_disabled and 429 (exit 5 with the message).

### `ov submit "<claim>" [--text "<evidence text>"] [--url <https url>]... [--criteria "<text>"]`
POST {base}/api/fact-checks with `{claim, text?, urls?, resolutionCriteria?}`
(claim 5 to 1000 characters, text up to 20000, up to 5 https urls).
200 `{claimId}`: print the claim id, the link {base}/claims/<id>, and
"watch it: ov watch <id>". 202 `{queued: true, queueId, weather}`: print
the queue id, the link {base}/fact-check/queue/<id>, the weather lines, and
"the engine launches it when all four answer; queued items expire after
six hours; watch it: ov watch <queueId>". 400 validation: the message.
403 writes_disabled / 429: exit 5. With `--json` print the response body
plus `link` and `kind` ("claim" | "queued").

### `ov queue <queueId>`
GET {base}/api/fact-checks/queue/<id>: status QUEUED / LAUNCHED (with
claimId and link) / EXPIRED / CANCELLED, statement, created, expires,
weather, launchError when present.

### `ov status <claim id or link>`
GET {base}/api/claims/<id>. One block: statement, state label in plain
words (jury forming, round one research and sealed votes, reveal,
discussion, round two commit, round two reveal, finalized, unresolved),
seats committed / revealed (n of 5), attempt n of 3 and status, the next
deadline relative ("reveal window opens in 3 min" / "passed"), result and
score and certificate link when settled, relaunch link when voided.

### `ov watch <claim id, claim link, or queue id> [--for <duration>] [--since <sequence>]`
Follow a verification live and print each step as one dated line, until
it ends. Details:
- Queue id: poll `GET /api/fact-checks/queue/<id>` every 30 s, printing
  the weather changes; when LAUNCHED, continue with the claim.
- Claim: open `GET /api/claims/<id>/events` (SSE, `data: {json}` lines
  with `sequence`, `kind`, `occurredAt`, `payload`, sometimes
  `transactionDigest`). The stream replays history first: print history
  compactly (one line per event, same format) unless `--since <seq>` is
  given, in which case only events with a larger sequence are printed.
- Line format: `HH:MM:SSZ  <kind in words>  <detail>`. Kinds to render:
  claim_created ("claim created on Sui, package ..."), evidence_frozen
  ("evidence frozen, root 0x..., phase n"), committee_selected ("5 seats
  drawn: <models>" from /api/agents by profile id), run_approved ("juror
  n run approved, hash 0x..."), vote_committed ("juror n committed (k of
  5)"), phase_changed ("<from> to <to>"), vote_revealed ("juror n revealed
  <outcome> <bps> bps (k of 5)"), DELIBERATION_TURN ("debate turn k, seat
  n, <stance> <bps>: <first 100 chars>"), debate_converged ("debate
  converged after exchange n"), output_repaired ("juror n output repaired:
  <field>"), inference_completed / argument_published (skip or one short
  line), RESEARCH_TICK (skip unless `--verbose`), claim_finalized ("final:
  <result>, score X.XX, certificate 0x... <suiscan link>").
- In parallel, poll `GET /api/claims/<id>` every 60 s to catch a void
  (attemptChain.status VOIDED with void.reason, modelId, phase) or GAVE_UP,
  which the event stream may not carry; print "attempt n voided: <reason>
  (<model>, phase p); relaunch pending" and keep watching for
  `relaunchedAs`; when it appears, print the new claim link and follow
  that claim (new stream). GAVE_UP: print the reason and exit 3.
- Ends: claim_finalized -> print the final line and "audit it: ov audit
  <id>" and exit 0. Voided without relaunch after `--for` -> exit 3 with
  the void detail. `--for` reached (default 9m, because a Claude Code tool
  call cannot exceed ten minutes) -> print "still <state>; last sequence
  N; run again with --since N to continue" and exit 4. Stream dropped ->
  reconnect up to 5 times with backoff, replaying with `--since`.
- `--json`: one JSON line per event (NDJSON) plus a final summary object.

### `ov audit <claim id or link> [same flags as audit:claim]`
Delegates to lib/audit (auditClaim, renderMarkdown, renderVerdictCard,
renderJson) with the same flags and exit codes as `pnpm audit:claim`;
prints the banner first (stderr).

### `ov help [command]`
Usage with one example per command and the exit codes.

## Tests

vitest with a fake fetch per command (weather clear and not clear, board,
extract success and no-claim, submit 200 / 202 / 400 / 403 / 429, queue
statuses, status in three states, watch: history replay, --since, a void
followed by a relaunch, --for exit 4, finalized exit 0, queue -> claim
hand-off). Duration parsing. Banner text has no em dash and is ASCII only.
Keep `pnpm typecheck`, `pnpm lint`, `pnpm test` green.

## Skill

SKILL.md gains a second half: "Verify a new claim end to end" (extract when
the user gives a page or a paragraph, confirm the claim text with the user,
`ov weather`, `ov submit`, then `ov watch` in a loop of at most nine minutes
per call using `--since` until exit 0 or 3, narrating each step in plain
words as it lands, then `ov audit` and the usual presentation). Expected
durations: a one-round verdict about 11 to 12 minutes after launch, a
two-round verdict about 32 minutes; queued submissions wait for clear
weather (say so, offer `ov weather`). Never submit without the user's
explicit go; never submit the same claim twice in a row; rate limit is five
submissions per minute. Frame: the console at {base}/claims/<id> shows the
same events live for the audience.
