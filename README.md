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

**Live on Sui testnet:** [openverdict.info](https://openverdict.info) · [app.openverdict.info](https://app.openverdict.info)

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
- **Equal weights** in v1 (in future: weighted by on-chain track record)
- Anyone can **stake on a seat**: **0.1 SUI** minimum, with a wallet or a Google sign-in through Sui zkLogin, and the staker earns that seat's jury rewards

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

### One jury round

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/jury-round-dark.png">
  <img alt="Commit-reveal jury round" src="docs/diagrams/jury-round.png">
</picture>

Diagram sources are editable Excalidraw files in
[`docs/diagrams/`](./docs/diagrams) (black-and-white; Excalidraw's own dark
theme inverts them natively, and the paired `*-dark.png` exports serve GitHub's
dark mode).

---

## 🧱 Technology stack (implemented, versions verified 2026-09-03)

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

## 🔍 What is auditable

The design goal, stated plainly: a claim's entire lifecycle can be recomputed
from public artifacts by anyone, every step, every fetched page, every vote,
every reasoning trace. Independence is enforced before the fact: commit-reveal
means no juror sees another's vote before committing, and evidence roots
freeze on Sui before any reveal. Integrity is checkable after the fact: hash
chains run from the raw Walrus bytes to the on-chain roots. Two honest caveats
below keep this precise: inference re-execution is corroboration rather than
cryptographic proof until gateway-signed receipts land, and the operator is
detectable rather than impossible, unable to forge the record without breaking
hashes anyone can check. OpenVerdict certifies the process, not universal
truth: manipulation cannot hide.

| Item | Source of truth |
| --- | --- |
| Claim, deadlines, bonds, result | Shared claim object + immutable resolution certificate |
| Committee and commitments | Locked committee + owned jury-seat objects |
| Reveals and counts | Immutable revealed-vote objects + shared round tally |
| Evidence roots | Immutable Sui evidence-bundle objects |
| Evidence files and metadata | Public Walrus blobs plus explicit hashes |
| GonkaRouter response metadata | Walrus run audit + Sui RunApproval object |
| Gonka Request IDs, devshard ids, fingerprints, every attempt (retries, repairs, hedges) | Revealed run bundle on Walrus (sealed copy cited on chain before the commit) |
| Juror research trail (searches with intent, pages opened on both sides, citations) | Transcript inside the sealed bundle; its hash is in the on-chain run hash |
| Live juror research (each search with its intent and query, each page open) | Public `research_step` events as they land, replayable from the event stream |
| Exact prompt and conversation sent to the model | `request.messages` in the revealed bundle; re-runnable through the re-execution check |
| Reveal keys | Published at reveal, and escrowed under the Seal time-lock policy so the sealed bundle opens after the deadline without the operator |
| Failed seats | Failure record (status, message, trail, attempts) on Walrus and on the claim page; no vote is inferred |
| Truth Score | Final-round tally + immutable resolution certificate |
| Payouts and refunds | Payout-ticket objects and Sui coin movement |
| Observer dashboard | Rebuildable read-only projection, never authoritative |

Verify it yourself: `/verify` in the app takes a claim link and offers two
ways to audit it, "With an agent" (one line to hand any agent) and "By hand". By hand it recomputes commitments and Truth
Scores client-side from revealed fields, runs 15 checks on any revealed run
(prompt, policy, system prompt, input, output and transcript hashes,
citations, challenge search, both sides opened, citation sites,
counter-evidence summary, opens per turn, run hash, Seal escrow binding,
sealed core), opens a sealed bundle through Seal after its deadline, and
re-runs a juror against the recorded model; `scripts/gen-parity-vectors.ts`
regenerates the cross-language vectors pinned in both test suites.

### Use OpenVerdict from the terminal and from any agent

Any claim can be audited from a terminal with no key, no database and no
wallet. The auditor refetches the public record (the app's API, Sui JSON-RPC,
the Walrus aggregator, GonkaRouter's public receipts), recomputes every vote
commitment, run hash and truth score, checks the certificate on Sui, and
writes one Markdown dossier:

```bash
pnpm install
pnpm audit:claim https://app.openverdict.info/claims/<claimId>   # dossier on stdout and in .audit/<claimId>.md
pnpm audit:claim <claimId> --json audit.json --out audit.md      # plus a JSON dump of everything fetched
pnpm audit:claim --list                                          # the board: every claim with state, result, score, attempt
```

Exit 0 means every check passed (or a public source was unavailable), 1 means
at least one check failed, 2 means the input or a fetch failed. A Sui RPC,
Walrus or receipt outage marks the check UNAVAILABLE with the manual URL,
never FAIL. Run links, report links and bare ids are accepted;
`--base <url>` points at another deployment.

The whole journey runs from the same terminal through the public CLI `ov`
(`pnpm ov`, also no key, no database, no wallet): check the jury's weather,
extract a checkable claim from a page, submit it, watch the jury live, audit
the verdict. The web console stays the visual monitor: a claim page opens in
its Chat view, the same events in the same words with one card per juror and
every debate turn in full, and a Chat | Graph toggle switches to the courtroom
ring, a fixed seating chart where each juror keeps its place. The CLI reads and
writes only the public API.

```bash
pnpm ov weather                                                    # DeepSeek, MiniMax, Kimi, Web search: ok or down, clear or not
pnpm ov board --limit 20                                           # the live board, newest first
pnpm ov extract --url https://example.org/article                  # up to three checkable claims with reasons and quotes (or --text, --file)
pnpm ov submit "The first Bitcoin halving happened in November 2012."   # 200: claim id and link; 503: the jury cannot sit, nothing stored
pnpm ov agents                                                     # the jury roster: model, role, stake, lifetime rewards, track record
pnpm ov agent <seatId>                                             # one seat and its published manifest (prompt spec, tool policy, evidence policy)
pnpm ov status <claimId>                                           # one block: state in plain words, seats committed and revealed, next deadline
pnpm ov watch <claimId> --for 9m                                   # one dated line per event until the final line (rerun with --since N)
pnpm ov audit <claimId>                                            # the same dossier as pnpm audit:claim
pnpm ov trace <claimId> [--juror N] [--full]                       # every juror's searches, pages, quotes, answer and receipt; --full prints the exact prompt and output
```

`ov trace` is the judge's answer to "show me the reasoning": it rebuilds each
juror's turns from the recorded conversation in the public run proof, so the
order and the results the model actually saw are exact.

Exit codes of `ov`: 0 success, 2 input or request error (one `error: ...`
line on stderr), 3 the claim voided or the verification gave up (`watch`),
4 the watch stopped before the end (`--for` reached), 5 rate limited or
public writes disabled (`submit`, `extract`). `--json` puts one JSON
document on stdout (`watch`: one line per event), the banner goes to
stderr, and `--base <url>` points at another deployment. Limits on a public
submission: a claim of 5 to 1000 characters, evidence text up to 20000
characters, up to five https URLs, five submissions per minute per client;
a submission made while a model family or web search is down is refused with
503 `WEATHER_NOT_CLEAR` and nothing is stored, so you try again when the
weather clears. A one-round verdict lands about 11 to 12 minutes after
launch, a two-round verdict about 32 minutes.

### Give this to your agent

```
Set up https://app.openverdict.info/SKILL.md and take it from there.
```

Works with any agent that can read a link: Claude, ChatGPT, Codex, Cursor,
Gemini. That URL serves `skills/openverdict/SKILL.md` from disk, so the link and
the folder are the same file, and it tells the agent how to set itself up at
whichever rung it can reach.

The auditor, the CLI and a map of the whole app are packaged together as one
agent skill at `skills/openverdict/`, written in the open
[Agent Skills format](https://agentskills.io). It is not tied to one product:
install it with the [`skills`](https://skills.sh) CLI and any agent that reads
the format loads it.

```bash
npx skills add Marcussy34/OpenVerdict
```

That covers Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, VS Code,
OpenCode, Amp and the rest. The skill's two launchers run this repository's own
code, so clone it for the `ov` CLI itself:

```bash
git clone https://github.com/Marcussy34/OpenVerdict.git
cd OpenVerdict && pnpm install
pnpm ov help
```

The folder holds `SKILL.md`, `references/reference.md`, `references/faq.md` and
the launchers `scripts/ov.sh` and `scripts/run.sh`;
`.claude/skills/openverdict-audit` and `.agents/skills/openverdict` are two of
the discovery paths agents scan, both symlinked to that one folder, so the skill
loads on its own inside the repo.

With the skill loaded, paste a claim, report, run or agent link, or ask
in plain words: "audit this", "verify this claim", "who is on the jury", "is the
jury healthy", "watch this claim". The agent runs the auditor, presents the
verdict card and a plain-English timeline, and answers questions from the
dossier and the bundled protocol reference. It also drives the journey above end
to end: confirm the claim text, check the weather, submit on an explicit go,
narrate the events as they land, then audit.

---

## 🔒 Security posture and honest limitations

Implemented defenses:

- Evidence retrieval is SSRF-hardened: https-only, DNS-first validation of
  every resolved address (loopback/private/link-local/CGNAT/metadata/reserved,
  including IPv4-mapped IPv6), per-hop redirect revalidation, streaming byte
  caps, MIME allowlists, sanitized errors.
- Models never fetch, never hold keys or transaction authority; every URL a
  juror sees or opens is executed by the engine and recorded in the sealed
  transcript; outputs are strict-schema validated and may cite only pages the
  juror opened in that run or frozen evidence IDs (fail closed otherwise).
- API write routes: operator routes need a bearer token (uniform 403 on any
  failure), public submissions sit behind an explicit enable flag plus rate
  limiting whose per-client keys apply only behind a trusted proxy.
- Salts never reach the inference provider; commitments bind the approved run
  hash before any vote is cast; the Seal escrow of a reveal key is insurance
  only and can never cost a seat.

Known limitations (V1, disclosed by design):

- The run attestor and evidence freezer are single team-held capabilities —
  the pipeline upstream of the commitment is trusted infrastructure in the
  hackathon build (multi-attestor is production work, PRD §28.6).
- There is no proof yet that the model received exactly the recorded bytes:
  the re-execution check is a soft corroboration, GonkaRouter's public
  receipts lookup is cross-checked on every revealed run (model, devshard,
  timing; live since 2026-08-31), a gateway-signed receipt is on their
  roadmap, and an attested forwarder (Nautilus) is the full closure (see
  `docs/superpowers/specs/2026-08-30-attested-inference-design.md`).
- Seal keys and salts are stored in plaintext in the engine's Postgres on
  testnet; encrypt at rest before any mainnet use.
- Five LLM jurors are correlated even across model families; diversity
  constraints reduce but cannot remove shared failure modes (PRD §32.4).
- DNS validation → fetch has a residual rebinding TOCTOU window; production
  needs socket-level IP pinning (documented in `lib/evidence/retriever.ts`).
- The in-process rate limiter is per-instance and best-effort; real
  deployments need an edge limiter.
- Unaudited. Capped, team-funded demo value only.

---

## 💰 Economics: who pays, who earns

OpenVerdict runs a validator-slot model, not a bring-your-own-agent model.
Jurors are standardized and manifest-pinned (fixed GonkaRouter model catalog,
prompt and tool policy hashed on-chain), so nobody competes on secret sauce:
operators compete on liveness and integrity, the way PoS validators do.

The money flows that exist on-chain today:

- **Requesters fund claims.** `create_claim` escrows creation, committee and
  evidence budgets as coins. Direct review is requester-paid by construction;
  the public demo tier is a rate-limited subsidy, not the business model.
- **Jurors earn.** At settlement the committee budget splits per valid
  revealed seat and mints a recipient-bound payout ticket to that seat's
  staker, or to the seat owner where no staker is recorded
  (`settlement.move`, `REASON_JURY_REWARD`). Commit late, fail schema, or
  refuse to reveal, and you earn nothing.
- **Disputes fund themselves.** The optimistic pathway finalizes
  unchallenged bonded outcomes with zero inference cost; a challenge
  escalates to a jury and the losing side's bond pays for it.
- **The protocol takes a fee.** Five percent of each committee budget
  (`protocol_fee_bps`, 500 on the registry) is minted as its own treasury
  payout ticket at settlement, next to the jury reward tickets; on the
  settled claim `0x273220b5…` that was one 500,000 MIST fee ticket beside
  five 1,900,000 MIST jury tickets, all in the finalize transaction.

Stake is the gate on that faucet, and it is real money: a seat is opened by
its staker posting at least **0.1 SUI** as the seat's bond in one wallet
transaction (gas sponsored through Shinami, so a Google sign-in can stake
with 0.1 SUI and nothing else). The staker receives that seat's jury
rewards, keeps the bond locked while the seat is active, and gets it back
24 hours after unstaking (slashing the bond for proven protocol violations
is specified in the PRD and not yet enforced on chain). A staker picks the
model and nothing else: research is identical for every seat, so the engine
assigns the seat's debate role, taking the least represented role among the
active seats on that model. The draw stays diverse on its own terms: at most
two seats per model family, three families per jury, a skeptic seat and a
source-authenticity seat on every committee, and at most one seat per
operational signing key, with no cap per staker. Two guards keep that
draw honest in practice: the on-chain sample restarts when a partial
pick can no longer be completed (so a valid roster is always drawn), and
the stake endpoint refuses a seat that no valid committee could ever seat,
naming the reason and a combination that works. Where DIVE gates agent
rewards with World ID personhood proofs on the agent's owner, OpenVerdict
makes no identity claim at all: it gates standardized validator seats with
stake and a diversity draw.

Decentralization ladder: the team's seven demo jurors are the starting
roster; anyone can now open a seat by staking on it (their stake, their
bond, their earnings, our compute), and staked seats are already
live on testnet (for example [profile `0xc32aa5db…`](https://testnet.suivision.xyz/object/0xc32aa5db303d2d479133cd8476afedf1fa8f4eac1241bd90b57a3fb2723d6037), a MiniMax source-authenticity seat opened with 0.1 SUI through the public API, gas paid by Shinami); finally, self-hosted juror workers bring
their own GonkaRouter keys and pay their own inference, verified by the
engine exactly as our own runs are (run hashes, receipts, re-execution).

### Next rung: several stakers per seat (recorded direction, not yet on-chain)

One staker per seat ships today: the stake opens the seat and that seat's
jury reward tickets are minted to the staker. Requester-paid SUI per
verification funds the round's jury pool (the `create_claim` budget vaults
already exist), and the open rung is pooling: several stakers behind one
seat sharing its jury rewards pro rata after protocol and run fees, the way
PoS delegators share a validator's yield, plus stake-weighted draws under a
cap. Reward distribution stays participation-based with at most an
accuracy bonus for certificate-aligned seats; majority-only ("winners take
all") pay is rejected by design because paying for agreement manufactures
herding, punishes honest UNSURE votes, and corrupts UNRESOLVED as an
outcome (PRD §24.2, §24.5). Per-seat stake pools become meaningful once
reputation wiring differentiates track records; until then this section is
the answer of record, not shipped code.

### Next rung: seat weights from track record (roadmap, not implemented)

Today every juror profile carries the same selection weight (10000) and every
seat counts equally in the truth score, on purpose, because no juror has a
track record yet. The principled next step is a weight derived from each
juror's Brier score over resolved claims (the squared distance between its
mapped probability and the settled outcome), recomputed after every settlement
and published on the juror's agent page. A consistently well-calibrated juror
then earns more weight in both committee selection and the mean, and a poorly
calibrated one loses it, with no hand-set constants. Because the selection
weight lives on-chain in the juror registry, this needs a registry update path.

---

## 🏆 Hackathon track fit

One build, both tracks: Gonka supplies all of the intelligence; Sui supplies
the coordination, the settlement and the currency; Walrus keeps the public
evidence and Seal keeps the time-locked keys (both Mysten stack, detailed
per-sponsor in the next section).

### The three pillars

| Pillar | What it provides | Why it is irreplaceable here | Track requirement satisfied |
| --- | --- | --- | --- |
| **Gonka (GonkaRouter): the only mind** | Every reasoning pass: claim extraction, five independent research runs, each debate turn, each table vote. Three model families behind one gateway, with a request id, devshard id and fingerprint kept for every call. | A jury is only as independent as its minds. Correlated-failure resistance: identical models share the same training blind spots and alignment priors, so five copies of one model debating is one opinion five times. The committee rule mandates three families (DeepSeek, Kimi, MiniMax) with at most two seats per family, so no single architecture or vendor can dictate the quorum. One gateway serving three families is what makes that rule enforceable and pins each juror's model in a manifest; the request ids are the receipts a verifier re-checks against Gonka's public lookup. | Gonka track: all AI reasoning through GonkaRouter, URL or text input, multi-model cross-verification, Truth Score with a reasoning trace, Gonka Request IDs shown. |
| **Sui: the only judge** | The clock and the court: claims and deadlines as objects, the jury drawn by native randomness under family limits, commit-reveal enforced in Move, evidence roots frozen before any reveal, the immutable certificate and Truth Score, payout tickets, the demo pool that settles on the certificate, staked juror seats (0.1 SUI minimum, wallet or zkLogin, gas sponsored). | Nobody picks the judges (native randomness) and nobody edits the result (Move rules, immutable objects). The verdict is not a number a judge is asked to trust; it is something the chain acts on: it settles the pool and pays the seats. | Sui Track 02: Sui is integral, ownership and identity as owned objects, on-chain execution of deadlines, thresholds and payouts, a working live demo path. |
| **Walrus + Seal (Mysten): the only memory** | The public record: claim text, every page a juror opened, evidence manifests, sealed and revealed run bundles, debate transcripts, failure records, all content-addressed and hash-pinned on Sui. Seal time-locks each reveal key so sealed bundles open after the deadline without the operator. | "Anyone can recompute" is only true if the bytes are public and cannot be swapped. Walrus gives the bytes an address the on-chain hash commits to; Seal removes the operator from the reveal path. Without this pillar the verification checks have nothing to run on. | Sui Track 02 signals: Walrus evidence layer, reveal-key escrow with Seal, recheck everything in the browser. |

Gonka is the only mind, Sui is the only judge, Walrus is the only memory,
SUI is the working currency. No AI runs outside Gonka, no rule is enforced
outside Sui, no evidence lives outside Walrus.

### Remove one pillar and the app fails

The three pillars are not features bolted onto a fact checker. Each one
carries a load the other two cannot take.

| Pillar removed | What you would replace it with | What breaks immediately | Why the substitute does not work | What is left |
| --- | --- | --- | --- | --- |
| **Gonka** | One vendor API, or five separate vendor keys | The three-family jury, the two-seats-per-family cap, the manifest-pinned model ids, the request-id receipts a verifier re-checks against Gonka's public lookup | One vendor is one mind voting five times, steerable by whoever controls it. Five keys turn one enforceable rule into five private promises nobody can audit as one | A Truth Score that still prints a number and no longer means anything |
| **Sui** | A database run by the operator | The random jury draw, the deadlines, the vote commitments before reveal, the evidence root frozen before any reasoning, the immutable certificate, the payouts, the pool settlement | Every one of those becomes a line the operator can edit: pick friendlier jurors, reopen a vote, swap evidence after the fact, change the result, delete the log | A verdict people are asked to trust, instead of one the chain acts on |
| **Walrus + Seal** | The operator's own storage bucket, keys held by the operator | The bytes behind every on-chain hash: opened pages, manifests, sealed and revealed run bundles, transcripts; the operator-free opening of sealed bundles after the deadline | Files in the operator's bucket can be rewritten or withdrawn; the on-chain hashes then point at nothing anyone can fetch, and the verification checks have no input. Without Seal, the party with a motive to hide a bad run is the one holding the key | A story about evidence, with no record to check it against |

**Why they only work together:** Gonka produces the work and the receipts.
Sui commits to that work before it is revealed and enforces what happens
next. Walrus keeps the bytes those commitments point at, and Seal makes
them openable without us. The verification page walks that chain end to
end: fetch from Walrus, hash, compare to Sui, re-ask Gonka. Cut any link
and the chain does not get shorter; it breaks.

**MUBA Gonka Track — AI for Society** (fact checker):

| Requirement | OpenVerdict |
| --- | --- |
| All AI reasoning/verification through GonkaRouter | Single adapter, host-pinned to gonkarouter.io in code; no other provider; fail-closed on outage |
| URL or text input | `/fact-check` takes one bar: paste a URL or a paragraph and a Gonka model extracts the checkable claim into it; the API and CLI also accept optional source URLs and evidence text |
| Multi-model cross-verification | 5 juror seats spanning all three GonkaRouter model families, no family majority, each juror researching both sides of the claim |
| Truth Score 0–100 + reasoning trace | Deterministic, recomputable; evidence-linked public traces with the full research trail, never chain-of-thought |
| Gonka Request IDs | Response `id`, `x-request-id`, devshard id and fingerprint preserved verbatim for every attempt, shown after reveal |

**MUBA Sui Track 02 — AI × Sui**:

| Signal | OpenVerdict |
| --- | --- |
| Sui is integral | Native `Random` jury selection, owned `JurySeat`s, Move capabilities, immutable certificates, coin settlement |
| Ownership & identity | `AgentProfile` + `AgentCap`; every seat, approval, ticket is an owned object |
| On-chain execution | Deadlines, commit-reveal, thresholds, payouts and seat stakes enforced in Move — 89 tests |
| Working demo path | Localnet E2E exit 0 AND finalized LIVE testnet lifecycles on https://app.openverdict.info: NO certificate [`0x42954c91…`](https://testnet.suivision.xyz/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706) ("Humans use only ten percent of their brains.", 5 of 5 seats, attempt 3 of 3, audited 110/110 by `pnpm ov audit`), YES certificate [`0xff3191bc…`](https://testnet.suivision.xyz/object/0xff3191bcad4a645f44a6caccf2e6c661e8defcbf4943b44ec8b08d91b4f4133c) (claim #25, 5 of 5 seats, Seal escrows) and NO certificate [`0x975b3ae1…`](https://testnet.suivision.xyz/object/0x975b3ae103c7832c4405714196528808af70ef975fe0d0db3ae70017191c00e4) (claim #26, hedged calls); see `docs/demo/runbook.md` |
| Walrus evidence layer | Every fetched page, evidence manifest, sealed and revealed run bundle is a public Walrus blob; its hash is pinned on-chain, so blobs are content addresses a verifier can fetch |
| Reveal-key escrow (Seal) | Mysten Seal time-lock policy on testnet; sealed juror bundles open after the deadline without the operator |
| Economic loop in SUI | Budgets escrowed at `create_claim`, per-seat jury-reward `PayoutTicket`s and refunds as one-time tickets, a 5 percent protocol-fee ticket, seat stakes (a 0.1 SUI bond opens a seat and its jury rewards go to the staker), demo binary pool consuming certificates (`/risk`); pooling several stakers per seat is the recorded next step |

Both public track pages were placeholders at spec time; final submission
requirements must be reconfirmed against organizer material (PRD §7.3).

---

## 🧩 Sponsor tech, one by one

One table per sponsor technology: what it does inside OpenVerdict, and where
a judge can see it working. Nothing here is aspirational; every row is live
on testnet at https://app.openverdict.info.

### GonkaRouter (Gonka)

| Used for | How | Check it |
| --- | --- | --- |
| Every juror reasoning pass | One adapter, `/v1/chat/completions`, host-pinned to gonkarouter.io, no other provider, fail closed on outage | `lib/gonka/adapter.ts`; any revealed run shows the raw request/response and their hashes |
| Multi-model consensus | 5 seats drawn across all three GonkaRouter families (DeepSeek, Kimi, MiniMax), at most 2 seats per model, equal weight | Committee rules in `move/openverdict/sources/jury.move`; jury card on any claim page |
| Claim extraction from a URL | Paste a link on `/fact-check`; a Gonka model distills one bounded claim, with a JSON repair round when needed | `POST /api/extract-claim`; the provenance card names the model and request id |
| Inference provenance | Response `id`, `x-request-id`, devshard id and fingerprint stored for every attempt (retries, repairs, hedges) and cross-checked against Gonka's public receipts lookup | "Run provenance" on any revealed run |
| Latency hedging | A same-model hedge fires after a 25 s stall; every attempt lands in the audit trail | Revealed run bundle on Walrus |

**Gonka compliance rules, enforced in code (not policy):**

| Rule | Where | What happens when it is broken |
| --- | --- | --- |
| Host pinned to `api.gonkarouter.io`; no other provider exists in the repository | `lib/gonka/adapter.ts` | There is no code path to any other model host |
| `X-Gonka-No-Fallback: true` on every call | `lib/gonka/adapter.ts` (default headers) | The gateway may not silently substitute a model; the `x-gonka-fallback` header is recorded if it ever appears |
| The served model must equal the juror's manifest model | `lib/gonka/adapter.ts`, `RESPONSE_MODEL_MISMATCH` | The response is a provider error, never a vote |
| A response without a Gonka Request ID is rejected | `lib/gonka/adapter.ts`, `normalizeRawResponse` | The run fails; nothing is committed |
| The Request ID is committed on Sui before the vote | `lib/protocol/bcs.ts`, `RunRecordV1.gonka_request_id` is inside the run hash written as a `RunApproval` and inside the vote commitment | A vote cannot be revealed against a run whose Request ID was not committed first; the certificate depends on those votes |
| Receipts cross-checked after reveal | `/api/gateway-receipts/[requestId]`, "Run provenance" panel | Model, devshard and timing compared against Gonka's public receipts lookup; a mismatch is shown, never hidden |
| One seat failure voids the whole attempt | `lib/engine/engine.ts`, `voidAttempt` | No partial jury ever finalizes; the attempt relaunches when all three families answer |

The Request ID row is the one to notice: on OpenVerdict the Gonka receipt is
not attached to the verdict afterwards, it is part of what the jury commits
to on-chain before anyone reveals.

### Sui

| Used for | How | Check it |
| --- | --- | --- |
| Protocol of record | Claims, committees, jury seats, revealed votes, certificates and payout tickets are Sui objects; deadlines, thresholds, payouts and seat stakes enforced in Move (89 tests) | Every object in the UI opens on SuiVision and every transaction on Suiscan |
| Jury selection | Native `Random` draw under the model-family constraints | `move/openverdict/sources/jury.move` |
| Commit-reveal voting | Commitments bind the approved run hash on-chain before any reveal; `blake2b256(BCS(preimage))` is recomputable by anyone | `/verify` recomputes it in the browser |
| Evidence freezing | The manifest merkle root is frozen into an `EvidenceBundle` object before any vote reveals | Report page, evidence bundle chip |
| Onboarding | zkLogin (Enoki): a Google login yields a self-custodial address that can post the 0.1 SUI stake and open a seat, so people without a wallet can stake too; authentication only | `/agents`; env-gated |
| Wallet rendering | Object Display metadata on certificates, profiles and positions | `move/openverdict/sources/display_meta.move` |

### Walrus

| Used for | How | Check it |
| --- | --- | --- |
| Claim inputs | Statement and resolution-criteria blobs; their hashes ride the `create_claim` transaction | Claim dossier chips on the canvas |
| Evidence bytes | Raw and canonical copies of every page a juror opened, blake2b-256 hashed into the manifest | Evidence pages link straight to the aggregator |
| Evidence manifests | The merkle leaves behind each frozen on-chain root | `evidence-<claim>-<phase>.json` blob |
| Juror work product | The sealed run bundle is stored and cited on-chain before the commit; the revealed bundle and any failure record follow | Run pages link both blobs |

### Seal (Mysten)

| Used for | How | Check it |
| --- | --- | --- |
| Reveal-key escrow | Each seat's reveal key is Seal-encrypted at commit time under an on-chain time-lock policy | `move/openverdict_seal/sources/reveal_lock.move` |
| Operator-independent opening | After the reveal deadline anyone recovers the key from the threshold key servers and opens the sealed bundle; the operator is not needed | `/verify` performs the recovery live; the Seal panel links every key server object |
| Safety stance | Escrow is insurance only; it can never cost a seat its vote | 4 dedicated Move policy tests |

### Shinami (Gas Station)

| Used for | How | Check it |
| --- | --- | --- |
| Gas for wallet-signed pool entries and seat stakes | The browser builds the transaction kind, the server allowlists it and Shinami attaches gas and signs; the user's wallet signs the bytes Shinami returned, so the user still approves the full transaction | `app/api/sponsor/route.ts`; a sponsored deposit or stake shows "Gas paid by OpenVerdict (Shinami Gas Station)" with its digest |
| Google sign-in without SUI | A zkLogin address created by a Google login holds no SUI, so without sponsorship it cannot act at all; with it, the first on-chain action costs the user nothing, and a seat stake costs exactly the 0.1 SUI bond | `/claims/<id>` market panel after continuing with Google; `/agents` stake card |
| Fund health | `gas_getFund` reports fund name, network, balance and in-flight reservations, with no key in the output | `pnpm sponsor:check`; a live sponsored testnet transaction: [9ToB29r3…](https://suiscan.xyz/testnet/tx/9ToB29r3WWJv7odpai4HkTMjjccmu3aCndrxEAoViGjw) (sender the operator, gas owner Shinami's fund) |

The access key never reaches the browser: Shinami's Gas Station refuses CORS
requests by design, and a leaked key drains the fund. It stays in
`SHINAMI_GAS_ACCESS_KEY` on the server, and `POST /api/sponsor` is the only door
to it, behind the same two guards as every public write (`OPENVERDICT_PUBLIC_WRITES`
plus rate limiting). That route is a positive allowlist, not a blocklist: it
decodes the submitted kind, refuses anything over eight commands, refuses every
Move call except `demo_binary_pool::enter` and `agent_registry::register_staked_agent`
in the deployed package (plus the four
`0x2::coin` helpers the Sui SDK emits to assemble the stake), refuses any
reference to the gas coin, refuses any funds withdrawal that names the sponsor
instead of the sender, and caps the gas budget at 50,000,000 MIST server-side.
A rejected kind never reaches Shinami, so a rejection costs the fund nothing.

Configure it with `SHINAMI_GAS_ACCESS_KEY` (and optionally `SHINAMI_GAS_ENDPOINT`
for a non-US region), then run `pnpm sponsor:check` to print the fund line, or
`pnpm sponsor:check --send` to sponsor one real operator transaction and see the
gas owner on Suiscan. With the key unset the app degrades quietly: the route
answers 503 and the deposit falls back to wallet-paid gas, labelled as such.

Next rungs of the same ladder: sponsored juror commit and reveal, so a seat never
misses a deadline for want of gas, and sponsored operator lifecycle transactions
so the operator key stops being a gas wallet.

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
seat is opened by its staker posting 0.1 SUI, and that seat's jury rewards
go to the staker; pooling several stakers behind one seat is the recorded
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