# Deliberation Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the claim page with a live Obsidian-style graph canvas of the whole deliberation (jurors, tool calls, verdicts, certificate), with sealed pulses pre-reveal, a replay mode for finished claims, juror avatars, and two interim UX fixes (live report page, faster submit).

**Architecture:** A pure graph-builder module turns the claim inspection, revealed run proofs and the resolution event log into nodes and edges with deterministic ids and timestamps; a d3-force React component renders it; the existing SSE stream drives live updates; a new content-free RESEARCH_TICK event gives sealed-phase activity; replay filters the same graph by time. The old page moves intact to `/claims/[id]/report`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, d3-force (new), motion (present), Tailwind + shadcn/ui, iconsax via `@/components/icons`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-deliberation-canvas-design.md` (read it first; it records the owner's decisions verbatim).

## Global Constraints

- NEVER use an em dash anywhere (comma, colon, parentheses or period instead); the middle dot `·` in labels is fine and already used.
- No Co-Authored-By lines. Conventional commit subjects.
- 2-space indent, double quotes, semicolons; icons ONLY from `@/components/icons` (iconsax); Tailwind utilities, no custom CSS files.
- Models never fetch and salts never leave the engine; RESEARCH_TICK payloads must stay content-free (`jurySeatId`, `kind`, `ordinal`, nothing else): never a query, url, hash or text.
- Pre-reveal redaction is sacred: the canvas may never receive research content before the seat's reveal.
- `lib/engine/contract.ts` is the engine seam: additive changes only.
- Every task: `pnpm typecheck && pnpm lint && pnpm vitest run <touched dirs>` before its commit; the full `pnpm test && pnpm build` gate runs at the end of each wave. Never deploy while a claim is live.

---

### Task 1 (interim): live claim report page

**Files:**
- Modify: `app/claims/[id]/page.tsx` (today's report page; Task 6 later moves this file to `app/claims/[id]/report/page.tsx`, so keep the change self-contained inside the component)

**Interfaces:**
- Consumes: `useClaimEvents(claimId)` from `components/use-claim-events.ts` returning `{ events, status, isDelayed, lastEventId, error, reconnect }`.
- Produces: nothing new; behavioural change only.

- [x] **Step 1:** In the page component, call `const { events } = useClaimEvents(id);` next to the existing state hooks (before any early return).
- [x] **Step 2:** Add a debounced refetch effect:

```tsx
// Live: any new engine event refetches the inspection (debounced), so the
// page follows the claim without the Refresh button.
const eventCount = events.length;
useEffect(() => {
  if (eventCount === 0) return;
  const timer = setTimeout(() => {
    void loadData();
  }, 800);
  return () => clearTimeout(timer);
}, [eventCount, loadData]);
```

`loadData` already exists (useCallback). Ensure `loadData` does not flip the whole page into its loading skeleton on refetch: change `setLoading(true)` inside `loadData` to only apply when `claim === null` (first load).
- [x] **Step 3:** `pnpm typecheck && pnpm lint` pass.
- [x] **Step 4:** Manual check in `pnpm dev` with a finished claim: page renders, no loop of refetches (network tab quiet after one refetch), Refresh button still works.
- [x] **Step 5:** Commit `feat(ui): claim page follows the live event stream`.

### Task 2 (interim): faster submit

**Files:**
- Modify: `lib/engine/engine.ts` (factCheckStart / createClaimRecord upload section)
- Modify: `app/fact-check/page.tsx` (button copy)

**Interfaces:** unchanged public API.

- [x] **Step 1:** In the claim creation path, find the two sequential Walrus uploads (statement, criteria) that run before the create_claim transaction and run them concurrently with `Promise.all`. The blob ids still land in the same fields; nothing else moves.
- [x] **Step 2:** `pnpm vitest run lib/engine` passes (lifecycle tests cover creation).
- [x] **Step 3:** In the form, while submitting show "Freezing your statement to Walrus (about 20 s)..." instead of plain "Submitting...".
- [x] **Step 4:** `pnpm typecheck && pnpm lint`; commit `perf(engine): parallel Walrus writes at claim creation, honest submit copy`.

### Task 3: RESEARCH_TICK events

**Files:**
- Modify: `lib/research/loop.ts`
- Modify: `lib/engine/engine.ts` (juryRun research invocation)
- Test: `lib/engine/engine.test.ts` (extend) and `lib/research/loop.test.ts` (extend)

**Interfaces:**
- Produces: `runResearchLoop` deps gain `onStep?: (info: { kind: "search" | "open"; ordinal: number }) => void` (optional, fire-and-forget, called once per recorded transcript step at the moment it is pushed; ordinal is the step index starting at 0).
- Produces: engine emits `ResolutionEvent` with `kind: "RESEARCH_TICK"`, `source: "ENGINE"`, `visibility: "PUBLIC_NOW"`, `payload: { jurySeatId, kind, ordinal }` through the same event-append path the engine already uses for its other engine-sourced events (locate the helper that stores events with sequence numbers in `lib/events` / repository and reuse it exactly; do not invent a second path).

- [x] **Step 1:** Write the failing loop test: with a fake provider run, `onStep` receives one call per transcript step, ordinals 0..n-1, kinds matching the steps, and the info object has exactly the two keys.
- [x] **Step 2:** Implement `onStep` in `lib/research/loop.ts` at the single `steps.push(...)` site (wrap in try/catch so a throwing callback never affects the run).
- [x] **Step 3:** Write the failing engine test: a fake-jury run produces RESEARCH_TICK events, `visibility === "PUBLIC_NOW"`, and `Object.keys(payload).sort()` equals `["jurySeatId","kind","ordinal"].sort()`; no payload value contains a url or query string.
- [x] **Step 4:** Wire the callback in the engine's research invocation; emit per tick.
- [x] **Step 5:** `pnpm vitest run lib/research lib/engine lib/events` green; commit `feat(engine): content-free RESEARCH_TICK events for the sealed phase`.

### Task 4: graph model

**Files:**
- Create: `lib/viz/deliberation-graph.ts`
- Test: `lib/viz/deliberation-graph.test.ts`

**Interfaces (verbatim, later tasks depend on these names):**

```ts
export type GraphNodeKind =
  | "claim" | "juror" | "sealedAction" | "search" | "page"
  | "verdict" | "failure" | "certificate";
