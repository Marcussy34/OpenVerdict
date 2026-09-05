# <img src="app/icon.svg" alt="OpenVerdict logo" width="36" height="36" valign="middle" /> OpenVerdict

<!-- markdownlint-disable MD013 -->

See how the verdict was reached.

**A decentralized adversarial AI jury protocol for factual disputes: jurors
from three model families research independently, cast commit-reveal secret
ballots, and cross-examine deadlocks on Gonka; verdicts settle on Sui as
certificates anyone can recompute.**

Not an agent swarm: five juror seats drawn on-chain, a 4-of-5 quorum,
sealed ballots, a bounded debate over a frozen record, and `UNRESOLVED` as
an honest outcome.

**Live on Sui testnet:** [openverdict.info](https://openverdict.info)

**Sui contracts and transactions, GonkaRouter request IDs:** [here](https://docs.openverdict.info/proof).

---

## 💡 Why

- A single AI model can be wrong or manipulated
- Token voting lets whales decide truth
- Private resolution desks never show their work
- Chatbot "juries" live in editable logs nobody can recheck

**Juries no single vendor can steer; verdicts anyone can recompute.**

**The model in one line:** Gonka is the only mind, Sui is the only judge, and
SUI is the working currency. (Full write-up: [appendix](#appendix-the-idea-in-full).)

---

## ⚙️ How it works

### 📝 1. Submit a claim

- Paste a **statement or URL**; a GonkaRouter model distills it into **one checkable claim**
- The claim, its budget and its **deadlines go live on Sui**; the text is archived to Walrus
- Demo tier is **free today** (in future: **paid in SUI**; a seat's jury rewards go to its staker)

**The clock and the money live on-chain from the first second.**

---

### 🎲 2. Jury drawn on-chain

- **Sui's built-in randomness draws the 5 seats**
- **Max 2 seats per AI family**: DeepSeek, Kimi and MiniMax, all served through GonkaRouter
- Every committee also seats **a skeptic and a source-authenticity juror**; the **engine assigns** a seat's debate role, nobody picks it
- **The draw is weighted by stake**, 10000 per 0.1 SUI and capped at ten times the minimum (in future: also weighted by on-chain track record)
- Anyone can **stake on a seat**: any amount from **0.1 SUI** up, with a wallet or a Google sign-in through Sui zkLogin, and the staker earns that seat's jury rewards; a bigger stake is drawn more often, up to the cap

**No operator picks the judges; no vendor holds a majority.**

---

### 🧊 3. Evidence frozen

- Sources are fetched, cleaned, **fingerprinted on Sui** and stored publicly on Walrus
- All of it **before any model reasons** about anything

**Nobody can slip evidence in or out after the jury convenes.**

---

### 🧠 4. Jury resolution

Every claim runs round one; only a deadlock runs round two.

The words used throughout: a **juror** occupies a **seat** (an on-chain
`JurySeat` governed by an `AgentCap`, never a free-floating worker
process); the five seats form the **committee**, and **4 of 5** is the
**quorum**; round two is **cross-examination**; the settled verdict is the
**resolution certificate**.

### 🤫 Round One (every claim) 🤫

**Step 1: Independent research**

- Each juror, alone, searches the live web **for AND against** the claim
- **Word-for-word quotes from 2+ sites** required; every AI call runs **through GonkaRouter, nothing else**
- Every page a juror opens is **archived publicly on Walrus**
- Each search and page open is **published as it happens**; the answer, the vote and the reasoning stay sealed until the reveal
- A failed juror records a **public failure**; no vote is ever invented

<img src="docs/assets/hairline.svg" width="100%" height="1" alt="" />

**Step 2: First vote (commit-reveal)**

- Private votes (**YES / NO / UNSURE**) are **locked on Sui** as fingerprints
- Each juror's sealed work file goes to Walrus, its key **time-locked with Seal**
- Votes **open together**, checked against the locks

**Commit-reveal prevents informational cascades:** no juror can anchor on or herd around another juror's reasoning before sealing its own stance. In a naive model swarm the first answer becomes everyone's prompt context; here nobody sees a ballot until all are sealed.

<img src="docs/assets/hairline.svg" width="100%" height="1" alt="" />

**Step 3: Consensus check**

- **4-of-5 agreement** → ✅ **finalized** (~10 min). **Most claims end here.**
- **No supermajority** → round two below 👇

<img src="docs/assets/hairline.svg" width="100%" height="1" alt="" />

### ⚔️ Round Two (only when round one deadlocks) ⚔️

**Step 4: Public debate**

- Revealed jurors bring their round-one evidence and vote **to the table** and **argue it out**, streamed **live**; every turn is its own GonkaRouter run
- It is a **conversation, not a row of briefs**: each turn **answers a named seat's specific point**, weighs it against the record, may **put one question to a named seat**, and states its **position last**. A **dissenting seat opens** each exchange and the sides **speak alternately**; a seat that is asked a question **speaks next and answers it first**
- Each turn states a **current stance and confidence**; up to **three exchanges**, and the debate **stops early when nobody moves**
- They cross-examine each other's **interpretations of the frozen evidence root**; a juror may cite **only the frozen round-one record** (its evidence ids and the pages the jury itself opened and revealed), and a turn that cites anything else is rejected, so no new or invented facts enter the debate
- The transcript is **frozen into the evidence on Walrus**

**Adversarial cross-examination in the open, not an ungrounded chat between bots.**

<img src="docs/assets/hairline.svg" width="100%" height="1" alt="" />

**Step 5: Second vote (the table vote)**

- A fresh **commit-reveal round** with **no new research**: each juror re-votes on the frozen record plus the debate transcript
- The vote prompt is **pinned in the juror manifest** (hash on-chain), so the second vote is as recomputable as the first

<img src="docs/assets/hairline.svg" width="100%" height="1" alt="" />

**Step 6: Still split**

- The claim finalizes **`UNRESOLVED`**

**The system never forces fake certainty.**

<img src="docs/assets/hairline.svg" width="100%" height="1" alt="" />

**All or nothing:** a verification is one attempt. Any error at a binding step (a failed run, a committee that never drew, a missing commit, a missing reveal) **voids the whole attempt**; nothing partial is ever finalized. The engine **relaunches automatically** once all three model families answer a health probe, up to **three attempts**, and gives up after six hours. Every attempt, voided or not, stays public on the claim page.

---

### 💰 5. Settlement in SUI

- Immutable **certificate** + 0-100 **Truth Score**, recorded forever on Sui
- **Payout tickets** for every juror who did valid work; protocol fee
- Bonded claims: **unchallenged proposals finalize free**; a challenge convenes the jury

**Seats are paid for valid work, never for agreeing with the majority.**

---

### 🔍 6. Recheck everything

- **15 checks re-run in your browser** from the public Walrus files and Sui records
- **Re-ask the same model** the exact recorded conversation through GonkaRouter
- Sealed files **unlock after the deadline without us**, thanks to Seal's time-lock
- (in future: attested execution in a Sui Nautilus enclave; signed gateway receipts)

**Trust is optional; recomputation is not.**

---

## 🏗️ Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/architecture-dark.png">
  <img alt="OpenVerdict system architecture" src="docs/diagrams/architecture.png">
</picture>

The engine is headless-first: the complete lifecycle runs through the CLI with
the dashboard offline. The dashboard is a read-only projection of the
append-only resolution event log and holds no signer, and anyone can recompute
a verdict from Sui objects, Walrus artifacts and the public API without it,
with `pnpm ov audit <link>` or the agent skill served at
[`/SKILL.md`](https://app.openverdict.info/SKILL.md).

### Claim lifecycle

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/claim-lifecycle-dark.png">
  <img alt="Claim lifecycle state machine" src="docs/diagrams/claim-lifecycle.png">
</picture>

### Jury rounds: research, then cross-examination on a split

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/jury-round-dark.png">
  <img alt="Jury rounds: research and sealed votes in round one, cross-examination and a sealed table vote in round two" src="docs/diagrams/jury-round.png">
</picture>

Diagram sources are editable Excalidraw files in
[`docs/diagrams/`](./docs/diagrams) (black-and-white; Excalidraw's own dark
theme inverts them natively, and the paired `*-dark.png` exports serve GitHub's
dark mode).

---

## 🔍 What is auditable

Anyone can recompute a claim's whole lifecycle from public artifacts. Independence is enforced before the fact (commit-reveal, evidence roots frozen on Sui before any reveal) and integrity is checkable after it (hash chains from the raw Walrus bytes to the on-chain roots). Two caveats. Re-execution is corroboration, not proof, until gateway-signed receipts land, and the operator is detectable rather than impossible, unable to forge the record without breaking hashes anyone can check. OpenVerdict certifies the process, not universal truth.

| Item | Source of truth |
| --- | --- |
| Claim, deadlines, bonds, result, Truth Score | Shared claim object, immutable certificate |
| Committee, commitments, reveals, counts | Locked committee, owned jury seats, immutable revealed votes, shared round tally |
| Evidence roots, files, metadata | Immutable evidence bundles on Sui, public Walrus blobs with explicit hashes |
| Gonka Request IDs, devshard ids, fingerprints, every attempt (retries, repairs, hedges) | Revealed run bundle on Walrus, its sealed copy cited on chain before the commit, metadata also in the `RunApproval` |
| Research trail (searches with intent, pages on both sides, citations) and the exact conversation sent to the model | Transcript and `request.messages` in the revealed bundle; the transcript hash is inside the on-chain run hash; re-runnable |
| Live research as it happens | Public `research_step` events, replayable from the event stream |
| Reveal keys | Published at reveal and escrowed under the Seal time-lock, so sealed bundles open after the deadline without the operator |
| Failed seats | Failure record (status, message, trail, attempts) on Walrus and the claim page; no vote is inferred |
| Payouts and refunds | Payout-ticket objects and Sui coin movement |
| Observer dashboard | Rebuildable read-only projection, never authoritative |

`/verify` offers "With an agent" (one line to hand any agent) and "By hand", which recomputes commitments and Truth Scores in the browser, runs 15 checks on any revealed run (prompt, policy, system prompt, input, output and transcript hashes, citations, challenge search, both sides opened, citation sites, counter-evidence summary, opens per turn, run hash, Seal escrow binding, sealed core), opens a sealed bundle through Seal after its deadline, and re-runs a juror against the recorded model. `scripts/gen-parity-vectors.ts` regenerates the cross-language vectors pinned in both test suites.

---

## 🖥️ Use OpenVerdict from the terminal and from any agent

No key, no database, no wallet. `pnpm audit:claim` refetches the public record (the API, Sui JSON-RPC, the Walrus aggregator, GonkaRouter receipts), recomputes every commitment, run hash and truth score, checks the certificate on Sui and writes one Markdown dossier.

```bash
pnpm install
pnpm audit:claim https://app.openverdict.info/claims/<claimId>   # dossier on stdout and in .audit/<claimId>.md
pnpm audit:claim <claimId> --json audit.json --out audit.md      # plus a JSON dump of everything fetched
pnpm audit:claim --list                                          # every claim with state, result, score, attempt
```

Exit 0 means every check passed (an unreachable source is UNAVAILABLE with a manual URL, never FAIL), 1 means a check failed, 2 means bad input or a failed fetch. Claim, run and report links and bare ids all work, and `--base <url>` targets another deployment.

The public CLI `ov` runs the whole journey against the same public API. The console stays the visual monitor.

```bash
pnpm ov weather                                # DeepSeek, MiniMax, Kimi, web search: ok or down, clear or not
pnpm ov board --limit 20                       # the live board, newest first
pnpm ov extract --url <article>                # up to three checkable claims with reasons and quotes (or --text, --file)
pnpm ov submit "<claim>"                       # 200: claim id and link; 503: the jury cannot sit, nothing stored
pnpm ov agents                                 # the roster: model, role, stake, rewards, track record
pnpm ov agent <seatId>                         # one seat and its published manifest
pnpm ov status <claimId>                       # state in plain words, seats committed and revealed, next deadline
pnpm ov watch <claimId> --for 9m               # one dated line per event (rerun with --since N)
pnpm ov audit <claimId>                        # the same dossier as pnpm audit:claim
pnpm ov trace <claimId> [--juror N] [--full]   # every search, page, quote, answer and receipt; --full adds the exact prompt and output
```

`ov trace` rebuilds each juror's turns from the recorded conversation, so the order and results the model saw are exact. Exit codes are 0 success, 2 input or request error, 3 the claim voided or gave up (`watch`), 4 the watch stopped at `--for`, 5 rate limited or writes disabled (`submit`, `extract`), and `--json` puts one JSON document on stdout. A public submission is a claim of 5 to 1000 characters, up to 20000 characters of evidence text and five https URLs, at five per minute per client. While a model family or web search is down it is refused with 503 `WEATHER_NOT_CLEAR` and nothing is stored. One round settles in about 12 minutes, two rounds in about 32.

### 🤖 Give this to your agent

```
Set up https://app.openverdict.info/SKILL.md and take it from there.
```

That URL serves `skills/openverdict/SKILL.md` and tells any agent that can read a link (Claude, ChatGPT, Codex, Cursor, Gemini) how to set itself up. The auditor, the CLI and a map of the app ship as one skill in the open [Agent Skills format](https://agentskills.io). `npx skills add Marcussy34/OpenVerdict` installs it into Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, VS Code, OpenCode, Amp and the rest, and inside the repo it loads on its own through `.claude/skills/openverdict-audit` and `.agents/skills/openverdict`. The launchers run this repository's code, so clone it for the CLI itself (`git clone https://github.com/Marcussy34/OpenVerdict.git`, `pnpm install`, `pnpm ov help`). Then paste any claim, report, run or agent link, or ask "audit this", "who is on the jury", "is the jury healthy", "watch this claim", and the agent audits, explains and drives the whole journey, submitting only on an explicit go.

---

## 💰 Economics: who pays, who earns

Jurors are standardized seats, manifest-pinned to a fixed GonkaRouter model, prompt and tool policy, so operators compete on liveness and integrity like PoS validators, not on secret sauce.

On chain today:

- **Requesters pay.** `create_claim` escrows the claim, committee and evidence budgets. The free demo tier is a rate-limited subsidy, not the business model.
- **Valid seats earn.** At settlement the committee budget splits evenly across the seats that revealed a valid vote, as payout tickets to each seat's staker (`settlement.move`). Commit late, fail schema or skip the reveal and you earn nothing.
- **Disputes pay for themselves.** An unchallenged bonded outcome finalizes with no inference at all; a challenge convenes the jury and the losing bond pays.
- **The protocol takes 5 percent** of each committee budget (`protocol_fee_bps` 500). On claim `0x273220b5…` that was one 500,000 MIST fee ticket beside five 1,900,000 MIST jury tickets.

Stake opens seats. Post at least **0.1 SUI** in one transaction (gas sponsored, so a Google sign-in needs nothing else) and that seat's rewards go to you; the bond returns 24 hours after unstaking (slashing is specified, not yet enforced). You pick the model and the amount, nothing else. The engine assigns the debate role, and a bigger stake buys a bigger share of the draw, capped at ten times the minimum. The draw enforces diversity on its own, with at most two seats per family, three families, a skeptic and a source-authenticity seat on every committee, one seat per operational key and no cap per staker. While a provider is down an operator can lower the families to two on chain (degraded mode), and every certificate drawn that way says so. A pick that cannot be completed restarts, and the stake endpoint refuses a seat no valid committee could seat. No identity claim is made, unlike DIVE's World ID gate.

The roster today is the team's seven demo jurors plus staked seats (for example [profile `0xc32aa5db…`](https://testnet.suivision.xyz/object/0xc32aa5db303d2d479133cd8476afedf1fa8f4eac1241bd90b57a3fb2723d6037), a MiniMax seat opened with 0.1 SUI, gas paid by Shinami). Next come self-hosted juror workers with their own GonkaRouter keys, verified exactly like ours.

### Next rungs (recorded direction, not shipped)

- **Pooled stake.** Several stakers behind one seat share its rewards pro rata after fees, like delegators behind a validator, funded by requester-paid SUI. Pay stays participation-based with at most an accuracy bonus. Majority-only pay is rejected because paying for agreement buys herding and punishes honest UNSURE votes (PRD §24.2, §24.5).
- **Track-record weights.** Selection weight comes from stake alone today (10000 per 0.1 SUI, capped at 100000) and every vote counts equally. The next step adds each juror's Brier score over settled claims, recomputed after every settlement and published on its agent page. The weight lives in the on-chain registry, so this needs a registry update path.

---

## 🏆 Hackathon track fit

One build, both tracks. Gonka supplies all of the intelligence, Sui the coordination, settlement and currency, Walrus the public evidence and Seal the time-locked keys. Each pillar carries a load the other two cannot take.

### The three pillars

| Pillar | What it provides | Why it is irreplaceable here | Remove it and |
| --- | --- | --- | --- |
| **Gonka (GonkaRouter): the only mind** | Every reasoning pass (claim extraction, five research runs, each debate turn and table vote) across three model families behind one gateway, with a request id, devshard id and fingerprint kept per call. | Five copies of one model share the same blind spots, so the committee rule mandates three families (DeepSeek, Kimi, MiniMax) with at most two seats each. One gateway serving all three makes that rule enforceable, pins each model in a manifest, and its request ids are receipts a verifier re-checks against Gonka's public lookup. | One vendor API is one mind voting five times, steerable by whoever runs it. Five vendor keys turn one enforceable rule into five private promises. The Truth Score still prints a number and no longer means anything. |
| **Sui: the only judge** | Claims and deadlines as objects, the jury drawn by native randomness under family limits, commit-reveal enforced in Move, evidence roots frozen before any reveal, the immutable certificate and Truth Score, payout tickets, the demo pool, staked seats (0.1 SUI, wallet or zkLogin, gas sponsored). | Nobody picks the judges and nobody edits the result. The verdict is something the chain acts on, settling the pool and paying the seats, not a number a judge is asked to trust. | A database the operator runs. The draw, the deadlines, the commitments, the frozen root, the certificate and the payouts become rows it can edit. A verdict people are asked to trust. |
| **Walrus + Seal (Mysten): the only memory** | Claim text, every opened page, manifests, sealed and revealed bundles, transcripts and failure records, content-addressed and hash-pinned on Sui. Seal time-locks each reveal key. | "Anyone can recompute" needs bytes that are public and cannot be swapped. Walrus gives them an address the on-chain hash commits to; Seal removes the operator from the reveal path. | An operator bucket whose files can be rewritten or withdrawn, so the hashes point at nothing fetchable, and a reveal key held by the party with a motive to hide a bad run. A story about evidence with no record to check. |

Gonka is the only mind, Sui is the only judge, Walrus is the only memory, SUI is the working currency. Gonka produces the work and the receipts, Sui commits to it before reveal and enforces what follows, Walrus keeps the bytes and Seal makes them openable without us. The verifier walks that chain end to end (fetch from Walrus, hash, compare to Sui, re-ask Gonka). Cut any link and it breaks.

**MUBA Gonka Track, AI for Society.** All AI reasoning through GonkaRouter (one adapter host-pinned in code, no other provider, fail closed). URL or text input (`/fact-check` extracts the claim with a Gonka model; the API and CLI also take source URLs and evidence text). Multi-model cross-verification (5 seats across all three families, no family majority, both sides researched). A deterministic, recomputable Truth Score 0 to 100 with evidence-linked public traces, never chain-of-thought. Gonka Request IDs (response `id`, `x-request-id`, devshard id, fingerprint) kept verbatim for every attempt and shown after reveal.

**MUBA Sui Track 02, AI × Sui.** Sui is integral (native `Random` selection, owned `JurySeat`s, Move capabilities, immutable certificates, coin settlement), ownership and identity are owned objects (`AgentProfile` + `AgentCap`, every seat, approval and ticket), and deadlines, commit-reveal, thresholds, payouts and stakes are enforced in Move (89 tests). The working demo path is localnet E2E exit 0 plus finalized live testnet lifecycles, NO certificate [`0x42954c91…`](https://testnet.suivision.xyz/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706) ("Humans use only ten percent of their brains.", 5 of 5 seats, attempt 3 of 3, audited 110/110 by `pnpm ov audit`), YES certificate [`0xff3191bc…`](https://testnet.suivision.xyz/object/0xff3191bcad4a645f44a6caccf2e6c661e8defcbf4943b44ec8b08d91b4f4133c) (claim #25, Seal escrows) and NO certificate [`0x975b3ae1…`](https://testnet.suivision.xyz/object/0x975b3ae103c7832c4405714196528808af70ef975fe0d0db3ae70017191c00e4) (claim #26, hedged calls); see `docs/demo/runbook.md`. Walrus holds every page, manifest and bundle with its hash pinned on chain, Seal time-locks the reveal keys, and the SUI loop is live (budgets escrowed at `create_claim`, per-seat reward and refund tickets, a 5 percent fee ticket, 0.1 SUI seat stakes paying the staker, the demo pool consuming certificates at `/risk`; pooled stake is the recorded next step).

Both public track pages were placeholders at spec time; final requirements must be reconfirmed against organizer material (PRD §7.3).

---

## 🧩 Sponsor tech, one by one

Every row is live on testnet at https://app.openverdict.info.

### GonkaRouter (Gonka)

| Used for | How | Check it |
| --- | --- | --- |
| Every juror reasoning pass | One adapter on `/v1/chat/completions`, host-pinned to gonkarouter.io, no other provider, fail closed | `lib/gonka/adapter.ts`; any revealed run shows the raw request, response and hashes |
| Multi-model consensus | 5 seats across DeepSeek, Kimi and MiniMax, at most 2 per model, tickets weighted by stake and capped | `move/openverdict/sources/jury.move`; the jury card on any claim page |
| Claim extraction from a URL | A Gonka model distills one bounded claim, with a JSON repair round when needed | `POST /api/extract-claim`; the provenance card names model and request id |
| Inference provenance | Response `id`, `x-request-id`, devshard id and fingerprint stored for every attempt and cross-checked against Gonka's public receipts | "Run provenance" on any revealed run |
| Latency hedging | A same-model hedge after a 25 s stall; every attempt lands in the audit trail | Revealed run bundle on Walrus |

Compliance rules are enforced in code (`lib/gonka/adapter.ts` unless noted). The host is pinned to `api.gonkarouter.io` and no other provider exists in the repository; `X-Gonka-No-Fallback: true` rides every call and an `x-gonka-fallback` header is recorded if it ever appears; a served model that differs from the manifest model is a provider error (`RESPONSE_MODEL_MISMATCH`), never a vote; a response without a Gonka Request ID fails the run (`normalizeRawResponse`) and nothing is committed; the Request ID sits inside the run hash (`lib/protocol/bcs.ts`, `RunRecordV1.gonka_request_id`) written as a `RunApproval` and bound into the vote commitment, so no vote can be revealed against an uncommitted receipt; receipts are cross-checked after reveal (`/api/gateway-receipts/[requestId]`) and a mismatch is shown, never hidden; one seat failure voids the whole attempt (`lib/engine/engine.ts`, `voidAttempt`) and it relaunches when all three families answer. The Gonka receipt is not attached to the verdict afterwards. It is part of what the jury commits to on chain before anyone reveals.

### Sui

| Used for | How | Check it |
| --- | --- | --- |
| Protocol of record | Claims, committees, seats, revealed votes, certificates and payout tickets are Sui objects; deadlines, thresholds, payouts and stakes enforced in Move (89 tests) | Objects open on SuiVision, transactions on Suiscan |
| Jury selection | Native `Random` draw under the family constraints | `move/openverdict/sources/jury.move` |
| Commit-reveal voting | Commitments bind the approved run hash before any reveal; `blake2b256(BCS(preimage))` is recomputable by anyone | `/verify` recomputes it in the browser |
| Evidence freezing | The manifest Merkle root is frozen into an `EvidenceBundle` before any reveal | Report page, evidence bundle chip |
| Onboarding | zkLogin (Enoki): a Google login yields a self-custodial address that can post the 0.1 SUI stake, so people without a wallet can stake too; authentication only | `/agents`; env-gated |
| Wallet rendering | Object Display on certificates, profiles and positions | `move/openverdict/sources/display_meta.move` |

### Walrus

| Used for | How | Check it |
| --- | --- | --- |
| Claim inputs | Statement and criteria blobs, hashes in the `create_claim` transaction | Claim dossier chips |
| Evidence bytes | Raw and canonical copies of every opened page, blake2b-256 hashed into the manifest | Evidence pages link to the aggregator |
| Evidence manifests | The Merkle leaves behind each frozen root | `evidence-<claim>-<phase>.json` |
| Juror work product | The sealed bundle stored and cited on chain before the commit; the revealed bundle and any failure record follow | Run pages link both blobs |

### Seal (Mysten)

| Used for | How | Check it |
| --- | --- | --- |
| Reveal-key escrow | Each reveal key Seal-encrypted at commit time under an on-chain time-lock policy | `move/openverdict_seal/sources/reveal_lock.move` |
| Operator-independent opening | After the deadline anyone recovers the key from the threshold key servers | `/verify` performs the recovery live and links every key server object |
| Safety stance | Insurance only; it can never cost a seat its vote | 4 Move policy tests |

### Shinami (Gas Station)

| Used for | How | Check it |
| --- | --- | --- |
| Gas for wallet-signed pool entries and seat stakes | The browser builds the transaction kind, the server allowlists it, Shinami attaches gas and signs, the user's wallet signs the returned bytes and still approves the full transaction | `app/api/sponsor/route.ts`; a sponsored action shows "Gas paid by OpenVerdict (Shinami Gas Station)" with its digest |
| Google sign-in without SUI | A fresh zkLogin address holds no SUI and cannot act without sponsorship; with it the first action costs nothing and a stake costs exactly the 0.1 SUI bond | `/claims/<id>` market panel after continuing with Google; `/agents` stake card |
| Fund health | `gas_getFund` reports fund, network, balance and in-flight reservations, no key in the output | `pnpm sponsor:check`; live sponsored tx [9ToB29r3…](https://suiscan.xyz/testnet/tx/9ToB29r3WWJv7odpai4HkTMjjccmu3aCndrxEAoViGjw) (sender the operator, gas owner Shinami's fund) |

The access key stays in `SHINAMI_GAS_ACCESS_KEY` on the server (Shinami refuses CORS by design, and a leaked key drains the fund), and `POST /api/sponsor` is the only door, behind the same guards as every public write (`OPENVERDICT_PUBLIC_WRITES` plus rate limiting). The route is a positive allowlist, at most eight commands, no Move call except `demo_binary_pool::enter` and `agent_registry::register_staked_agent` in the deployed package plus the four `0x2::coin` helpers a stake needs, no reference to the gas coin, no withdrawal naming the sponsor, gas budget capped at 50,000,000 MIST, and a rejected kind never reaches Shinami. `SHINAMI_GAS_ENDPOINT` selects a non-US region, `pnpm sponsor:check` prints the fund line (`--send` sponsors one real transaction), and with the key unset the route answers 503 and gas falls back to the wallet, labelled as such. Next rungs are sponsored juror commits and reveals, and sponsored operator lifecycle transactions.

---

## 🧱 Technology stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| AI inference | GonkaRouter (`/v1/chat/completions`, 4096-token output cap; three model families) | Every juror reasoning pass; no hidden fallback; hedged same-model calls after 25 s |
| Juror research | Firecrawl v2 REST through the engine | Engine-executed web search and page reads; every step recorded and hashed |
| Protocol | Sui Move (edition 2024, sui CLI 1.78) | Objects, capabilities, native randomness, commit-reveal, settlement |
| Reveal-key escrow | Mysten Seal (`@mysten/seal` 1.4, time-lock policy package on testnet) | Sealed bundles openable by anyone after the reveal deadline, without the operator |
| Sui client | `@mysten/sui` 2.26 (`SuiGrpcClient`) | BCS, PTBs, signing, object/event reads |
| Storage of record | Walrus (`@mysten/walrus` 1.2) | Evidence, opened pages, manifests, sealed and revealed run bundles, failure records |
| App/db | drizzle-orm + pglite (dev/tests) / Railway Postgres (prod) | Rebuildable indexes and the resolution event log |
| Frontend | Next.js 16, React 19, Tailwind 4, shadcn/ui, iconsax | Read-only observer + verification UI |
| CLI | TypeScript: `pnpm cli` (operator console, commander 15) and `pnpm ov` (public: weather, board, agents, agent, extract, submit, status, watch, audit, trace) | Complete control, inspection, automation; the public journey with no key |
| Validation | zod 4 (strict schemas) | Oracle I/O contracts, manifests, config |
| Hashing | `@noble/hashes` blake2b-256 == `sui::hash::blake2b256` | One commitment format across TS and Move |
| Onboarding | `@mysten/enoki` (zkLogin) + dapp-kit v2 | Social-login self-custodial addresses; env-gated, wallet-standard |
| Object metadata | Sui Object Display (`display_meta` module) | Certificates/profiles/positions render in wallets + explorers |
| Tests | vitest 4 + `sui move test` + the localnet E2E | 996 TS + 93 Move (89 protocol, 4 Seal policy), incl. the cross-language parity gate; `pnpm e2e:localnet` runs every lifecycle on a fresh localnet |

---

## 🔒 Security posture and honest limitations

Implemented:

- SSRF-hardened evidence retrieval: https-only, DNS-first validation of every resolved address (loopback, private, link-local, CGNAT, metadata, reserved, IPv4-mapped IPv6), per-hop redirect revalidation, streaming byte caps, MIME allowlists, sanitized errors.
- Models never fetch, hold keys or transaction authority. Every URL a juror sees or opens is engine-executed and recorded in the sealed transcript; outputs are strict-schema validated and may cite only pages that juror opened in that run or frozen evidence ids, else they fail closed.
- Operator write routes need a bearer token (uniform 403). Public submissions sit behind an enable flag plus rate limiting whose per-client keys apply only behind a trusted proxy.
- Salts never reach the inference provider, commitments bind the approved run hash before any vote, and the Seal escrow is insurance only and can never cost a seat.

Known limitations (V1, disclosed by design):

- The run attestor and evidence freezer are single team-held capabilities, so the pipeline upstream of the commitment is trusted infrastructure (multi-attestor is production work, PRD §28.6).
- No proof yet that the model received exactly the recorded bytes. Re-execution is soft corroboration, GonkaRouter's public receipts are cross-checked on every revealed run (model, devshard, timing; live since 2026-08-31), a gateway-signed receipt is on their roadmap, and an attested forwarder (Nautilus) is the full closure (`docs/superpowers/specs/2026-08-30-attested-inference-design.md`).
- Seal keys and salts sit in plaintext in the engine's Postgres on testnet; encrypt at rest before mainnet.
- Five LLM jurors stay correlated even across families; diversity reduces but cannot remove shared failure modes (PRD §32.4).
- DNS validation then fetch leaves a residual rebinding window; production needs socket-level IP pinning (`lib/evidence/retriever.ts`).
- The in-process rate limiter is per instance and best effort; real deployments need an edge limiter.
- Unaudited. Capped, team-funded demo value only.

---

## ❓ Judge defence (short form)

- **“AI agents aren't reliable.”** Five independent juror seats, frozen
  evidence, a 4-of-5 quorum, and `UNRESOLVED` as a first-class outcome — the
  system never manufactures certainty.
- **“Why doesn't the round-two debate amplify hallucinations like agent
  swarms do?”** Most swarms hallucinate in loops because context accumulates
  unchecked. Deliberation here is strictly bounded: (1) the evidence is
  frozen on Walrus before the debate starts and a juror may cite only the
  frozen round-one record, never a fresh URL or a new claim; (2) turns are capped
  at three exchanges and stop early when nobody moves; (3) the second vote
  is a sealed ballot over the frozen record, not a negotiated consensus; (4)
  when the quorum is still missing the claim exits cleanly to `UNRESOLVED`
  instead of forcing synthetic agreement.
- **“Can the backend change votes?”** No: votes bind to on-chain commitments
  before reveal; anyone can recompute `blake2b256(BCS(preimage))` — the app
  even does it for you at `/verify`.
- **“Do the jurors browse or transact?”** They research, but only through the
  engine: every web search and page open is executed server-side, recorded
  in the sealed transcript and hashed into the on-chain run hash; models
  never fetch, never hold keys, never sign. No wallet keys near models.
- **“Did the model really see that prompt?”** The exact conversation is in
  the revealed bundle and can be resent to the same model from the run page;
  and the gateway's own public receipt for the recorded request id is
  compared on the run page; the byte-level proof (a gateway-signed receipt,
  on GonkaRouter's roadmap, or an attested forwarder) is the one disclosed
  gap, documented and in motion.
- **“Is the dashboard running the protocol?”** No: stop it and the CLI
  continues; it has no signer and no mutation endpoint.
- **“Does GonkaRouter prove truth?”** No, and we never claim it does: Gonka
  validates that inference work happened; OpenVerdict's evidence, voting, and
  economic rules produce a protocol result, not universal truth.

The long-form defence and full protocol semantics live in [PRD.md](./docs/PRD.md)
(§6 proof boundaries, §32 threat model, §36.9).

---

## 📚 Documentation

The technical reference is the docs site,
[docs.openverdict.info](https://docs.openverdict.info): how a verdict happens,
the trust model, staking, the agent guide, the Gonka integration, the API, the
contracts, the limits, an audit guide and a glossary. It is the same deployment
as the app, served at `/docs` on the other hosts, and its pages are the
Markdown files in [`docs/site/`](./docs/site). The repository documents below
stay the record.

- [The public API reference](./docs/API.md) (every route, with its limits and status codes)
- [Complete product requirements and implementation specification](./docs/PRD.md) (§1.1 records every place the code corrected the spec)
- [Current product state](./docs/STATUS.md) and the [resume map for agents](./docs/CHECKPOINT-2026-08-30.md)
- [Demo runbook + preserved live testnet claim ids](./docs/demo/runbook.md)
- Design records: [juror research v1](./docs/superpowers/specs/2026-08-29-juror-research-design.md), [juror research v2 and batched opens](./docs/superpowers/specs/2026-08-30-juror-research-v2-design.md), [Seal escrow of reveal keys](./docs/superpowers/specs/2026-08-30-seal-escrow-design.md), [attested inference](./docs/superpowers/specs/2026-08-30-attested-inference-design.md), [Sui stack map](./docs/superpowers/specs/2026-08-30-sui-stack-map.md)
- [Master build plan (verified stack + interface contracts)](./docs/superpowers/plans/2026-08-26-openverdict-build.md)
- [Seal documentation](https://seal-docs.wal.app/) · [Mysten Sui dev skills for coding agents](https://github.com/MystenLabs/sui-dev-skills)
- [How OpenVerdict integrates GonkaRouter](./docs/GONKA-INTEGRATION.md) (judge-facing: model pinning, per-turn request ids, receipts cross-check, consensus logic)
- [GonkaRouter developer documentation](https://gonkarouter.io/docs)
- [Gonka network architecture](https://gonka.ai/docs/architecture/)
- [Sui documentation](https://docs.sui.io/) · [on-chain randomness](https://docs.sui.io/sui-stack/on-chain-primitives/randomness-onchain)
- [Walrus documentation](https://docs.wal.app/docs/getting-started)

---

## Appendix: the idea in full

GonkaRouter-powered AI juries, coordinated and settled on Sui, with public
evidence and juror deliberation trails preserved on Walrus. The long-form one-liner:
a decentralized verification protocol for factual claims where requesters
fund claims in SUI, standardized AI juror seats investigate them through
GonkaRouter-only inference, and Sui settles the verdict, the payouts and the
permanent record.

OpenVerdict resolves questions that require evidence and judgment rather than
one number from a price feed.

Each juror request enters the decentralized Gonka network through GonkaRouter.
Independent Gonka Hosts execute the actual LLM inference off-chain, while
Gonka's L1 records inference inputs, outputs, and validation artifacts. Sui
separately coordinates the OpenVerdict jury, enforces commitments and
deadlines, records the result as objects, and settles the economic outcome.
Walrus preserves the public evidence and the juror deliberation trails.
GonkaRouter is the exclusive inference provider by protocol rule: juror
research and verdicts, the deliberation round, claim extraction and the
re-execution check all run on gonkarouter.io, the adapter refuses any other
host in code, and a seat that cannot reach Gonka fails closed rather than
falling back to another AI provider.

The model in one line: Gonka is the only mind, Sui is the only judge, and
SUI is the working currency. Claim budgets escrow at `create_claim`, juror
bonds are `Balance<SUI>` in the registry, jury rewards and refunds move as
one-time payout tickets, and the demo binary pool consumes certificates. A
seat is opened by its staker posting at least 0.1 SUI, and that seat's jury
rewards go to the staker; pooling several stakers behind one seat is the recorded
next rung.

Instead of relying on:

- A single AI model that can be wrong or manipulated.
- Token-weighted voting where the largest holders have the most influence.
- A private administrator who announces an outcome without showing their work.
- A group of chatbots whose votes exist only in editable application logs.

OpenVerdict turns dispute resolution into a:

> Staked, AI-powered, evidence-driven jury process with enforceable
> on-chain rules.

The hackathon entry point is a public fact checker: state one bounded claim (the API and CLI still accept optional URLs and text)
and receive a multi-model verdict, a transparent Truth Score, evidence-linked
public reasoning traces, and the Gonka Request ID for every juror run. A
prediction market is the first economic consumer of that verdict. The engine is
general enough to later resolve DAO milestones, grants, bounties, agent-service
disputes, and other bounded questions.

---

## License

[MIT](./LICENSE) © 2026 Marcussy34 and OpenVerdict contributors.