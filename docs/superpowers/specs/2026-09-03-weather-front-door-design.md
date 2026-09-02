# Weather-aware front door: design

Date: 2026-09-03. Owner-approved direction ("make the live path survive bad
weather"). Status: approved for implementation.

## Problem

A verification needs all three GonkaRouter model families (DeepSeek, MiniMax,
Kimi). When one is shedding or timing out, a claim submitted now starts on
Sui, a seat fails, the attempt is voided and relaunched later. To a judge
trying the app that reads as broken, although it is the all-or-nothing rule
working. Attempts are capped at three, so launching into a known-bad window
also burns attempts for nothing.

## Goals

1. A live, public readout of the three families' health ("weather").
2. A submission never launches into a known-bad window: it queues and starts
   itself on the first clear probe. When nothing is known (no recent probe),
   behaviour is exactly today's: launch immediately.
3. A voided attempt reads as policy on the claim page: which juror failed and
   why, the all-or-nothing rule, the live weather, what happens next and when.

Out of scope: roster changes, ladder changes, per-claim decomposition, any
Move change.

## A. Weather record

Storage: table `gonka_weather`, one row per model id:
`model_id text primary key, ok boolean, latency_ms integer, status text,
probed_at timestamptz`. `status` is the HTTP status as text, or `TIMEOUT` or
`ERROR` (the adapter's `GonkaWeatherProbe.status`).

Engine (lib/engine/engine.ts):

- `weatherTick(): Promise<void>`: when the newest stored probe is older than
  `WEATHER_PROBE_INTERVAL_MS` (120 000) or missing, call
  `gonka.probeModels(manifest.gonka.models, RELAUNCH_PROBE_TIMEOUT_MS)`, save
  one row per model, and set `#weatherProbeCache` so `relaunchTick` reuses it.
- `weather(): Promise<WeatherReport>` reads the rows. Shape (contract.ts):
  `{ probedAtMs: number | null; stale: boolean; clear: boolean;
     families: Array<{ modelId: string; family: "deepseek" | "minimax" | "kimi";
     ok: boolean; latencyMs: number; status: string }> }`.
  `stale` is true when there is no row or the newest is older than
  `WEATHER_STALE_MS` (300 000). `clear` is true only when not stale and every
  family is ok. Family is derived from the model id (lower-cased substring
  match: deepseek, minimax, kimi; anything else keeps the model id as label).
- `relaunchTick` keeps its own cache logic; `weatherTick` simply fills the same
  cache so a fresh probe is never repeated within the interval.

Worker (workers/resolution-worker.ts): each tick calls `engine.weatherTick()`
first (cheap when fresh), then the existing claim loop, then `relaunchTick`,
then `queueTick`. A probe failure is logged and never blocks the tick.

API: `GET /api/weather` returns `WeatherReport` (public, no auth, cache
headers `no-store`).

## B. Queue

Storage: table `fact_check_queue`:
`queue_id text primary key, status text (QUEUED | LAUNCHED | EXPIRED |
CANCELLED), request jsonb (the FactCheckRequest as submitted),
hold_reason text (WEATHER), launch_error text null, launched_claim_id text
null, created_at, updated_at, expires_at timestamptz`.
Queue ids are `0x` + 32 random bytes in hex.

Engine:

- `factCheckSubmit(req): Promise<FactCheckSubmission>` where
  `FactCheckSubmission = { kind: "claim"; claimId: string } |
  { kind: "queued"; queueId: string; weather: WeatherReport }`.
  Validation runs first (same errors as `factCheckStart`). Then: weather
  `clear` or `stale` means launch now through `factCheckStart` (today's
  behaviour). Otherwise insert a QUEUED row with `expires_at = now +
  QUEUE_TTL_MS` (6 h) and return it with the weather.
- `getQueuedFactCheck(queueId): Promise<QueuedFactCheck | undefined>` with
  shape `{ queueId; status; statement; createdAt; expiresAt; claimId?;
  launchError?; weather: WeatherReport }`.
- `queueTick(): Promise<void>`: expire QUEUED rows past `expires_at`
  (EXPIRED). If the weather is `clear` and at least `QUEUE_LAUNCH_SPACING_MS`
  (60 000) has passed since the last launch, launch the oldest QUEUED row via
  `factCheckStart`; on success mark LAUNCHED with the claim id; on an
  `EngineValidationError` mark CANCELLED with `launch_error`; on any other
  error record `launch_error` and leave it QUEUED for the next tick. One
  launch per tick at most.
- `listQueuedFactChecks(): Promise<QueuedFactCheck[]>` (QUEUED only, oldest
  first) for the dashboard and the CLI.

API:

- `POST /api/fact-checks` calls `factCheckSubmit`. Responses: `200 { claimId }`
  unchanged, or `202 { queued: true, queueId, weather }`. Validation and rate
  limiting are unchanged.
- `GET /api/fact-checks/queue/[id]` returns `QueuedFactCheck` or 404.

CLI (cli/src/index.ts): the fact-check start command prints the queue id and
the weather when the submission is queued.

## C. UI

- `components/weather/weather-strip.tsx`: three chips (family name, state,
  latency, and "probed 40 s ago"). State copy: `ok` and latency under 30 s is
  "healthy"; `ok` and slower is "slow"; not ok is "down"; stale report is
  "no recent probe". Polls `/api/weather` every 30 s. Prop `compact` for the
  claim page. One-line legend: "A jury needs all three model families."
- Fact-check page: the strip under the input. Copy under it: "If one family is
  down, your claim queues and starts on the first clear probe." The shared
  submission hook handles `202`: navigate to `/fact-check/queue/[queueId]`.
- Queue page `app/fact-check/queue/[id]/page.tsx`: the statement, the heading
  "Queued", the sentence "A jury needs all three model families. Yours starts
  on the first clear probe.", the live strip, "queued at" and "expires at",
  polling every 10 s; when `claimId` appears, navigate to `/claims/[claimId]`;
  EXPIRED shows "The families did not all answer within six hours. Submit
  again." with a link; CANCELLED shows the launch error.
- Claim page voided panel: line one keeps the failure sentence, now with the
  attempt count ("Attempt 1 of 3 voided: Seat 3 (MiniMax) failed: ...").
  Line two: "All-or-nothing: no partial verdict is ever finalized. The engine
  relaunches automatically once all three families answer." Then the compact
  strip and, for VOIDED, "gives up at HH:MM" computed as void time plus six
  hours; for GAVE_UP the reason sentence as today.

## Edge cases

- No recent probe (worker down): submissions launch immediately and the strip
  says "no recent probe". Nothing is ever held on unknown weather.
- Weather turns bad after launch: the existing void and relaunch policy.
- A cleared sky with many queued claims: one launch per minute.
- Queue ids are unguessable; the stored request is the same public text the
  claim would carry; nothing private is stored.

## Testing

- Engine (vitest, fake adapter with `setWeather`): weatherTick stores rows and
  fills the cache; weather() clear, not clear, stale; factCheckSubmit queues
  when not clear and launches when clear or stale; queueTick launches the
  oldest, respects spacing, expires after TTL, cancels on validation errors,
  keeps the row on transient errors; relaunchTick does not probe again within
  the interval after weatherTick.
- Repository (pglite): both tables round-trip.
- Worker: the resolution worker tick calls weatherTick, relaunchTick and
  queueTick (stubbed engine).
- API: route handler tests where the existing pattern has them.
- UI: typecheck and lint; manual check on the deployed app.

## Rollout

Migration runs at boot (CREATE TABLE IF NOT EXISTS). Deploy at a clean window
(no ACTIVE attempt). Verify `/api/weather`, submit a claim during bad weather
and watch it queue and self-launch. The external sentry stays for canaries.
