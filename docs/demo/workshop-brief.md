# GonkaRouter workshop brief (2026-08-27)

Pocket card for the workshop: 30-second pitch, real questions from real
integration pain, and links to have open.

## The 30-second pitch

"OpenVerdict is a decentralized fact-checking engine: five AI jurors — drawn
from three GonkaRouter model families — review frozen evidence under
cryptographic commit-reveal on Sui. No juror can see another's work before
votes are sealed on-chain; every inference carries its GonkaRouter request id
into a public audit bundle; the Truth Score is deterministic arithmetic
anyone can recompute. Live on Sui testnet today with real DeepSeek, Kimi and
MiniMax juries."

Differentiators to land: (1) request ids as first-class AUDIT primitives, not
just logs; (2) commit-reveal makes multi-model juries collusion-resistant by
construction; (3) zkLogin one-social-account-one-seat backing; (4) fail-closed
engine — malformed model output can never become a vote.

## Ask devrel (ranked, all from live integration)

1. **Reliability during judging**: today the gateway returned raw 502s for
   ~an hour (before request ids were assigned). Is there a status page or
   health endpoint, and an incident channel for the hackathon window?
2. **MiniMax-M2.7 JSON mode**: with `response_format: json_object` accepted,
   MiniMax still returns schema-breaking output where DeepSeek-V4-Flash and
   Kimi-K2.6 comply (we run temp 0, strict contract in the system prompt, one
   repair attempt). Is response_format actually enforced for MiniMax? Known
   issue? Recommended prompt pattern?
3. **Request-id verification API**: is there (or could there be) an endpoint
   to verify a request id after the fact — model, timestamp, token counts?
   That would let third parties confirm our jury inferences really ran on
   Gonka. Feature request that fits their decentralized-inference story.
4. **Per-key concurrency + rate limits**: we currently run the five jury
   calls serially; what's the official concurrency so we can parallelize?
5. **Output cap**: responses cap at 4096 tokens on our account — tier limit
   or raisable? (Bounds our public reasoning traces.)
6. **Determinism stance**: at temperature 0, how reproducible are outputs
   across their decentralized worker network? (We hash outputs rather than
   claim replay, but their answer shapes the audit story.)
7. **Credits** for the judging window / demo video takes.

## Deep technical questions (engineer-to-engineer, with our evidence)

1. **Is `response_format: json_object` actually enforced for MiniMax-M2.7?**
   Accepted with HTTP 200, temp 0, strict system contract — yet MiniMax
   returns schema-invalid content in ~8/8 runs while DeepSeek-V4-Flash and
   Kimi-K2.6 comply 100%. Any grammar-constrained decoding option planned?
2. **Determinism & worker attestation**: at temperature 0, does the same
   request reproduce the same tokens across your decentralized worker
   network (GPU/quantization heterogeneity)? Are model weights
   version-pinned, and is the executing worker attested anywhere? (We build
   verification on top of you — this is our deepest dependency.)
3. **Request-id semantics**: format `devshard-<n>-<m>` — what are the
   components? Globally unique and permanent? Any (planned) lookup endpoint:
   id → model, timestamp, token counts? We persist ids in public audit
   bundles; a verification endpoint makes them third-party-checkable.
4. **Today's ~1h of raw gateway 502s** (no request ids assigned): router or
   upstream provider pool? Status page / Retry-After guidance? Are 502s ever
   billed?
5. **Per-key concurrency and rate limits**: we serialize five jury calls and
   want to parallelize — official concurrent-request and burst limits?
6. **4096-token output cap**: account tier or platform-wide? Behavior if
   `max_tokens` exceeds it — clamp or error?
7. **Latency SLOs per family**: Kimi-K2.6 sometimes needs >120s (we run 240s
   timeouts) and threw one transient PROVIDER_ERROR today — expected p99?
8. **Model lifecycle**: deprecation/renaming policy for model ids? Our
   on-chain agent profiles pin model ids by hash, so catalog churn matters.
9. **`usage` fields**: we've seen token usage missing/malformed occasionally
   (we flag, never trust) — guaranteed or best-effort?

## For judges & mentors

- Track fit: Gonka "AI for Society" fact-checker + Sui "AI × Sui".
- Proof points on your phone:
  - Repo: github.com/Marcussy34/OpenVerdict (README has screenshots)
  - Operator (testnet, live objects incl. ResolutionCertificates):
    suiscan.xyz/testnet/account/0xff3538d73840319aa0439ca047118b584a423b48c94ac0776f6cef25d73b9e1a
  - Package: suiscan.xyz/testnet/object/0xb411210a52dad799b9b4a53e3a44b30c3c8b8a3b1981795f830166533a474c1d
  - Numbers: 431/431 TS tests, 70/70 Move tests (66 protocol, 4 Seal policy), byte-identical TS↔Move
    commitment parity, full lifecycle E2E exit 0, live juries with real
    `devshard-…` request ids across 3 model families.
- Honest framings that build trust: zkLogin backing is authentication and a
  Sybil-cost raise — never proof of personhood; unaudited hackathon trust
  model with capped demo funds; UNSURE/UNRESOLVED are honest first-class
  outcomes, not failures.
- If asked "why Sui": native on-chain randomness for committee draws, shared
  objects for the jury state machine, frozen immutable certificates, zkLogin
  onboarding, sponsored transactions.
