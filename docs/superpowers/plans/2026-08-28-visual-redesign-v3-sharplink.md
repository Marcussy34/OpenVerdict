# OpenVerdict visual redesign v3 — Sharplink adaptation (2026-08-28)

Owner: Opus design agent (max effort). Orchestrator: Fable session.
Supersedes v2's page composition; v2's globe components and data rules stand.
Reference: https://www.sharplink.com/ — style/behavior adaptation ONLY. No
Sharplink text, logos, images, or claims (we are NOT Nasdaq-listed; never
copy that band's content). User-approved reference screenshots (12):
`/private/tmp/claude-501/-Users-marcus-Projects/ea697832-244e-426b-a971-ef1e18dba18e/scratchpad/sharplink-refs/`
— view them (Read tool) in filename order; they are the layout ground truth.
clip-…022011 = palette card; …022117 = hero; …022151 = productivity;
…022209/…022221 = propositions light→dark; …022243 = black banner;
…022254 = highlight text; …022304/…022321 = opportunity list; (news shot —
SKIP that section entirely per user); …022405 = FAQ; …022417/…022424 = footer.

## Extracted foundation (from live sharplink.com, getComputedStyle — exact)

**Fonts (Google Fonts — USE THE SAME, user-directed):**
- `Archivo` via next/font/google, weights 300 400 500 700 (900 optional).
  Body 16px/400. Display headings 400 weight (yes, 400 — the big sizes are
  NOT bold): h1 hero 88px, h2 section 68px / lh 72.08px / ls -1.36px
  (= lh 1.06, ls -0.02em). Dark-banner h2 44px / lh 54.12px / ls -0.01em.
  Card/item h3 32px / 500 / lh 37.12px / ls -0.01em. Question rows 19px/500.
- `Archivo Narrow` weights 400 500 700 — ALL uppercase micro-labels:
  13px / 500 / lh 18.2px / letter-spacing 1.04px (0.08em), uppercase.
  Used for: nav chips, eyebrows, buttons, number chips, legal links.
- Keep the existing mono font for addresses/hashes/digests only.

**Palette (exact):**
- Accent blue `#0E76FF` (rgb 14,118,255) — arrow chips, pins, links, accents.
- Surface `#F3F3F3` — chips, cards, light text on dark.
- Body bg `#F7F7F5`; text black; borders `rgba(0,0,0,0.15)`;
  faint fills `rgba(0,0,0,0.03)` (FAQ rows), `rgba(242,242,242,0.4)` panels.
- Dark: pure `#000` banner; navy radials for hero/gradients (sample from the
  screenshots: deep #04122b→#0a2c5e-family); dark glass
  `rgba(38,38,41,0.45)` + `backdrop-filter: blur(20px)` (hero live card);
  dark translucent chip `rgba(238,238,240,0.1)`.
- Light hero-2 wash: `radial-gradient(100% 130% at 50% -30%, #C4D5E7 45%, #FDFBF7 85%, #F7F7F5)`.
- Footer: deep blue gradient (light blue top → #0E76FF-family → navy bottom,
  per screenshots …022417/…022424).

**Grid & furniture:**
- Inner container: `margin: 0 28px` at desktop, effectively full-bleed minus
  28px gutters; max content width none (1864px at 1920vw). 12-col feel.
- Faint DASHED hairlines (vertical column guides + horizontal separators):
  implement as `repeating-linear-gradient` 1px `rgba(0,0,0,0.15)` (light) /
  `rgba(243,243,243,0.15)` (dark) — the original uses pseudo-elements.
- Signature "pin" detail: small 6×6px `#0E76FF` squares at section/card
  corners (`has-pin` in the original). Sprinkle exactly like screenshots.
- Number chips: 30×22px black box, Archivo Narrow 13px white, centered,
  content like `■ 01` (4px gap, tiny square glyph). Sharp corners.
- **Zero border-radius everywhere on the landing.** Sharp rectangles are the
  identity. (Product pages: see "Site-wide scope" below.)
- Buttons (signature split-button, height 34px, flex gap 2px):
  uppercase Archivo Narrow 13px/500/+1.04px; `content` block
  (bg #F3F3F3, black text, padding 0 16px) + separate `icon` block
  (bg #0E76FF, 32×34px, white arrow →). Secondary: content bg
  `rgba(238,238,240,0.1)` light text (dark sections) or `rgba(0,0,0,0.06)`
  black text (light sections), NO blue chip. Hover: subtle bg shift +
  arrow nudge 2px right, transition ~200ms ease.
- Header: `position: fixed, top 0, z 999`, transparent, inner = same 28px
  gutters; logo left (wordmark "OpenVerdict" in Archivo 500 + existing mark
  if any); right: nav chips (uppercase Narrow 13px, height ~34px, padding
  0 14px, bg #F3F3F3/black text on light sections; bg rgba(238,238,240,0.1)/
  #F3F3F3 text on dark) + terminal arrow chip. Theme flips per section:
  sections declare `data-header-theme="dark|light"`, header observes via
  IntersectionObserver. Nav items: HOME · CLAIMS · AGENTS · VERIFY ·
  OBSERVER + the wallet connect button (restyle its SHELL to chip style
  only — do NOT touch its logic/handlers in
  components/wallet/connect-button.tsx beyond className-level styling).
- Smooth scroll: `lenis` package (the original uses it; html.lenis). Mount
  ONLY on the landing page (destroy on unmount); guard reduced-motion
  (skip Lenis entirely); anchor links must still work.

## Page composition (9 sections; matches screenshots minus news)

### 1. HERO (dark navy, full viewport)
- Right/center visual (2026-08-28 addendum): a quality-first Google Cloud
  generated kinetic network instrument replaces the hero-only SwarmGlobe.
  Its titanium Earth armature and distributed optical nodes represent Gonka;
  five hardware anchors represent the jury; a restrained sapphire waterdrop
  references Sui. It uses #0E76FF / #F3F3F3, preserves left-side copy space,
  pauses offscreen, and falls back to its exact poster for reduced motion or
  codec failure. The lower protocol-section SwarmGlobe remains unchanged.
- Left: h1 Archivo 400 88px (2 lines, max-w ~500px): `Agentic\nResolution`.
  Below: the two split-buttons: primary `SUBMIT A CLAIM` (blue arrow chip;
  scrolls to the footer claim form) + secondary `WATCH LIVE CLAIMS`
  (links /claims).
- Bottom-center blurb (max-w ~420px, 16px, #F3F3F3): reuse the EXISTING
  tightened landing description sentence — do not write new marketing copy,
  do not reinflate.
- Bottom-left eyebrow band: `SETTLED ON` + Sui wordmark/text `SUI TESTNET`
  (honest). Bottom-right: dark-glass live card (bg rgba(38,38,41,0.45),
  blur 20px, padding 20px, blue corner pin): eyebrow `LATEST VERDICT` +
  date + one line from `/api/claims` (most recent resolved claim: statement
  truncated + outcome) + arrow chip; links to that claim page. Falls back
  gracefully to "No verdicts yet" if none.
- Cookie banner: none. Mobile: stack, globe above text, reduced height.

### 2. PRODUCTIVITY (light wash) — "hero docks into the stat card"
- Background: the light radial wash (exact gradient above).
- Layout: left h2 68px `Pioneering Verifiability` + left-bottom paragraph
  (~330px wide, 16px): adapt existing copy about juries + on-chain
  settlement (keep meaning, no new claims). Center: DARK stat card
  (~600px wide, navy gradient like screenshot, sharp): rows
  `CLAIMS RESOLVED` / `JURY SEATS FILLED` (Narrow 13px labels, right-aligned
  big numbers, NumberFlow ok) + a thin white 1px line-chart (SVG polyline of
  resolved-claims-over-time from /api/claims; deterministic fallback shape
  if sparse) + bottom full-width button `MORE IN LIVE CLAIMS` →
  /claims (translucent gray content + arrow chip). Right column: three rows
  (bg subtle gradient panels), each: number chip ■01/02/03 + 19px/500 title
  + right dotted-outline mini-illustration (hand-drawn SVG, 1px dashed
  strokes, rgba(0,0,0,0.25)): 01 `Committed before revealed` (ballot/seal),
  02 `Evidence pinned on Walrus` (anchor/pin), 03 `Certificates on Sui`
  (stamp/chain). Rows fade+rise in on scroll (stagger).
- **The dock move (the transition the user loved):** on scroll from hero →
  this section, the hero visual (globe + navy bg) scales/clips down INTO the
  dark stat card's frame, then the card content crossfades in over it.
  Implement with scroll progress (position: fixed/sticky choreography like
  the original's animated-mask + fixed section, or a simpler sticky +
  clip-path inset() + transform interpolation). MUST degrade: with
  prefers-reduced-motion (or mobile <1024px if too heavy), sections render
  as plain stacked blocks, no fixed/clip choreography, zero layout jump.

### 3–4. PROPOSITIONS (light → dark gradient, sticky object right)
- Section header: eyebrow `PROTOCOL` + h2 68px `The Stack for Settling
  Claims`.
- Left column: 4 stacked items, each: eyebrow label + h3 32px/500 + 16px
  paragraph (~330px). Content (adapt existing honest copy):
  1. `JURY` — "Diverse by Construction" — ≥3 model families via
     GonkaRouter; no single vendor steers a verdict.
  2. `COMMIT–REVEAL` — "Sealed Before Spoken" — votes commit as hashes,
     reveal after; no copying, no steering.
  3. `EVIDENCE` — "Pinned Before Deliberation" — evidence frozen to Walrus
     before the jury convenes; the record can't shift under the verdict.
  4. `SETTLEMENT` — "Certificates on Sui" — verdicts + tallies settle
     on-chain; anyone can recompute the result.
- Scroll behavior: right visual is position: sticky (top ~15vh) while the
  left list scrolls; the ACTIVE item is full opacity, inactive items
  opacity 0.4 (IntersectionObserver on item midpoints). Background
  transitions light → deep navy across the section (bg interpolation tied
  to scroll or stacked gradient), text flips to #F3F3F3 accordingly.
- Right sticky visual: second SwarmGlobe instance (globe is lazy-mounted +
  frameloop demand; hero instance pauses offscreen so only one runs).
  If cheap to add, drive the globe's phase from the active item index
  (INGEST→GATHER→CROSS-CHECK→SEAL map to items 1–4) via a new optional prop
  on the globe components (presentational change — allowed); otherwise let
  it free-run. Do NOT rewrite the globe internals.

### 5. BANNER (pure #000, full-width)
- Left: logo mark (large, ~90px) above h2 44px/#F3F3F3, line 1 white
  `Truth for everyone,` line 2 rgba(243,243,243,0.5)
  `engineered to verify.` Buttons row: `SUBMIT A CLAIM` + `HOW IT WORKS`
  (→ /observer or the propositions anchor).
- Right: dotted/wireframe rendering of the globe — static SVG or a styled
  reuse of existing globe-motif (1px dashed strokes rgba(243,243,243,0.4),
  one tiny blue ■ accent). No second WebGL canvas here.

### 6. MANIFESTO TEXT-REVEAL (dark navy → fades toward light at bottom)
- Eyebrow: `WHY OPEN VERIFICATION`. Right-top: chip button `LEARN MORE` →
  README/GitHub.
- One big 44px/lh 54px paragraph, max-w ~1000px, split into per-WORD spans;
  each word's opacity ramps 0.25 → 1 driven by scroll progress through the
  section (the original is per-character; per-word is fine and cheaper).
  Copy (honest, Sharplink cadence, ~40 words max — final wording may be
  polished but claims must stay true): "Open verification is becoming
  public infrastructure. Claims deserve juries no single vendor can steer —
  evidence sealed before deliberation, verdicts settled in public where
  anyone can audit them. This is just the beginning."
- Reduced motion: full opacity static.

### 7. OPPORTUNITY LIST (light, fades in + right looping visual)
- Same eyebrow band continues. Left: 4 rows, big vertical rhythm
  (~120-140px apart), each: small dotted icon (SVG, dashed 1px) + 19px/500
  title + 16px paragraph (~430px). Content (existing honest claims only):
  1. "Juries diverse by construction" — model families named honestly.
  2. "Evidence sealed before deliberation" — Walrus freeze.
  3. "One identity, one seat" — zkLogin is AUTHENTICATION, one account one
     seat — NEVER call it proof of personhood.
  4. "Verdicts anyone can recompute" — /verify + certificate recompute.
  Rows fade/translate in on viewport entry (stagger, once).
- Right: a looping ambient visual sliding in from the right edge as the
  section enters (like the original's metal pillar): reuse/restyle an
  existing viz component (jury-marquee or phase-rail) inside a tall sharp
  panel, or a slow-looping CSS/SVG arc animation. Keep it light (no video).

### 8. FAQ (light)
- Left: h2 68px `FAQ`. Right-top chip: `GOT MORE QUESTIONS?` label +
  `REACH US` button → GitHub issues.
- Right column: 7 accordion rows (`faq-item`): bg rgba(0,0,0,0.03), 1px
  rgba(0,0,0,0.15) hairline separators, row = number chip ■0N + question
  19px/500 + right 34×34 BLACK box with white +/− (rotates 45° on open,
  ~250ms). Answer: 16px, max-w ~640px, padding-bottom 24px, expand
  animation height/opacity ~300ms ease. Honest answers (2–3 sentences,
  from README/runbook truths — verify claims against the repo):
  1. What is OpenVerdict? (decentralized fact-checking court; AI juries;
     Sui settlement)
  2. How are verdicts decided? (commit–reveal rounds, supermajority
     thresholds, UNSURE is an honest outcome)
  3. What settles on-chain? (claims, commits, reveals, tallies,
     certificates on Sui testnet)
  4. Is sign-in proof of personhood? (No — zkLogin is authentication; one
     account, one seat)
  5. Where does evidence live? (Walrus, frozen before deliberation)
  6. Which models sit on a jury? (≥3 model families via GonkaRouter — name
     the actual families from the repo config)
  7. Can I check a verdict myself? (/verify page + CLI recompute)

### 9. FOOTER (deep blue gradient, giant wordmark)
- Top-left block (blue corner pin): heading 19px `Put a claim on trial:` +
  the REAL claim submission form restyled: full-width underlined input-row
  (transparent bg, 1px bottom hairline rgba(243,243,243,0.4), 19px text,
  placeholder "Enter a claim…") + split-button `SUBMIT` (blue arrow chip).
  This MUST wire to the existing claim-submission logic (reuse the current
  form component/hooks — restyle shell only; keep validation, char counts,
  error and success states functional, adapting their styles to dark).
  Hero `SUBMIT A CLAIM` scrolls here (#submit anchor).
- Columns right: `NAVIGATION` (Home, Claims, Agents, Verify, Observer) ·
  `RESOURCES` (GitHub, Demo runbook, Sui Explorer package link,
  GonkaRouter) · `BACK TO TOP` chip with ↑ box.
- Below-left: `SETTLED ON SUI TESTNET · JURIES BY GONKAROUTER` (Narrow 13px
  uppercase, 0.6 alpha) + `MIT LICENSE`. Legal row: existing footer links.
- Bottom: GIANT `OpenVerdict` wordmark, Archivo 500, ~28vw, metallic
  silver-to-white vertical gradient text (background-clip: text), cropped
  by the section bottom (overflow hidden, sits ~55% visible), and it RISES
  into place with scroll (translateY 35% → 0 tied to footer scroll
  progress; reduced-motion: static). This replaces the original's canvas.
- Bg: vertical gradient light-blue → #0E76FF-family → deep navy at bottom.

## Site-wide scope & hard rules

- File scope: `app/**` pages/layout (NOT `app/api/**`), `components/**`
  presentational, `app/globals.css`, package.json via pnpm. NEVER touch
  `lib/**`, `app/api/**`, `move/**`, `scripts/**`, `cli/**`, `workers/**`,
  `components/use-claim-events.ts`, `components/wallet/providers.tsx`.
  connect-button.tsx: className/markup shells only, logic untouched.
- Allowed deps: `lenis` (+ nothing else new; three/r3f/NumberFlow exist).
  No GSAP (not needed — original doesn't use it), no UI frameworks,
  no icon-set swaps (iconsax stays for app icons; custom inline SVGs fine
  for the dotted illustrations/arrows).
- Fonts: swap the app to Archivo/Archivo Narrow via next/font/google in
  app/layout.tsx with CSS variables; product pages inherit. Addresses/
  hashes keep mono. Update tailwind font config accordingly.
- Tokens: update globals.css palette to this spec (accent #0E76FF etc.).
  Landing is radius-0; product pages may keep small radii if flipping the
  global radius breaks shadcn overlays — decide by LOOKING at /claims,
  /report/[id], /agents, /verify, /observer on :3001 after the token pass;
  they must remain coherent (same fonts/palette) and unbroken. Fix visual
  fallout on product pages caused by the token/font swap (style-level only).
- Every displayed data field stays real (no fabricated stats/logos/news).
  All existing routes keep working. Honest framings are non-negotiable
  (UNSURE honest; zkLogin = authentication not personhood; testnet, not
  mainnet; no invented institutional claims).
- The claim form keeps full functionality (footer placement). SSE-driven
  pages unaffected.
- prefers-reduced-motion: EVERY animation collapses (dock, text-reveal,
  wordmark, staggers, Lenis off). Avoid hydration mismatches: gate
  motion-dependent initial states the way v2 did (branch in transition,
  not initial render).
- Performance: only one WebGL globe animating at a time (lazy mount +
  offscreen pause already exist — preserve); DPR cap stays; scroll
  handlers passive + rAF-throttled; no layout thrash (transform/opacity
  only for scroll effects).
- a11y: accordions keyboard-operable (button + aria-expanded), focus
  visible, form labels/aria intact, contrast ≥ 4.5 for body text.

## Working setup

- A production stack serves http://localhost:3000 (user testing) —
  DO NOT kill, rebuild, or touch it. `.next` is shared between dev and
  build: run `pnpm dev` on :3001 for iteration, and STOP that dev server
  before the final `pnpm build` gate.
- Dev server env (Postgres is multi-process safe; localnet chain runs):
  `SUI_OPERATOR_SECRET_KEY=suiprivkey1qp82fu0kevmkg6j4lcm30rdtmvylpyyt82as9mzctlzs336n27r2g5zzuaq OPENVERDICT_AGENT_SEED=cockpit-demo-fixed-seed OPENVERDICT_RELEASE_MANIFEST=/Users/marcus/Projects/OpenVerdict/.localnet/release.runtime.json DATABASE_URL=postgres://openverdict:openverdict-dev-only@127.0.0.1:5432/openverdict OPENVERDICT_PUBLIC_WRITES=enabled PORT=3001 pnpm dev`
- Verify visually with chrome-devtools MCP (ToolSearch to load) against
  http://localhost:3001 — own tabs only, close them when done. Iterate
  screenshot → judge → refine per section, then full-page pass at 1440
  AND 390 widths. Check the section transitions by scrolling, not just
  static screenshots.
- Gates before reporting: stop dev server; `pnpm typecheck`, `pnpm lint`,
  `pnpm build` all green. Do NOT git commit — orchestrator reviews/commits.

## Deliverable report

Sections built, files created/modified, packages added, how the dock
transition + text-reveal + sticky propositions + wordmark were implemented,
what was verified visually (pages × viewports), product-page fallout fixed,
known gaps.
