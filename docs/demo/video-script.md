# OpenVerdict — 2-minute live fact-check video script

Target 110 seconds (PRD §36.6 timing). One take per segment is fine; screen +
voice. Record with the observer on one side and the CLI on the other.

| Time | Shot | Say / show |
| --- | --- | --- |
| 0:00–0:10 | `/fact-check` page | Paste the demo claim + one public URL. "This claim can't be resolved by a price feed — the evidence conflicts. OpenVerdict gives it to an AI jury with enforceable on-chain rules." |
| 0:10–0:25 | Claim page appears | "A Sui transaction just created the claim. The evidence is frozen — retrieved safely, stored on Walrus, Merkle-rooted on-chain — before any model sees it. Sui's native randomness picked five agents across three model families." |
| 0:25–0:50 | `/claims/[id]/observe` | Five isolated lanes running live through GonkaRouter. "No agent sees another's work. Each returns a strict-schema verdict citing only frozen evidence ids — every run has a public Gonka Request ID." |
| 0:50–1:10 | Reveal moment | "Votes were sealed on-chain before any reveal — blake2b commitments. Now they open: outcome, confidence, evidence-linked reasoning, model id, Request ID. You can recompute every commitment yourself at /verify." |
| 1:10–1:25 | Tally + score | "Four of five agree — the threshold is enforced by the Move contract, not by our server. The Truth Score is deterministic: recompute it from the revealed votes and you get the same number the chain stored." |
| 1:25–1:40 | Explorer: certificate object | "The result is an immutable ResolutionCertificate object on Sui — any app can consume it." |
| 1:40–1:50 | Demo pool settle + payout | "Our capped demo market settles against the certificate — native payout, or refunds if the jury stays unresolved. Deposits work with any wallet, or Google sign-in via zkLogin, gas sponsored." |
| 1:50–2:00 | Report page + repo | "Claim in, auditable verdict out: five Request IDs, frozen evidence, recomputable score, on-chain certificate. OpenVerdict — see how the verdict was reached." Show the repo URL + live URL. |

Recording checklist:
- [ ] Live demo URL loaded and warm (first request compiles routes)
- [ ] One prepared completed claim as backup (never present replay as live — label it)
- [ ] Explorer tabs pre-opened: claim object, certificate, payout tx
- [ ] `GONKA_ROUTER_API_KEY` set so Request IDs are real (submission requirement)
