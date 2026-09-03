# 2-minute demo video script

One recording pass, two claims: CLAIM A is submitted on camera (shows liveness),
CLAIM B is an already-finalized claim (shows the verdict and audit trail without
waiting ten minutes). If the first live deliberation has run by recording time,
use that claim as CLAIM B and include beat 5; otherwise use certificate claim
#25 (`0xff3191bc…`) and skip to beat 6.

## Setup checklist (before recording)

- [ ] Browser at 100% zoom, light desktop clutter, notifications off.
- [ ] Tab 1: https://openverdict.info (landing). Tab 2: /fact-check.
  Tab 3: CLAIM B's canvas page. Tab 4: CLAIM B on `/claims/[id]/report`.
  Tab 5: its certificate on Suiscan. Tab 6: /agents.
- [ ] CLAIM A text ready in the clipboard (a short, clean factual claim).
- [ ] Confirm engine healthy: /api/status shows gonkaMode live.
- [ ] Optional on-camera moment: be signed out of Google so the zkLogin
      staking flow can be shown fresh.

## Timed beats

| Time | Screen | Say (roughly) |
| --- | --- | --- |
| 0:00-0:12 | Landing hero | "This is OpenVerdict, an adversarial AI jury protocol, not an agent swarm. Juror seats from three model families research a disputed claim on Gonka's decentralized inference network, seal their ballots, cross-examine a deadlock, and Sui settles a verdict the chain acts on and anyone can recompute." |
| 0:12-0:30 | /fact-check, paste CLAIM A, submit | "I submit one claim. Five juror seats are drawn on-chain with Sui's native randomness, across three model families, at most two seats per model." |
| 0:30-0:50 | CLAIM A canvas, sealed phase | "Each juror researches the live web through the engine: every search and page-open appears here as it happens, sealed. No juror can see another's work, and votes lock as hash commitments on Sui before anything is revealed." |
| 0:50-1:10 | CLAIM B canvas, revealed | "Here is a finished claim: at reveal, the sealed trails bloom into the full record: the searches on both sides, the exact pages, verbatim citations, and each seat's vote with its confidence." |
| 1:10-1:25 | CLAIM B deliberation chat (if a debate ran) | "When the jury splits, the revealed jurors cross-examine each other in public, citing only the frozen record, for at most three exchanges, then cast a second sealed ballot at the table. Honest deadlock ends as UNRESOLVED, never a forced answer." |
| 1:25-1:45 | Report page then Suiscan certificate | "The verdict is an immutable certificate on Sui with a 0-to-100 Truth Score, and every inference carries its Gonka request id. This is not our database; it is the chain." |
| 1:45-1:55 | /verify on one of CLAIM B's runs | "And you do not have to trust us: the browser reruns 15 checks per juror run, can resend the exact conversation to the same model, and can open sealed bundles through Seal without our help." |
| 1:55-2:00 | /agents (or the staking card) | "Anyone can stake on a jury seat with a Google account. OpenVerdict: see how the verdict was reached." |

## Backup plan

- If Gonka weather is bad on recording day, skip CLAIM A's live research shot:
  submit it anyway (0:12-0:30), then cut straight to CLAIM B with the line
  "resolution runs on real deadlines, about ten minutes end to end, so here is
  one that has finished."
- If the canvas SSE chip shows SYNCING, refresh once before recording the shot.
- Keep every hash/id shot to at least 1.5 s on screen so pauses read cleanly.

## One-liners for cuts and captions

- "Gonka is the only mind. Sui is the only judge. SUI is the currency."
- "The operator can halt. It cannot forge."
- "Sealed before reveal. Public forever after."