export type JurorFamily = "deepseek" | "kimi" | "minimax" | "unknown";
export type GraphNode = {
  id: string;                    // deterministic, see id scheme below
  kind: GraphNodeKind;
  label: string;                 // short human text drawn on the canvas
  atMs: number;                  // when it became true (drives replay)
  seatId?: string;
  runId?: string;
  family?: JurorFamily;
  state?: "researching" | "sealed" | "revealed" | "failed";
  intent?: "support" | "challenge";
  outcome?: "YES" | "NO" | "UNSURE";
  confidenceBps?: number;
  url?: string;
  stepIndex?: number;
  detail?: Record<string, unknown>;  // inspector payload (citations, hashes, failure record)
};
export type GraphEdge = { id: string; from: string; to: string;
  kind: "seat" | "action" | "result" | "citation" | "verdict" | "settle" };
export type DeliberationGraph = { nodes: GraphNode[]; edges: GraphEdge[] };
export function buildDeliberationGraph(input: {
  claim: ClaimInspection;
  proofs?: Array<{ runId: string; jurySeatId: string; transcript?: unknown; output?: unknown; revealed: boolean }>;
  events?: ResolutionEvent[];
  nowMs: number;
}): DeliberationGraph;
export function familyOfModelId(modelId: string | undefined): JurorFamily; // "deepseek-ai/..." -> "deepseek", "moonshotai/..." -> "kimi", "MiniMaxAI/..." -> "minimax"
```

Id scheme: `claim`, `seat:<jurySeatId>`, `tick:<jurySeatId>:<ordinal>` (sealedAction), `step:<runId>:<index>` (search/page), `verdict:<runId>`, `failure:<jurySeatId>`, `certificate`. A sealedAction and the revealed step with the same seat and ordinal share `atMs` so the bloom replaces in place. Edges follow the recorded sequence (spec section 1). `atMs` sources: event `occurredAt` when available, else claim deadlines interpolation for pre-tick claims (research steps spread evenly between evidence cutoff and the first commit event).

- [x] **Step 1:** Write failing tests first, minimum set: builds claim+5 jurors from a bare inspection; a revealed proof yields search/page/verdict nodes with citation edges; a `failureStatus` seat yields a failure node; RESEARCH_TICK events yield sealedAction nodes that disappear when the same seat has revealed steps; deterministic ids (two calls deep-equal); every node has finite `atMs`; pre-tick claim interpolation is monotonic. Build fixtures inline (small literal ClaimInspection and transcript objects; copy realistic field shapes from `lib/engine/contract.ts` and an actual proof JSON in `node_modules/.cache/proof-387a344b-1.json` if present).
- [x] **Step 2:** Implement until green. Pure module: no React, no fetch, no Date.now (take `nowMs`).
- [x] **Step 3:** `pnpm vitest run lib/viz` green; typecheck; commit `feat(viz): deliberation graph model`.

### Task 5: canvas renderer

**Files:**
- Create: `components/viz/deliberation-canvas.tsx` (client)
- Create: `components/viz/use-force-layout.ts` (client hook wrapping d3-force)
- Modify: `package.json` (`pnpm add d3-force @types/d3-force`)

**Interfaces:**
- Consumes: `DeliberationGraph`, `GraphNode` from Task 4.
- Produces: `<DeliberationCanvas graph={g} selectedId={id|null} onSelect={(node: GraphNode | null) => void} avatars={Record<JurorFamily, string[]>} reducedMotion?: boolean />`.

Behaviour: claim node pinned centre; jurors on a radial ring (forceRadial), per-juror action nodes linked (forceLink distance 40, forceManyBody -80, forceCollide by radius); simulation ticks write positions into refs and a single `requestAnimationFrame` loop paints an absolutely positioned div layer (no SVG performance cliff at this size; divs keep Tailwind styling and avatar `<img>` simple). Pan and zoom with pointer events + wheel on a transform wrapper (scale 0.4 to 2.5). Hover sets a highlighted subtree (walk edges from the hovered juror); click calls `onSelect`. Dark stage: `bg-[#04122b]` with the family colours (deepseek `#0e76ff` range, kimi warm gold, minimax coral) as node accents; sealedAction nodes grey with a `Lock` icon; failure node `text-no` pulse; verdict nodes show outcome and confidence; certificate node `ShieldTick`. `prefers-reduced-motion` disables the entry/bloom animations (respect the passed `reducedMotion`).

- [x] **Step 1:** `pnpm add d3-force && pnpm add -D @types/d3-force`.
- [x] **Step 2:** Build `use-force-layout.ts`: input nodes/edges, output `Map<string, {x,y}>` updated per simulation tick; unit test with a 3-node graph asserting positions stabilise (run `simulation.tick()` 300 times synchronously in the test, no RAF).
- [x] **Step 3:** Build the component; storyless smoke test: render with a small graph in vitest jsdom asserting node labels appear.
- [x] **Step 4:** typecheck, lint, `pnpm vitest run components lib/viz`; commit `feat(viz): force-layout deliberation canvas`.

### Task 6: page restructure

**Files:**
- Create: `app/claims/[id]/report/page.tsx` (move of the current `app/claims/[id]/page.tsx`, content unchanged except its back link points to the canvas)
- Rewrite: `app/claims/[id]/page.tsx` (the canvas page)
- Create: `components/claim/canvas-sidebars.tsx` (left info rail + right node inspector)
- Modify: `app/claims/[id]/observe/page.tsx` (replace body with `redirect` to `/claims/[id]`)
- Modify: `app/claims/layout.tsx` (title stays "Claims")

**Interfaces:**
- Consumes: Task 4 builder, Task 5 canvas, `useClaimEvents`, existing fetchers (`/api/claims/[id]?verify=1`, `/api/claims/[id]/report`, `/api/claims/[id]/runs/[runId]/proof`), existing run-proof components for the inspector (`components/claim/run-proof*.tsx`), `StateBadge`, `useNow`.
- Produces: the canvas claim page.

Page behaviour: fetch inspection (+ events via SSE, refetch debounced as in Task 1); after reveal fetch each revealed seat's proof once (`Promise.all`, cache in state); `buildDeliberationGraph({claim, proofs, events, nowMs})` memoised; left rail shows statement, `StateBadge` (+stranded), countdown to the next deadline (from `useNow`), sealed x/5 and revealed x/5, Truth Score and certificate + "Full report" link (`/claims/[id]/report`); right inspector renders the selected node: juror or verdict node reuses the run-proof components (hash checks, Seal, re-run), search/page nodes show query, intent, url, hash, Walrus link from `detail`; failure shows the failure record. Mobile (`lg:` breakpoints): rails become sheets toggled by two floating buttons.

- [x] **Step 1:** `git mv "app/claims/[id]/page.tsx" "app/claims/[id]/report/page.tsx"`, then fix the moved file's back link and title ("Full report").
- [x] **Step 2:** Write the new canvas page and sidebars.
- [x] **Step 3:** Observe page becomes a server component calling `redirect(\`/claims/${id}\`)` from `next/navigation`.
- [x] **Step 4:** typecheck, lint, `pnpm vitest run`, `pnpm build`; manual dev pass on claims `0x21aa5a7bdd80…` (finalized with a failed seat), `0xbdab0011…` (Seal) and an old pre-research claim.
- [x] **Step 5:** Commit `feat(ui): the claim page is the deliberation canvas; report moves to /report`.

### Task 7: replay

**Files:**
- Create: `components/viz/use-replay.ts`
- Modify: `app/claims/[id]/page.tsx` (mount the control)
- Test: `components/viz/use-replay.test.ts`

**Interfaces:**
- Produces: `useReplay(graph: DeliberationGraph, terminal: boolean)` returning `{ active, t, playing, speed, start, stop, toggle, seek, setSpeed, visible }` where `visible` is the graph filtered to `atMs <= t`; speeds 1, 10 (default), 60; `t` runs from `min(atMs)` to `max(atMs)` on a RAF clock times speed.

- [x] **Step 1:** Failing hook test (vitest fake timers): construct a 5-node graph spanning 10 minutes, start replay at speed 60, assert `visible.nodes` grows in `atMs` order and completes.
- [x] **Step 2:** Implement; wire a play/scrub bar into the left rail (shadcn `Slider`, `Play`/`Pause` iconsax icons), shown only when `terminal`.
- [x] **Step 3:** Suites green; commit `feat(viz): replay a finished deliberation end to end`.

### Task 8: avatars

**Files:**
- Create: `public/media/agents/<whale-1..3|moon-1..2|spark-1..2>.png` (from the approved generated set, downscaled to 256x256)
- Create: `components/agents/avatar.tsx` (`<JurorAvatar family={f} ordinal={n} size={px} />`, circle-masked `next/image`, geometric coloured-disc fallback when the asset is missing)
- Modify: `components/viz/deliberation-canvas.tsx` (juror nodes wear the avatar)
- Modify: `app/agents/[id]/page.tsx` and `components/agents/*` cards (show the avatar)

Mapping: `familyOfModelId` (Task 4) picks the family; ordinal = the agent's index within its family sorted by profile id, mod the asset count.

- [x] Steps: downscale with `sips -Z 256`, add component + usages, typecheck, lint, visual dev pass, commit `feat(ui): juror avatars`.

### Task 9: docs and ship

- [x] README canvas paragraph + screenshot note, `docs/STATUS.md` dated bullet, `docs/demo/runbook.md` step 3 rewrite (watch the canvas, replay), spec/plan checkboxes ticked, PRD addendum item 17 (canvas, ticks, replay).
- [x] Full gate `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [x] Deploy between claims (worktree checkout, `railway up -s app -d`), verify: canvas on the three reference claims, sealed pulses on one fresh live claim, replay end to end, screenshots archived in the scratchpad.
- [x] Commit `docs: canvas shipped`, push.
