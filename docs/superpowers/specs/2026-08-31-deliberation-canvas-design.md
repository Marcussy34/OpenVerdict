# Deliberation canvas (design, 2026-08-31 early morning)

Status: brainstormed with the owner on 2026-08-31 between 03:20 and 03:55;
the owner approved the design ("yes. sounds good.") with one addition
(juror avatars via the ip-as-logo flow) and one requirement ("make sure
also everything is live"). Decisions recorded from that conversation:
sealed pulses during the commit phase, the canvas IS the claim page, 2D
force graph rendering. Fixture claim: `0x21aa5a7bdd80…` (the owner's
Section 232 tariffs claim: four full research trails, one INVALID_SCHEMA
failed seat, YES at 9525).

## Vision

Opening a claim shows one canvas, Obsidian-graph style: the claim in the
middle, the five jurors around it, and every step of their work as nodes
(searches with intent, pages opened, citations, verdicts, failures, the
certificate), all connected and all live. Sidebars carry the assertion,
stage, timer and statistics on the left and a node inspector on the right.
Nothing in the recorded trail stays off-canvas.

## Protocol boundary (drives the whole design)

While the jury sits, research content is sealed on purpose (commit-reveal:
nothing a juror reads may be visible before reveal or votes could be
copied or front-run). The owner chose "sealed pulses": during the sealed
phase the canvas shows content-free activity, and at reveal each locked
node blooms into its real content. Content never leaves the engine early.

## Components

1. **Graph model** `lib/viz/deliberation-graph.ts` (pure, renderer
   agnostic, unit tested). Input: `ClaimInspection`, the revealed run
   proofs (or report agent cards), and the live event list. Output:
   `{ nodes, edges }` with deterministic ids (`claim`, `seat:<jurySeatId>`,
   `run:<runId>:step:<index>`, `verdict:<runId>`, `failure:<jurySeatId>`,
   `certificate`). Node kinds: claim, juror (model family, live state:
   researching | sealed | revealed | failed), sealedAction (content-free
   placeholder), search (with support|challenge intent), page (batch
   aware), citation marker on page nodes, verdict (outcome + confidence),
   failure (status string), certificate. Edges follow the recorded
   sequence: claim to juror, juror to its actions in turn order, search to
   the pages it listed, page to the verdict it is cited by, juror to
   verdict, verdicts to certificate.
2. **Live pipeline.** The canvas subscribes to the existing SSE stream
   (`useClaimEvents`, Last-Event-ID resume). New engine emission: a
   content-free `RESEARCH_TICK` event (visibility PUBLIC_NOW) carrying
   only `{ jurySeatId, kind: "search" | "open", ordinal }`, emitted by the
   research loop as steps happen. Pre-reveal these render as locked grey
   nodes under the juror. At reveal the canvas fetches the run proofs and
   matches locked nodes to real transcript steps by seat and ordinal
   (bloom animation). Phase changes, commits, reveals and the certificate
   already arrive as events. If ticks are absent (old claims, stream
   gaps) the juror node simply pulses while sealed; on reconnect the
   resume cursor replays missed events.
3. **Renderer.** 2D force layout (d3-force, new small dependency; three.js
   already ships with the app so a 3D mode can be added later on the same
   graph model). Claim pinned centre, jurors radial, per-juror clusters;
   pan and zoom; hover highlights a juror's subtree; motion (already a
   dependency) animates entry, bloom and settle. Dark navy canvas
   (`--ov-navy` family) so the product's light chrome frames a dark
   stage. Respect prefers-reduced-motion.
4. **Avatars (owner addition).** Each juror node wears a character avatar
   from the ip-as-logo flow instead of a plain disc: one cute species per
   model family, one colourway per agent profile, reused on
   `/agents/[id]`. Generation follows the ip-as-logo skill (three
   directions, six candidates, owner picks; requires a top-tier image
   model, which the owner must enable: no key is on this machine).
   Fallback until avatars exist: geometric family-coloured faces so the
   canvas never blocks on artwork.
5. **Page structure.** `/claims/[id]` renders the canvas full-bleed.
   Left sidebar: assertion, mode, stage chip with a countdown to the next
   deadline, sealed/revealed counters, Truth Score and certificate links
   when final. Right sidebar (node inspector): juror nodes show verdict,
   confidence, citations, the 15 hash checks, Open through Seal and
   Re-run this juror (reusing the existing run-proof components); search
   nodes show query, intent and result list; page nodes show url, content
   hash, Walrus link; failure nodes show the failure record. Top bar:
   state badge and a "Full report" link. The current page moves intact to
   `/claims/[id]/report` (the audit surface loses nothing); the separate
   `/observe` page retires with a redirect to the canvas. Mobile: canvas
   on top, sidebars become slide-up sheets.
6. **Replay (owner addition, 2026-08-31 04:00: "make sure that users can
   watch a replay too, everything played out from beginning to the
   end").** On a finalized claim the whole event log is public, and every
   event carries `occurredAt`; research steps additionally arrive as
   RESEARCH_TICK events with their own timestamps. The canvas gets a
   replay mode: a play/pause control with a scrubber and speed presets
   (10x default, 1x and 30x; the top preset was 60x until 2026-08-31,
   when the owner tuned it down) that rebuilds the canvas as of time t, so
   the claim plays out from creation through committee, freeze, sealed
   pulses, reveals and certificate exactly in recorded order. Claims
   finalized before ticks existed replay with research steps spread in
   transcript order across the research window (labelled "approximate
   timing"). Live claims show the live canvas; the replay control appears
   once the claim is terminal.
7. **Degradation.** Claims from before juror research render juror to
   verdict only. Failed seats always render their failure node. A second
   round adds a phase-2 ring of the same juror nodes. Engine-offline and
   not-found states keep the current handling.

## Interim fixes (ship first, independent of the canvas)

1. The claim report page subscribes to the SSE stream and refetches its
   inspection (debounced) whenever an event lands, so it updates without
   the Refresh button (tonight's gap: the owner watched a finalized claim
   on a static page).
2. Submit returns the claim id as soon as the claim exists and the page
   shows "freezing evidence" while Walrus writes finish in the workers
   (today the POST blocks about 45 s before the redirect).

## Testing and rollout

Graph-model unit tests from fixtures of claim `0x21aa5a7bdd80…` (four
trails, one failure) and a pre-research claim; a layout smoke test;
`RESEARCH_TICK` emission covered in the engine suite (content-free
payload asserted); every existing suite stays green (the sealed bundle
and verifier are untouched: ticks are additive events). Deploy only
between claims; verify live with screenshots on claims #25, #26 and the
tariffs claim, sealed phase verified on the next fresh submission.
