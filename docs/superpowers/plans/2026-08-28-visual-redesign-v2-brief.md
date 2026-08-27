# OpenVerdict visual redesign v2 — "Agentic Resolution" (2026-08-28)

Owner: Opus design agent (xhigh effort). Orchestrator: Fable session.
The v1 redesign (light + Sui blue, docs/superpowers/plans/2026-08-27 brief)
shipped but the user wants a bolder, more VISUAL identity. This brief
supersedes v1's aesthetic section; v1's file-scope and data rules stand.

## The story the site must tell

**Agentic Resolution**: autonomous agents, distributed around the world,
gather truthful evidence in a swarm — they debate, cross-check and
challenge each other's findings until verified evidence converges into a
final on-chain verdict. The site should FEEL like watching that swarm work.

## Hero vision (the centerpiece — invest most effort here)

- An animated **Earth globe** with agent nodes placed around it and
  **interlinking arcs** between them — evidence and messages visibly
  traveling as pulses along the arcs. Think "global verification network,
  alive right now."
- Choreograph a loop: a claim appears somewhere on the globe → agents
  light up and interlink → evidence pulses converge → a verdict seal
  stamps. Subtle, continuous, not a video — real rendered motion.
- Implementation options (agent's choice): `cobe` (lightweight WebGL globe,
  the pattern MagicUI's Globe uses), or `three` + `@react-three/fiber` +
  `@react-three/drei` for a richer 3D scene. GSAP or `motion` (installed)
  for scroll/entrance choreography. 3D depth, parallax and micro-animations
  are welcome across the page, not just the hero.
- The globe section may sit on a deep/dark canvas if that makes it shine —
  as a CONTAINED band inside the otherwise light identity. Product pages
  (claims, report, observer, agents…) keep the light + Sui-blue system from
  v1. One cohesive site, no half-migrations.

## Reference libraries & galleries (study these before designing)

The `firecrawl` CLI is installed and authenticated — scrape what you need
into `.firecrawl/` (e.g. `firecrawl scrape <url> -o .firecrawl/x.md`,
`firecrawl search "..."`). References the user picked:

- https://ui.shadcn.com/ (base system — already in the repo)
- https://magicui.design/ (globe, marquees, animated beams/lists — adapt
  MIT patterns into components/viz)
- https://www.heroui.com/ · https://daisyui.com/components/ (pattern ideas
  only — do NOT install these frameworks; reimplement in tailwind/shadcn)
- https://animate-ui.com/docs · https://reactbits.dev · https://www.aura.build/browse/components
  · 21st.dev · Kokonut UI · BKLIT UI (component/motion patterns)
- https://www.landingfolio.com/inspiration/landing-page · https://mobbin.com/
  (layout inspiration)
- https://gsap.com/ · https://motion.dev (motion tooling — both allowed)
- https://useanimations.com/ (micro-animation feel; icons stay iconsax)

Allowed `pnpm add`: cobe, three, @react-three/fiber, @react-three/drei,
gsap, @number-flow/react or similar SMALL visual libs. Not allowed: wholesale
UI frameworks (heroui/daisyui/chakra), icon-set swaps (iconsax remains the
app icon system; lucide is inspiration only).

## What must survive untouched (from v1 rules)

- File scope: only `app/**` pages/layout (NOT `app/api/**`),
  `components/**` presentational, `app/globals.css`, package.json via pnpm.
  NEVER touch `lib/**`, `app/api/**`, `move/**`, `scripts/**`, `cli/**`,
  `workers/**`, `components/use-claim-events.ts`,
  `components/wallet/providers.tsx`.
- The NEW compact Google-only sign-in modal and its Enoki feature-guard
  logic (components/wallet/connect-button.tsx) — restyle shells only.
- The tightened landing copy (2026-08-28) — do NOT reinflate wording; add
  meaning through visuals, not words.
- Every displayed data field, all 14 routes, read-only guarantees, honest
  framings ("authentication, not proof of personhood"; UNSURE as honest).
- prefers-reduced-motion: every animation must collapse gracefully.
  Performance budget: the globe must not wreck low-end laptops — lazy-mount
  it, pause when offscreen, cap device pixel ratio.

## Working setup

- A production stack already serves http://localhost:3000 (user is testing
  on it) — DO NOT kill or rebuild it.
- Run YOUR OWN dev server for iteration:
  `SUI_OPERATOR_SECRET_KEY=suiprivkey1qp82fu0kevmkg6j4lcm30rdtmvylpyyt82as9mzctlzs336n27r2g5zzuaq OPENVERDICT_AGENT_SEED=cockpit-demo-fixed-seed OPENVERDICT_RELEASE_MANIFEST=/Users/marcus/Projects/OpenVerdict/.localnet/release.runtime.json DATABASE_URL=postgres://openverdict:openverdict-dev-only@127.0.0.1:5432/openverdict OPENVERDICT_PUBLIC_WRITES=enabled PORT=3001 pnpm dev`
  (Postgres is multi-process-safe; localnet chain is running.)
- Verify visually with the chrome-devtools MCP tools (load via ToolSearch),
  on your own page against http://localhost:3001 — never touch other tabs,
  close yours when done. Iterate screenshot → judge → refine.
- Gates before reporting: `pnpm typecheck`, `pnpm lint`, `pnpm build` all
  green. Do NOT git commit — the orchestrator reviews and commits.

## Deliverable report

Aesthetic decisions, packages added, files created/modified, how the globe
was built (lib, data model for nodes/arcs, animation loop), performance
notes, pages visually verified, anything intentionally left.
