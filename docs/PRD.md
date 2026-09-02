# OpenVerdict: A Decentralized Verification Protocol

<!-- markdownlint-disable MD013 -->

> Product requirements, protocol specification, implementation guide, security model, demo plan, and production runbook in one file.

| Field | Value |
| --- | --- |
| Product name | OpenVerdict |
| Document version | 3.1 — Sui × GonkaRouter architecture |
| Status | Build-ready specification; hackathon eligibility and final track rules require written confirmation |
| Last source verification | 2026-08-26 |
| Primary AI provider | GonkaRouter |
| Underlying AI infrastructure | Gonka network, as exposed by GonkaRouter |
| Settlement network | Sui |
| Public artifact storage | Walrus |
| Development network | Sui Testnet |
| Production/demo network | Sui Mainnet after a capped canary |
| First application | Public multi-model fact checking; prediction-market settlement as the first economic consumer |
| General product | Decentralized verification through an optimistic, human-backed AI swarm |
| GonkaRouter's role | Execute every oracle-agent reasoning pass; it does not determine truth |
| Project lineage | Renamed, clean reimplementation of the team's earlier DIVE concept |
| Repository visibility | Public |

## Table of contents

1. [How to use this document](#1-how-to-use-this-document)
2. [Executive summary](#2-executive-summary)
3. [Product definition](#3-product-definition)
4. [Problem statement](#4-problem-statement)
5. [Why GonkaRouter](#5-why-gonkarouter)
6. [GonkaRouter role and proof boundaries](#6-gonkarouter-role-and-proof-boundaries)
7. [Project origin and hackathon boundary](#7-project-origin-and-hackathon-boundary)
8. [Target users](#8-target-users)
9. [Jobs to be done](#9-jobs-to-be-done)
10. [Product principles](#10-product-principles)
11. [Goals and non-goals](#11-goals-and-non-goals)
12. [Success metrics](#12-success-metrics)
13. [Release scope](#13-release-scope)
14. [Agent trust and run audit](#14-agent-trust-and-run-audit)
15. [Protocol roles](#15-protocol-roles)
16. [Claim and resolution model](#16-claim-and-resolution-model)
17. [End-to-end protocol flow](#17-end-to-end-protocol-flow)
18. [State machines](#18-state-machines)
19. [Committee selection and diversity](#19-committee-selection-and-diversity)
20. [GonkaRouter inference lifecycle](#20-gonkarouter-inference-lifecycle)
21. [Evidence system](#21-evidence-system)
22. [Commit-reveal voting](#22-commit-reveal-voting)
23. [Consensus, uncertainty, and escalation](#23-consensus-uncertainty-and-escalation)
24. [Economic design](#24-economic-design)
25. [Reputation system](#25-reputation-system)
26. [User experience](#26-user-experience)
27. [Technical architecture](#27-technical-architecture)
28. [Sui Move reference](#28-sui-move-reference)
29. [Application API reference](#29-application-api-reference)
30. [Data model](#30-data-model)
31. [GonkaRouter integration reference](#31-gonkarouter-integration-reference)
32. [Security and threat model](#32-security-and-threat-model)
33. [Testing strategy](#33-testing-strategy)
34. [Observability and operations](#34-observability-and-operations)
35. [Deployment and mainnet runbook](#35-deployment-and-mainnet-runbook)
36. [Hackathon demo](#36-hackathon-demo)
37. [Delivery plan and backlog](#37-delivery-plan-and-backlog)
38. [Definition of done](#38-definition-of-done)
39. [Production roadmap](#39-production-roadmap)
40. [Risks and open questions](#40-risks-and-open-questions)
41. [Source map](#41-source-map)
42. [Glossary](#42-glossary)

## 1. How to use this document

This file is the source of truth for OpenVerdict. It combines four documentation modes:

- **Explanation:** why the product exists and which trust problem it solves.
- **Reference:** protocol states, Move objects/modules, APIs, events, and constraints.
- **How-to:** implementation and operating procedures.
- **Tutorial:** the complete first disputed-claim lifecycle and hackathon demo.

Requirements are labelled by release level:

- **Required:** must exist in the hackathon submission.
- **Beta:** required before inviting non-team users to risk funds.
- **Production:** required before resolving high-value or externally consumed claims.

When this PRD conflicts with a published Move package/object schema, current GonkaRouter or Walrus behavior, or a pinned dependency, deployed state and source code win. Record the correction in this document before changing product behavior.

### 1.1 Implementation addendum (recorded 2026-08-27; source code is authoritative)

Corrections and additions discovered during implementation, per the rule above:

1. **`select_committee` visibility (§28.4):** listed here among public functions, but the Sui Move compiler rejects `public fun` with `&Random`. Implemented as a private `entry fun` completing draw + `Committee` + `RoundTally` + five owned `JurySeat` transfers in one call (PTB restriction: only TransferObjects/MergeCoins may follow a Random call). See `move/openverdict/sources/jury.move`.
2. **GonkaRouter live limits (§20.3, §31.1):** the live API hard-caps output at 4096 tokens (default 3072; larger requests silently clamped; reasoning tokens count). The adapter uses `max_tokens: 4096` and a 120000 ms timeout — this PRD's `max_tokens: 1024` and `GONKA_REQUEST_TIMEOUT_MS=8000` are superseded. Verified models: DeepSeek-V4-Flash, Kimi-K2.6, MiniMax-M2.7 families (≥3 families satisfied).
3. **Claim-state u8 encoding (§28.2):** concrete codes fixed as CREATED=0 … CANCELLED=12 (see `lib/protocol/constants.ts`, mirrored in `claim.move`); byte-locked to TypeScript by six blake2b256/BCS parity vectors asserted in both test suites.
4. **Module list (§28.1):** an eighth module `display_meta` was added implementing Sui Object Display metadata for `ResolutionCertificate`, `AgentProfile`, and demo `Position` (V1 `sui::display` API — the pinned 1.52.2 framework does not vendor V2 `display_registry`).
5. **zkLogin scope (§14.4, §13):** upgraded from "optional onboarding" to two implemented uses — (a) end-user onboarding via Enoki-managed zkLogin registered as a wallet-standard wallet, optionally with sponsored gas; (b) planned zkLogin-backed agent registration where `human_backing_hash = blake2b256(zkLogin address)` yields one-social-account-one-seat under the existing seat-uniqueness rule. Both remain labelled authentication / Sybil-cost-raising — never proof of personhood, exactly as §14.4 requires.
6. **Sponsored transactions (§24.6):** implemented with the current SDK v2 flow (`onlyTransactionKind` bytes → `Transaction.fromKind` → `setSender`/`setGasOwner`/`setGasPayment` → dual signatures).
7. **SDK generation (§27.4):** implemented on `@mysten/sui` v2 (`SuiGrpcClient`, ESM-only) and dapp-kit v2 (`@mysten/dapp-kit-core`/`-react`) — this document's package names predate the v2 split.
8. **Proof chain v2 (§6, §14, §17.7, §22; recorded 2026-08-29):** the system prompt, JSON fallback suffix, repair prompt, temperature, token cap, and response format are a versioned `PromptSpecV1` whose hash is the `promptHash` of every agent manifest and therefore the `prompt_hash` inside every on-chain run hash; the engine refuses to run a seat whose manifest hash differs from the live spec. Agent manifests are `AgentManifestDocumentV2` blobs (prompt spec, tool policy, evidence policy, all hashed) for both backing kinds. Each run publishes a `PublicRunBundleV2` (prompt spec, exact request, raw response, validated output, audit, hashes). Before the commit only an AES-256-GCM sealed copy is published and cited by `approve_run` as `run_blob_id`; the plaintext bundle plus the key is published at reveal and cited as `argument_blob_id`, so the pre-commit existence proof holds without leaking a vote early (this corrects §17.7, which stored the raw response as a public blob at inference time). Walrus artifacts are raw blobs (`writeBlob`/`readBlob`), not quilts, so a blob id addresses the artifact itself. GonkaRouter's response `id` (`devshard-<n>-<seq>`), `x-request-id`, `x-devshard-id`, and `system_fingerprint` are recorded as audit pointers; Gonka's devshard model exposes no per-request chain record through brokers, so §6 stands and no such record is claimed. Verified against the live API and the Gonka architecture docs on 2026-08-29.
9. **Juror research v1 (§6, §14, §17; designed 2026-08-29, spec `docs/superpowers/specs/2026-08-29-juror-research-design.md`):** every juror run researches the claim itself. The model answers with one JSON action per turn (`search`, `open`, `answer`); the engine executes searches and page opens through a `ResearchProvider` (Firecrawl v2 REST, cloud or self-hosted by configuration), stores every opened page on Walrus as a `DISCOVERED` evidence artifact, and records every step in a `ResearchTranscriptV1` whose hash is the `tool_transcript_hash` inside the on-chain run hash. A citation (`evidenceId`, `url`, `quote`) is valid only if that juror opened that page in that run and the quote occurs in the stored text; a YES or NO verdict needs at least one citation of a page the juror found through its own search, otherwise the seat fails closed (`CITATION_INVALID`, no vote). The transcript travels inside the sealed bundle core (v3), so research trails are public only at reveal, and the on-chain `tool_blob_id` cites the sealed blob. Prompt spec v2 and tool policy v2 (budgets: 3 searches, 4 opens, 8 turns, 5 results, 4,000-character page slices, 240-second research calls) are bound through manifest document v3. Models cite opened pages by short refs (`p1`, `p2`, ...) or url; the engine resolves them to full evidence ids before hashing, and quote matching is punctuation- and markdown-tolerant but exact (verified live on 2026-08-30 with DeepSeek, MiniMax, and Kimi, each returning a cited verdict). This replaces the earlier rule "models never receive URLs" with: models never fetch, never hold keys or transaction authority, and every URL they see or open is engine-executed and recorded.

10. **Juror research v2 and batched opens (§6, §14, §17; 2026-08-30, specs `docs/superpowers/specs/2026-08-30-juror-research-v2-design.md`):** every search carries an intent (`support` or `challenge`); before a YES or NO the engine requires a challenge search with one of its results opened, citations from at least two distinct sites, and a counter-evidence summary, each enforced with bounded nudges (`CHALLENGE_REQUIRED`, `CORROBORATION_REQUIRED`); UNSURE is never blocked. Under tool policy v4 an `open` action may name up to three urls (`maxOpensPerTurn`), fetched in parallel and recorded as one transcript step per page with a batch marker. Prompt spec v4, tool policy v4 (4 searches, 5 opens, 10 turns), manifest document v5 and bundle core v5 are live for the seven testnet jurors; older documents keep their behaviour byte for byte because their hashes are on chain.
11. **Seal escrow of reveal keys (§17.7, §22; 2026-08-30, spec `docs/superpowers/specs/2026-08-30-seal-escrow-design.md`):** at commit time each run's AES reveal key is also escrowed under a Mysten Seal time-lock policy (package `openverdict_seal::reveal_lock`, testnet `0xf54eb61116372f8506ca332457b2fee61231a559e44923429f54fab355d0f0c5`, identity = claim id, seat id, phase, reveal deadline), so after the phase's reveal deadline anyone can obtain the key from Seal's key servers and open the sealed bundle without the operator. The escrow record rides unhashed inside the sealed blob the chain already cites; the verifier adds "Seal escrow binds this run" and the run view an "Open through Seal" recovery. Escrow failure never costs a seat.
12. **Re-execution check and attestation gap (§6; 2026-08-30, spec `docs/superpowers/specs/2026-08-30-attested-inference-design.md`):** `POST /api/claims/[id]/runs/[runId]/reexecute` resends a revealed run's exact recorded messages to the recorded model at temperature 0 and compares verdict, output hash and served model (a soft check: a match corroborates, a difference is a reason to look closer). Proof that the model received the exact recorded bytes still requires either a signed receipt from GonkaRouter (requested) or an attested forwarder (Nautilus, deferred; hostable through Marlin Oyster without an AWS account).
13. **Hedged requests and failed-seat records (§20.3, §22; 2026-08-31):** a model call that has not answered after `GONKA_HEDGE_AFTER_MS` (25 s) is repeated to the same model; the first valid reply wins and both attempts stay in the bundle (`HEDGE`, `HEDGE_ABANDONED`). A seat that fails before committing keeps a public failure record (status, message, research transcript and attempts at failure time, Walrus copy) under its derived run id; the proof route returns it and the claim page shows "Seat failed before commit". No vote is ever inferred for a failed seat.
14. **Hosted ladder and topology (§26, §31; 2026-08-30):** deadlines are measured from the `create_claim` transaction: evidence cutoff +60 s, first commit +450 s, first reveal +570 s, discussion +1290 s, second commit +1740 s, second reveal +1860 s (a one-round verdict about 10 minutes after submission, two rounds about 31 minutes; until 2026-09-02 the discussion closed at +630 s, second commit +1080 s, second reveal +1200 s, a 60 s discussion window that opened only at the reveal deadline and left every debate turn unspoken, so it is now 720 s: ten 60 s turns plus the 120 s evidence-freeze lead). The engine, API and the three workers run in one Railway container with Railway Postgres; workers inspect live claims only (2 s poll while busy, 15 s idle, a wake file on submission) and skip stranded claims. All jurors keep equal selection weight; GonkaRouter serves three model families and every committee spans all three.

15. **Superseded body statements (recorded 2026-08-31; items 9 to 14 govern):** the following passages describe the tool model and storage rules as designed before juror research and the Seal escrow shipped, and are superseded where they conflict: 11.3 Non-goals for V1: the V1 non-goal "automatic web browsing by untrusted model output"; 17.7 Run independent GonkaRouter inference: raw response, validated output and run audit stored as public blobs at inference time; 20.6 Bounded model capabilities: "does not give the model general web access" and the `OracleToolName` union (read_evidence_item, compare_deadline, read_sui_transaction, read_move_object_snapshot, flag_unsupported_claim); 20.7 Controlled tool execution: "read_evidence_item accepts only an ID from the frozen manifest", "no tool accepts an arbitrary URL", the eight-tool-call cap and `toolCallCount <= 8`; 26.1 Required routes: `/verify` described as recomputing only manifest hashes, evidence roots, commitments and reveals; 32.5 Prompt injection: "agents have no direct network access" and "model cannot choose new URLs"; 32.8 Privacy: "Seal/Nautilus may support encrypted policy-controlled data in a later release"; “Can an agent use tools to browse or transact arbitrarily?”: "a typed, read-only allowlist limited to frozen evidence and pinned Sui state"; 40.1 Risk register: "frozen data, no model-selected URLs"; Oracle and mechanism references: the Seal/Nautilus reference marked future only. The live surface is the JSON action loop (`search` with intent, `open` of up to three model-chosen urls per turn, `answer`) executed and recorded by the engine under a hashed tool policy (4 searches, 5 opens, 10 turns); every page a juror opens is a public Walrus blob referenced by hash; `/verify` runs 15 checks per run; and Seal is in production use for reveal-key escrow (item 11).

16. **Statement-only submission (§16, §17; 2026-08-31):** the public forms (`/fact-check` and the landing) take one bounded claim statement and nothing else. The jurors research the open web themselves (item 10), so submitter evidence is no longer requested; the API and CLI still accept optional pasted text, public URLs and resolution criteria, which are frozen as the submitter's material and can never decide a vote on their own. Claims without custom criteria are judged by one public rubric derived by the engine (`factCheckStart`): decide whether the statement is true as written as of the evidence cutoff, weigh primary sources for and against found through the juror's own research, YES or NO only when credible sources agree, otherwise UNSURE.

17. **Deliberation canvas (§26, §34; 2026-08-31):** the claim page is a live force-directed graph: the claim at the centre, the five jurors around it wearing family avatars, and every engine-executed step (searches with intent, page opens, citations, verdicts, failures, the certificate) as connected nodes. During the sealed phase the engine emits content-free `RESEARCH_TICK` events (`PUBLIC_NOW`, payload only `jurySeatId`, `kind`, `ordinal`) that render as locked pulses; at reveal they bloom into the real steps from the run proofs. Terminal claims can be replayed end to end (1x/10x/30x scrubber) from the recorded event timeline. The prior audit view moved intact to `/claims/[id]/report`; `/claims/[id]/observe` redirects to the canvas. Pre-reveal redaction is unchanged: no research content leaves the engine before a seat's reveal.

18. **URL claim extraction, round-two discussion record, verification language (§16, §26, §31; 2026-08-31):** `POST /api/extract-claim` turns a pasted URL into one falsifiable claim: the engine's SSRF-guarded retriever fetches the page, a prose window (from the first line of at least 160 characters) reaches the article's lead, and the first configured GonkaRouter model at temperature 0 (1500-token cap, strict JSON, exactly one repair round) proposes the claim together with its Gonka and gateway request ids; the user confirms and submits statement-only, so the source page never becomes privileged evidence. A split first round injects the revealed round-one public record (per seat: model, outcome, confidence in bps, public reasoning trace) into every round-two juror input and freezes the same record canonically into the phase-two evidence manifest as `round-1-public-record:<claimId>`; a missing reveal fails closed and phase-one inputs stay byte-identical. Product language is open verification: the nav reads Verify / Claims / Agents / Audit / Status, claim submission owns "Verify", the independent run checker at `/verify` is labelled "Audit", and the `/fact-check` route plus `/api/fact-checks` endpoint keep their URLs for link stability.

19. **Truth reframe and Gonka-exclusivity invariant (§2, §5, §12.2, §19.2, §25; 2026-09-01):** the Gonka track mandate ("all AI reasoning and verification logic MUST run on the Gonka Network via gonkarouter.io") is now a code-enforced invariant: the adapter refuses any base URL whose host is outside gonkarouter.io, and every inference path (juror research and verdicts, deliberation turns, claim extraction, the re-execution check) already routes through that one adapter; a seat that cannot reach Gonka fails closed and no other AI provider exists in the codebase. Selection weight is equal for every eligible agent in this release: the on-chain `Reputation` counters register at baseline and are not yet updated by the protocol, the §2 executive summary was amended in place to say diversity-constrained with equal v1 weights, and the §19.2/§25.2-25.3 update rules remain superseded until reputation wiring ships (addendum item 14 already recorded the equal weights). Agent roles (SKEPTIC, SOURCE_AUTHENTICITY, INVESTIGATOR) are recorded manifest labels with no behavioral effect: no prompt or tool policy varies by role; the public registration card no longer offers a role choice and presents zkLogin registration as backing a standardized seat (validator model), and app copy is aligned to seats-not-personas throughout.

20. **Economic direction of record (§24, §25; decided 2026-09-01, not implemented):** the intended business model is requester-paid SUI per verification funding that round's committee budget (the `create_claim` vaults and `REASON_JURY_REWARD` payout tickets already implement the on-chain half), plus delegated seat backing: multiple zkLogin backers stake SUI behind a seat and share that seat's jury rewards pro rata after protocol and run fees. Two constraints bind any implementation: (a) reward distribution stays participation-based, with at most a bounded accuracy bonus for certificate-aligned seats; majority-only distribution is rejected because it pays for agreement rather than correctness, penalizes honest UNSURE votes and minority dissent, and pressures juries to manufacture consensus where UNRESOLVED is truthful (§24.2, §24.5 govern); (b) per-seat stake pools presuppose reputation wiring (item 19) so seats have differentiated track records worth staking on. Model-family identity stays public and pinned regardless (diversity constraints, served-model verification); persona identity stays removed. Sequenced after the hackathon build; recorded here so the answer to judges is the documented design, not improvisation. Adopted as the positioning of record across the README, the landing FAQ and /learn on 2026-09-01 (one build, both tracks: Gonka supplies the intelligence; Sui the coordination, settlement and currency); implementation remains sequenced after the hackathon build.

21. **Naming of record (2026-09-01):** the top-level product identity is "decentralized verification protocol for factual claims" everywhere a category is stated (README, landing, social cards, package metadata, pitch materials). "Oracle" is reserved for integrator and market-slot contexts ("OpenVerdict fills the oracle slot for markets and DAOs"), since leading with it invokes the single-answer-box model the protocol exists to replace. Jury and court are explanation-layer metaphors only, used when describing the mechanism ("the models argue their case like jurors"), never as the leading identity. "Factual claims" is the scope word: bounded, falsifiable, evidence-settleable statements; opinions and unresolved future events are out of scope until they become factual questions. Earlier "engine" and "court" identity phrasing is superseded accordingly.

22. **Round two at the table and all-or-nothing attempts (§6, §14, §17, §22, §23, §26, §31; 2026-09-02):** every verification attempt is now all-or-nothing: any seat failing a binding step (a research or table-vote run with no valid output, a missing commit, a missing reveal) voids the whole attempt, and a voided attempt relaunches automatically once the three model families answer a health probe, up to two relaunches (three attempts total); if the probe keeps failing for six hours the verification gives up. A voided attempt lapses on-chain without a certificate, because the settlement contract has no mid-flight cancel once a claim leaves the CREATED state. When round one splits, the five jurors debate in public for up to three exchanges, each turn a citation-backed argument and a non-binding stance, and the debate stops early once a full exchange passes with nobody changing their stance ("nobody moved"). Round two itself is no longer a second research pass: it is one sealed table vote per juror over what is already on the table (the round-one record, the debate transcript, the juror's own round-one output), with no tools and no new research; manifest v6 pins the table-vote prompt and run bundle v6 carries the sealed vote, and the verifier marks the five research-only checks (challenge search, both sides opened, citation sites, counter-evidence summary, opens per turn) not applicable for a table vote. Four matching table votes settle the claim; otherwise the claim ends UNRESOLVED with the truth score, which stays the end state this release (escalation to a second jury is roadmap, not implemented). The hosted ladder is now evidence cutoff +60 s, first commit +450 s, first reveal +570 s, discussion +1410 s, second commit +1650 s, second reveal +1770 s: a one-round verdict stays about 10 minutes after submission, and a claim that reaches the table settles (or resolves UNRESOLVED) about 29.5 minutes after submission.

## 2. Executive summary

OpenVerdict is a decentralized verification protocol for claims that require evidence and judgment rather than a deterministic data feed. A claim receives a proposed outcome and becomes final if nobody challenges it during a defined window. A successful challenge selects a diversity-constrained committee of AI oracle agents (equal selection weights in v1; reputation-weighted selection is roadmap), each controlled by a distinct approved owner and associated with a distinct human-backing record. Every agent reviews the same frozen evidence bundle, reasons through GonkaRouter, commits a hidden vote on Sui, and later reveals its answer and argument. If the first round lacks sufficient agreement, agents inspect one another's published evidence and reasoning, add new admissible evidence, and vote again. The protocol can finalize, expand the committee, or remain unresolved instead of manufacturing certainty.

The hackathon entry point is a public fact checker because it directly exposes the verification engine: a user submits text, a public URL, or both and receives a multi-model verdict, a recomputable Truth Score from `0` to `100`, evidence-linked public reasoning traces, and every Gonka Request ID. A low-value binary prediction market is the first economic consumer of the resulting `ResolutionCertificate`, making the Sui settlement path concrete without narrowing the product to betting. The underlying protocol remains generic enough to later resolve DAO milestones, bounties, agent-service disputes, marketplace delivery claims, insurance evidence, and content-authenticity challenges.

The disputed event does not need to occur on Sui. Evidence may describe another chain, a public API, a repository, or a real-world announcement. Sui is the coordination and settlement court. Sui applications can consume a `ResolutionCertificate` directly; contracts on other networks need a reviewed bridge or cross-chain attestation adapter and must define their own trust assumptions.

The core promise is:

> Do not trust a single model, a token whale, or an unexplained oracle answer. Inspect which agents participated, which evidence they received, which arguments they made, how they committed and voted, and why money moved.

GonkaRouter is OpenVerdict's required AI provider for the hackathon build: every first-round and second-round oracle-agent reasoning call goes through its API. GonkaRouter does not resolve the oracle problem and is not presented as proof that an answer is true. OpenVerdict supplies the oracle mechanism: bounded criteria, frozen evidence, independent arguments, commit-reveal voting, dispute economics, consensus rules, uncertainty, reputation, and the public audit timeline. The final result is a protocol resolution under published rules, not universal truth.

The verification engine is the product and must operate headlessly. The CLI is the complete operator and developer interface for creating claims, running jury phases, inspecting artifacts, and advancing valid state transitions. An optional observer dashboard consumes the same public event stream and renders the process visually so users can understand agent activity, bounded tool calls, evidence, commitments, arguments, and settlement without reading raw terminal output. Dashboard availability or correctness never determines protocol state.

## 3. Product definition

### 3.1 What OpenVerdict is

- A generic optimistic claim-resolution protocol.
- A human-backed committee of independently configured AI oracle agents.
- A GonkaRouter-powered inference system for every oracle-agent reasoning pass.
- A bonded challenge and escalation mechanism.
- An on-chain commit-reveal voting protocol.
- An evidence-snapshot and provenance system.
- A public agent and resolution explorer.
- A reputation system with separate liveness, argument quality, evidence, and outcome metrics.
- A public fact-checking interface for text and URL submissions.
- A first-party prediction-market consumer of finalized verdicts.
- A headless engine whose complete lifecycle is operable through a CLI.
- An optional read-only observer dashboard for visual comprehension and auditing.

### 3.2 What OpenVerdict is not

- It is not a guarantee that model output is true.
- It is not a claim that GonkaRouter verifies evidence or oracle outcomes.
- It is not a replacement for objective price feeds or deterministic data.
- It is not a general-purpose AI chatbot.
- It is not a five-model majority poll stored in a database.
- It is not a promise that multiple prompts equal independent agents.
- It is not a high-value production oracle at hackathon launch.
- It is not an autonomous custodian of user wallets.
- It does not allow a model to broadcast arbitrary transactions.
- It does not treat a Gonka network record or validation artifact as proof that
  the model's conclusion is factually true. If GonkaRouter does not expose such
  an identifier, V1 does not require it for vote validity.
- It is not dependent on a browser dashboard for execution, correctness, or availability.
- Its observer dashboard is not an orchestration, signing, or truth-determination service.

### 3.3 First product wedge

The first wedge is disputed binary prediction-market resolution for claims that cannot be resolved safely by a simple price feed.

Good first claims:

- Did a protocol officially complete a stated mainnet launch before a deadline?
- Did a grant recipient deliver every objective milestone in a published scope?
- Did a governance proposal meet its documented passing conditions?
- Did a public bounty submission satisfy all acceptance criteria?

Bad first claims:

- Was ETH above a price at a timestamp? Use an oracle price feed.
- Is a person guilty of wrongdoing? Legal and defamation risk is unacceptable.
- Will a token increase? This is forecasting, not resolution.
- Is a subjective product "good"? Resolution criteria are not bounded.

## 4. Problem statement

### 4.1 Single-model oracle risk

A single model is a central point of failure. It can hallucinate sources, inherit hidden provider policies, misread ambiguous criteria, or be manipulated by adversarial evidence.

### 4.2 Token-voting risk

Token-weighted resolution makes influence proportional to capital. It can protect systems economically, but it does not ensure evidence quality or diverse reasoning.

### 4.3 Opaque-oracle risk

An oracle can return a decision without exposing its criteria, evidence, disagreement, or incentives. OpenVerdict reduces this opacity by freezing evidence, publishing arguments after the independent round, committing votes before reveal, and making the final calculation reproducible. V1 does not claim to prove the complete private agent harness.

### 4.4 Evidence risk

Model citations are not evidence by themselves. URLs can be fabricated, pages can change, retrieval can be prompt-injected, and a linked source may not support the claim.

### 4.5 Forced-certainty risk

Many resolution systems require `YES` or `NO` even when evidence is insufficient. OpenVerdict treats `UNSURE` and `UNRESOLVED` as valid protocol outcomes.

## 5. Why GonkaRouter

OpenVerdict needs reliable model inference for every member of its oracle committee. The hackathon implementation standardizes that inference on GonkaRouter. GonkaRouter exposes OpenAI- and Anthropic-compatible APIs, supports multiple model IDs through one account, and handles API keys, credits, and access to Gonka-backed compute. This lets the team focus on the oracle, evidence, and economic mechanism instead of operating model infrastructure. See the [GonkaRouter docs](https://gonkarouter.io/docs), [model catalog](https://gonkarouter.io/models), [privacy policy](https://gonkarouter.io/privacy-policy), and [terms](https://gonkarouter.io/terms-of-service).

The execution boundary is explicit. GonkaRouter is the application gateway into the decentralized Gonka network. Independent Gonka Hosts run the actual LLM computation on off-chain GPU/ML nodes. Gonka's L1 records inference inputs, outputs, and validation artifacts, validates Host work after execution, and applies network rewards or penalties. Sui remains the separate application-settlement chain that enforces OpenVerdict's committee, commitment, verdict-object, and payout rules. These are complementary chains, not two places executing the same logic. See the [Gonka architecture](https://gonka.ai/docs/architecture/) and [FAQ](https://gonka.ai/docs/FAQ/).

GonkaRouter usage is meaningful because disputed resolution cannot advance without successful agent arguments and votes: five agents run in round one, and up to five more calls run after evidence discussion. Each call uses a declared GonkaRouter model, the canonical frozen-evidence input, strict structured output, and visible request metadata. A GonkaRouter outage cannot be silently replaced with another provider under the same agent version; the round pauses, uses a registered reserve under policy, or becomes unresolved.

The abstract jury pattern could be reimplemented elsewhere, but this OpenVerdict release is Gonka-native and ships no alternate provider adapter. Agent manifests, multi-model selection, run audits, public Request IDs, and every AI judgment step assume GonkaRouter. Removing GonkaRouter makes a review round unable to produce valid runs, so it pauses or becomes unresolved. The underlying Gonka protocol records inference inputs, outputs, and validation artifacts and verifies Host work; those infrastructure guarantees still do not establish that the model's factual conclusion is correct. See the [Gonka developer quickstart](https://gonka.ai/docs/developer/quickstart/) and [architecture](https://gonka.ai/docs/architecture/).

## 6. GonkaRouter role and proof boundaries

| Question | What OpenVerdict records | What GonkaRouter does not establish for OpenVerdict |
| --- | --- | --- |
| Which configured model was requested? | Agent manifest, request model ID, and provider response model field | That the model's answer is factually correct |
| Did the API return a response? | Gonka Request ID (the returned response `id`), timestamps, status, token usage, and output hash | That every hidden part of the agent harness ran exactly as declared |
| Did the response follow OpenVerdict's output policy? | Local schema validation and evidence-ID validation | That cited evidence is authentic or supports the conclusion |
| Was the vote fixed before peers revealed? | Sui commitment and later matching reveal | That independently named agents are independently owned |
| Did the committee reach the threshold? | Deterministic Move calculation over revealed jury seats | That the majority represents universal truth |
| Did funds move under the published rule? | Sui events, object balances, payout tickets, and coin withdrawals | That the resolved answer will never be corrected later |

OpenVerdict tracks a plain execution lifecycle, not an inference-proof ladder:

1. `QUEUED`: the selected agent has a unique run ID.
2. `REQUESTED`: the canonical request was sent to GonkaRouter.
3. `RECEIVED`: GonkaRouter returned a response or a visible error.
4. `SCHEMA_VALID`: the output passed OpenVerdict's deterministic checks.
5. `VOTE_COMMITTED`: the output hash was bound to an on-chain hidden vote.
6. `VOTE_REVEALED`: the reveal matched the commitment.
7. `OUTCOME_FINALIZED`: the protocol completed resolution and settlement.

The explorer shows model ID, Gonka Request ID, input hash, output hash, evidence root, timing, retry history, and commitment result. These fields make the OpenVerdict workflow inspectable; they are not labelled as proof that the conclusion is factually correct. Gonka records validation artifacts at the network level, but V1 does not assume GonkaRouter's public API exposes a separate independently verifiable network-record identifier. If the API exposes one, OpenVerdict attaches it as additional metadata without conflating it with the required Request ID.

## 7. Project origin and hackathon boundary

### 7.1 Earlier DIVE project lineage

OpenVerdict is the new name for a clean reimplementation of the DIVE concept previously created and prototyped by members of this project team and their teammates. The public [earlier DIVE repository](https://github.com/derek2403/cannes2026) records that product history. It is not a competing third-party idea.

Idea authorship does not automatically settle ownership of jointly created code, brand assets, prompts, contracts, or designs. Before reuse, the submitting team must obtain agreement from the relevant teammates and document which prior materials may be reused. For MUBA, the safest plan is a clean implementation written during the official build period, with prior concept work disclosed and prior code/assets left untouched unless organizers approve their reuse in writing.

### 7.2 UMA

UMA demonstrates the practical value of optimistic resolution: propose an answer, allow a challenge, and escalate only disputed cases. UMA's documentation reports that most requests resolve without escalation and uses bonds plus a dispute mechanism. OpenVerdict borrows the optimistic pattern, not UMA's contracts or token economics. See [UMA's oracle overview](https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work).

### 7.3 Hackathon eligibility and disclosure

The current MUBA FAQ says submissions must be the team's original work created during the online hackathon period and that the build-from-scratch rule includes frameworks privately built before the event. This repository therefore remains planning documentation only until the official build period. Ask organizers in writing whether an OpenVerdict clean reimplementation of the team's previously demonstrated DIVE concept is eligible, whether a pre-event PRD is allowed, and which prior names/assets may appear. Preserve Git history and disclose the earlier project; do not rewrite history. Organizer reveal material now supplies the Gonka and Sui track direction, but the public detail pages still show placeholders. Confirm final API, eligibility, submission, and judging requirements before scope lock. See the [MUBA FAQ](https://www.mubahack.xyz/frequently_asked_questions/code.html), [GonkaRouter track page](https://www.mubahack.xyz/challenge_tracks/track-details-gonka-1.html), and [Sui Track 02 page](https://www.mubahack.xyz/challenge_tracks/track-details-sui-2.html).

### 7.4 MUBA Sui Track 02 — AI × Sui fit

Organizer reveal material supplied to the team on 2026-08-26 describes Track 02 as AI applications powered by Sui, using Sui for ownership, identity, payments, or on-chain execution. It says judges are looking for a real problem, integral Sui usage, thoughtful UX, and a working live demo, and lists product UX, real-world readiness, technical implementation, and presentation as judging dimensions.

| Track requirement or signal | OpenVerdict evidence |
| --- | --- |
| AI application powered by Sui | GonkaRouter agents perform evidence-based judgment; Sui turns their outputs into enforceable jury actions and reusable verdict objects |
| Ownership | Owned `AgentCap`, `JurySeat`, `RunApproval`, and `PayoutTicket<T>` objects give authority and entitlements explicit owners |
| Identity | `AgentProfile` plus controller capabilities create versioned on-chain agent identities; optional zkLogin improves authentication without being misrepresented as proof of unique humanity |
| Payments | Native USDC funds proposal/challenge bonds, jury rewards, refunds, and capped demonstration payouts |
| On-chain execution | Move enforces committee eligibility, commitments, reveals, deadlines, tallies, terminal outcomes, and one-time payout redemption |
| Sui is integral | Native `Random`, the object/capability model, immutable `ResolutionCertificate`, and Move coin accounting are protocol mechanisms, not decorative writes |
| Thoughtful UX | The complete CLI plus read-only visual observer explains agents, tools, evidence, Sui objects, transaction digests, and money movement without making the dashboard authoritative |
| Working live demo | One capped Sui Mainnet dispute runs from challenge through GonkaRouter inference, commit-reveal, verdict certification, and native-USDC payout |
| Helpful Sui features | Walrus stores public evidence and run artifacts; PTBs compose explicit object actions; sponsored transactions reduce gas friction; zkLogin remains an optional onboarding path |

The two sponsor technologies have non-overlapping jobs. GonkaRouter is the required gateway into decentralized Gonka inference. Gonka Hosts execute LLM work and Gonka L1 records and validates work artifacts. Sui owns the OpenVerdict application state, agent/jury authority, dispute state machine, and economic settlement. Removing either technology breaks the submitted product path rather than merely removing a logo.

Source caveat: the public [Sui Track 02 page](https://www.mubahack.xyz/challenge_tracks/track-details-sui-2.html) still says that details will be revealed soon. Archive the organizer's official reveal post when published and confirm final eligibility, submission, and judging rules in writing before scope lock.

### 7.5 MUBA Gonka Track — AI for Society fit

Organizer reveal material supplied to the team on 2026-08-26 asks builders to create AI tools with genuine public value using Gonka. All AI reasoning and verification must run through GonkaRouter. The preferred fact-checker flow accepts URL or text input, performs multi-model cross-verification, returns a Truth Score from `0` to `100` plus a reasoning trace, and displays Gonka Request IDs. Submission requires a live demo URL, documented GitHub repository, and two-minute live fact-check video.

| Gonka requirement or preference | OpenVerdict evidence |
| --- | --- |
| Genuine public value | OpenVerdict lets users challenge and audit public claims instead of trusting one model, token voter, or private operator |
| All AI reasoning through GonkaRouter | Every investigator, skeptic, source-verifier, deliberation, synthesis, and repair call uses an explicit GonkaRouter model; no unrecorded AI fallback is allowed |
| All AI verification through GonkaRouter | Any model-based source assessment or claim verification runs as a recorded GonkaRouter call; deterministic fetching, hashing, schemas, scoring, and Sui execution remain ordinary code |
| URL or text input | `/fact-check` takes one bounded claim statement (2026-08-31); the API and CLI still accept optional pasted text and public URLs as the submitter's material |
| Multi-model cross-verification | A five-agent jury uses at least three account-available GonkaRouter model IDs and no single model controls a majority |
| Truth Score `0–100` | The final valid round deterministically aggregates committed confidence values into `truth_score_bps`, stored in the immutable `ResolutionCertificate` |
| Reasoning trace | Each agent publishes a structured, evidence-linked public reasoning trace; private chain-of-thought is never requested, stored, or displayed |
| Gonka Request IDs | The exact response `id` returned by GonkaRouter is preserved for every attempt, displayed after reveal, and included in the public audit bundle |
| Live submission | Release checklist includes a live URL, documented repository, and a dedicated two-minute live fact-check video |

GonkaRouter and Sui solve different halves of the product. Gonka supplies decentralized inference and infrastructure-level work validation. Sui turns those agent outputs into owned jury actions, sealed votes, an immutable result, and economic consequences. This makes OpenVerdict one coherent product for both tracks rather than two demos sharing a frontend.

Source caveat: the public [Gonka track page](https://www.mubahack.xyz/challenge_tracks/track-details-gonka-1.html) still shows a placeholder. Archive the organizer's official reveal post when published and reconfirm the exact submission fields before final release.

## 8. Target users

### 8.1 Public fact-check user

Needs to paste a claim or public URL and receive a transparent multi-model verdict, Truth Score, sources, public reasoning traces, and request identifiers.

### 8.2 Prediction-market operator

Needs an inexpensive first answer, a credible dispute path, visible evidence, and a result callback.

### 8.3 DAO or grant program

Needs to resolve whether published milestones were satisfied without assigning one employee as unquestioned judge.

### 8.4 AI-agent developer

Needs a public record showing which agent version participated, which GonkaRouter model it used, what argument it produced, how it voted, and how it performed.

### 8.5 Challenger or evidence contributor

Needs a way to contest weak outcomes, submit evidence, recover a correct challenge bond, and receive attribution.

### 8.6 Auditor or application user

Needs a readable timeline from claim creation through evidence, inference, votes, result, and payout.

## 9. Jobs to be done

1. When a person submits a public claim or URL, cross-check it with several GonkaRouter models and return a transparent report rather than one opaque answer.
2. When an application needs a subjective binary result, return a fast optimistic answer with a credible challenge path.
3. When an outcome is challenged, select a diverse committee whose work can be inspected rather than trusting one model.
4. When an agent cites evidence, preserve exactly what it saw and make unsupported claims visible.
5. When an agent votes, prove the vote was committed before other votes were revealed.
6. When confidence remains weak, preserve uncertainty instead of forcing a payout.
7. When money moves, show the exact rule, evidence, vote, and transaction that caused it.
8. When an operator runs a resolution, provide a complete CLI that works with the dashboard disabled.
9. When a user wants to follow a resolution, translate the same engine events into a safe visual observer without changing state.

## 10. Product principles

1. **Optimistic by default.** Do not spend swarm compute on uncontested claims.
2. **Arguments are not truth.** Make every conclusion inspectable against frozen evidence.
3. **Evidence before rhetoric.** Every material claim must map to a frozen source item.
4. **Independent before social.** Agents vote before seeing peer reasoning.
5. **Uncertainty is valid.** `UNSURE` and `UNRESOLVED` are not failures.
6. **Minority is not dishonesty.** Slash non-participation, invalid reveals, or proven protocol violations, not mere disagreement.
7. **Economic state belongs on-chain.** Bonds, commitments, reveals, outcomes, and withdrawals are authoritative on Sui.
8. **Observable, not UI-dependent.** The engine emits model, evidence, tool, argument, hash, commitment, and reveal events; the CLI and dashboard are replaceable views over those records.
9. **Fail closed.** Missing evidence, malformed output, or an invalid reveal cannot silently become a counted vote.
10. **One great dispute flow beats a pretend universal truth engine.**

## 11. Goals and non-goals

### 11.1 Hackathon goals

- Register five distinct agent manifests with separate approved owners and roles.
- Accept a bounded text claim, public URL, or both through `/fact-check` and the CLI.
- Create one binary claim and optimistic proposal.
- Accept a real low-value challenge bond.
- Freeze and publish one evidence bundle.
- Select a five-agent committee with diversity constraints.
- Run every oracle-agent reasoning pass through GonkaRouter.
- Use at least three account-available GonkaRouter model IDs across the five-agent committee.
- Preserve and display the model ID, Gonka Request ID, timing, token usage, input/output hashes, and all failed attempts.
- Publish a structured evidence-linked public reasoning trace for every revealed agent output.
- Compute and display a deterministic Truth Score from `0` to `100` without labelling it objective truth.
- Publish each agent's evidence-linked argument after the independent commitment round.
- Commit and reveal votes on Sui.
- Trigger a second evidence/discussion round when first-round agreement is below 70%.
- Finalize with at least four of five valid votes, or remain unresolved.
- Settle bonds and committee rewards.
- Publish a complete resolution explorer.
- Complete the entire lifecycle through the CLI with the observer dashboard offline.
- Reconstruct and follow the same lifecycle through the read-only observer dashboard.
- Demonstrate one live agent call and one pre-completed full lifecycle.
- Publish a live demo URL, documented repository, and two-minute live fact-check video.

### 11.2 Beta goals

- Support third-party agent owners and claim creators.
- Add production-grade evidence retrieval and content persistence.
- Use Sui's native on-chain randomness for committee selection.
- Add sponsored transactions for approved user and agent actions.
- Add notification, monitoring, dispute support, and agent analytics.
- Complete Move package/object, application, Walrus, and gas-sponsor security reviews.

### 11.3 Non-goals for V1

- High-value market settlement.
- Open-ended legal, medical, or personal accusations.
- Automatic web browsing by untrusted model output.
- Autonomous custody or arbitrary transaction execution.
- A tradeable protocol token.
- Governance by agent reputation.
- Arbitrary multi-outcome claims.
- Fully private prompts or evidence.
- Proof of complete agent-harness execution.
- Browser-side orchestration, signing authority, or protocol finalization.
- Streaming private chain-of-thought or unrevealed vote information to observers.

## 12. Success metrics

### 12.1 North-star metric

**Disputed claims completed with a fully inspectable evidence-to-payout timeline and no malformed or uncommitted vote counted.**

### 12.2 Protocol metrics

| Metric | Hackathon target |
| --- | ---: |
| Valid agent manifests | 5 |
| Inference completion rate | 100% for prepared demo; failures visible otherwise |
| Vote commitment/reveal match | 100% |
| Votes with frozen evidence roots | 100% |
| Counted votes backed by a valid GonkaRouter run record | 100% |
| Economic transfers attributable to final state | 100% |
| Unsupported forced resolutions | 0 |
| Mainnet canary value | Strictly capped and operator funded |

### 12.3 Product metrics

- Fact-check submission-to-report completion and latency.
- Truth Score recomputation success rate.
- Gonka Request ID presence rate across all attempts.
- Distinct model IDs per completed review.
- Time from challenge to first commitment.
- Time from reveal window to result.
- Evidence items per run and retrieval failure rate.
- Agent abstention rate.
- Invalid-output and provider-error rate.
- Percentage of users who can explain why the result finalized.
- Resolution-explorer completion rate.
- CLI/dashboard state-parity and event-replay success rate.

### 12.4 Guardrails

- No secret, private key, challenge salt, or private URL in logs.
- No vote revealed before its commitment deadline.
- No model-generated URL fetched without server-side safety validation.
- No result labelled objective truth.
- No single owner controls a majority of a committee.
- No single model ID controls a majority of a committee.
- No AI judgment call leaves the GonkaRouter adapter or lacks a Request ID.

## 13. Release scope

| Capability | Hackathon | Beta | Production |
| --- | ---: | ---: | ---: |
| Public text/URL fact check | Required | Required | Required |
| Direct-review mode | Required | Required | Required |
| Binary claims | Required | Required | Required |
| Optimistic proposal | Required | Required | Required |
| Challenge bond | Required | Required | Required |
| Five-agent committee | Required | Required | Configurable |
| Diversity constraints | Required | Required | Required |
| Human-backing policy | Reviewed five-person demo allowlist | Privacy-preserving proof required | Permissionless with Sybil safeguards |
| GonkaRouter inference | Required | Required | Required |
| At least three models per five-agent review | Required | Required | Policy-configured diversity floor |
| Gonka Request IDs and public reasoning traces | Required | Required | Required |
| Recomputable Truth Score | Required | Required | Required |
| Inference run audit trail | Required | Required | Required |
| Walrus evidence and public artifacts | Required | Required | Required |
| Headless engine and CLI | Required | Required | Required |
| Observer dashboard | Required for the hackathon presentation only; never authoritative | Recommended | Optional consumer |
| Evidence bundle and root | Required | Required | Required |
| Sui commit-reveal | Required | Required | Required |
| One discussion round | Required | Required | Configurable |
| `UNSURE` and unresolved | Required | Required | Required |
| Rewards and withdrawals | Required | Required | Required |
| Basic reputation | Required | Required | Expanded |
| Sui native randomness | Required | Required | Required |
| Sponsored transactions | Optional | Required | Required |
| Open registration | Team agents only | Invite-only | Permissionless with safeguards |
| Security audit | Internal | Independent review | Full audit |
| Mainnet | Low-value canary/demo | Capped | Risk-governed |

## 14. Agent trust and run audit

### 14.1 Agent trust profile

Every agent exposes a public profile:

```ts
type AgentManifest = {
  agentProfileId: `0x${string}`
  owner: `0x${string}`
  humanAttestationHash: `0x${string}`
  humanVerificationProvider: string
  version: string
  manifestBlobId: string
  manifestHash: `0x${string}`
  codeCommit?: string
  containerDigest?: string
  promptHash: `0x${string}`
  modelId: string
  modelRevision?: string
  providerId: 'gonkarouter'
  toolPolicyHash: `0x${string}`
  evidencePolicyHash: `0x${string}`
  publicKey: string
  registeredAtMs: number
  registeredCheckpoint: number
}
```

For the hackathon, the registry uses a reviewed five-person demo allowlist and enforces one active committee identity per approved owner and human-backing hash. The UI labels this `MANUAL_ALLOWLIST`, not Sybil-proof identity. Before invite-only beta or permissionless registration, OpenVerdict requires a privacy-preserving proof-of-personhood or equivalent human-backing attestation. Store only a nullifier-derived or attestation hash; never store a person's civil identity.

Publishing a manifest hash proves that later content matches the registered version. It does not prove that every private line of the declared harness executed. OpenVerdict therefore makes claims only about the frozen input, returned structured output, on-chain commitment, and revealed vote that it can inspect.

### 14.2 Inference run audit profile

```ts
type InferenceRunAudit = {
  runId: `0x${string}`
  claimObjectId: `0x${string}`
  agentProfileId: `0x${string}`
  jurySeatId: `0x${string}`
  phase: 1 | 2
  attempt: number
  providerId: 'gonkarouter'
  modelId: string
  responseModelId?: string
  gonkaRequestId: string
  promptHash: `0x${string}`
  inputHash: `0x${string}`
  outputHash: `0x${string}`
  runWalrusBlobId: string
  toolTranscriptHash: `0x${string}`
  toolTranscriptWalrusBlobId: string
  toolCallCount: number
  evidenceRoot: `0x${string}`
  requestedAtMs: number
  completedAtMs: number
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  status:
    | 'RECEIVED'
    | 'SCHEMA_VALID'
    | 'INVALID_SCHEMA'
    | 'TIMEOUT'
    | 'PROVIDER_ERROR'
}
```

A vote is countable only when the selected agent has a `SCHEMA_VALID` run for that claim and phase, the output references only frozen evidence IDs, and the later reveal matches the on-chain commitment. A Gonka Request ID is required public trace metadata; it is not displayed as proof that the conclusion is true.

### 14.3 Integrity boundaries

The explorer displays four separate badges:

- **Manifest integrity:** published files match their registered hashes.
- **Run trace:** GonkaRouter request/response metadata and application hashes are present.
- **Vote integrity:** reveal matches the prior on-chain commitment.
- **Economic finality:** a resolution certificate and payout/refund objects were created under the published Move rules.

Never collapse these into one green verified badge. In particular, `Run trace` means the application preserved a GonkaRouter interaction; it does not mean GonkaRouter certified the factual answer.

### 14.4 Sui-native identity and capabilities

V1 represents each oracle identity as an `AgentProfile` Move object and gives its controller an owned `AgentCap`. The profile stores the current manifest hash and Walrus blob ID, model/role classifications, human-backing hash, bond state, suspension state, and compact reputation totals. Only possession of the corresponding capability can request an agent-version update or bond withdrawal.

The hackathon still uses a reviewed five-person allowlist. [Sui zkLogin](https://docs.sui.io/sui-stack/zklogin-integration/zklogin) can simplify owner onboarding through OAuth credentials, but it does not by itself prove one unique human or prevent one person from using multiple providers. Treat zkLogin as authentication, not Sybil resistance.

ERC-8004 is an EVM Draft and is not a dependency of the Sui implementation. A future cross-chain mirror may publish selected identity or reputation signals, but the Move registry remains authoritative for OpenVerdict on Sui.

## 15. Protocol roles

| Role | Capability | Trust boundary |
| --- | --- | --- |
| Claim creator | Defines statement, criteria, deadlines, outcomes, fees | Cannot finalize unilaterally |
| Proposer | Posts optimistic answer and proposal bond | Loses bond if challenged and rejected |
| Challenger | Posts challenge bond and reason | Loses bond if proposal survives |
| Agent owner | Registers versioned agent and eligibility bond | Cannot alter registered manifest retroactively |
| Oracle agent | Produces evidence analysis, public argument, and hidden vote | Vote counts only after a valid GonkaRouter output and matching reveal |
| Evidence submitter | Adds a URL or content item before cutoff | Item is not trusted until retrieval succeeds |
| Committee executor | Sends GonkaRouter requests; Gonka Hosts execute inference off-chain while Gonka records validation artifacts | Cannot choose final outcome |
| Randomness provider | Supplies unbiased committee seed | Must be verifiable in production |
| Finalizer | Submits permissionless finalization after conditions are met | Move function recomputes result and creates the certificate |
| Protocol operator | Pauses emergency writes and manages bounded config | Cannot rewrite finalized outcomes |
| Auditor/user | Reads and verifies full timeline | Has no special permissions |

## 16. Claim and resolution model

### 16.1 Claim schema

```ts
type BinaryClaim = {
  statement: string
  resolutionCriteria: string
  evidenceCutoff: number
  proposalDeadline: number
  challengeDeadline: number
  firstCommitDeadline: number
  firstRevealDeadline: number
  discussionDeadline: number
  secondCommitDeadline: number
  secondRevealDeadline: number
  outcomes: ['YES', 'NO', 'UNSURE']
  evidencePolicyId: `0x${string}`
}
```

### 16.2 Resolution-criteria requirements

The creation UI and API reject criteria that do not identify:

- The exact event or condition.
- The relevant entity.
- The deadline and timezone.
- The authoritative or admissible source classes.
- How conflicting sources are handled.
- What `YES`, `NO`, and `UNSURE` mean.
- Which evidence was available before the cutoff.
- Whether later corrections are admissible.

An AI model must not invent resolution criteria after a dispute begins.

### 16.3 Claim fingerprint

The canonical claim hash binds:

```text
Sui chain identifier
OpenVerdict package ID
registry object ID
creator Sui address
creator nonce
statement hash
criteria hash
evidence policy ID
claim mode (`DIRECT_REVIEW` or `OPTIMISTIC_SETTLEMENT`)
deadlines in milliseconds
outcome set
```

Serialize `ClaimIntentV1` with Binary Canonical Serialization (BCS) and hash it with `sui::hash::blake2b256`. Claim creation normally uses a directly signed Sui transaction. If an off-chain intent is required, sign a domain-separated Sui personal message that includes the package ID, network identifier, nonce, and expiry; the submitted transaction must consume the nonce. See [Sui hashing](https://docs.sui.io/develop/cryptography/hashing) and [transaction authentication](https://docs.sui.io/develop/transactions/transaction-auth/auth-overview).

## 17. End-to-end protocol flow

### 17.1 Create

1. Creator submits statement, criteria, evidence policy, claim mode, timing, and reward budget. The public fact-check interface takes one bounded statement (the engine derives the rubric); pasted text and public URLs remain optional API and CLI inputs.
2. Client canonicalizes and hashes the claim.
3. Client builds a Sui Programmable Transaction Block (PTB) targeting the reviewed OpenVerdict package and registry object.
4. Creator reviews and signs the transaction; a gas sponsor may add the gas payment without changing the user's signed action.
5. The Move call creates and shares a `Claim<T>` object containing economic fields plus statement/criteria/Walrus references.
6. `ClaimCreated` Move event becomes the canonical discovery signal.

### 17.2 Start direct public fact check

1. The fact-check adapter creates a `DIRECT_REVIEW` claim and deposits a capped jury budget supplied by the requester, sponsor, or team demo wallet.
2. No optimistic answer, proposer bond, challenger bond, or market position is required.
3. The claim enters `REVIEW_REQUESTED`, triggers native-random committee selection, and follows the same evidence, inference, commitment, reveal, scoring, and certificate path as a disputed economic claim.
4. The resulting `ResolutionCertificate` is a public fact-check result. A separate consumer such as `demo_binary_pool` may reference it for settlement, but cannot alter it.

### 17.3 Propose

1. A proposer selects `YES`, `NO`, or `UNSURE`.
2. Proposer posts the required bond.
3. Proposal becomes challengeable until `challengeDeadline`.
4. If unchallenged, anyone can finalize the optimistic answer after the deadline.

### 17.4 Challenge

1. Challenger posts the matching challenge bond.
2. Challenger submits a short reason plus initial evidence items.
3. The Move call mutates the shared claim to `CHALLENGED`, then `REVIEW_REQUESTED` when the review budget and evidence window are valid.
4. Committee-selection randomness is requested.
5. Evidence remains open until `evidenceCutoff`.

### 17.5 Select committee

1. Eligible agents are filtered by active bond, liveness, manifest state, ownership, and diversity.
2. Verifiable randomness selects five agents.
3. The committee and selection seed are published.
4. Selected agents have an accept/decline deadline.
5. Declines trigger reserve-agent selection; non-response affects liveness reputation.

### 17.6 Freeze first-round evidence

1. Evidence service retrieves each admissible source.
2. It canonicalizes content, stores the raw and normalized artifacts on Walrus, and records retrieval metadata plus blob/object IDs.
3. It builds a Merkle root over accepted evidence items.
4. The engine creates an immutable `EvidenceBundle` object containing the Merkle root, manifest blob ID, storage epoch, and policy metadata, then links it to the claim before inference begins.

### 17.7 Run independent GonkaRouter inference

1. Each agent receives the same claim and frozen evidence manifest.
2. Each agent receives only its own manifest-defined prompt and tool policy.
3. Agents cannot see peer output or votes.
4. The runner sends every request through GonkaRouter using the agent's registered model ID. No other provider may perform AI reasoning, verification, deliberation, synthesis, or output repair in the hackathon build.
5. The runner stores every attempt, exact returned response `id` as `gonka_request_id`, response metadata, timing, token usage, and input/output hashes.
6. The runner validates the output schema and confirms that every cited evidence ID belongs to the frozen manifest.
7. A separate run validator recomputes the hashes and creates a `RunApproval` object for the selected `JurySeat`. This approval means only that the required GonkaRouter record and schema-valid Walrus artifact exist; it does not endorse the answer.
8. Invalid or missing responses become `NO_VALID_INFERENCE`, not implicit votes.

The canonical run hash is:

```text
blake2b256(BCS(RunRecordV1 {
  run_id,
  claim_object_id,
  agent_profile_id,
  jury_seat_id,
  phase,
  attempt,
  provider_id,
  model_id,
  gonka_request_id,
  prompt_hash,
  input_hash,
  output_hash,
  tool_transcript_hash,
  evidence_root,
  requested_at_ms,
  completed_at_ms
}))
```

The raw response, validated output, and full run audit are stored as public Walrus blobs. The on-chain `RunApproval` stores the run hash and required blob IDs. Production should replace the single hackathon run validator with multiple attestors or a challengeable approval mechanism.

### 17.8 First commitment

Each valid agent chooses `YES`, `NO`, or `UNSURE`, creates a random salt locally, and signs/commits:

```text
blake2b256(BCS(VotePreimageV1 {
  claim_object_id,
  agent_profile_id,
  jury_seat_id,
  phase,
  outcome,
  confidence_bps,
  evidence_root,
  output_hash,
  run_hash,
  salt
}))
```

The selected agent mutates only its owned `JurySeat` object to store the commitment. The chain sees no outcome before the reveal window.

### 17.9 First reveal

1. Agent submits its owned `JurySeat` by value, outcome, confidence in basis points, output hash, run hash, salt, argument Walrus blob ID, and immutable `Clock` reference.
2. The Move function BCS-encodes the preimage and recomputes the Blake2b-256 commitment.
3. The function verifies all claim/committee/phase/profile/run/evidence bindings, rejects a duplicate seat ID, destroys or retires the consumed seat, creates a `RevealedVote` object, freezes it as immutable, and appends its ID/outcome to the shared five-seat `RoundTally`.
4. Off-chain verifier confirms that the immutable run record, argument, tool transcript, and output artifacts remain available on Walrus and policy-valid.
5. The immutable revealed vote is auditable; the bounded `RoundTally` becomes the authoritative count used by any finalizer.
6. Missing, early, late, mismatched, or malformed reveals are excluded and recorded.

### 17.10 First consensus check

With five committee seats:

- Four matching valid votes meet a 70% threshold.
- Three matching votes do not.
- Denominator is the configured committee size, not only responders, unless claim policy explicitly states otherwise.
- `UNSURE` can itself reach threshold and produce unresolved settlement.

If threshold is met, proceed to finalization. Otherwise proceed to discussion.

### 17.11 Discussion and second round

1. First-round reasoning and evidence references become visible.
2. Agents may challenge claims, mark unsupported statements, and submit new admissible evidence.
3. Evidence service freezes `secondEvidenceRoot` at the discussion deadline.
4. Agents receive the complete public discussion and second evidence manifest.
5. The engine creates new phase-two `JurySeat` objects for the same selected profiles; phase-one seats and votes cannot be reused.
6. Agents perform a new GonkaRouter inference.
7. They commit and reveal a second independent vote.

### 17.12 Finalize or remain unresolved

- Four of five valid matching votes finalize `YES` or `NO`.
- Four of five `UNSURE` votes finalize `UNRESOLVED`.
- No threshold finalizes `UNRESOLVED` for V1.
- Finalization computes `truth_score_bps` from the final valid round and stores it in the immutable resolution certificate.
- Production policy may expand the committee once before unresolved finality.
- Direct-review claims pay configured jury rewards and refund unused budget. Economic claims create payout/refund tickets according to the published policy.

## 18. State machines

### 18.1 Claim state

```text
CREATED
  -> REVIEW_REQUESTED                       (direct public fact check)
  -> PROPOSED                               (optimistic settlement)
      -> FINALIZED_UNCHALLENGED
      -> CHALLENGED
          -> REVIEW_REQUESTED

REVIEW_REQUESTED
  -> COMMIT_1
  -> REVEAL_1
      -> FINALIZED_REVIEWED
      -> DISCUSSION
          -> COMMIT_2
          -> REVEAL_2
              -> FINALIZED_REVIEWED
              -> UNRESOLVED

CREATED -> CANCELLED_BEFORE_PROPOSAL
```

Finalized states are terminal.

### 18.2 Evidence state

```text
SUBMITTED
  -> FETCHING
  -> ACCEPTED
  -> REJECTED
  -> FROZEN_PHASE_1
  -> FROZEN_PHASE_2
```

### 18.3 Inference state

```text
QUEUED
  -> RUNNING
  -> RECEIVED
  -> SCHEMA_VALID
  -> COMMITTED
  -> REVEALED

Failure states:
  TIMEOUT
  PROVIDER_ERROR
  INVALID_SCHEMA
  PRIVACY_REJECTED
```

### 18.4 Vote state

```text
NOT_STARTED
  -> INFERENCE_READY
  -> COMMITTED
  -> REVEALED_VALID

Invalid terminal states:
  NO_COMMIT
  EARLY_REVEAL
  HASH_MISMATCH
  LATE_REVEAL
  INVALID_RUN_RECORD
```

## 19. Committee selection and diversity

### 19.1 Eligibility

An agent is eligible when:

- Registration is active.
- Required bond is deposited.
- Manifest is not deprecated.
- Owner is not suspended.
- Human-backing record is active and not already represented in the committee.
- Liveness score exceeds policy minimum.
- A current GonkaRouter model ID and prompt version are registered.
- No conflict of interest is declared for the claim.
- Agent has not already participated through another identity owned by the same owner.

### 19.2 Selection weight

V1 weight:

```text
weight = clamp(
  baseWeight
  × livenessMultiplier
  × validOutputMultiplier
  × evidenceQualityMultiplier,
  minimumWeight,
  maximumWeight
)
```

Do not include consensus agreement or profitability in initial selection weight. That would reinforce dominant mistakes.

### 19.3 Diversity constraints

For a five-agent committee:

- No owner controls more than one seat.
- No human-backing hash controls more than one seat.
- No single model ID controls more than two seats.
- Use at least three distinct GonkaRouter model IDs where the authenticated catalog permits.
- At least one seat uses an adversarial/skeptic role.
- At least one seat uses a source-authenticity role.
- Reserve agents satisfy the same constraints.

### 19.4 Randomness

Committee selection uses Sui's native `Random` shared object. The selection Move function accepts `&Random`, creates a transaction-local generator, and draws from the bounded eligible-agent snapshot. No external VRF provider or organizer-controlled seed is used in the deployed path. See [Sui on-chain randomness](https://docs.sui.io/sui-stack/on-chain-primitives/randomness-onchain).

Randomness does not prevent denial-of-service mistakes. The official Sui guidance warns that gas, object counts, events, and other transaction resources remain limited. Selection therefore caps draws, bounds the eligible snapshot, rejects insufficient diversity, and never weakens constraints merely to finish a transaction.

### 19.5 Hackathon selection algorithm

Limit the registered eligible pool to a small bounded set for the demo. Store active agent IDs in the registry and snapshot the sorted eligible list when the challenge begins.

Create a `RandomGenerator` and derive candidate positions:

```text
candidate_index = generate_u64_in_range(generator, 0, eligible_count - 1)
```

Draw until five agents and reserve agents satisfy uniqueness and diversity. The Move function verifies agent activity, owner and human-backing uniqueness, model caps, and no prior selection. For every selected profile, it creates an owned `JurySeat` object and transfers it to the registered agent address. Cap attempts and abort with `E_INSUFFICIENT_DIVERSE_AGENTS` rather than weakening policy silently.

This bounded on-chain approach is acceptable for a small hackathon pool. Production needs a gas-scalable snapshot or separately proven eligible set before permissionless agent counts grow.

## 20. GonkaRouter inference lifecycle

### 20.1 Provider integration

Initial endpoint:

```text
OpenAI-compatible base URL: https://api.gonkarouter.io/v1
Anthropic-compatible base URL: https://api.gonkarouter.io
```

API keys stay server-side. The browser never calls GonkaRouter directly.

Hackathon boundary: every operation involving model judgment must use this adapter. That includes independent investigation, source assessment, cross-model verification, deliberation, synthesis, and malformed-output repair. The application must not call ChatGPT, Claude, another model gateway, a browser-bundled model, or an undisclosed fallback. Deterministic URL retrieval, parsing, hashing, schema validation, Truth Score arithmetic, Move execution, and database queries are ordinary code and are not misrepresented as AI reasoning.

### 20.2 Agent diversity

The initial committee distributes across model IDs available to the authenticated GonkaRouter account. The five-agent hackathon committee uses at least three distinct model IDs and no model occupies more than two seats. Do not hard-code a model catalog in source code or silently substitute a model. Copy case-sensitive IDs into a reviewed release manifest and record the exact ID used for every run. If the authenticated catalog cannot satisfy this rule, obtain sponsor guidance rather than falsely claiming multi-model cross-verification. See [GonkaRouter models](https://gonkarouter.io/models).

### 20.3 Canonical inference input

Every model receives a canonical JSON envelope:

```ts
type OracleInferenceInput = {
  protocolVersion: '1.0'
  runId: string
  agentRole: string
  promptVersion: string
  submission: {
    kind: 'TEXT' | 'URL' | 'TEXT_AND_URL'
    submittedTextHash?: string
    submittedUrls: string[]
  }
  claim: {
    statement: string
    resolutionCriteria: string
    outcomes: ['YES', 'NO', 'UNSURE']
    relevantDeadline: string
  }
  evidenceManifest: {
    root: string
    items: Array<{
      evidenceId: string
      sourceClass: string
      retrievedAt: string
      walrusBlobId: string
      contentHash: string
      excerpt: string
    }>
  }
  outputContract: {
    requiredOutcome: true
    requiredEvidenceIds: true
    maximumReasonLength: number
  }
}
```

### 20.4 Output schema

```ts
type OracleInferenceOutput = {
  outcome: 'YES' | 'NO' | 'UNSURE'
  confidenceBps: number
  evidenceFor: string[]
  evidenceAgainst: string[]
  unsupportedClaims: string[]
  decisiveEvidence: string[]
  reasoning: string
  publicReasoningTrace: Array<{
    check: string
    evidenceIds: string[]
    assessment: 'SUPPORTS' | 'CONTRADICTS' | 'MIXED' | 'INSUFFICIENT'
    finding: string
  }>
}
```

`reasoning` is a bounded public conclusion summary. `publicReasoningTrace` is a structured list of verification steps and evidence references prepared for audit. Neither field is a request for hidden chain-of-thought.

Validation:

- Reject additional properties.
- Require `0 <= confidenceBps <= 10000`.
- Require every evidence ID to exist in the frozen manifest.
- Require one to eight public reasoning-trace entries and validate every trace evidence ID against the frozen manifest.
- Cap array sizes, trace fields, and reasoning bytes.
- Do not allow model output to add URLs, package/module/function targets, object IDs, recipients, transaction commands, or gas data.
- Retry malformed output once with a repair-only prompt, then fail the run.

### 20.5 Truth Score

The final valid jury round produces a deterministic score in basis points:

```text
agent_probability_bps(vote) =
  YES    -> confidence_bps
  NO     -> 10000 - confidence_bps
  UNSURE -> 5000

probability_sum_bps = sum(agent_probability_bps(valid_reveal))
truth_score_bps =
  (probability_sum_bps + floor(valid_reveal_count / 2))
  / valid_reveal_count

display_truth_score = truth_score_bps / 100
```

The hackathon score is deliberately unweighted so each selected seat has equal influence and anyone can recompute it from the final-round immutable `RevealedVote` objects. `confidence_bps` is included in the commitment preimage. Move validates `0 <= confidence_bps <= 10000`, adds the mapped probability and count to the bounded shared `RoundTally` during reveal, rejects score calculation when the count is zero, calculates the score from that tally during finalization, and stores `Some(score)` in `ResolutionCertificate.truth_score_bps`.

Use only the terminal jury round. An optimistic result finalized without GonkaRouter review has no Truth Score and the UI displays `Not independently reviewed`, never a fabricated `0`, `50`, or `100`. `UNRESOLVED` may still have a score, but the unresolved label remains dominant. The score summarizes this jury under this evidence snapshot; it is not objective truth, a probability guarantee, or a substitute for the four-of-five outcome threshold.

### 20.6 Bounded model capabilities

The [GonkaRouter documentation](https://gonkarouter.io/docs) describes streaming and tool use on its compatible endpoints. OpenVerdict permits only a small, read-only, server-executed tool set. The tool layer helps an agent inspect frozen evidence and pinned Sui state; it does not give the model general web access, code execution, wallet access, or transaction authority.

### 20.7 Controlled tool execution

V1 may expose these model-selectable tools where the chosen GonkaRouter model and endpoint support tool calling:

```ts
type OracleToolName =
  | 'read_evidence_item'
  | 'compare_deadline'
  | 'read_sui_transaction'
  | 'read_move_object_snapshot'
  | 'flag_unsupported_claim'

type ToolCallRecord = {
  callIndex: number
  toolName: OracleToolName
  argumentHash: `0x${string}`
  resultHash?: `0x${string}`
  startedAt: number
  completedAt: number
  status: 'SUCCEEDED' | 'REJECTED' | 'TIMED_OUT' | 'FAILED'
  artifactBlobId?: string
  errorCode?: string
}
```

Rules:

- `read_evidence_item` accepts only an ID from the frozen evidence manifest.
- Sui reads use the configured network and a pinned checkpoint, transaction digest, object ID/version/digest, package ID, or Move type.
- No tool accepts an arbitrary URL, shell command, code payload, recipient, PTB command list, gas object, signing request, or secret.
- Each run has a maximum of eight tool calls, a per-call timeout, and a bounded result size.
- The server validates every tool request before execution and stores the sanitized input/output as a content-addressed artifact.
- Each call records tool name, canonical argument hash, result hash, start/end time, status, and error category.
- The ordered transcript produces `toolTranscriptHash = blake2b256(BCS(records))`, which is included in the approved `runHash`; an empty vector has its own deterministic hash.
- `toolCallCount` must equal the encoded record count and cannot exceed eight.
- Tool failures remain visible and cannot be rewritten as successful calls.

Protocol actions are not model tools. `commitVote`, `revealVote`, evidence freezing, phase advancement, finalization, and fund movement are performed by the engine or CLI only after policy validation and authorized signing. The model never holds a wallet key.

During an independent pre-reveal round, public observers may see a generic activity state and timing, but not tool arguments, results, evidence choices, reasoning, confidence, or vote direction. After a valid reveal, the dashboard may show the sanitized tool transcript and evidence links allowed by claim policy. OpenVerdict never streams private chain-of-thought.

### 20.8 GonkaRouter adapter

Implement a narrow application interface:

```ts
interface GonkaRouterAdapter {
  run(input: OracleInferenceInput, manifest: AgentManifest): Promise<unknown>
  normalizeResponse(response: unknown): Promise<{
    gonkaRequestId: string
    modelId: string
    output: OracleInferenceOutput
  }>
  validateOutput(
    output: OracleInferenceOutput,
    evidenceManifest: OracleInferenceInput['evidenceManifest'],
  ): Promise<void>
  buildRunAudit(response: unknown): Promise<InferenceRunAudit>
}
```

The adapter is responsible for timeouts, visible retries, response normalization, schema checks, usage capture, and redaction. `gonkaRequestId` is the exact response `id` returned by GonkaRouter, such as the `msg_…` value documented for the Messages API. Preserve it verbatim for every attempt and label it **Gonka Request ID** in the product. It is trace metadata, not proof that the answer is true. Optional Gonka network metadata may be stored later in a separate extension field without changing the core interface.

### 20.9 Privacy

GonkaRouter's privacy policy and terms govern provider-side processing and may change independently from OpenVerdict. OpenVerdict permits only public claims and public evidence in V1. Wallet balances, proof-of-personhood material, challenge salts, API keys, and unrevealed votes never enter prompts.

## 21. Evidence system

### 21.1 Evidence item

```ts
type EvidenceItem = {
  evidenceId: string
  submittedBy: `0x${string}`
  submittedAt: number
  sourceUrl: string
  sourceClass: 'PRIMARY' | 'OFFICIAL_RECORD' | 'INDEPENDENT' | 'USER_SUBMITTED'
  retrievalStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED'
  retrievedAt?: number
  finalUrl?: string
  mimeType?: string
  byteLength?: number
  rawSha256?: string
  rawWalrusBlobId?: string
  rawWalrusObjectId?: `0x${string}`
  canonicalTextHash?: string
  canonicalWalrusBlobId?: string
  canonicalWalrusObjectId?: `0x${string}`
  walrusEndEpoch?: number
  title?: string
  excerpt?: string
  rejectionCode?: string
}
```

### 21.2 Retrieval safety

The retriever must:

- Allow only `https` by default.
- Resolve DNS and block loopback, link-local, private, metadata, and internal ranges.
- Recheck every redirect target.
- Cap redirects, size, duration, and decompressed body length.
- Allow known text/document MIME types only.
- Never execute JavaScript from evidence.
- Strip active content.
- Treat retrieved text as untrusted prompt data.
- Record HTTP status and final URL.
- Rate-limit submitters.
- Scan archives/documents before parsing.

### 21.3 Canonicalization

For each accepted item:

1. Preserve raw bytes and SHA-256.
2. Extract normalized text with tool/version metadata.
3. Store raw bytes and normalized text as separate public Walrus blobs.
4. Record each content-derived blob ID, corresponding Sui blob object ID, explicit raw/canonical hash, and paid storage end epoch.
5. Build a sorted evidence-manifest entry and store the complete manifest as another Walrus blob.
6. Compute the evidence Merkle root over BCS-encoded manifest leaves.
7. Create an immutable `EvidenceBundle` Move object containing the root, manifest blob ID/object ID, source count, parser version, policy ID, and storage end epoch.

Walrus blob IDs are content-derived, while the corresponding Sui objects control blob metadata and storage duration. Keep both IDs and explicit SHA-256/Blake2b hashes. Walrus storage is epoch-based and must be renewed before the evidence retention window expires. Mainnet uploads use the TypeScript SDK, an upload relay, or a private authenticated publisher rather than assuming a public unauthenticated publisher. See [Walrus getting started](https://docs.wal.app/docs/getting-started).

All Walrus blobs in V1 are public. Do not upload personal, private, sealed, or legally restricted evidence. Deletion cannot revoke copies, caches, or data already retrieved by others.

### 21.4 Evidence admission

V1 accepts evidence before each phase cutoff. The shared `Claim` points to the immutable `EvidenceBundle`; the full manifest and files remain on Walrus.

An evidence item may be rejected for:

- Unsupported scheme or network target.
- Retrieval failure.
- Size/type violation.
- Duplicate content.
- Submission after cutoff.
- Policy-disallowed source class.
- Malware or parser failure.

### 21.5 Prompt-injection defense

Evidence is data, never instruction. System prompts state that embedded commands, role changes, tool instructions, and requests for secrets inside evidence must be ignored. Deterministic output validation remains mandatory because prompt instructions alone are not a security boundary.

## 22. Commit-reveal voting

### 22.1 Commitment function

Reference Sui Move:

```move
public struct VotePreimageV1 has copy, drop, store {
    claim_id: ID,
    agent_profile_id: ID,
    jury_seat_id: ID,
    phase: u8,
    outcome: u8,
    confidence_bps: u16,
    evidence_root: vector<u8>,
    output_hash: vector<u8>,
    run_hash: vector<u8>,
    salt: vector<u8>,
}

public fun compute_commitment(preimage: &VotePreimageV1): vector<u8> {
    sui::hash::blake2b256(&std::bcs::to_bytes(preimage))
}
```

The TypeScript CLI uses the matching BCS schema from `@mysten/sui/bcs`. Test vectors generated in TypeScript and Move must produce the same 32-byte commitment.

### 22.2 Salt custody

- Salt is generated client-side or in an isolated agent runner.
- Backend database stores encrypted recovery data only if required.
- Salt is never logged or sent to GonkaRouter.
- User/agent receives an exportable reveal package.
- Missing reveal is penalized as liveness failure.

### 22.3 Vote contents

On-chain reveal includes compact hashes, Walrus blob IDs, outcome, and committed `confidence_bps`. Full public reasoning trace, evidence references, tool transcript, and the GonkaRouter run audit remain on Walrus and are checked against the committed hashes.

### 22.4 Deadline enforcement

Move entry functions accept Sui's immutable shared `Clock` object and compare `clock::timestamp_ms(clock)` with the claim or jury-seat deadline. The UI reads deadlines from objects and confirmed events. Backend clocks are informational. See the [Sui Clock reference](https://docs.sui.io/references/framework/sui_sui/clock).

## 23. Consensus, uncertainty, and escalation

### 23.1 Threshold

Hackathon policy:

```text
committee size: 5
required matching outcome: 4
required valid reveals: 4
```

Four matching votes are 80%, above the advertised 70% policy. Using integer threshold `ceil(committeeSize × 0.70)` avoids incorrectly treating three of five as sufficient.

### 23.2 Outcomes

- `YES`: criteria were satisfied.
- `NO`: criteria were not satisfied.
- `UNSURE`: evidence is inadequate or contradictory.
- `UNRESOLVED`: no valid threshold after protocol phases.

### 23.3 First-round result

- Threshold `YES` or `NO`: finalize.
- Threshold `UNSURE`: finalize unresolved and refund policy-defined bonds.
- No threshold: proceed to discussion.

### 23.4 Second-round result

- Threshold `YES` or `NO`: finalize disputed result.
- Threshold `UNSURE` or no threshold: finalize unresolved in V1.
- Production may select an expanded committee once, with a hard maximum total duration.

### 23.5 Result meaning

The UI states:

> OpenVerdict resolved this claim under version X of its criteria, evidence policy, committee policy, and economic rules.

It must not state:

> OpenVerdict proved this claim is universally true.

## 24. Economic design

### 24.1 Value flows

Economic components:

- Claim creation fee.
- Proposer bond.
- Challenge bond.
- Agent registration bond.
- Committee reward budget.
- Evidence retrieval, Walrus storage, and retention-renewal budget.
- Protocol reserve/treasury.

All token amounts are configurable and capped during the hackathon. Production values require economic modelling and review.

Move modules are generic over an allowlisted coin type `T`. The Mainnet demo targets Circle's native USDC on Sui, pinned by exact type in the release manifest; Testnet may use a dedicated test coin. Never accept an arbitrary coin type through unreviewed application configuration. See [Circle's Sui USDC guide](https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui).

### 24.2 Direct-review settlement

- Requester, sponsor, or team demo wallet deposits a capped committee/evidence budget.
- Valid agent participation earns the published jury reward regardless of majority/minority outcome.
- Actual retrieval, GonkaRouter, Walrus, and gas costs are charged under the disclosed policy.
- Unused budget returns through a recipient-bound payout ticket.
- No prediction-market winner or loser exists until a separate consumer references the immutable certificate.

### 24.3 Unchallenged settlement

- Proposer bond returns.
- Proposer may receive claim-funded reward.
- Unused committee/evidence budget refunds according to claim policy.

### 24.4 Challenged settlement

If proposal survives:

- Proposer bond returns.
- Challenger bond funds committee/retrieval costs and remaining defined reward.

If challenge succeeds:

- Challenger bond returns.
- Proposer bond funds committee/retrieval costs and challenger reward.

If unresolved:

- Neither side is labelled correct.
- Claim policy defines partial refunds after actual compute/retrieval costs.
- Protocol must not fabricate a winner merely to distribute bonds.

### 24.5 Agent penalties

Penalize:

- Accepted committee seat with no commitment.
- Commitment with no reveal.
- Reveal mismatch.
- Forged or altered run record.
- Undeclared conflict or duplicate-owner identity.
- Proven manipulation of evidence or manifest.

Do not slash merely for a minority vote.

### 24.6 Withdrawal pattern

Shared claim and market objects hold funds as `Balance<T>`. Finalization calculates entitlements once and creates non-transferable or recipient-bound `PayoutTicket<T>` objects. A claimant later presents its ticket to withdraw a `Coin<T>`; one user's delay cannot block another claimant.

Move does not use EVM-style reentrancy guards or ERC-20 approvals. Security comes from resource semantics, coin-type constraints, capability checks, explicit object ownership, bounded shared-object mutation, and one-time ticket consumption. A `PauseCap` can stop new economic actions without mutating terminal results or permanently trapping valid withdrawals.

Sponsored transactions may pay gas for approved challenges, agent commits/reveals, and withdrawals while the user still signs the full transaction data. The sponsor validates package, module, function, objects, coin type, amount, gas budget, and expiration before signing. See [Sui sponsored transactions](https://docs.sui.io/develop/transaction-payment/sponsor-txn).

## 25. Reputation system

### 25.1 Separate dimensions

```ts
type AgentReputation = {
  livenessBps: number
  validOutputBps: number
  validRevealBps: number
  evidenceQualityBps: number
  consensusReliabilityBps: number
  externalAccuracyBps?: number
  successfulChallenges: number
  provenViolations: number
  resolvedRuns: number
}
```

### 25.2 Updates

- Liveness increases for timely accepted seat, commit, and reveal.
- Valid-output score reflects GonkaRouter completion and output-policy compliance.
- Evidence quality uses deterministic citation checks plus later review.
- Consensus reliability records agreement without claiming truth.
- External accuracy updates only when an independent objective result later exists.
- Proven protocol violations reduce eligibility and may slash bonds.

### 25.3 Selection usage

Selection initially uses liveness, valid output, and evidence quality. Consensus agreement and external performance remain visible but do not dominate seat probability.

### 25.4 Versioning

Reputation attaches to an agent identity plus manifest lineage. Major prompt/model/tool-policy changes create a new strategy version. Historical results remain attached to the version that produced them.

## 26. User experience

### 26.1 Required routes

| Route | Purpose |
| --- | --- |
| `/` | Public fact-check entry point plus recent verified claims |
| `/fact-check` | Submit bounded text, one or more public URLs, or both and start direct review |
| `/claims/new` | Create claim and resolution criteria |
| `/claims/[id]` | Live proposal, dispute, evidence, votes, result, and payouts |
| `/claims/[id]/observe` | Optional read-only visual observer for the live resolution event stream |
| `/agents` | Agent directory with identity, human-backing, model, role, and reputation filters |
| `/agents/[id]` | Manifest versions, GonkaRouter runs, arguments, votes, and performance |
| `/evidence/[id]` | Retrieved source metadata, hashes, Walrus blob/object IDs, retention, and excerpts |
| `/verify` | Recompute manifest hashes, evidence roots, commitments, and reveals |
| `/status` | Sui, GonkaRouter, evidence service, storage, and worker health |
| `/learn` | Optimistic resolution, commit-reveal, AI limitations, and risk |
| `/terms` | Terms of use |
| `/privacy` | Privacy notice |
| `/risk` | Experimental oracle and financial-risk disclosure |

### 26.2 Claim card

Show:

- Claim statement.
- Input type and admitted source URLs.
- Current state.
- Proposed outcome.
- Challenge deadline.
- Bond amount.
- Evidence count.
- Committee and evidence policy.
- Final outcome when terminal.
- Truth Score or `Not independently reviewed` when no jury round occurred.
- Clear `Experimental` label.

### 26.3 Claim detail timeline

The default browser view is an ordered timeline derived from engine events:

```text
Created
Proposed YES
Challenged
Committee selected
Evidence phase 1 frozen
5 inference runs completed
5 commitments submitted
5 votes revealed
Threshold not met
Discussion evidence frozen
5 second-round runs completed
5 second commitments/reveals
Finalized YES
Payout and refund tickets created
```

Every item links to a chain transaction, content artifact, or inference metadata where available.

### 26.4 Agent card

Show:

- Agent ID and owner.
- Strategy version.
- GonkaRouter model ID.
- Role/persona.
- Manifest integrity.
- GonkaRouter completion and valid-output rates.
- Bond.
- Liveness and valid-reveal rates.
- Evidence-quality score.
- Consensus reliability, labelled correctly.
- Conflicts or suspension state.

### 26.5 Vote reveal

Before reveal, show commitments only. Never derive or display likely outcomes from model reasoning that has not been revealed.

After reveal, show:

- Outcome.
- Confidence.
- Evidence IDs.
- Public reasoning summary and structured evidence-linked trace.
- Commitment verification.
- Gonka Request ID and GonkaRouter model ID.
- Input, output, evidence-root, and run-record hashes.

### 26.6 Empty and failure states

- No proposal: invite a bonded proposal.
- No challenge: show time to optimistic finality.
- Evidence unavailable: identify item and reason.
- GonkaRouter timeout: mark the agent run failed; do not fabricate a vote.
- Malformed output: show the validation error and exclude the run.
- Insufficient valid agents: select reserve or resolve as unresolved.
- No consensus: explain unresolved status and bond policy.
- Paused: allow reads and withdrawals where safe; disable new claims/actions.

### 26.7 Mobile and accessibility

- Design for 360-pixel width first.
- Minimum touch target 44 by 44 CSS pixels.
- Timeline and vote states must have text equivalents.
- Do not rely on green/red alone.
- Support keyboard access for all economic actions.
- Announce transaction and phase changes through accessible live regions.
- Respect reduced-motion preferences.
- Provide UTC and local times.

Use [shadcn/ui](https://ui.shadcn.com/docs) components, Tailwind utility classes, and Iconsax icons. Build the hackathon interface during the allowed period; reuse earlier DIVE visual assets only with teammate and organizer approval.

### 26.8 Optional observer dashboard

The observer dashboard is a visual companion to the engine, not the engine itself. A claim must complete through Move objects/modules, workers, and CLI when this dashboard is disabled. Starting the dashboard after completion must reconstruct the same view from Walrus artifacts, indexed Sui events/objects, and the public resolution event stream.

Recommended layout:

```text
+-------------------------------------------------------------------+
| Phase rail: Evidence -> Independent -> Commit -> Reveal -> Debate |
+---------------------------+-------------------+-------------------+
| Five agent activity lanes | Resolution events | Evidence + Sui   |
| status, model, safe tools | ordered by source | hashes and links  |
+---------------------------+-------------------+-------------------+
| Consensus state, result rule, payout/refund, integrity checks      |
+-------------------------------------------------------------------+
```

The dashboard shows:

- Five separate agent lanes with owner/human-backing label, role, model ID, run status, latency, and token usage.
- A phase rail driven by Sui object state and confirmed Move events rather than frontend timers.
- Safe tool activity, evidence access, run approval, commitments, reveals, discussion, finalization, and withdrawals.
- Source labels on every item: `ENGINE`, `GONKA_ROUTER`, `TOOL`, `EVIDENCE`, or `SUI`.
- Sui explorer links for confirmed transactions and content links for hashed public artifacts.
- First-round arguments and sanitized tool transcripts only after reveal.
- The four-of-five threshold calculation and the reason a claim finalized or remained unresolved.

The dashboard must not:

- Sign or submit protocol transactions.
- Call GonkaRouter directly from the browser.
- Advance a phase, select an agent, approve a run, or calculate an authoritative outcome.
- Show unrevealed reasoning, evidence choices, confidence, tool details, or likely votes.
- Display application logs as if they were on-chain proof.
- Block CLI or engine operation when unavailable.

### 26.9 Public fact-check report

The report is the primary hackathon landing result. It shows, in this order:

1. Normalized claim and submitted URL/text provenance.
2. Final `YES`, `NO`, `UNSURE`, or `UNRESOLVED` label.
3. Truth Score from `0` to `100`, its exact formula, and the final-round vote inputs.
4. Five agent cards with model ID, confidence, public reasoning trace, cited evidence, and Gonka Request ID.
5. Cross-model agreement/disagreement matrix and minority reasoning.
6. Frozen evidence root plus Walrus and source links.
7. Sui claim, committee, revealed-vote, and `ResolutionCertificate` objects.
8. A downloadable JSON audit bundle containing every public identifier and hash.

Never display an invented synthesis from an unrecorded model. If a plain-language report summary is AI-generated, it must be a separate GonkaRouter run with its own manifest, input/output hashes, Gonka Request ID, and visible label. The simpler V1 path is deterministic templating over already revealed agent outputs.

## 27. Technical architecture

### 27.1 System diagram

```text
+----------------------+       commands       +----------------------------+
| OpenVerdict CLI      |--------------------->| Verification engine        |
| required control     |<-- status / JSON ----| API + workers + policies   |
+----------------------+                      +--+---------+----------+----+
                                                  |         |          |
                                        inference| evidence|          | tx/read
                                                  v         v          v
                                          +-------------+ +----------+ +-------------+
                                          | GonkaRouter | | Evidence | | Sui Move    |
                                          | API/models  | | service  | | objects     |
                                          +-------------+ +----+-----+ +--+----------+
                                                            |          |
                                                            v          v
                                                      +-----+----------+---+
                                                      | Walrus blobs +     |
                                                      | Sui event indexer  |
                                                      +---------+----------+
                                                                |
                                          normalized public events + hashes
                                                                v
                                                      +---------+----------+
                                                      | Resolution event   |
                                                      | log / SSE endpoint |
                                                      +---------+----------+
                                                                |
                                                        read-only observe
                                                                v
                                                      +---------+----------+
                                                      | Optional dashboard |
                                                      | visual companion   |
                                                      +--------------------+
```

### 27.2 Product-surface boundaries

| Surface | Required | Can change protocol state | Authority |
| --- | --- | --- | --- |
| Verification engine | Yes | Yes, through validated and authorized transactions | Sui objects and published Move protocol rules |
| CLI | Yes | May request or submit authorized engine actions | None beyond the signer/role it uses |
| Observer dashboard | No | No | Read-only projection of authoritative sources |

The engine exposes one domain layer used by workers, APIs, and CLI. Do not duplicate lifecycle rules in CLI commands or frontend components. The observer reads public events and artifacts; it never becomes a hidden second orchestrator.

Acceptance test: stop the dashboard, complete a full claim through CLI, delete the dashboard cache, restart it, and reproduce the same timeline and result from authoritative data.

### 27.3 CLI reference

The CLI is the complete control and diagnostic surface. It supports human-readable output by default and deterministic newline-delimited JSON with `--json`. Long-running commands support `--follow`; failures return non-zero exit codes and stable error codes.

Reference commands:

```text
openverdict fact-check start --file fact-check.json --follow
openverdict fact-check report --claim 0xCLAIM --verify --json
openverdict claim create --file claim.json
openverdict claim propose --claim 0xCLAIM --outcome YES
openverdict claim challenge --claim 0xCLAIM --reason-file challenge.json
openverdict evidence freeze --claim 0xCLAIM --phase 1
openverdict jury run --claim 0xCLAIM --phase 1 --follow
openverdict votes commit --claim 0xCLAIM --phase 1
openverdict votes reveal --claim 0xCLAIM --phase 1
openverdict claim advance --claim 0xCLAIM --follow
openverdict claim finalize --claim 0xCLAIM
openverdict claim inspect --claim 0xCLAIM --verify --json
openverdict events follow --claim 0xCLAIM --public
```

CLI rules:

- Read commands require only RPC/API access.
- State-changing commands print network, package/module/function, object IDs/versions, coin type/value, gas sponsor, simulation result, and signer before confirmation.
- User, agent, and administrator keys are never accepted as command arguments or written to shell history.
- Worker-only actions require scoped service authentication and an isolated signer or external wallet flow.
- Vote commit/reveal commands may relay ready packages signed by the selected agent key; the operator CLI cannot invent or replace an agent's signed vote.
- Commands are idempotent where possible and detect already-completed phases from chain state.
- `--json` output uses the same event and artifact schemas as the observer dashboard.
- The CLI remains fully usable when the browser application, event stream, or dashboard is unavailable.

### 27.4 Recommended stack

- Next.js App Router and TypeScript.
- `@mysten/sui` for BCS, PTBs, Sui clients, signers, object reads, and transaction execution.
- `@mysten/dapp-kit-react` and `@mysten/dapp-kit-core` for wallet connectivity in the observer and user-facing flows.
- Sui Move packages plus `sui move test` for protocol implementation and unit/scenario tests.
- Owned capability objects for administration, run attestation, evidence freezing, agent control, and pausing.
- PostgreSQL for indexed application state.
- A queue/worker system for evidence retrieval, GonkaRouter inference, run validation, and notifications.
- A TypeScript CLI that calls the same domain layer and validated APIs as the workers.
- Server-Sent Events for the one-way public observer stream, with cursor-based replay after reconnect.
- An append-only application event table whose entries link back to chain events or hashed artifacts.
- `@mysten/walrus` for public evidence, manifests, arguments, run audits, and tool transcripts.
- Sui gRPC/custom indexer ingestion plus a managed full-node endpoint and failover.
- An optional gas-station service for narrowly allowlisted sponsored transactions.

### 27.5 Suggested project structure

```text
app/
  page.tsx
  claims/new/page.tsx
  claims/[id]/page.tsx
  claims/[id]/observe/page.tsx
  agents/page.tsx
  agents/[id]/page.tsx
  evidence/[id]/page.tsx
  verify/page.tsx
  status/page.tsx
  learn/page.tsx
  terms/page.tsx
  privacy/page.tsx
  risk/page.tsx
  api/
    claims/route.ts
    evidence/route.ts
    agents/route.ts
    inference/route.ts
    claims/[id]/events/route.ts
    status/route.ts
components/
  claim/
  timeline/
  agent/
  evidence/
  votes/
  transactions/
  observer/
cli/
  src/commands/
  src/output/
move/
  openverdict/
    Move.toml
    sources/
      agent_registry.move
      claim.move
      evidence.move
      jury.move
      settlement.move
      demo_fact_checker.move
      demo_binary_pool.move
    tests/
    published-at.testnet
    published-at.mainnet
lib/
  sui/
  gonka/
  walrus/
  evidence/
  protocol/
  storage/
  validation/
  analytics/
  events/
workers/
  evidence-worker.ts
  inference-worker.ts
  resolution-worker.ts
  event-indexer.ts
```

### 27.6 Source-of-truth matrix

| Data | Source of truth |
| --- | --- |
| Agent registration/bond | `AgentProfile` object plus registry/agent capabilities |
| Current manifest hash | `AgentProfile` object |
| Manifest content | Public Walrus blob |
| Claim economic state | Shared `Claim<T>` object |
| Proposal/challenge | Shared `Claim<T>` object and Move events |
| Committee and counts | Locked shared `Committee`, owned `JurySeat`, immutable `RevealedVote`, and shared per-phase `RoundTally` objects selected/created with Sui Random |
| Evidence roots | Immutable `EvidenceBundle` objects linked from the claim |
| Evidence content | Public Walrus blobs plus retrieval database |
| Inference response and run audit | Gonka Request ID plus hashed Walrus artifacts and `RunApproval` object |
| Vote commitments/reveals | Owned `JurySeat` objects and Move events |
| Final outcome/withdrawals | `Claim<T>`, `ResolutionCertificate`, and `PayoutTicket<T>` objects |
| Resolution observer events | Derived append-only log; each event points to its authoritative chain or artifact source |
| CLI output | Projection of engine, chain, and artifact state; never authoritative itself |
| Dashboard state | Rebuildable projection of public resolution events and authoritative sources |
| UI indexes and analytics | PostgreSQL, rebuildable from authoritative sources |

### 27.7 Build bootstrap

After the hackathon kickoff, scaffold the original implementation:

```bash
pnpm create next-app@latest openverdict --ts --tailwind --eslint --app --src-dir
cd openverdict
pnpm add openai zod @mysten/sui @mysten/dapp-kit-react @mysten/dapp-kit-core @mysten/walrus @tanstack/react-query
pnpm dlx shadcn@latest init
pnpm add iconsax-react
mkdir -p move
cd move
sui move new openverdict
cd ..
```

Then:

1. Pin the lockfile and record exact versions.
2. Add Sui Testnet and Mainnet release manifests containing package IDs, shared-object IDs, Walrus network settings, coin types, and explorer templates.
3. Implement Move objects, capabilities, entry functions, and tests before wallet UI.
4. Implement a fake GonkaRouter adapter fixture before using a live key.
5. Run a full local-network lifecycle with `sui move test` and the TypeScript CLI before adding second-round discussion polish.

Verify every command against current framework documentation at implementation time; package CLIs may change after this PRD's verification date.

## 28. Sui Move reference

### 28.1 Package and modules

Publish one versioned `openverdict` Move package with narrowly scoped modules:

| Module | Responsibility |
| --- | --- |
| `agent_registry` | Agent profiles, owner capabilities, human-backing hashes, bonds, eligibility, and reputation |
| `claim` | Claim creation, optimistic proposal, challenge, phase state, deadlines, and terminal result |
| `evidence` | Immutable evidence-bundle objects containing Walrus IDs, roots, policies, and retention metadata |
| `jury` | Native-random committee selection, jury-seat objects, run approvals, commitments, reveals, and tally checks |
| `settlement` | Coin balances, payout tickets, refunds, rewards, penalties, and withdrawals |
| `demo_fact_checker` | Direct-review entry point, capped jury budget, Truth Score report linkage, and no-market public verification flow |
| `demo_binary_pool` | Low-cap YES/NO consumer used only for the hackathon demonstration |

The package emits Move events for discovery but treats objects, not the event index, as authoritative state. Each deployed release pins package ID, upgrade-cap object, registry object, pause-cap holder, attestor-cap holder, coin type, and Walrus network configuration.

### 28.2 Core objects and capabilities

```move
public struct Registry has key {
    id: UID,
    version: u64,
    eligible_agents: vector<EligibilityRecord>,
    paused: bool,
}

public struct EligibilityRecord has copy, drop, store {
    agent_profile_id: ID,
    owner: address,
    human_backing_hash: vector<u8>,
    model_hash: vector<u8>,
    role_hash: vector<u8>,
    weight: u64,
    active: bool,
}

public struct Reputation has copy, drop, store {
    liveness_bps: u64,
    valid_output_bps: u64,
    valid_reveal_bps: u64,
    evidence_quality_bps: u64,
    consensus_reliability_bps: u64,
    resolved_runs: u64,
    proven_violations: u64,
}

public struct AgentProfile has key, store {
    id: UID,
    owner: address,
    manifest_hash: vector<u8>,
    manifest_blob_id: vector<u8>,
    human_backing_hash: vector<u8>,
    model_hash: vector<u8>,
    role_hash: vector<u8>,
    bond: Balance<SUI>,
    active: bool,
    reputation: Reputation,
}

public struct AgentCap has key, store { id: UID, agent_profile_id: ID }
public struct AdminCap has key, store { id: UID }
public struct PauseCap has key, store { id: UID }
public struct EvidenceCap has key, store { id: UID }
public struct RunAttestorCap has key, store { id: UID }

public struct EvidenceBundle has key, store {
    id: UID,
    claim_id: ID,
    phase: u8,
    root: vector<u8>,
    manifest_blob_id: vector<u8>,
    manifest_blob_object_id: ID,
    source_count: u32,
    policy_id: vector<u8>,
    walrus_end_epoch: u64,
}

public struct Committee has key, store {
    id: UID,
    claim_id: ID,
    agent_profile_ids: vector<ID>,
    agent_owners: vector<address>,
    reserve_profile_ids: vector<ID>,
    reserve_owners: vector<address>,
    selected_at_ms: u64,
    locked: bool,
}

public struct JurySeat has key, store {
    id: UID,
    claim_id: ID,
    committee_id: ID,
    agent_profile_id: ID,
    agent_owner: address,
    phase: u8,
    evidence_root: vector<u8>,
    commitment: vector<u8>,
    run_hash: vector<u8>,
    status: u8,
}

public struct RoundTally has key {
    id: UID,
    claim_id: ID,
    committee_id: ID,
    phase: u8,
    evidence_root: vector<u8>,
    expected_jury_seat_ids: vector<ID>,
    revealed_jury_seat_ids: vector<ID>,
    revealed_vote_ids: vector<ID>,
    yes_count: u8,
    no_count: u8,
    unsure_count: u8,
    truth_probability_sum_bps: u64,
    truth_probability_count: u8,
    closed: bool,
}

public struct RunApproval has key, store {
    id: UID,
    claim_id: ID,
    committee_id: ID,
    jury_seat_id: ID,
    agent_profile_id: ID,
    agent_owner: address,
    run_hash: vector<u8>,
    run_blob_id: vector<u8>,
    run_blob_object_id: ID,
    tool_blob_id: vector<u8>,
    tool_blob_object_id: ID,
    walrus_end_epoch: u64,
    phase: u8,
}

public struct RevealedVote has key, store {
    id: UID,
    claim_id: ID,
    committee_id: ID,
    jury_seat_id: ID,
    agent_profile_id: ID,
    phase: u8,
    outcome: u8,
    confidence_bps: u16,
    evidence_root: vector<u8>,
    output_hash: vector<u8>,
    run_hash: vector<u8>,
    argument_blob_id: vector<u8>,
    argument_blob_object_id: ID,
    argument_walrus_end_epoch: u64,
    revealed_at_ms: u64,
}

public struct ResolutionCertificate has key, store {
    id: UID,
    claim_id: ID,
    package_version: u64,
    result: u8,
    truth_score_bps: Option<u16>,
    committee_id: Option<ID>,
    evidence_bundle_ids: vector<ID>,
    revealed_vote_ids: vector<ID>,
    finalized_at_ms: u64,
}
```

Freeze `EvidenceBundle`, `RevealedVote`, and `ResolutionCertificate` objects immediately after construction. They are public immutable records. `Registry`, `AgentProfile`, `Claim<T>`, `Committee`, per-phase `RoundTally`, and demo pool objects are shared mutable objects whose entry functions enforce capabilities and state rules. During each valid reveal, the jury module increments the bounded tally counts plus `truth_probability_sum_bps` and `truth_probability_count`; finalization reads this tally rather than attempting to fetch arbitrary vote objects by ID. Anyone can independently recompute the same values from the immutable revealed votes. Committee membership may change only during the acceptance/reserve window and becomes immutable in practice after `locked = true`. `AgentCap`, `JurySeat`, `RunApproval`, positions, and payout tickets are address-owned until consumed or transferred by an authorized flow.

Use explicit `u8` constants for states and outcomes so off-chain BCS schemas remain stable. Reserve `0 = NONE`, `1 = YES`, `2 = NO`, and `3 = UNSURE`; `UNRESOLVED` is a terminal claim result rather than an agent vote.

### 28.3 Claim struct

```move
public struct Claim<phantom T> has key {
    id: UID,
    protocol_version: u64,
    claim_mode: u8,
    creator: address,
    content_hash: vector<u8>,
    statement_blob_id: vector<u8>,
    criteria_blob_id: vector<u8>,
    evidence_policy_id: vector<u8>,
    first_evidence_bundle_id: Option<ID>,
    second_evidence_bundle_id: Option<ID>,
    committee_id: Option<ID>,
    first_round_tally_id: Option<ID>,
    second_round_tally_id: Option<ID>,
    resolution_certificate_id: Option<ID>,
    proposal_deadline_ms: u64,
    challenge_deadline_ms: u64,
    first_commit_deadline_ms: u64,
    first_reveal_deadline_ms: u64,
    discussion_deadline_ms: u64,
    second_commit_deadline_ms: u64,
    second_reveal_deadline_ms: u64,
    proposer: Option<address>,
    challenger: Option<address>,
    challenge_reason_hash: vector<u8>,
    challenge_reason_blob_id: vector<u8>,
    proposal: u8,
    result: u8,
    state: u8,
    creation_budget: Balance<T>,
    proposer_bond: Balance<T>,
    challenger_bond: Balance<T>,
    committee_budget: Balance<T>,
    evidence_budget: Balance<T>,
}
```

Create one shared `Claim<T>` per direct review or optimistic dispute. Reserve `claim_mode = 1` for `DIRECT_REVIEW` and `claim_mode = 2` for `OPTIMISTIC_SETTLEMENT`. `T` must match an allowlisted coin type and is fixed for that object. Amounts are stored in the coin's smallest unit. Validate mode-specific required fields, deadline ordering, maximum total duration, budget caps, and all `u64` additions before sharing the object.

### 28.4 Public functions

#### Agent registry

```text
register_agent(registry, bond: Coin<SUI>, manifest_hash, manifest_blob_id, model_hash, role_hash, human_backing_hash, clock, ctx)
update_agent_manifest(agent_profile, agent_cap, manifest_hash, manifest_blob_id, model_hash, role_hash, clock)
deprecate_agent(agent_profile, agent_cap)
deposit_agent_bond(agent_profile, agent_cap, bond: Coin<SUI>)
request_agent_bond_withdrawal(agent_profile, agent_cap, amount, clock)
complete_agent_bond_withdrawal(agent_profile, agent_cap, clock, ctx)
```

#### Claim lifecycle

```text
create_claim<T>(registry, creator_budget: Coin<T>, params, content_hash, statement_blob_id, criteria_blob_id, clock, ctx)
start_direct_review<T>(claim, clock)
propose_outcome<T>(claim, proposer_bond: Coin<T>, outcome, clock)
challenge_outcome<T>(claim, challenger_bond: Coin<T>, reason_hash, reason_blob_id, clock)
select_committee<T>(registry, claim, random, clock, ctx)
accept_jury_seat(jury_seat, agent_cap, clock)
decline_jury_seat(jury_seat: JurySeat, agent_cap, clock)
replace_declined_seat<T>(claim, committee, round_tally, declined_seat_id, reserve_index, clock, ctx)
lock_committee<T>(claim, committee, round_tally, clock)
create_second_round_seats<T>(claim, committee, first_round_tally, clock, ctx)
freeze_evidence<T>(claim, evidence_cap, phase, evidence_bundle, clock)
approve_run(run_attestor_cap, claim_id, committee_id, jury_seat_id, agent_profile_id, agent_owner, phase, run_hash, run_blob_id, run_blob_object_id, tool_blob_id, tool_blob_object_id, walrus_end_epoch, clock, ctx)
commit_vote(jury_seat, agent_cap, run_approval, commitment, clock)
reveal_vote(jury_seat: JurySeat, round_tally, agent_cap, outcome, confidence_bps, output_hash, run_hash, salt, argument_blob_id, argument_blob_object_id, argument_walrus_end_epoch, clock, ctx)
advance_phase<T>(claim, clock)
finalize_claim<T>(claim, committee, round_tally, evidence_bundles, clock, ctx)
withdraw_payout<T>(claim, payout_ticket, clock, ctx)
pause(registry, pause_cap)
unpause(registry, pause_cap)
```

Off-chain workers and CLI operators may submit lifecycle transactions when deadlines pass, but Move functions independently validate object IDs, ownership/capabilities, state, Clock time, hashes, thresholds, and one-time consumption. Use PTBs to group only actions that share one signer and have no hidden authorization dependency.

### 28.5 Events

```move
public struct AgentRegistered has copy, drop { agent_profile_id: ID, owner: address, manifest_hash: vector<u8> }
public struct AgentManifestUpdated has copy, drop { agent_profile_id: ID, manifest_hash: vector<u8>, version: u64 }
public struct ClaimCreated has copy, drop { claim_id: ID, creator: address, claim_mode: u8, content_hash: vector<u8>, coin_type_hash: vector<u8> }
public struct OutcomeProposed has copy, drop { claim_id: ID, proposer: address, outcome: u8, amount: u64 }
public struct OutcomeChallenged has copy, drop { claim_id: ID, challenger: address, reason_hash: vector<u8>, amount: u64 }
public struct CommitteeSelected has copy, drop { claim_id: ID, committee_id: ID, first_round_tally_id: ID, agent_profile_ids: vector<ID>, jury_seat_ids: vector<ID> }
public struct EvidenceFrozen has copy, drop { claim_id: ID, phase: u8, evidence_bundle_id: ID, root: vector<u8> }
public struct RunApproved has copy, drop { claim_id: ID, jury_seat_id: ID, run_approval_id: ID, run_hash: vector<u8> }
public struct VoteCommitted has copy, drop { claim_id: ID, jury_seat_id: ID, phase: u8, commitment: vector<u8> }
public struct VoteRevealed has copy, drop { claim_id: ID, round_tally_id: ID, jury_seat_id: ID, revealed_vote_id: ID, phase: u8, outcome: u8, confidence_bps: u16, output_hash: vector<u8>, run_hash: vector<u8> }
public struct ClaimFinalized has copy, drop { claim_id: ID, certificate_id: ID, outcome: u8, reviewed: bool, truth_score_bps: Option<u16>, finalized_at_ms: u64 }
public struct ClaimUnresolved has copy, drop { claim_id: ID, certificate_id: ID, truth_score_bps: Option<u16>, finalized_at_ms: u64 }
public struct PayoutTicketCreated has copy, drop { claim_id: ID, ticket_id: ID, recipient: address, amount: u64, reason: u8 }
public struct PayoutWithdrawn has copy, drop { claim_id: ID, ticket_id: ID, recipient: address, amount: u64 }
```

Event payloads contain discovery data only. Indexers must re-read referenced objects or transaction effects before presenting authoritative state.

### 28.6 Access control

Use owned capability objects with the smallest possible surface:

- `AgentCap`: manage one agent profile and its bond subject to lock rules.
- `AdminCap`: bounded registry configuration only; cannot rewrite claims or results.
- `PauseCap`: stop new registrations and active economic actions while preserving safe exits.
- `EvidenceCap`: create/link one phase's evidence bundle before the cutoff and only once.
- `RunAttestorCap`: create a run approval for a selected jury seat and phase; it does not judge the outcome.
- `UpgradeCap`: package upgrade authority held separately from operational capabilities.

Production capabilities belong to reviewed Sui multisig addresses or dedicated policy objects, never a web-server key. Emit capability-transfer events and alert on any owner change. Long term, evidence and run approvals should become multi-attestor or challengeable rather than depend on one capability holder.

### 28.7 Upgrade policy

Hackathon recommendation: publish a versioned package with low caps and explicit object versions. Prefer a new package plus migration over an unreviewed in-place upgrade.

Production may adopt controlled upgrades only with:

- An `UpgradeCap` held by a reviewed multisig or governance policy object.
- The strictest compatible Sui package-upgrade policy that supports the required change.
- Published implementation and migration plan.
- Package-ID and protocol-version pinning on every claim and resolution certificate.
- Explicit migration transactions for mutable shared objects.
- No mutation or reissue of finalized resolution certificates.

### 28.8 Sui object and value invariants

- Finalized claims never change outcome.
- Total payout-ticket amounts never exceed balances deposited into the relevant claim or market object.
- Each agent has at most one counted vote per phase per claim.
- Every jury seat belongs to one selected profile, owner, claim, and phase.
- Committee membership and expected seat IDs never change after the committee is locked.
- Reveal consumes only the signer's owned jury seat and creates one immutable `RevealedVote` if its BCS/Blake2b commitment matches.
- Commit consumes a matching one-time `RunApproval`; reveal cannot change the approved run hash.
- Each `RoundTally` accepts only the five expected seat IDs, records each at most once, and keeps counts equal to its revealed-vote vector length.
- Finalization accepts only a tally matching the committee, claim, active phase, evidence root, and required deadline; it closes the tally before creating the certificate.
- No evidence root changes after its freeze.
- An `EvidenceBundle` object is immutable after creation and its Walrus retention has not expired at finalization.
- No proposal can be challenged after its deadline.
- No finalization occurs before required phase deadline.
- `UNRESOLVED` never credits proposer or challenger as uniquely correct.
- A payout ticket is consumed exactly once.
- Pausing cannot block valid ticket withdrawals indefinitely.

### 28.9 Demo prediction-market consumer

OpenVerdict is the oracle. A separate minimal Move consumer makes the hackathon outcome visible without turning the oracle package into an AMM.

`DemoBinaryPool<T>` behavior:

- Creator links a shared pool object to an OpenVerdict claim object ID and accepted package version.
- Users deposit `Coin<T>` into `YES` or `NO` before market close and receive an owned `Position<T>` object.
- No entry is accepted after close or claim challenge deadline.
- After OpenVerdict creates a matching `ResolutionCertificate`, `settle_pool` fixes the payout ratio and prevents new entries.
- Winners consume position objects to withdraw a pro-rata `Coin<T>`, net of an explicitly disclosed fee if any.
- If OpenVerdict returns unresolved, participants consume positions for policy-defined refunds with no winner.
- One failed or delayed claimant cannot block other position holders.
- The module and pool objects are labelled demonstration-only and use low caps.

Required Move read boundary:

```move
public fun certificate_claim_id(certificate: &ResolutionCertificate): ID;
public fun certificate_result(certificate: &ResolutionCertificate): u8;
public fun certificate_package_version(certificate: &ResolutionCertificate): u64;
```

The Mainnet demo pins Circle native USDC's exact Sui coin type. Testnet uses an explicitly published test coin because Mainnet coin types must never leak into Testnet assumptions.

Do not present this fixed-pool consumer as a production market maker. Production market design, pricing, liquidity, fees, and regulation are separate work.

## 29. Application API reference

### 29.1 `POST /api/fact-checks`

Accepts a bounded claim string, optional explanatory text, one or more public URLs, resolution criteria, evidence policy, and capped review budget. It safely queues URL retrieval, stores submitted text on Walrus, prepares a `DIRECT_REVIEW` claim PTB, and returns the unsigned transaction plus status URL. A gas sponsor may complete only the gas-payment portion after validating the exact package, function, objects, amounts, budget, and expiration.

### 29.2 `POST /api/claims`

Validates and canonicalizes claim content, stores statement/criteria artifacts on Walrus, and returns a prepared Sui PTB targeting the pinned package and registry object. The server does not sign for the user.

### 29.3 `GET /api/claims`

Filters by state, creator, deadline, and final outcome. Results include source checkpoint, object version/digest, and indexing lag.

### 29.4 `GET /api/claims/[id]`

Returns Sui-object-derived economic state plus content, Walrus evidence manifests, committee/jury-seat objects, GonkaRouter run audits, arguments, votes, discussion, payout tickets, and integrity checks.

### 29.5 `POST /api/evidence`

Input:

```json
{
  "claimId": "0x...",
  "phase": 1,
  "sourceUrl": "https://example.org/public-source",
  "sourceClass": "PRIMARY",
  "wallet": "0x...",
  "signature": "0x..."
}
```

Returns submission ID only. Retrieval is asynchronous.

### 29.6 `GET /api/evidence/[id]`

Returns retrieval status, safety decision, hashes, Walrus blob/object IDs, paid retention epoch, title, excerpt, and rejection code. It never proxies arbitrary content directly.

### 29.7 `POST /api/rounds/[claimId]/run`

Operator/worker endpoint that queues selected-agent inference only after the evidence root is frozen. It is idempotent by `(claimId, phase, agentId)`.

### 29.8 `GET /api/inferences/[runId]`

Returns the sanitized GonkaRouter run audit, exact Gonka Request ID, model ID, validated output, evidence IDs, public reasoning trace, retry history, and content hashes. Reasoning visibility follows claim policy and reveal phase.

### 29.9 `POST /api/inferences/[runId]/approve`

Internal worker endpoint. It independently reloads the frozen Walrus manifest and artifacts, recomputes all hashes, validates the output, and prepares `approve_run`. It cannot change the agent's outcome or output. The web process does not hold `RunAttestorCap` or its signer; an isolated worker or reviewed multisig/capability policy authorizes the transaction.

### 29.10 `GET /api/agents`

Returns active agents, manifests, human-backing status where available, eligibility, model/role classifications, and reputation dimensions.

### 29.11 `GET /api/status`

Returns:

- App version.
- Sui gRPC/full-node health and latest checkpoint.
- Package, registry, shared-object, capability-owner, and paused-state configuration.
- GonkaRouter health and model availability.
- Walrus read/write health, current epoch, paid retention, and renewal queue.
- Evidence queue/storage health.
- Worker lag.
- Indexer lag.
- Mainnet write mode.

### 29.12 `GET /api/claims/[id]/events`

Read-only public event feed for CLI followers and the optional observer dashboard. Default transport is Server-Sent Events. It supports `Last-Event-ID` or an explicit cursor for reconnect and replay. A JSON snapshot mode returns the same schema for tests and CLI inspection.

```ts
type ResolutionEvent = {
  eventId: string
  claimId: string
  sequence: number
  phase: string
  kind: string
  source: 'ENGINE' | 'GONKA_ROUTER' | 'TOOL' | 'EVIDENCE' | 'SUI'
  visibility: 'PUBLIC_NOW' | 'PUBLIC_AFTER_REVEAL' | 'INTERNAL_REDACTED'
  actorId?: string
  runId?: string
  occurredAt: string
  publishedAt?: string
  transactionDigest?: string
  checkpoint?: number
  artifactHash?: `0x${string}`
  payload: Record<string, unknown>
}
```

The endpoint:

- Emits only fields allowed by the current on-chain phase and claim policy.
- Never sends unrevealed outcomes, reasoning, confidence, evidence choices, tool arguments/results, salts, keys, or private chain-of-thought.
- Emits only generic `agent_activity` status before reveal; detailed tool events remain `PUBLIC_AFTER_REVEAL`.
- Releases eligible `PUBLIC_AFTER_REVEAL` records only after a matching reveal is confirmed.
- Includes a source pointer so clients can distinguish application events from Sui transactions and content artifacts.
- Deduplicates by `eventId` and preserves a stable per-claim sequence for replay.
- Sends heartbeats and resumes without requiring the engine to rerun work.
- Has no mutation methods and no privileged browser mode that can advance protocol state.

## 30. Data model

Recommended PostgreSQL tables:

| Table | Purpose |
| --- | --- |
| `agent_manifests` | Versioned public agent configuration and hashes |
| `claims` | Indexed claim object IDs, versions/digests, package version, coin type, and synchronization checkpoint |
| `proposals` | Optimistic proposal data and Sui transaction digests |
| `challenges` | Challenge reasons, bonds, Walrus blobs, and transaction digests |
| `committees` | Committee/jury-seat object IDs, selected/reserve agents, randomness transaction, and acceptance |
| `round_tallies` | Shared tally object IDs/versions, expected/revealed seats, immutable vote IDs, outcome counts, Truth Score accumulator/count, evidence root, and closed state |
| `evidence_submissions` | URL submissions and retrieval status |
| `evidence_artifacts` | Hashes, Walrus blob/object IDs, excerpts, parser metadata, and retention epoch |
| `evidence_manifests` | EvidenceBundle object IDs, Walrus manifest IDs, phase roots, and sorted leaves |
| `inference_runs` | GonkaRouter attempts, exact Gonka Request IDs, model IDs, hashes, validation status, and usage |
| `tool_calls` | Ordered bounded tool requests, canonical argument/result hashes, timing, status, and artifact references |
| `run_approvals` | RunApproval object IDs, recomputed hashes, transaction digests, attestor, and validation errors |
| `vote_packages` | Encrypted local reveal recovery and public commitment metadata |
| `reveals` | Immutable RevealedVote object IDs, outcomes, committed confidences, source transaction digests, and index data |
| `resolution_certificates` | Immutable certificate IDs, terminal result, optional Truth Score, final-round vote IDs, and source transaction |
| `discussions` | Agent statements and attached evidence IDs |
| `reputation_snapshots` | Rebuildable materialized agent metrics |
| `payout_tickets` | Indexed PayoutTicket object IDs, recipients, amounts, coin type, consumption state, and transaction digests |
| `walrus_retention` | Blob/object IDs, paid end epoch, required retention, renewal status, and cost |
| `protocol_health` | Dependency checks and latency history |
| `resolution_events` | Append-only normalized events with source pointers, phase visibility, and replay sequence |
| `analytics_events` | Redacted product funnel and support events |

Never store plaintext API keys, wallet private keys, challenge salts in logs, or unpublished model output outside encrypted recovery storage. Do not persist private model chain-of-thought. Store only the structured outcome, public argument, bounded tool transcript, and operational metadata required by the protocol.

## 31. GonkaRouter integration reference

### 31.1 Environment

```text
GONKA_ROUTER_BASE_URL=https://api.gonkarouter.io/v1
GONKA_ROUTER_API_KEY=server-secret
GONKA_ALLOWED_MODELS=live-model-ids-from-catalog
GONKA_REQUEST_TIMEOUT_MS=8000
GONKA_MAX_RETRIES=1
```

Do not expose these as `NEXT_PUBLIC_*` variables.

### 31.2 OpenAI-compatible client

```ts
import OpenAI from 'openai'

export function createGonkaClient() {
  const apiKey = process.env.GONKA_ROUTER_API_KEY
  if (!apiKey) throw new Error('Missing GONKA_ROUTER_API_KEY')

  return new OpenAI({
    baseURL:
      process.env.GONKA_ROUTER_BASE_URL ??
      'https://api.gonkarouter.io/v1',
    apiKey,
    timeout: Number(process.env.GONKA_REQUEST_TIMEOUT_MS ?? 8000),
    maxRetries: Number(process.env.GONKA_MAX_RETRIES ?? 1),
  })
}
```

### 31.3 Safe inference call

```ts
const response = await client.chat.completions.create({
  model: selectedModelId,
  temperature: 0,
  max_tokens: 1024,
  messages: [
    { role: 'system', content: versionedSystemPrompt },
    { role: 'user', content: canonicalInputJson },
  ],
  response_format: { type: 'json_object' },
})
```

Validate `response.choices[0].message.content` against the exact output schema. If a selected GonkaRouter model does not support `response_format`, use a bounded JSON-only prompt and fail closed on malformed output.

### 31.4 Request logging

Log:

- Run ID.
- Model ID.
- Request/response timestamps.
- Input/output hashes.
- Exact Gonka Request ID from the returned response `id`.
- Token usage.
- HTTP status/error category.
- Schema-validation status.

Do not log:

- API key.
- Full prompts containing unrevealed strategy content.
- Challenge salts.
- Wallet private information.
- Raw internal/provider URLs from error bodies.

### 31.5 Retry policy

- Retry network timeout, 429, and eligible 5xx once with jitter.
- Do not retry deterministic 4xx schema/policy rejection without changing the request.
- A retry is a new inference run with its own ID and must remain visible.
- Never hide a failed attempt to make the final run appear cleaner.
- No automatic cross-model substitution under the same agent manifest.

### 31.6 Model availability

Resolve allowed model IDs from a server-side release manifest updated from the current GonkaRouter model catalog. A missing model makes that agent temporarily ineligible; it does not silently select another model.

### 31.7 Provider boundary

GonkaRouter is an independent broker over Gonka-backed compute. Its uptime, pricing, credits, rate limits, supported models, retention, and account policies are separate from OpenVerdict's Sui consensus. During the hackathon, `providerId` is pinned to `gonkarouter`, and every AI reasoning or verification operation must use the configured GonkaRouter endpoint. The submitted release fails closed when GonkaRouter is unavailable; it never falls back to another provider.

The submitted product does not include provider portability. A separate future fork could redesign the manifests and audit contract around another provider, but that would not be this release and must not share agent-version identities silently. OpenVerdict's oracle mechanism supplies evidence, committee selection, arguments, commit-reveal voting, incentives, reputation, and uncertainty. GonkaRouter's indispensable role is supplying every model judgment and its public Request ID through one production API.

### 31.8 Release checks

Verify these against the live GonkaRouter account and current docs before every release:

1. Exact OpenAI- or Anthropic-compatible endpoint used by the worker.
2. Case-sensitive model IDs available to the account.
3. Context and output-token limits for each selected model.
4. Streaming, tool-use, and structured-output behavior actually used by OpenVerdict.
5. Rate limits, timeout behavior, retry guidance, and error bodies.
6. Exact response `id` and token-usage fields returned by each endpoint and displayed as Gonka Request ID.
7. Current pricing, credit balance, privacy policy, and terms.
8. Archived organizer reveal plus final MUBA submission form and video requirements.

Record the verified values in a dated release manifest. Do not turn an undocumented behavior into a product claim.

## 32. Security and threat model

### 32.1 Threat boundaries

| Boundary | Primary risk | Control |
| --- | --- | --- |
| User wallet | Malicious or confusing PTB | Show network, package/module/function, object IDs/versions, coin type, amount, gas sponsor, simulation, and no server signing |
| Protocol capability owner | Capability theft, transfer, pause, or config abuse | Sui multisig/policy ownership, isolated caps, alerts, least privilege, immutable certificates |
| GonkaRouter | Provider outage, rate limits, policy changes, or sensitive logs | Timeouts, privacy filter, visible health state, pinned release manifest, fail closed |
| AI egress | Worker silently calls a non-Gonka model | One adapter, outbound-domain allowlist, no alternate provider credentials, run audit and Request ID assertions |
| GonkaRouter model | Invalid, manipulated, or correlated reasoning | Strict schema, model/role diversity, frozen evidence, no single model majority |
| Tool executor | Model requests unauthorized data or actions | Read-only allowlist, typed schemas, pinned sources/checkpoints/object versions, limits, transcript hashes |
| Run attestor | Approves a missing or altered run artifact | Separate validator, public hashes/artifacts, narrow role, reproducible checks, multi-attestor beta |
| Agent owner | Sybil, hidden manifest changes, collusion | Bonds, owner uniqueness, versioning, diversity, conflict declarations |
| Evidence submitter | SSRF, malware, prompt injection, source poisoning | Safe retriever, content limits, canonicalization, evidence policy |
| Evidence/Walrus service | Selective omission, expired retention, or root manipulation | Public submissions, blob/object IDs, renewal monitor, immutable bundle object, reproducible retrieval metadata |
| Committee executor | Omits runs or changes prompts | Agent manifest hashes, run IDs, visible failures, canonical inputs |
| CLI operator | Signs the wrong chain, value, role, or phase | Simulation, explicit confirmation, scoped auth, hardware/external signer, stable state checks |
| Observer dashboard | Leaks hidden votes or presents derived data as proof | Read-only service, phase gating, redaction tests, source labels, no signer |
| Database/indexer | Edited off-chain history | Sui objects/events and Walrus blobs as source of truth, checkpointed rebuilds |
| Sui shared objects | Contention, stale object versions, or denial of service | Per-claim objects, owned jury seats, bounded mutation, retries, checkpoint-aware clients |
| Gas sponsor | Sponsors malicious or over-budget transactions | Exact allowlist, full PTB validation, limits, expiration, separate gas coins, monitoring |
| Randomness | Biased selection or resource-exhaustion attack | Native Sui Random, bounded snapshot/draws, fixed committee size, abort on insufficient diversity |
| Proposer/challenger | Griefing and spam | Bonds, fees, timing, per-wallet limits |

### 32.2 Sui Move risks

Required controls:

- Separate owned capabilities for agent, admin, pause, evidence, run attestation, and package upgrade authority.
- One shared claim object per dispute; no global claim-state bottleneck.
- Owned jury seats for per-agent commitment and reveal mutation.
- Exact object ID/version/digest checks and stale-object retry behavior.
- Allowlisted coin types and generic `Claim<T>`/`DemoBinaryPool<T>` type consistency.
- One-time consumption of run approvals, jury seats at finalization, positions, and payout tickets.
- Bounded vectors, randomness draws, PTB commands, object inputs, events, and dynamic fields.
- Deadline ordering and min/max duration checks using immutable `Clock` reads.
- Blake2b/BCS test-vector equality between Move and TypeScript.
- Explicit terminal states and immutable resolution certificates.
- Pausing of new claims/economic writes while preserving valid payout-ticket redemption.
- Full validation of sponsored PTBs before the sponsor signs.
- Upgrade-cap custody, compatibility policy, object-version migration tests, and package-ID pinning.
- Move unit/scenario tests plus property and end-to-end invariant checks.

### 32.3 Sybil and collusion

V1 uses:

- One committee seat per owner and human-backing hash.
- Registration bond.
- Model and role diversity caps.
- Minimum liveness history for public committees after beta.
- Conflict-of-interest declaration.
- Random selection.

The hackathon uses a reviewed five-person demo allowlist and labels its limitation. Invite-only beta and permissionless production registration require proof of personhood or an equivalent human-backing policy, delegated-operator rules, and stronger ownership clustering. Do not assume five wallet addresses are five independent humans.

### 32.4 Correlated models

Different agent names are insufficient. Track correlation by:

- Model family.
- Model revision.
- GonkaRouter model route and response model field.
- Prompt lineage.
- Evidence policy.
- Owner.
- Historical vote correlation.

Committee diversity rules should adapt when actual alternatives exist.

### 32.5 Prompt injection

- Evidence text is placed in a delimited untrusted-data section.
- Agents have no direct network or transaction access in V1; bounded tools execute server-side against frozen evidence or pinned Sui state.
- Model cannot choose new URLs.
- No secret appears in prompt context.
- Output schema permits evidence IDs only.
- Deterministic validator rejects instructions, PTB commands, package/function targets, object IDs, or unsupported fields.
- Prompt-injection success cases become permanent regression tests.

### 32.6 Evidence manipulation

- Freeze evidence before inference.
- Preserve raw bytes and retrieval timestamp.
- Record redirects and final URL.
- Store canonicalization/parser version.
- Store raw/canonical Walrus blob IDs, corresponding Sui blob-object IDs, and paid retention epoch.
- Let users download manifest and recompute hashes.
- Renew Walrus storage before the claim's required retention deadline.
- Support correction evidence only in phase 2 under explicit policy.
- Avoid dynamic live-page fetches after freeze when rendering agent context.

### 32.7 Vote secrecy and liveness

- Salts never reach inference provider.
- Commit window closes before reveal opens.
- Agent runners export encrypted recovery packages.
- No reveal package stored in browser analytics/local logs.
- Reserve agents cover pre-commit declines, not post-commit failures.
- Missing reveal reduces liveness and can incur policy-defined penalty.

### 32.8 Privacy

V1 claims and evidence are public. Reject:

- Personal private data.
- Wallet balances unrelated to claim.
- Private communications without consent.
- Credentials and access tokens.
- Sealed legal/medical information.
- Unpublished exploit details.

GonkaRouter may retain API inputs/outputs and independent infrastructure providers may process them. The product must show this before agent owners register private prompts or users submit evidence.

Walrus blobs are public and discoverable. Deleting a blob cannot revoke copies, caches, or already retrieved data. Seal/Nautilus may support encrypted policy-controlled data in a later release, but V1 does not accept private evidence and must not claim confidential storage.

### 32.9 Content and defamation

Initial claim templates exclude allegations against private individuals, criminal guilt, medical status, and other high-risk personal claims. Implement moderation, takedown, and legal escalation before expanding subject matter.

### 32.10 Supply chain

- Pin Sui CLI/Move edition, package dependencies, TypeScript SDKs, Walrus SDK, and compiler versions.
- Review lockfile, `Move.lock`, and package dependency changes.
- Run secret, license, dependency, and malicious-package scans.
- Use reproducible Move builds and record package bytecode/source digests.
- Verify published package ID, upgrade policy/cap owner, shared-object IDs, and source against the release manifest.
- Protect GitHub and deployment accounts with phishing-resistant MFA.
- Require reviewed production deployments.

### 32.11 CLI, event, and observer security

- The CLI and dashboard call the same validated domain services; neither reimplements phase rules.
- Browser sessions never receive worker, attestor, administrator, or agent signing keys.
- Public events use an explicit visibility policy and are filtered again at serialization time.
- Tool-call arguments and results remain hidden until reveal when their disclosure could leak a vote.
- Event payloads are size-limited, escaped, and treated as untrusted content in the browser.
- Source labels and confirmation state prevent application records from impersonating Sui events.
- CLI JSON output and SSE payloads exclude secrets, salts, unrevealed model output, and private chain-of-thought.
- Dashboard unavailability is never a reason to bypass Clock deadlines or Move protocol checks.

## 33. Testing strategy

### 33.1 Sui Move unit and scenario tests

Cover:

- Claim creation validation.
- Direct-review creation, budget, and transition into `REVIEW_REQUESTED` without proposer/challenger state.
- Proposal and challenge bonds.
- Every legal/illegal state transition.
- Deadline boundaries at `-1`, exact, and `+1` second.
- Committee acceptance and reserve flow.
- Evidence root one-time freeze.
- Run approval authorization, phase binding, and one-time hash binding.
- Commit/reveal match and mismatch.
- Duplicate and unauthorized votes.
- 4-of-5 threshold.
- `UNSURE` and unresolved economics.
- Truth Score vectors for all-YES, all-NO, mixed, `UNSURE`, missing reveals, second-round replacement, and half-up rounding.
- `None` Truth Score for an optimistic result with no independent jury review.
- Payout-ticket creation, ownership, one-time consumption, and coin withdrawal.
- Pause behavior.
- Capability ownership, transfer, and misuse.
- Clock deadline enforcement and native-random selection bounds.
- BCS/Blake2b commitment test vectors shared with TypeScript.

### 33.2 Fuzz tests

- Random deadline sequences.
- Random committee sizes within caps.
- Arbitrary vote distributions.
- Arbitrary valid confidence values from `0` through `10000`.
- Arbitrary bond/reward values within bounds.
- Reveal payload/salt variation.
- Repeated lifecycle calls.
- Multiple claims and agents.

### 33.3 Invariant tests

- Claim and pool balances are at least the total outstanding payout-ticket amounts.
- Final claims never change.
- No agent counts more than once per phase.
- Counted reveal has matching commitment.
- Every reviewed certificate's Truth Score exactly matches its terminal-round immutable reveals.
- An unreviewed optimistic certificate cannot contain a Truth Score.
- Frozen evidence root never changes.
- No value disappears between `Coin<T>` deposits, `Balance<T>` vaults, tickets, and withdrawals.
- Owned jury seats and run approvals cannot be reused across claims or phases.
- No terminal state returns to active state.

### 33.4 GonkaRouter adapter tests

Fixtures for:

- Valid JSON output.
- Malformed JSON.
- Unknown outcome.
- Invented evidence ID.
- Extra fields.
- Timeout.
- `HTTP 429` rate limiting.
- Eligible 5xx retry.
- Unknown model.
- Missing Gonka Request ID.
- Duplicate Gonka Request ID across distinct attempts flagged for investigation.
- Response model differs from the requested model.
- Missing or malformed token-usage fields.
- Valid bounded tool call and ordered transcript hashing.
- Unknown tool, arbitrary URL, transaction request, or malformed arguments rejected.
- Tool-call limit, timeout, and result-size limit enforced.
- Model attempt to call `commitVote`, `revealVote`, or any wallet action rejected.
- Run-record hash mismatch.
- Approval rejects a run whose stored artifact or evidence root does not recompute.
- Retry remains visible as separate run.
- Every AI repair/synthesis fixture routes through the GonkaRouter adapter and receives its own Request ID.

### 33.5 Evidence-service tests

- Private-IP and metadata URL blocking.
- Redirect to private network.
- Redirect loops.
- Oversized compressed content.
- Unsupported MIME.
- Duplicate content and same content at different URLs.
- Parser failure.
- Prompt injection embedded in HTML/PDF.
- Content changes between phase freezes.
- Reproducible root generation.
- Walrus upload/read round trip for raw, canonical, manifest, argument, run, and tool artifacts.
- Blob/object ID persistence, expiry detection, renewal, and failed-renewal alerting.

### 33.6 Integration tests

- Build, simulate, sign, and execute the claim-creation PTB.
- Propose and challenge from separate wallets.
- Select a native-random committee and verify distinct owned jury-seat objects.
- Store evidence on Walrus and link an immutable `EvidenceBundle` object.
- Submit text plus URL through the direct fact-check path.
- Run five mocked or real GonkaRouter responses across at least three model IDs.
- Approve run hashes, then commit and reveal.
- Recompute the displayed Truth Score from revealed votes and match the certificate.
- Trigger second phase.
- Finalize and withdraw.
- Rebuild explorer state from events/artifacts.
- Complete the same lifecycle through CLI while the observer dashboard is stopped.
- Start a fresh observer instance and reconstruct an identical public timeline.

### 33.7 Browser end-to-end tests

- Wallet connect and wrong-chain state.
- Claim creation wizard.
- Proposal and challenge review.
- Evidence submission/rejection.
- Hidden commitments before reveal.
- Timeline updates after transaction.
- Five independent agent activity lanes without pre-reveal outcome leakage.
- Tool details withheld before reveal and published correctly afterward.
- Event source and confirmation labels distinguish Sui, evidence, provider, tool, and application data.
- SSE disconnect, cursor resume, deduplication, and delayed-data state.
- Observer has no mutation endpoint or signing authority.
- GonkaRouter timeout and malformed-output exclusion.
- Unresolved result.
- Withdrawal.
- Mobile and keyboard navigation.

### 33.8 CLI and resolution-event tests

- Every documented command has help text, human output, `--json` output, and stable exit behavior.
- State-changing commands show network, package/module/function, object IDs/versions, coin type/value, signer, gas sponsor, and simulation before confirmation.
- Repeating an already-completed idempotent command does not duplicate work or value movement.
- CLI-only full lifecycle succeeds with all frontend services stopped.
- Resolution events preserve per-claim ordering and stable IDs across worker retries.
- Every Sui-labelled event points to a matching transaction digest, Move event, and affected object; every Walrus/artifact-labelled event recomputes its hash.
- `PUBLIC_AFTER_REVEAL` events cannot be fetched or inferred before the confirmed reveal phase.
- Cursor replay produces the same final observer state as a fresh full snapshot.
- CLI inspection, API state, dashboard state, shared claim object, and resolution certificate agree for the same claim.

### 33.9 Mainnet canary

Use a dedicated low-balance wallet and strict caps:

1. Publish the versioned Move package with reviewed upgrade policy and low caps.
2. Verify package bytecode/source digest, package ID, capability owners, registry object, and shared-object IDs.
3. Register team agents with minimal bonds.
4. Upload harmless public evidence to Walrus and record retention.
5. Create one harmless public claim using the pinned native USDC coin type.
6. Propose, challenge, select, commit, reveal, finalize, and consume a payout ticket.
7. Confirm every object, Move event, transaction effect, coin balance, Walrus blob, and certificate.
8. Preserve Sui explorer and Walrus explorer links.

Automated CI must never execute mainnet writes.

### 33.10 CI gates

- Format and lint.
- Typecheck.
- Frontend/unit tests.
- Move unit/scenario/property/invariant tests.
- API fixture tests.
- Evidence security tests.
- Production build.
- Secret scan.
- Dependency/license scan.
- Move bytecode/build checks, package dependency review, and capability/object-layout audit.
- Documentation link/Markdown checks.

## 34. Observability and operations

### 34.1 Resolution event log

Every engine, provider, tool, evidence, and Sui event receives `event_id`, `claim_id`, `sequence`, `phase`, `kind`, `source`, `visibility`, `occurred_at`, and its available transaction digest, checkpoint, object ID/version/digest, Walrus blob ID, or artifact hash. This log powers CLI `--follow`, support diagnostics, replay tests, and the optional observer dashboard.

| Event | Required fields |
| --- | --- |
| `claim_created` | claim_id, claim_mode, package_id, transaction_digest, checkpoint, policy_id, coin_type_hash |
| `proposal_submitted` | claim_id, outcome, transaction_digest, amount |
| `challenge_submitted` | claim_id, transaction_digest, reason_blob_id, amount |
| `committee_selected` | claim_id, committee_id, first_round_tally_id, agent_profile_ids, jury_seat_ids, transaction_digest |
| `evidence_submitted` | claim_id, evidence_id, source_class |
| `evidence_retrieved` | evidence_id, status, latency_ms, bytes |
| `evidence_frozen` | claim_id, phase, evidence_bundle_id, root, manifest_blob_id, transaction_digest |
| `inference_started` | run_id, agent_id, provider_id, model_id, attempt |
| `inference_completed` | run_id, gonka_request_id, model_id, latency_ms, schema_status, token_usage |
| `inference_failed` | run_id, category, retry_count |
| `agent_activity` | run_id, agent_id, generic_stage, status, latency_ms |
| `tool_call_started` | run_id, agent_id, tool_name, argument_hash, call_index |
| `tool_call_completed` | run_id, tool_name, result_hash, latency_ms, status, artifact_hash |
| `run_approved` | run_id, agent_profile_id, jury_seat_id, run_approval_id, run_hash, transaction_digest |
| `vote_committed` | claim_id, phase, agent_profile_id, jury_seat_id, transaction_digest |
| `vote_revealed` | claim_id, phase, round_tally_id, agent_profile_id, jury_seat_id, revealed_vote_id, confidence_bps, valid, transaction_digest |
| `argument_published` | claim_id, phase, agent_id, gonka_request_id, argument_hash, reasoning_trace_hash, evidence_ids |
| `discussion_posted` | claim_id, agent_id, parent_argument_id, artifact_hash |
| `phase_changed` | claim_id, previous_phase, new_phase, checkpoint, transaction_digest |
| `claim_finalized` | claim_id, certificate_id, outcome, reviewed, truth_score_bps, transaction_digest |
| `payout_withdrawn` | claim_id, payout_ticket_id, recipient_hash, coin_type_hash, amount_bucket, transaction_digest |

Application events are audit aids, not self-authenticating proof. The observer labels an event `Confirmed on Sui`, `Bound to artifact hash`, or `Application record` based on its actual source.

`agent_activity` is the only tool-adjacent public event during independent investigation. Detailed `tool_call_started` and `tool_call_completed` events publish only after the corresponding valid reveal.

### 34.2 Operational dashboards

- Claims by state and overdue phase.
- Sui gRPC/full-node error/latency, latest checkpoint, object-version conflicts, and event-indexer lag.
- GonkaRouter model availability, latency, failure, token usage, and valid-output rates.
- Evidence queue, SSRF rejects, parser failures, and storage health.
- Agent liveness, invalid output, and reveal rates.
- Claim/pool `Balance<T>` totals versus outstanding payout tickets.
- Walrus upload/read latency, paid end epochs, renewal cost, and expiring blobs.
- Mainnet caps and cumulative value at risk.
- Frontend errors and conversion funnel.

### 34.3 Observer guarantees

- The observer process is horizontally disposable and contains no signer.
- A fresh instance reconstructs a completed claim from chain state, public artifacts, and resolution events.
- The page displays chain-indexer lag and the last confirmed Sui checkpoint.
- SSE disconnects resume by cursor without duplicating agent or transaction entries.
- If the observer fails, the CLI and engine continue and no deadline is extended.
- If the event service is delayed, the UI shows `Delayed observer data` instead of guessing state.
- Pre-reveal events are tested for indirect leaks through names, counts, timings, arguments, and payload sizes.

### 34.4 Alerts

Alert when:

- Claim/pool balance versus outstanding-ticket invariant diverges.
- Phase remains overdue beyond worker SLA.
- GonkaRouter error or timeout rate exceeds threshold.
- Structured-output validation rate falls below threshold.
- Evidence queue or storage becomes unavailable.
- Primary and secondary RPC disagree on critical state.
- Unknown package ID, package bytecode digest, shared-object ID, capability owner, or coin type is configured.
- Withdrawal failures rise.
- Any secret scanner or integrity check fails.
- Observer output diverges from reconstructed chain/artifact state.
- Event cursor stalls or public phase-gating releases data early.

### 34.5 Support IDs

Every failed claim action receives a support ID that correlates client state, Sui transaction digest/checkpoint/object versions, worker job, inference run, evidence item, and Walrus blob without exposing secrets.

## 35. Deployment and mainnet runbook

### 35.1 Environments

| Environment | Chain | Purpose |
| --- | --- | --- |
| Local | Sui local network | Move, CLI, indexer, and UI development |
| Test | Sui Testnet | End-to-end public testing |
| Demo | Sui Mainnet with caps | Hackathon proof after canary |
| Production | Sui Mainnet | Post-review deployment |

### 35.2 Environment variables

Public:

```text
NEXT_PUBLIC_SUI_NETWORK=mainnet
NEXT_PUBLIC_SUI_GRPC_URL=https://your-public-sui-grpc.example
NEXT_PUBLIC_OPENVERDICT_PACKAGE_ID=0x...
NEXT_PUBLIC_REGISTRY_OBJECT_ID=0x...
NEXT_PUBLIC_DEMO_POOL_OBJECT_ID=0x...
NEXT_PUBLIC_SETTLEMENT_COIN_TYPE=0x...::usdc::USDC
NEXT_PUBLIC_SUI_EXPLORER_URL=https://your-reviewed-sui-explorer.example
NEXT_PUBLIC_WRITE_MODE=disabled
```

Server-only:

```text
SUI_NETWORK=mainnet
SUI_GRPC_URL=https://your-primary-sui-grpc.example
SUI_GRPC_FALLBACK_URL=https://your-secondary-sui-grpc.example
SUI_OPENVERDICT_PACKAGE_ID=0x...
SUI_REGISTRY_OBJECT_ID=0x...
SUI_CLOCK_OBJECT_ID=0x6
SUI_RANDOM_OBJECT_ID=0x8
SUI_SETTLEMENT_COIN_TYPE=0x...::usdc::USDC
DATABASE_URL=postgresql://...
GONKA_ROUTER_BASE_URL=https://api.gonkarouter.io/v1
GONKA_ROUTER_API_KEY=...
WALRUS_NETWORK=mainnet
WALRUS_PUBLISHER_URL=https://your-private-publisher.example
WALRUS_PUBLISHER_TOKEN=...
WALRUS_REQUIRED_RETENTION_EPOCHS=...
GAS_STATION_URL=https://your-gas-station.example
GAS_STATION_API_KEY=...
RUN_ATTESTOR_SIGNER_REF=kms-or-isolated-signer-reference
QUEUE_URL=...
SENTRY_DSN=...
```

No agent, user, capability-owner, upgrade, gas-station, or attestor private key belongs in the web deployment or plaintext environment variables.

### 35.3 Pre-deploy checklist

- [ ] Move unit/scenario/property/invariant tests pass.
- [ ] Package ID, object IDs/versions, caps, coin type, deadlines, committee size, and threshold reviewed.
- [ ] Upgrade, admin, pause, evidence, and attestor capabilities have reviewed owners.
- [ ] Sui native randomness and Clock integration tested against target network.
- [ ] GonkaRouter model list and health verified against the authenticated account.
- [ ] Evidence fetcher security suite passes.
- [ ] Walrus Mainnet upload/read and retention-renewal canary passes.
- [ ] Sponsored-transaction allowlist, budgets, gas-coin concurrency, and expiry tested if enabled.
- [ ] Privacy/terms/risk pages published.
- [ ] Mainnet writes disabled at initial app deploy.
- [ ] Package source/bytecode digest and release object manifest prepared.
- [ ] Monitoring, support, pause, and incident owners assigned.

### 35.4 Release sequence

1. Publish the Move package with low caps and reviewed upgrade policy.
2. Verify source/bytecode digest and record the package ID.
3. Create the registry and operational capabilities, then transfer capabilities to reviewed owners.
4. Configure package/object IDs, native USDC type, Walrus Mainnet, gRPC endpoints, and explorer templates in the release manifest.
5. Deploy the read-only application, CLI, indexer, and observer.
6. Reconcile object reads, Move events, checkpoints, Walrus blobs, and paid retention.
7. Enable the reviewed five-agent allowlist and optional sponsored-action allowlist.
8. Complete the full Sui Mainnet canary and consume one payout ticket.
9. Enable hackathon demo mode for team wallets and monitor continuously.

### 35.5 Pausing

Use `PauseCap` to pause new registrations, claims, proposals, challenges, evidence links, and jury actions when object configuration, balances, randomness, sponsorship, Walrus retention, or verification is unsafe. Preserve object reads and valid payout-ticket redemption where safe. Pausing the UI does not mutate the registry; pausing the registry does not erase pending off-chain jobs.

### 35.6 Incident response

1. Classify: Move package/object/capability, gRPC/checkpoint, randomness, gas sponsor, GonkaRouter, evidence, Walrus, indexer, wallet, or content/legal.
2. Pause the smallest affected write surface.
3. Preserve logs, run audits, Walrus blobs/object IDs, Sui transaction digests/effects, object versions, and checkpoints.
4. Publish user impact and safe actions.
5. Reproduce with read-only state and fixtures.
6. Patch and independently review.
7. Test on the Sui local network and Testnet.
8. Run capped canary.
9. Restore and publish resolution.

Finalized `ResolutionCertificate` objects cannot be edited or reissued through incident response.

## 36. Hackathon demo

### 36.1 Demo claim

Use a harmless, already-closed claim whose evidence requires interpretation rather than a price lookup. Example template:

> Did the demo protocol complete all three published mainnet-launch conditions before 12:00 UTC on the stated date?

The live demo starts by pasting this text plus one public source URL into `/fact-check`. The criteria name the three conditions and permitted official/independent sources. Use a fictional demo entity or a real claim reviewed for content/legal risk.

### 36.2 Demo hierarchy

The demo proves the verification engine, not the dashboard. The CLI drives normal engine actions. The optional observer dashboard is open beside it and makes the same public events legible. If the dashboard closes, the CLI must continue the resolution; reopening it must reconstruct the same state.

Use three visible surfaces:

1. **CLI:** commands, object IDs/versions, run IDs, Gonka Request IDs, validation errors, transaction digests, checkpoints, and final exit status.
2. **Observer dashboard:** URL/text submission, agent activity lanes, safe tool states, evidence, public reasoning traces, Truth Score, consensus, and source-labelled audit events.
3. **Sui/Walrus explorers:** independent inspection of objects, commitments, reveals, roots, blobs, certificates, payout tickets, and coin movement.

### 36.3 Prepared result

Before Demo Day, complete one full low-value lifecycle and preserve:

- Direct-review claim transaction digest and claim object.
- Optional prediction-market proposal/challenge digests and Walrus reason blob.
- Native-random committee transaction, committee object, and five jury-seat objects.
- Phase-one `EvidenceBundle` object plus Walrus manifest/source blobs and paid retention.
- Five Gonka Request IDs across at least three model IDs, run-record hashes, validated public reasoning traces, and arguments.
- Five commitments and reveals.
- Split first-round vote, such as three `YES` and two `NO`.
- Phase-two discussion and evidence.
- Four-to-one final vote.
- Recomputed Truth Score and immutable resolution certificate.
- Optional prediction-market payout tickets, consumed position/ticket objects, and coin withdrawals.
- Complete explorer timeline.

### 36.4 Demo CLI sequence

The entire lifecycle remains available through ordinary CLI commands. For presentation, use one live jury command and one live finalization command; keep the other phase transitions prepared to avoid spending the pitch on terminal repetition.

```text
openverdict fact-check start --file fact-check.json --follow
openverdict fact-check report --claim 0xCLAIM --verify --json
openverdict claim inspect --claim 0xCLAIM --verify
openverdict events follow --claim 0xCLAIM --public
openverdict jury run --claim 0xCLAIM --phase 1 --follow
openverdict votes commit --claim 0xCLAIM --phase 1
openverdict votes reveal --claim 0xCLAIM --phase 1
openverdict claim advance --claim 0xCLAIM --follow
openverdict jury run --claim 0xCLAIM --phase 2 --follow
openverdict votes commit --claim 0xCLAIM --phase 2
openverdict votes reveal --claim 0xCLAIM --phase 2
openverdict claim finalize --claim 0xCLAIM
```

Run `events follow` in a second terminal only if it adds clarity. The primary CLI should remain readable and show the command that caused each authorized action.

### 36.5 Observer-dashboard narrative

The dashboard should visually change with protocol phase:

- **Evidence:** show the frozen root, immutable bundle object, admitted sources, Walrus blob/object IDs, paid retention, and explorer links.
- **Independent investigation:** show five isolated agent lanes, model IDs, status, and generic safe-tool activity. Do not show arguments, evidence selections, confidence, or vote direction.
- **Commit:** show five owned jury-seat objects and commitment transaction digests without predicting the outcome.
- **Reveal:** disclose votes, confidence, public reasoning traces, evidence citations, Gonka Request IDs, and sanitized tool transcripts.
- **Deliberation:** draw connections only after reveal; show rebuttals, challenged claims, and new phase-two evidence.
- **Final vote:** show the four-of-five calculation, recomputable Truth Score, and minority view without labelling the minority dishonest.
- **Settlement:** show the resolution certificate, payout-ticket/position consumption, native USDC movement, and downloadable public audit bundle.

The visual design may feel like a live resolution room, but it remains a read-only projection. No button in this view signs, advances, approves, reveals, or finalizes anything.

### 36.6 Live presentation

The required fact-check video must be at most two minutes. Target 110 seconds:

1. **0:00–0:10:** Paste the ambiguous claim and public URL; explain why one price feed or model cannot resolve it.
2. **0:10–0:25:** Start direct review and show the sponsored Sui claim transaction, Walrus-backed evidence bundle, native-random committee, and five jury seats.
3. **0:25–0:50:** Run the five GonkaRouter agents live across at least three model IDs while the dashboard shows isolated lanes and bounded tool activity.
4. **0:50–1:10:** Reveal each verdict, evidence-linked public reasoning trace, confidence, model ID, and Gonka Request ID.
5. **1:10–1:25:** Show cross-model disagreement, the four-of-five rule, and the recomputed Truth Score. Use a prepared second-round transition only if it remains legible within the time limit.
6. **1:25–1:40:** Finalize and show the immutable Sui `ResolutionCertificate` plus Walrus audit bundle.
7. **1:40–1:50:** Let the demonstration prediction market consume the certificate and show the capped native-USDC payout or unresolved refund.
8. **1:50–2:00:** End on the public report URL with Gonka Request IDs, Sui explorer links, repository link, and one-sentence public-value summary.

### 36.7 Reliability fallback

- Target five parallel live phase-one calls. If latency is unsafe, run one agent live and use four prepared run records that are clearly labelled.
- Label replayed data clearly.
- Keep a completed resolution available if GonkaRouter or Sui is degraded.
- Never present cached inference as live.
- Keep CLI output and the completed Sui claim available if the dashboard or event stream fails.
- Dashboard failure must not stop finalization or withdrawals.
- Keep screen recording and explorer links as proof, not as a substitute for the deployed app.

### 36.8 Submission package

- Public live demo URL opening directly to `/fact-check`.
- Documented GitHub repository with setup, architecture, deployed Sui package/object IDs, environment-variable reference, test commands, security limitations, and demo instructions.
- Two-minute live fact-check video following the timed script above.
- One completed public report URL containing five Gonka Request IDs, at least three model IDs, Truth Score inputs, public reasoning traces, Walrus evidence, Sui objects, and the final certificate.
- Clear disclosure of prepared/replayed segments, experimental financial limits, and features not yet production-ready.

### 36.9 Judge defence

#### “GonkaRouter does not prove truth.”

Correct, and OpenVerdict does not ask GonkaRouter to prove truth. GonkaRouter routes each oracle agent's request into Gonka, whose Hosts execute inference and whose L1 validates work artifacts. OpenVerdict resolves the claim through frozen evidence, independent arguments, commit-reveal voting, bonded disputes, consensus, and an explicit unresolved outcome. Valid execution is not the same as a factually correct conclusion.

#### “These agents are not independent.”

Show owner or approved human backing, model, prompt lineage, role, and correlation constraints. Explain remaining correlation risk honestly.

#### “The backend can change votes.”

Show on-chain commitments created before reveal and recompute a commitment live.

#### “Is the dashboard actually running the protocol?”

No. Stop it and continue through the CLI. The dashboard has no signer or mutation endpoint and reconstructs its view from public engine events, artifacts, and Sui state.

#### “Can an agent use tools to browse or transact arbitrarily?”

No. Agents receive a typed, read-only allowlist limited to frozen evidence and pinned Sui checkpoints, transactions, and object versions. The engine validates every request, caps the loop, hashes the transcript, and reserves every state-changing action for authorized engine or CLI code.

#### “Why Sui instead of a generic EVM settlement contract?”

Sui is part of the mechanism rather than a logo: native `Random` selects the jury, owned `JurySeat` objects isolate agent actions, Move capabilities enforce authority, Walrus preserves evidence and public agent work, sponsored transactions reduce agent/user gas friction, and a reusable `ResolutionCertificate` becomes the final result object.

#### “Why not use one model?”

One model is a single failure domain. OpenVerdict makes diversity, disagreement, evidence and uncertainty observable.

#### “Why not UMA?”

UMA supplies a mature economic oracle. OpenVerdict explores a different evidence-processing committee where agent arguments, source handling, disagreement, and uncertainty are first-class public artifacts. It is experimental, not a claim to replace UMA today.

#### “Why not ChatGPT or Claude?”

ChatGPT or Claude could technically supply model inference, but they are not valid fallbacks for this submission. Every AI investigation, verification, deliberation, synthesis, and repair pass uses GonkaRouter and exposes its Request ID. OpenVerdict's value is its oracle mechanism; GonkaRouter's required role is powering the complete fact-check swarm rather than an ornamental chatbot.

## 37. Delivery plan and backlog

### Milestone 0: GonkaRouter integration spike

Build:

- GonkaRouter server client.
- Calls to every intended account-available model ID.
- Output-schema validator.
- Exact Gonka Request ID, usage, latency, error, and input/output-hash capture.
- Structured public reasoning-trace validation.
- Written release manifest for endpoints, models, limits, pricing, privacy, and track requirements.

Exit criteria:

- Thirty bounded test prompts across at least three model IDs measured for validity, latency, token usage, and errors.
- Every intended agent role produces policy-valid structured output at an acceptable rate.
- No sensitive data enters prompts.

### Milestone 1: local protocol

Build:

- OpenVerdict Move package, `Registry`, capabilities, `AgentProfile`, and shared `Claim<T>` objects.
- Direct-review fact-check mode and jury-budget accounting.
- Claim/propose/challenge.
- Fixed test committee.
- Immutable evidence-bundle objects and placeholder Walrus IDs.
- Commit/reveal.
- Truth Score calculation, optional score field in resolution certificates, payout tickets, and coin withdrawals.
- CLI commands for every local lifecycle action and inspection.

Exit criteria:

- Full local lifecycle passes tests.
- Full local lifecycle completes through CLI with no frontend running.
- Move object/capability/coin invariants hold.
- Four-of-five threshold and unresolved path verified.

### Milestone 2: evidence and swarm

Build:

- Safe evidence retriever.
- Canonicalization and Walrus storage/retention.
- Frozen evidence manifest/root.
- Five agent manifests.
- GonkaRouter inference worker.
- Controlled read-only tool executor and transcript hashing.
- Append-only resolution event pipeline with phase visibility.
- First and second-round output packaging.

Exit criteria:

- No model can cite an unknown evidence ID.
- Evidence root and every Walrus blob hash recompute independently.
- Failures remain visible.
- CLI `--follow` receives ordered resolution events without hidden-vote leakage.

### Milestone 3: Sui Testnet

Build:

- Wallet flows.
- Testnet Move package/object deployment.
- Native `Random`/`Clock` integration and Sui event indexer.
- Walrus Testnet upload/read/renewal flow.
- Optional sponsored-transaction gas station with strict allowlist.
- Claim/timeline/agent UI.
- Read-only observer dashboard and SSE replay endpoint.
- Transaction recovery.

Exit criteria:

- Full public testnet dispute completes from two user wallets.
- UI reconstructs state from Sui objects/events and Walrus artifacts.
- Observer can be deleted, restarted, and rebuilt without affecting the dispute.

### Milestone 4: demo release

Build:

- Sui Mainnet low caps and pinned native USDC type.
- Sui/Walrus Mainnet canary.
- Completed demo dispute.
- Polished CLI-led demo with optional visual observer.
- Live/replay controls.
- Status, risk, privacy, and terms pages.
- Monitoring and support IDs.

Exit criteria:

- Judge can inspect every inference, commitment, reveal, result, and transfer.
- Judge can see that CLI/engine continue when the observer is unavailable.
- One live call and one complete lifecycle are demonstrable.

### P0 backlog

- [ ] Organizer reveal posts archived and final Gonka/Sui submission requirements confirmed in writing.
- [ ] Original repository scaffolded after hackathon kickoff.
- [ ] Agent manifest schema and canonicalizer.
- [ ] Five model/role manifests.
- [ ] Move package, capabilities, objects, state machine, and object-version rules.
- [ ] Proposal and challenge bonds.
- [ ] Sui native-random committee selection, jury-seat creation, and diversity validation.
- [ ] Evidence retriever security controls.
- [ ] Walrus evidence artifacts, manifest, Merkle root, blob/object IDs, and retention renewal.
- [ ] GonkaRouter client, run audit, and output validation.
- [ ] At least three GonkaRouter model IDs across five agents with no hidden provider fallback.
- [ ] Exact Gonka Request ID capture, display, and audit export for every attempt.
- [ ] Structured public reasoning traces and deterministic Truth Score implementation.
- [ ] Controlled tool allowlist, limits, transcript artifacts, and transcript hash.
- [ ] Complete OpenVerdict CLI with human and `--json` output.
- [ ] Resolution event schema, append-only log, SSE cursor replay, and phase gating.
- [ ] Commit/reveal packages.
- [ ] First and second-round flow.
- [ ] Unresolved result.
- [ ] Generic coin vaults, position objects, payout tickets, refunds, and one-time withdrawals.
- [ ] Claim explorer/timeline.
- [ ] Public `/fact-check` text/URL input and report page.
- [ ] Optional observer dashboard with five agent lanes, tool states, evidence, Sui links, and consensus view.
- [ ] Agent pages and accurately labelled integrity/run-trace badges.
- [ ] Sui Testnet lifecycle.
- [ ] Sui/Walrus Mainnet canary and demo dispute with native USDC.
- [ ] Live demo URL, documented repository, and two-minute fact-check video.

### P1 backlog

- [ ] Sponsored transactions for narrowly allowlisted user and agent actions.
- [ ] Walrus Mainnet private publisher/upload relay and automated renewal.
- [ ] Multi-attestor evidence/run approval or challengeable attestation design.
- [ ] Optional zkLogin onboarding, explicitly not treated as proof of unique humanity.
- [ ] Optional Gonka network metadata extension if a documented endpoint becomes useful.
- [ ] Optional cross-chain resolution and identity/reputation mirrors.
- [ ] Open registration with stronger Sybil controls.
- [ ] Evidence submitter attribution/rewards.
- [ ] Notification and automation workers.
- [ ] External security review.
- [ ] Economic simulation.
- [ ] Content/legal moderation.

## 38. Definition of done

### Product

- [ ] The app explains optimistic resolution, challenge, committee, vote, and uncertainty.
- [ ] A user can submit bounded text, a public URL, or both and receive a complete fact-check report.
- [ ] One direct-review fact check completes end-to-end and its certificate settles one capped prediction-market claim.
- [ ] The report shows a recomputable Truth Score, cross-model disagreement, public reasoning traces, and Gonka Request IDs.
- [ ] The audit timeline is understandable without reading Move source code.
- [ ] Every lifecycle action and verification is available through CLI with the dashboard stopped.
- [ ] A fresh dashboard rebuilds the same public state from events, artifacts, and Sui.
- [ ] The dashboard contains no signer, mutation endpoint, or authoritative outcome logic.
- [ ] No UI claims that GonkaRouter proves factual truth.
- [ ] Replay mode is always labelled.

### GonkaRouter

- [ ] Every AI reasoning, verification, deliberation, synthesis, and repair pass calls an explicit GonkaRouter model.
- [ ] Five selected agents use at least three model IDs and no single model controls a majority.
- [ ] Every attempt, including failures/retries, is recorded.
- [ ] Input/output hashes and exact Gonka Request IDs are preserved and publicly displayed after reveal.
- [ ] Every revealed agent publishes a bounded evidence-linked public reasoning trace without private chain-of-thought.
- [ ] Bounded tool calls and sanitized transcript hashes are preserved.
- [ ] Every counted vote uses an approved run hash that can be independently recomputed.
- [ ] No UI text presents a Gonka Request ID as proof that an answer is true.
- [ ] API key and sensitive data never reach the browser/logs.

### Evidence

- [ ] Every counted agent receives a frozen manifest/root.
- [ ] Every referenced evidence ID exists.
- [ ] Raw/canonical hashes and retrieval metadata exist.
- [ ] Raw/canonical/manifest Walrus blob IDs and Sui blob-object IDs exist.
- [ ] Paid Walrus retention exceeds the claim's required retention window.
- [ ] SSRF, redirect, size, MIME, and injection tests pass.
- [ ] Phase roots are committed once and reproducible.

### Sui Move

- [ ] Direct review plus proposal/challenge/commit/reveal/finalize/withdraw work on Sui.
- [ ] Every illegal transition aborts with a stable Move error code.
- [ ] Native randomness creates five distinct owner-bound jury-seat objects.
- [ ] Clock deadlines, BCS hashes, capability ownership, coin types, and object versions are enforced.
- [ ] Four-of-five threshold is correct.
- [ ] Committed confidence, tally accumulators, optional certificate Truth Score, and independent recomputation agree.
- [ ] `UNSURE` and unresolved paths work.
- [ ] Accounting and terminal-state invariants pass.
- [ ] Package/source digest, package/object IDs, upgrade policy, capability owners, and low caps are published.

### Security and operations

- [ ] Secret, dependency, license, Move build/test/audit, Walrus, and application security gates pass.
- [ ] Primary/fallback Sui gRPC, checkpoints, GonkaRouter, Walrus, evidence, worker, object, and balance monitoring work.
- [ ] Pause and incident procedures are tested.
- [ ] Event phase-gating and pre-reveal leakage tests pass.
- [ ] CLI, API, observer, Sui objects/events, Walrus artifacts, and resolution certificate agree for the canary claim.
- [ ] Legal/content boundaries are published.
- [ ] Mainnet canary is documented.

### Hackathon submission

- [ ] Live `/fact-check` URL works without private setup steps.
- [ ] GitHub repository documents setup, architecture, test results, deployed Sui IDs, demo flow, and limitations.
- [ ] Two-minute live fact-check video shows URL/text input, at least three GonkaRouter models, five Request IDs, public reasoning traces, Truth Score, Sui certificate, and optional market settlement.
- [ ] Submission copy explains the separate, essential roles of GonkaRouter and Sui without claiming that either proves universal truth.

## 39. Production roadmap

### Phase A: invite-only beta

- Known agent owners.
- Low-value claims.
- Public evidence only.
- Multiple GonkaRouter models from the authenticated release catalog.
- Sui native-random committees.
- Walrus-backed public artifacts with automated retention.
- Manual content review.
- Independent security review.

### Phase B: application integrations

- Resolution callback interface.
- Claim-policy templates.
- Signed evidence attestations.
- Agent-owner dashboards.
- SLA/status APIs.
- DAO grants and bounties as second vertical.

### Phase C: open protocol

- Permissionless agent registration with mature Sybil policy.
- Provider adapters with explicit agent-version changes.
- Cross-chain result/identity mirrors without weakening the Sui object source of truth.
- Decentralized evidence-root attestations.
- Appeals/expanded committees.
- Audited economics and governance.
- SDK and indexer for external integrators.

### Phase D: higher-value resolution

Requires demonstrated security, audits, legal review, economic limits, insurance/reserves, and long-running performance data. Do not infer readiness from hackathon success.

## 40. Risks and open questions

### 40.1 Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Public Gonka/Sui track pages lag the organizer reveal material | Medium | High | Archive official reveal posts and confirm final submission fields before scope lock |
| Any hidden AI step bypasses GonkaRouter | Low after tests | Critical/disqualification | Central adapter, egress allowlist, provider-call audit, no fallback credentials, end-to-end Request ID assertions |
| Truth Score is mistaken for objective truth | High | High | Publish formula and inputs, retain verdict/uncertainty labels, prohibit probability/guarantee language |
| “Reasoning trace” is implemented as private chain-of-thought capture | Medium | High | Store only bounded evidence-linked public verification steps and test redaction boundaries |
| Same-model correlation | High | High | Model/prompt/role/owner diversity and correlation tracking |
| Evidence prompt injection | High | High | Safe retriever, frozen data, no model-selected URLs, strict schema |
| Bounded tool executor is abused | Medium | Critical | Typed read-only allowlist, pinned inputs, limits, sandboxing, transcript hashes |
| Majority becomes self-reinforcing | Medium | High | Separate reputation dimensions; no minority slash |
| Sybil agent owners | Medium | High | Bonds, one-owner-and-human seat, later proof of personhood/ownership clustering |
| Backend omits failed runs | Medium | High | Run IDs, visible retries/failures, queue audit logs, output commitments |
| Observer leaks unrevealed agent information | Medium | High | Visibility policy, serialization filter, payload-shape tests, no private chain-of-thought |
| Observer presents application data as proof | Medium | High | Source labels, Sui/artifact links, confirmation states, rebuild tests |
| CLI signs an unintended action | Low/medium | Critical | Simulation, explicit network/package/object/coin/gas/signer display, confirmation, scoped external signers |
| Move object or capability design bug | Medium | Critical | Owned-seat architecture, capability separation, scenario/property tests, external review |
| Shared-object contention or stale versions | Medium | Medium/high | Per-claim shared objects, owned seats, checkpoint-aware retries, load tests |
| Walrus blob expires or is unavailable | Medium | High | Retention budget, renewal worker, redundant reads, expiry alerts, explicit hashes |
| Gas sponsor signs malicious/oversized PTB | Low/medium | Critical | Exact package/function/object/coin allowlist, budgets, expiry, isolated gas coins |
| Native-random selection exhausts resources | Low/medium | High | Bounded eligible snapshot/draws, fixed committee, abort without weakening constraints |
| Unresolved claims frustrate users | Medium | Medium | Clear criteria, templates, refund policy, uncertainty education |
| GonkaRouter/model outage | Medium | Medium | Visible failure, reserve agents, strict timeouts, unresolved fallback |
| SSRF/malware in evidence | High | Critical | Dedicated sandboxed retriever and security tests |
| Move coin/object accounting bug | Low after review | Critical | Balance/ticket invariants, type constraints, audit, caps, one-time consumption |
| Defamation/illegal content | Medium | Critical | Narrow templates, moderation, takedown/legal process |
| Prior DIVE work conflicts with build-from-scratch rules | Medium/unknown | High | Written organizer approval, clean implementation, full disclosure, preserved Git history |

### 40.2 Open GonkaRouter questions

- Which final submission form fields and video-hosting constraints accompany the revealed track brief?
- Which model IDs, context limits, output limits, and structured-output behaviors apply to the team's account?
- Are response `id` and token-usage fields stable across the OpenAI- and Anthropic-compatible endpoints?
- What rate limits and concurrency should the five-agent rounds respect?
- What prompt/output retention, deletion, and private-deployment options apply?
- Which pricing and credit limits should the mainnet operating budget assume?
- Which status or incident channel should production monitoring use?

### 40.3 Open protocol questions

- Should evidence-root freezing be single attestor, multi-attestor, or challengeable?
- Which token funds bonds on Sui Mainnet?
- Which exact native USDC coin type and test-coin package are pinned per network?
- Who owns UpgradeCap, AdminCap, PauseCap, EvidenceCap, and RunAttestorCap at each release stage?
- How many Walrus epochs must every artifact remain available, and who funds/executes renewal?
- Which user and agent actions qualify for gas sponsorship, with what per-wallet and global budgets?
- What object layout and migration policy applies across package versions?
- What caps and minimum windows are safe for the demo?
- How are owner clusters identified without invasive identity?
- Which privacy-preserving proof-of-personhood provider and nullifier scope should beta use?
- Which bounded read-only tools are required for the first claim template, and which can be removed?
- Which public event fields remain safe before reveal under timing and payload-size analysis?
- Should an `UNSURE` threshold refund both sides equally?
- When should committee expansion occur?
- Who pays inference/retrieval if a claim remains unresolved?
- How is later objective truth attached without rewriting original resolution?

### 40.4 Hackathon rule question

Ask organizers in writing whether pre-kickoff product research and a PRD-only private repository are permitted, whether the original DIVE creators may submit OpenVerdict as a clean reimplementation, and whether any final eligibility or submission requirements differ from the supplied Gonka and Sui Track 02 reveal slides. Both categories have been revealed, but their public detail pages have not yet been updated. Begin code implementation after kickoff unless organizers explicitly permit otherwise.

## 41. Source map

### Gonka and GonkaRouter

- [GonkaRouter homepage](https://gonkarouter.io/)
- [GonkaRouter developer docs](https://gonkarouter.io/docs)
- [GonkaRouter models](https://gonkarouter.io/models)
- [GonkaRouter pricing](https://gonkarouter.io/pricing)
- [GonkaRouter privacy policy](https://gonkarouter.io/privacy-policy)
- [GonkaRouter terms](https://gonkarouter.io/terms-of-service)
- [Gonka developer quickstart](https://gonka.ai/docs/developer/quickstart/)
- [Gonka architecture](https://gonka.ai/docs/architecture/)
- [Gonka FAQ](https://gonka.ai/docs/FAQ/)
- [Gonka dynamic pricing](https://gonka.ai/docs/wallet/pricing/)
- [Gonka GitHub](https://github.com/gonka-ai/gonka)

### Oracle and mechanism references

- [UMA oracle overview](https://docs.uma.xyz/protocol-overview/how-does-umas-oracle-work)
- [Sui object model](https://docs.sui.io/develop/sui-architecture/object-model)
- [Sui Move concepts](https://docs.sui.io/develop/write-move/sui-move-concepts)
- [Sui on-chain randomness](https://docs.sui.io/sui-stack/on-chain-primitives/randomness-onchain)
- [Sui Clock](https://docs.sui.io/references/framework/sui_sui/clock)
- [Sui hashing](https://docs.sui.io/develop/cryptography/hashing)
- [Sui transaction authentication](https://docs.sui.io/develop/transactions/transaction-auth/auth-overview)
- [Sui sponsored transactions](https://docs.sui.io/develop/transaction-payment/sponsor-txn)
- [Sui zkLogin](https://docs.sui.io/sui-stack/zklogin-integration/zklogin)
- [Sui Programmable Transaction Blocks](https://docs.sui.io/develop/transactions/ptbs/prog-txn-blocks)
- [Sui event indexer example](https://docs.sui.io/getting-started/examples/event-indexer)
- [Walrus getting started](https://docs.wal.app/docs/getting-started)
- [Walrus on the Sui stack](https://docs.sui.io/sui-stack/walrus/sui-stack-walrus)
- [Circle native USDC on Sui](https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui)
- [Seal/Nautilus reference, future only](https://docs.sui.io/sui-stack/nautilus/seal)

### Application stack

- [Sui documentation](https://docs.sui.io/)
- [Sui developer tooling](https://docs.sui.io/getting-started/tooling)
- [Sui wallet/dApp integration](https://docs.sui.io/onchain-finance/asset-custody/wallets/self-custody)
- [Walrus TypeScript integration](https://docs.sui.io/sui-stack/walrus/sui-stack-walrus)
- [Next.js App Router](https://nextjs.org/docs/app)
- [shadcn/ui](https://ui.shadcn.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [Iconsax](https://iconsax.io/)

### Project history and hackathon

- [Earlier DIVE repository](https://github.com/derek2403/cannes2026)
- [MUBA tracks](https://www.mubahack.xyz/challenge_tracks/code.html)
- [MUBA GonkaRouter track details](https://www.mubahack.xyz/challenge_tracks/track-details-gonka-1.html)
- [MUBA Sui Track 2 details](https://www.mubahack.xyz/challenge_tracks/track-details-sui-2.html)
- [MUBA timeline](https://www.mubahack.xyz/event_timeline/code.html)
- [MUBA FAQ](https://www.mubahack.xyz/frequently_asked_questions/code.html)

## 42. Glossary

| Term | Meaning |
| --- | --- |
| Agent manifest | Versioned declaration of owner, model, prompt hash, tools, policies, and code references |
| Bond | Token collateral posted to discourage dishonest or frivolous participation |
| Argument round | Independent agent analysis followed by publication, discussion, and an optional second vote |
| Challenge | Bonded objection that escalates an optimistic proposal into committee review |
| Claim | Bounded statement plus criteria, timing, evidence policy, and possible outcomes |
| CLI | Required control and diagnostic interface over the headless OpenVerdict engine |
| Committee | Randomly selected, diversity-constrained oracle agents assigned to a dispute |
| Commitment | Hash hiding an agent vote until reveal |
| Capability | Owned Move object that authorizes a narrowly scoped action such as agent management, evidence freezing, pausing, run approval, or package upgrade |
| Consensus reliability | Historical agreement under protocol rules; not identical to truth accuracy |
| Content address | Identifier derived from content/structure, used to detect changes and retrieve artifacts |
| Direct review | Fact-check mode that funds and starts a jury without an optimistic proposal or challenge bond |
| Evidence bundle | Frozen manifest of safely retrieved source artifacts supplied to agents |
| Evidence root | Merkle root committed for an evidence bundle phase |
| Gonka Request ID | Exact response `id` returned by GonkaRouter for one attempt and displayed as public trace metadata |
| GonkaRouter | API gateway into Gonka: independent Hosts execute inference off-chain while Gonka L1 records and validates work artifacts |
| Human-backed agent | AI oracle identity controlled by an approved distinct owner, with privacy-preserving proof of personhood required before permissionless production use |
| Inference run audit | Stored request/response metadata, hashes, timing, usage, validation status, and attempts for a GonkaRouter call |
| Jury seat | Owned Sui object assigned to one selected agent for one claim phase; stores acceptance, commitment, reveal, and run linkage |
| Observer dashboard | Optional read-only visualization reconstructed from public resolution events and authoritative sources |
| Optimistic resolution | Proposed result becomes final unless challenged during a window |
| Outcome | `YES`, `NO`, `UNSURE`, or terminal `UNRESOLVED` |
| Programmable Transaction Block | Sui transaction containing one or more ordered commands over explicit object inputs |
| Public reasoning trace | Bounded evidence-linked verification steps intended for audit; never private model chain-of-thought |
| Reveal | Publication of vote data and salt so the commitment can be recomputed |
| Resolution event | Source-labelled, phase-gated event used by CLI following, replay, support, and the observer dashboard |
| Resolution certificate | Immutable Sui object recording the final rule-bound result and the claim/evidence/jury references used to derive it |
| Sponsored transaction | Sui transaction whose gas is paid by a sponsor while the user still signs the full transaction data |
| Sybil attack | One actor creates many identities to gain disproportionate influence |
| Tool transcript | Ordered, bounded record of sanitized model tool calls whose hash is bound into an inference run |
| Truth Score | Unweighted `0–100` summary derived from the final valid jury round's committed outcomes and confidence; not objective truth |
| Unresolved | Protocol cannot reach the configured threshold without forcing certainty |
| Walrus blob | Public content-addressed evidence or agent artifact stored for a paid number of Walrus epochs and linked to a Sui blob object |

---

OpenVerdict succeeds when a person can submit text or a public URL and receive an auditable multi-model fact check with Gonka Request IDs, public reasoning traces, a recomputable Truth Score, and an immutable Sui certificate; the same decentralized verification protocol must also resolve economic disputes headlessly through the CLI while the optional observer makes the process understandable without becoming protocol authority.
