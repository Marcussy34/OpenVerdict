# Weather-aware front door: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public weather readout of the three model families, a submission queue that launches on the first clear probe, and a voided-attempt panel that reads as policy.

**Architecture:** The resolution worker probes the three models every two minutes and stores the result (`gonka_weather`). Submissions go through `factCheckSubmit`: clear or unknown weather launches now, bad weather queues (`fact_check_queue`); `queueTick` launches queued claims one per minute on a clear probe. The UI reads `/api/weather` and the queue endpoint.

**Tech Stack:** TypeScript, drizzle (pglite in tests, Postgres in prod), Next.js App Router, vitest.

**Spec:** docs/superpowers/specs/2026-09-03-weather-front-door-design.md

## Global Constraints

- No em dash (U+2014) anywhere: code, comments, copy, docs. Use a comma, colon, parentheses or period. No double hyphen, no en dash.
- Surgical changes; match the surrounding style; short "why" comments.
- No change to prompt specs, manifests, the ladder, the roster or Move.
- Do not commit; the lead commits after review.

---

### Task 1 (Codex): engine, storage, worker, API, CLI

**Files:**
- Modify: `lib/storage/schema.ts`, `lib/storage/migrate.ts`, `lib/storage/types.ts`, `lib/storage/repository.ts` (+ repository test)
- Modify: `lib/engine/engine.ts`, `lib/engine/contract.ts` (types already added by the lead: `WeatherReport`, `WeatherFamily`, `FactCheckSubmission`, `QueuedFactCheck`, `QueuedFactCheckStatus`, and the `Engine` methods `weather`, `weatherTick`, `factCheckSubmit`, `getQueuedFactCheck`, `listQueuedFactChecks`, `queueTick`)
- Modify: `lib/engine/engine.test.ts`, `lib/gonka/fake.ts` (only if the fake needs a weather hook it lacks)
- Modify: `workers/resolution-worker.ts` (+ test), `app/api/fact-checks/route.ts`, `cli/src/index.ts` (+ test fake engine stubs), `lib/engine/server.ts` if the engine surface is re-exported there
- Create: `app/api/weather/route.ts`, `app/api/fact-checks/queue/[id]/route.ts`

**Produces:** the API contract in the spec (sections A and B), byte for byte.

- [ ] Storage: tables, migration (CREATE TABLE IF NOT EXISTS + index on `fact_check_queue(status, created_at)`), repository methods `saveGonkaWeather(rows)`, `listGonkaWeather()`, `saveFactCheckQueueItem`, `getFactCheckQueueItem`, `listFactCheckQueueItems(status)`; pglite round-trip tests.
- [ ] Engine: constants `WEATHER_PROBE_INTERVAL_MS = 120_000`, `WEATHER_STALE_MS = 300_000`, `QUEUE_TTL_MS = 6 * 60 * 60 * 1000`, `QUEUE_LAUNCH_SPACING_MS = 60_000`; `weatherTick`, `weather`, `factCheckSubmit`, `getQueuedFactCheck`, `listQueuedFactChecks`, `queueTick` per the spec; `relaunchTick` reuses the cache filled by `weatherTick`.
- [ ] Engine tests per the spec's Testing section (fake adapter `setWeather`).
- [ ] Worker: `weatherTick` first, `queueTick` after `relaunchTick`; failures logged, never blocking; worker test asserts the calls.
- [ ] API: `POST /api/fact-checks` returns 200 `{ claimId }` or 202 `{ queued: true, queueId, weather }`; `GET /api/weather`; `GET /api/fact-checks/queue/[id]` (404 when unknown); all responses `Cache-Control: no-store`.
- [ ] CLI: print queue id and weather when queued; test fake engine gains the new stubs.
- [ ] Gate: `npx tsc --noEmit -p .`, `npx vitest run`, `npm run lint`.

### Task 2 (Gemini): UI

**Files:**
- Create: `components/weather/weather-strip.tsx`, `app/fact-check/queue/[id]/page.tsx`
- Modify: `components/claim/use-claim-submission.ts`, `app/fact-check/page.tsx`, `app/claims/[id]/page.tsx`

**Consumes:** `WeatherReport` and `QueuedFactCheck` from `lib/engine/contract.ts`; `GET /api/weather`; `GET /api/fact-checks/queue/[id]`; `POST /api/fact-checks` 202 body `{ queued: true, queueId, weather }`.

- [ ] `WeatherStrip` per spec section C (three chips, legend, 30 s polling, `compact` prop, "no recent probe" when stale).
- [ ] Submission hook: on 202 navigate to `/fact-check/queue/[queueId]`.
- [ ] Fact-check page: strip under the input with the one-line copy.
- [ ] Queue page per spec (poll 10 s, redirect on claimId, EXPIRED and CANCELLED copy).
- [ ] Claim page voided panel: attempt count in line one, the policy line, compact strip, "gives up at HH:MM" for VOIDED.
- [ ] Gate: `npx tsc --noEmit -p .` (no errors in touched files), `npx eslint` on touched files.

### Task 3 (lead): review, gate, deploy, verify

- [ ] Review both diffs, run the full gate, commit, push.
- [ ] Deploy at a clean window; verify `/api/weather`; submit during bad weather and watch the queue page; update checkpoint and memory.
