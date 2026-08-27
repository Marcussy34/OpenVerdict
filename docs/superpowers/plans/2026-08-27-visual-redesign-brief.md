# OpenVerdict visual redesign brief (2026-08-27)

Owner: Opus design agent (max effort). Orchestrator: Fable session.
User directive: "more visual is better than words" — the current UI is
functional but plain. Redesign it into something strikingly good-looking.

## Mission

A complete visual redesign of the OpenVerdict observer frontend — every
page — into a product-grade, demo-winning interface. Favor VISUALS over
prose: motion, data visualization, iconography, depth. Judges should feel
"this is a real product" within 3 seconds of the home page.

## Product in one paragraph

OpenVerdict is a decentralized fact-checking engine: 5-seat AI juries
(distinct GonkaRouter model families) run under cryptographic commit-reveal
on Sui; evidence is frozen into Merkle-rooted bundles on Walrus; verdicts
finalize on-chain with a deterministic Truth Score (bps) and an immutable
certificate. The frontend is a strict READ-ONLY observer of that machinery
plus a submit flow and zkLogin/wallet onboarding. Hackathon tracks: Gonka
"AI for Society" fact-checker + Sui "AI × Sui".

## Aesthetic direction (recommended, you may refine)

- "Verification control room": dark-first, near-black surfaces, high-contrast
  typographic hierarchy, one restrained accent (e.g. signal-green for
  verified/YES, amber for pending, red for NO/challenge), monospace for
  hashes/ids/scores. Subtle grid/scanline texture is welcome; no gradients
  soup, no glassmorphism clichés.
- Motion with purpose: phase transitions, sealed→revealed flips, live event
  stream entries sliding in, count-up truth score, pulsing "live" indicators.
  Respect `prefers-reduced-motion`.
- Data-first components: verdict gauge/dial for Truth Score, jury lane cards
  with model-family identity, commit-reveal seat states as visual seals,
  lifecycle timeline as a real stepper, evidence cards with hash chips.
- Light mode may remain supported but dark is the demo default. Keep the
  whole app consistent — no half-migrated pages.

## Hard constraints

- Stack: Next 16 App Router, React 19, Tailwind 4, shadcn/ui primitives.
  Read `node_modules/next/dist/docs/` if unsure about Next 16 conventions —
  training-data Next.js knowledge may be stale.
- Icons: `iconsax-react` ONLY in app code (already a dependency). Never
  lucide.
- You MAY `pnpm add` UI-layer packages (e.g. `motion` for framer-motion v12
  animations, `@number-flow/react` for count-ups). No heavy chart libs
  unless truly needed; prefer hand-rolled SVG for gauges.
- Tailwind utilities over custom CSS. `app/globals.css` design tokens /
  `@theme` / minimal `@keyframes` are allowed; no new .css files.
- Server components stay server components where possible; add "use client"
  only where interactivity/motion requires it.

## File scope

ALLOWED to modify/create:
- `app/**` page/layout/loading/error files (NOT `app/api/**`)
- `components/**` presentational components (create freely, e.g.
  `components/viz/*`)
- `app/globals.css`, `tailwind`/theme config, `package.json` via pnpm add

FORBIDDEN (parallel engine work + protocol safety — do not touch):
- `lib/**`, `app/api/**`, `move/**`, `scripts/**`, `cli/**`, `workers/**`
- `components/use-claim-events.ts` (hook logic; you may restyle consumers)
- `components/wallet/providers.tsx` (provider logic; restyle UI shells like
  connect buttons/menus elsewhere)
- `.env*`, deploy configs. Do NOT `git commit` — the orchestrator reviews
  and commits.

## Data & routes (dev server RUNNING at http://localhost:3000 with real localnet data)

- `/` home + submit form (POST via existing form wiring — keep semantics)
- `/fact-check` submit flow, `/claims` directory, `/agents` directory,
  `/agents/[id]`, `/status`, `/verify` independent verifier, `/learn`,
  `/risk`, `/privacy`, `/terms`, `/evidence/[id]`
- `/claims/[id]` full report — FINALIZED demo claim:
  `0x747ea3ae77bca76b8488f6d7f7b919ff27919631981af45ef4138fbd59be25ba`
  (Truth Score 8850 bps = 89/100, 5/5 revealed YES, certificate, timeline)
- `/claims/[id]/observe` live observer — SEALED demo claim:
  `0x0fed117b1c8cbf4b252200d99aecfeca425ac927f3860c7d3f8502f4fbe098eb`
  (phase 3/6 Sealed Commit, populated SSE event stream)
- Keep EVERY data field currently displayed (scores, seats, hashes, tx
  digests, deadlines, security-boundary copy, "read-only" framing). You may
  reorganize/rehouse them (tooltips, expanders, tabs) but never drop them.

## Known cosmetic bugs to fix while you're in there

- Juror lane header badges overlap at 1440px (`Runni#4` collision on
  `/claims/[id]/observe`).
- Juror lanes show "Awaiting jury execution" even when the claim has sealed
  commitments — derive lane state from the claim inspection API
  (`commitments[].committed/revealed`) and/or received events: sealed lanes
  should read as cryptographically SEALED (visual seal), revealed lanes show
  the vote. Read-only API reads are allowed; no new endpoints.

## Verification loop (mandatory)

1. `pnpm lint` must pass. (Repo-wide `pnpm typecheck` is currently RED on
   `lib/engine/contract.ts` from parallel engine work — NOT yours to fix;
   ensure YOUR files introduce no new type errors.)
2. Visually verify in the running dev server via the chrome-devtools MCP
   tools (load them via ToolSearch "select:mcp__chrome-devtools__new_page,
   mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__take_screenshot,
   mcp__chrome-devtools__close_page"). Create your OWN page with
   `isolatedContext: "design-agent"` and `background: true`; NEVER touch
   other browser tabs; close your page when done.
3. Iterate: screenshot → judge → refine, page by page. The Next dev overlay
   badge (bottom-left) must show zero issues on every page you finish.
4. Check both demo claims render perfectly with real data.

## Deliverable / report

Final message: aesthetic decisions taken, packages added, complete list of
files created/modified, bugs fixed, anything intentionally left, and which
pages you verified visually. Do not commit.
