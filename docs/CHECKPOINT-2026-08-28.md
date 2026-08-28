# Session checkpoint — 2026-08-28 late (pre-compaction #3, supersedes earlier)

> Resume map. Repo is the source of truth; this file is the index.
> Active work at compaction: iterating the landing scroll choreography with
> the user reviewing live on http://localhost:3000. Next tracks: more UI
> review nits, the user's full human E2E test, demo recording + submission
> (T9), Railway builder flip. Companions: docs/STATUS.md, docs/demo/*, plan
> ledger, design briefs v1/v2/v3.

## Product state (all pushed, tip 3edfad7)

- **Verdict pipeline PROVEN end-to-end worker-driven** (the big one): claim
  `0x8661bf53…db84` submitted via public API → FINALIZED_REVIEWED in <4 min,
  5/5 commits + 5/5 reveals (YES, avg 8020 bps), certificate `0x76264101…`.
  Six stacked concurrency fixes got there (f313c2e advisory-lock tick
  serialization; a20eac7 gateway signer self-healing across processes;
  48fc86a stale-gas retry; 1e86aad per-claim worker error isolation +
  DISCUSSION finalize fallback; 7486a65 in-gateway approveRun tail-chain
  (E2E harness had it as a proxy for ages — production never did) + reserved
  retry + persistInferenceFailure now LOGS the real error; fe1b6a1
  executeAndWait takes transaction FACTORIES — every retry rebuilds, gas
  repinned only when the failure was gas). Earlier testnet canary-17 cert
  `0x8efdabe0…1a8634` still the live-Gonka proof.
- **Typography unified** (798dfe0): Archivo everywhere, `ov-micro`/`ov-micro-sm`
  (Archivo Narrow 13/11px) for every uppercase label incl. the globe HUD;
  mono ONLY for hashes/ids/hex/URLs/code (~54 deliberate sites).
- **Landing scroll choreography** — the evening's main iteration loop with
  the user; current design (all scrubbed = pure functions of scrollY):
  - `components/landing/hero-shrink.tsx` owns it. Constants:
    RUNWAY_VH=200 (wrapper 300vh), EXIT_PORTION=0.2, MASK_PORTION=0.4,
    FADE_PORTION=0.12, GHOST_START=0.18, GHOST_LENGTH=0.22, GHOST_FLOOR=0.35,
    LIGHT_TAIL_VH=120.
  - Timeline: hero type exits on its own (headline+CTAs fade & slide -40px,
    ground row sinks 16px; `[data-hero-exit]` els, never cropped) → the whole
    hero panel shrinks via clip-path toward the stat card's LIVE rect,
    measured IN THE PANEL'S OWN RECT SPACE (scrollbar/svh-proof; sharp
    corners, no radius) → from 18% the PANEL ghosts to a 35% opacity floor
    against the STILL-OPAQUE wash (section hidden) → at landing (p=0.40)
    the frame (wash incl.) dissolves over 0.12, revealing the section
    standing in place → pinned content plays → hold to p=1 → release.
  - Reveal section rides UNDER the frame: margin-top -100vh + per-frame
    counter-translate lift=(1−p)·runway → pinned at EXACT 0 the whole
    runway (no 40px park; header markers: wrapper dark body + 120vh light
    tail; reveal wrapper carries data-header-theme="light" ONLY when static).
  - Desktop choreography path is ALL `vh` units (wrapper/margin/frame
    lg:h-screen); mobile static keeps svh. Mobile/reduced-motion = fully
    static, every style cleared.
  - Entrance clock: entranceRef = (p − 0.40)/0.25, UNCLAMPED (consumers
    clamp); productivity fallback = its own viewport progress. In
    `productivity.tsx`: headline letters fade in random order
    (letterThreshold(i) sin-hash, window 0.16) + h2 rises 28px (hq=q/0.8);
    paragraph (q−0.45)/0.3 rise 14px; **card = transform-static ALWAYS**
    (opacity q/0.5 only — see hard rule below); rows slide from right one
    by one starting mid-dissolve (0.55 + i·0.22, window 0.26).
  - Lenis momentum (0.8s, landing-only, `smooth-scroll.tsx`, reduced-motion
    skips; anchors on). `scroll-driver.ts` = one shared rAF scroll loop.
- **Globe**: bare (no atmosphere shell — mesh+material deleted; poster plate
  fades out once WebGL mounts; no wireframe squares; no scrims). Static in
  the hero (`DockLayer` deleted); second instance sticky in propositions.
- **Everything earlier stands**: v3 Sharplink design (Archivo, #0E76FF/#F3F3F3,
  split-buttons, pins, 9 sections, footer claim form + rising wordmark),
  zkLogin verified, testnet canary, 236/236 vitest.

## HARD RULES distilled tonight (violating these re-breaks fixed bugs)

1. **The dock's landing target (stat card) must stay transform-static.**
   Its entrance = the mask landing + opacity. An entrance translate on it
   was "the drop" (came from parallel commit 831f6f2, reverted in 643392b).
2. **No CSS `scroll-behavior: smooth` anywhere** — it double-eases against
   Lenis (browser animates toward every per-frame write) = lurching. Killed
   in cf9d8f9; do not re-add (reduced-motion override at ~line 780 is fine).
3. Mask insets are measured in the PANEL's own getBoundingClientRect space —
   never against innerWidth/innerHeight (scrollbar band ≠ layout viewport).
4. Only Lenis smooths; every scroll effect stays a pure function of scrollY.
5. **Parallel-edit hazard is REAL**: another agent (the user runs one in
   their browser) committed 831f6f2 mid-session and hot-edited
   productivity.tsx between my passes. ALWAYS `git log`/re-read files before
   editing; attribute unexpected code before "fixing" it.

## Debug tooling learned (browser)

- User's Claude Chrome extension is connected. Create OWN tab via
  tabs_context_mcp/tabs_create; old tab ids die — refetch. chrome-devtools
  MCP server is disconnected (gone from tool list); use claude-in-chrome.
- **Background tabs throttle rAF/IO/timers to ~zero**: the live scroll
  driver + Lenis + framer whileInView all freeze. Live-loop recording is
  useless there. Working patterns: `scrollTo({behavior:'instant'})` +
  MANUALLY apply the pipeline's formulas (lift etc.) then measure rects
  synchronously; style-setter traps (defineProperty on el.style,
  'transform') capture writer stacks; React fiber walk
  (`__reactFiber$` key) identifies owning components; curl the SSR HTML to
  split server-vs-client-written styles.
- `next start` serves COMPILED code: after ANY lib/components change,
  `pnpm build` then restart, or web ≠ workers (workers run tsx live).

## Running processes + restart

- Local Sui chain (`sui start`, SUI_CONFIG_DIR=.localnet/sui-config),
  Docker Postgres (openverdict / openverdict-dev-only), and the :3000 stack.
- Restart stack (also the pkill patterns that actually match):
  `pkill -f "start-production.mjs"; pkill -f "cli.mjs workers/"; lsof -ti:3000 -sTCP:LISTEN | xargs kill`
  then from repo root:
  `nohup zsh -c 'SUI_OPERATOR_SECRET_KEY=suiprivkey1qp82fu0kevmkg6j4lcm30rdtmvylpyyt82as9mzctlzs336n27r2g5zzuaq OPENVERDICT_AGENT_SEED=cockpit-demo-fixed-seed OPENVERDICT_RELEASE_MANIFEST=/Users/marcus/Projects/OpenVerdict/.localnet/release.runtime.json DATABASE_URL=postgres://openverdict:openverdict-dev-only@127.0.0.1:5432/openverdict OPENVERDICT_PUBLIC_WRITES=enabled node scripts/start-production.mjs' >> "$SCRATCH/prod-stack.log" 2>&1 & disown`
  (log in the session scratchpad; workers = tsx child pairs, 6 PIDs normal).
- The LOCALNET operator address is `0x043b8d3e…` (holds Publisher/caps/ONE
  gas coin ~997 SUI — the single-coin contention is why the serialization +
  retry stack exists). `0xff3538…` is the TESTNET operator. gonkaMode=fake
  on this stack (live Gonka proven via canary separately).
- DB holds the debug-ladder claims (several honest UNRESOLVED) + scored
  `0x8661…db84`; stat card counters read live from /api/claims.

## OPEN ITEMS

1. User's live UI review continues — next nit whenever they see it (they
   test on :3000; ALWAYS rebuild+restart after edits, then they hard-refresh).
2. User's full human E2E walkthrough (submit claim from footer form →
   scored verdict ~4 min; /claims, report page, /verify, /agents).
3. T9: demo video (docs/demo/video-script.md — needs a re-skim vs the new
   landing choreography before recording), submission package, workshop brief.
4. Railway: user dashboard builder flip → then Google/Enoki origins for the
   public URL.
5. Flagged/optional: opportunity.tsx still uses viz/Reveal (IO-based) —
   fine, but inconsistent with the scrubbed system if the user notices;
   lucide-react unused dep; components/ui/progress.tsx unused.

## Environment facts (do NOT relearn)

- *.sui.io TLS-blocked here; publicnode JSON-RPC works (browser + node).
- pglite single-writer → worker topology REQUIRES Postgres DATABASE_URL.
- Bash run_in_background sandboxed (no network) → nohup+disown pattern.
- IDE diagnostics LAG badly — trust pnpm typecheck/lint/build only.
- OAuth: origins no trailing slash, redirect URIs with; Enoki portal needs
  the Google client id; app pins redirect to origin+/.
- Jury aborts: 1=INVALID_STATE 7=DEADLINE_PASSED 18=COMMITTEE_NOT_LOCKED
  20=DEADLINE_NOT_REACHED 21=EVIDENCE_NOT_BOUND 22=CONSENSUS_REACHED.
- Claim states: 3=REVIEW_REQUESTED 4=COMMIT_1 5=REVEAL_1 6=DISCUSSION
  7=COMMIT_2 8=REVEAL_2 9/10=FINALIZED 11=UNRESOLVED 12=CANCELLED.

## Resume protocol after /compact

Read this file. `git log --oneline -20` for the ladder. Verify :3000
answers /api/status (restart per block above if not). Check `git status` +
recent commits for PARALLEL-AGENT edits before touching UI files. Then
continue: UI nits → user E2E → demo/T9 → Railway.
