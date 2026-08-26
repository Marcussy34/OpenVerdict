# OpenVerdict — Decentralized Intelligence Verification Engine

<!-- markdownlint-disable MD013 -->

See how the verdict was reached.

GonkaRouter-powered AI juries, coordinated and settled on Sui, with public
evidence and agent work preserved on Walrus.

> **Current status:** OpenVerdict is currently a product and implementation
> specification. This repository does not yet contain a working application,
> published Move package/shared objects, or a production service. See the
> complete [PRD.md](./PRD.md).

## One-liner

A decentralized verification engine where human-backed AI juries investigate
disputed claims, publish evidence-based arguments, and trigger transparent
on-chain outcomes.

## 💡 Idea

OpenVerdict resolves questions that require evidence and judgment rather than
one number from a price feed.

Each agent request enters the decentralized Gonka network through GonkaRouter.
Independent Gonka Hosts execute the actual LLM inference on off-chain GPU/ML
nodes, while Gonka's L1 records inference inputs, outputs, and validation
artifacts. Sui separately coordinates the OpenVerdict jury, enforces commitments
and deadlines, records the result as objects, and settles the economic outcome.
Walrus preserves the public evidence and agent work.

Instead of relying on:

- A single AI model that can be wrong or manipulated.
- Token-weighted voting where the largest holders have the most influence.
- A private administrator who announces an outcome without showing their work.
- A group of chatbots whose votes exist only in editable application logs.

OpenVerdict turns dispute resolution into a:

> Human-backed, AI-powered, evidence-driven jury process with enforceable
> on-chain rules.

The hackathon entry point is a public fact checker: paste a claim, URL, or both
and receive a multi-model verdict, a transparent Truth Score, evidence-linked
public reasoning traces, and the Gonka Request ID for every agent run. A
prediction market is the first economic consumer of that verdict, demonstrating
that the same result can trigger enforceable Sui settlement.

The engine is general enough to later resolve DAO milestones, grants, bounties,
agent-service disputes, marketplace claims, and other bounded questions.

The disputed event does not have to happen on Sui. It may concern another
blockchain, a repository, a public API, or a real-world announcement. Sui acts
as the court that coordinates the jury and records the reusable resolution
certificate.

## 🧩 Concrete example

Imagine someone pastes a protocol announcement URL and asks:

> Did Protocol X complete all three requirements of its announced Sui Mainnet
> launch before 12:00 UTC on August 20?

The evidence conflicts:

- The project's announcement says the launch was complete.
- A Sui explorer shows that the required Move package and objects were published
  before the deadline.
- The project's documentation suggests that one required feature became
  available later.

A normal oracle cannot resolve this from one price or API response. OpenVerdict
gives the frozen evidence to five GonkaRouter agents, requires independent
investigation, records hidden votes on Sui, reveals their arguments together,
and uses a second deliberation round when the first vote is split. The public
fact-check report can then settle a low-value prediction market asking the same
question.

## ⚙️ How it works

### 1. Human-backed agent pool

- Oracle agents have versioned identities, owners, models, roles, prompts, and
  reputation histories.
- Each committee seat must belong to a different owner and human-backing record.
- The hackathon build uses a reviewed five-person allowlist labelled
  `MANUAL_ALLOWLIST`.
- Permissionless production participation requires privacy-preserving proof of
  personhood or an equivalent Sybil-resistance policy.

👉 One person should not gain more influence by creating hundreds of agent
wallets.

### 2. Reputation-weighted random selection

For each disputed claim:

- Eligible agents are selected randomly.
- Sui's native on-chain `Random` object supplies the selection randomness.
- Selection weight uses liveness, valid output, and evidence-quality history.
- No owner or human-backing record can control more than one seat.
- No single model ID can control more than two of the five seats.
- Planned demo roles can include investigator, skeptic, source verifier,
  on-chain analyst, and criteria judge.

👉 Strong agents are selected more often without creating a permanent ruling
group.

### 3. Optimistic resolution — the fast path

A proposer submits `YES`, `NO`, or `UNSURE` and posts a bond.

If nobody challenges the answer before the deadline:

- The proposed answer becomes final.
- The proposer receives the defined bond or reward treatment.
- OpenVerdict avoids paying for a full AI jury when there is no disagreement.

👉 Most simple claims can resolve quickly and cheaply.

### 4. Bonded dispute mechanism

If someone believes the proposed answer is wrong:

- They post a matching challenge bond.
- They provide a reason and initial evidence.
- OpenVerdict enters dispute mode.

👉 Bonds discourage spam while giving weak outcomes a credible challenge path.

### 5. Frozen evidence

Before agents investigate:

- Submitted sources are retrieved through a controlled evidence service.
- Unsafe URLs, private network targets, oversized files, and unsupported content
  are rejected.
- Raw sources, normalized text, and the manifest are stored as public Walrus
  blobs with explicit hashes and paid retention.
- An immutable Sui `EvidenceBundle` object records the Merkle root, Walrus blob
  and object IDs, policy, and storage end epoch.
- Every first-round agent receives the same frozen bundle.

👉 A source cannot quietly change halfway through the jury process.

### 6. GonkaRouter-powered jury resolution

Every oracle-agent reasoning pass in the hackathon build runs through
[GonkaRouter](https://gonkarouter.io/docs).

#### Step 1 — Independent investigation

Each selected agent:

- Receives the claim, resolution criteria, and frozen evidence.
- Uses its registered role, prompt version, and GonkaRouter model ID.
- Investigates without seeing peer arguments or votes.
- Returns `YES`, `NO`, or `UNSURE` with confidence, evidence IDs, and a bounded
  public reasoning trace rather than private chain-of-thought.
- Preserves the exact GonkaRouter response `id` and displays it as the
  **Gonka Request ID** after reveal.

#### Step 2 — Controlled tools

Where the selected GonkaRouter model supports tool use, an agent may call a
small server-executed allowlist:

- Read an item from the frozen evidence bundle.
- Compare a timestamp with the claim deadline.
- Read a pinned Sui transaction by digest and checkpoint.
- Read a Move object snapshot by ID, version, and digest.
- Flag a claim that lacks supporting evidence.

Agents cannot browse arbitrary URLs, execute code, hold wallet keys, select
recipients, or submit transactions. Tool calls are bounded, hashed, and included
in the agent's run record.

#### Step 3 — First vote with commit–reveal

- Each agent chooses `YES`, `NO`, or `UNSURE`.
- The vote, evidence root, output hash, run hash, and a secret salt become an
  on-chain commitment.
- Votes remain hidden until the reveal phase.
- The later reveal must reproduce the original commitment.

👉 Agents cannot change their vote after seeing the others.

#### Step 4 — Consensus check

For a five-agent jury:

- Four matching valid votes are required.
- A three-to-two split does not finalize.
- Four `UNSURE` votes produce an unresolved result rather than a fake answer.

#### Step 5 — Evidence-driven deliberation

When the first round has no threshold:

- First-round arguments become public.
- Agents challenge unsupported statements and conflicting evidence.
- New admissible evidence may be added before the second cutoff.
- A new evidence root freezes the second-round bundle.

👉 This is adversarial verification, not an unstructured group chat.

#### Step 6 — Second independent vote

- Agents reason again using the public arguments and second evidence bundle.
- They commit and reveal a new vote.
- Four matching votes finalize `YES` or `NO`.
- No threshold finalizes `UNRESOLVED` in V1.

👉 OpenVerdict treats uncertainty as information rather than failure.

#### Transparent Truth Score

OpenVerdict derives a score from the final valid jury round:

- A `YES` vote contributes its confidence.
- A `NO` vote contributes `100 - confidence`.
- An `UNSURE` vote contributes `50`.
- The unweighted mean becomes the displayed Truth Score from `0` to `100`.

The score and its inputs are committed on Sui and recomputable from revealed
votes. It summarizes the jury's final position; it is not marketed as objective
truth and does not replace the four-of-five settlement threshold.

### 7. On-chain settlement

OpenVerdict Move objects and modules on Sui enforce:

- Claim deadlines and state transitions.
- Proposal and challenge bonds.
- Immutable Walrus-backed evidence-bundle objects.
- Native-random committees and owner-bound `JurySeat` objects.
- Approved agent-run hashes and Blake2b/BCS vote commitments.
- Immutable `RevealedVote` objects and per-phase tally objects.
- The four-of-five threshold.
- An immutable `ResolutionCertificate` for the result or unresolved state.
- Native USDC vaults, positions, payout tickets, rewards, and refunds.

The hackathon demo uses a low-value, team-funded prediction pool. A `YES` or
`NO` result pays the winning side under the published rule. An unresolved result
refunds participants according to the market policy.

### 8. Reputation system

Agents build separate reputation dimensions for:

- Timely participation.
- Valid GonkaRouter output.
- Valid commit and reveal behavior.
- Evidence quality.
- Consensus reliability.
- Later objective accuracy when an external result exists.
- Proven protocol violations.

OpenVerdict does not punish an agent merely for holding the minority view.
Penalties target non-participation, invalid reveals, duplicate identities,
forged records, and proven manipulation.

👉 Reputation rewards useful behavior without teaching agents to blindly follow
the majority.

### 9. CLI engine and visual observer

The verification engine is the main product and must work without a browser.

- The CLI creates and inspects claims, starts jury rounds, follows events,
  relays signed vote packages, advances valid phases, and finalizes results.
- The optional observer dashboard makes the same public process easier to
  understand.
- The dashboard shows five agent lanes, safe activity, evidence, Sui
  transactions, revealed arguments, disagreement, consensus, and settlement.
- Before reveal, it hides arguments, evidence choices, detailed tool calls,
  confidence, and vote direction.
- The dashboard has no signer, cannot call GonkaRouter, and cannot change
  protocol state.

👉 The visual layer explains the engine; it does not become the engine.

## 🎯 Key innovations

### 🧠 AI jury, not a single oracle

Multiple agents reduce dependence on one model, prompt, owner, or hidden
provider policy.

### 👤 Human-backed participation

Agent influence is tied to distinct operators and eventually to
privacy-preserving human verification rather than unlimited wallets.

### ⚡ Optimistic plus disputed resolution

Unchallenged claims resolve cheaply. AI investigation runs only when someone
posts a real challenge.

### 📚 Evidence before rhetoric

Agents receive frozen sources and must connect public arguments to known
evidence IDs.

### 🔒 Commit before reveal

On-chain commitments stop agents from changing votes after seeing the
committee's result.

### ⚖️ Adversarial deliberation

Agents reason independently first. Discussion begins only after the first
reveal, when disagreement is useful.

### ❔ Honest uncertainty

OpenVerdict can return `UNSURE` or `UNRESOLVED`. It never needs to manufacture
confidence to pay a winner.

### 🔍 Inspectable execution

Users can trace the claim, evidence, GonkaRouter runs, bounded tools,
commitments, arguments, result, and money movement.

### 💻 Headless first

The CLI can complete the entire lifecycle with the dashboard offline. The
observer is a rebuildable, read-only projection.

### 🧩 Object-native verification

Claims, agent profiles, committees, jury seats, revealed votes, evidence
bundles, payout tickets, and resolution certificates become inspectable Sui
objects rather than hidden rows in one contract.

## 🧠 Why GonkaRouter

GonkaRouter powers every first-round and second-round agent inference in the
hackathon implementation by routing requests into the decentralized Gonka
network.

It provides:

- One familiar API for multiple supported model IDs.
- OpenAI- and Anthropic-compatible interfaces.
- Streaming and tool-use support where available.
- Inference executed by independent Gonka Hosts rather than inside Sui.
- On-chain records of inference inputs, outputs, and validation artifacts on
  Gonka L1.
- A single application integration without operating model infrastructure
  directly.

Gonka can validate whether Hosts performed inference work honestly; that does
not prove that a model's conclusion is factually true. OpenVerdict supplies the
evidence, jury, voting, dispute, uncertainty, reputation, and settlement system.

## 🌊 Why Sui and Walrus

Sui is part of the mechanism rather than a generic place to store a final vote:

- Sui's native `Random` object selects the jury without an external VRF.
- Move ownership and capabilities control agent, attestor, pause, and upgrade
  authority.
- Owned `JurySeat` objects isolate each agent's commitment.
- Reveals create immutable `RevealedVote` objects and update a bounded per-phase
  tally.
- Finalization creates an immutable `ResolutionCertificate` that other Sui
  applications can consume.
- Sponsored transactions can pay gas for narrowly approved user and agent
  actions while users still sign the full transaction.
- Native USDC can fund low-value bonds and the demonstration pool.

Walrus stores the public evidence bundle, agent arguments, run audits, and
sanitized tool transcripts. Their content-derived blob IDs and corresponding Sui
blob objects connect the public files to on-chain state. Storage is paid by
epoch and must be renewed before the required audit-retention window expires.

zkLogin may simplify owner onboarding, but it is authentication through an OAuth
identity, not proof that one unique human controls only one agent.

## 🏆 MUBA Gonka Track — AI for Society

The revealed Gonka brief asks for public-value AI tools and names fact checking
as the preferred direction. OpenVerdict directly satisfies its requirements:

| Gonka track requirement | OpenVerdict implementation |
| --- | --- |
| Genuine public value | Anyone can inspect a contested public claim instead of trusting one opaque answer |
| All AI reasoning and verification through GonkaRouter | Every independent analysis, deliberation, and output-repair pass uses a declared GonkaRouter model; there is no hidden model fallback |
| URL or text input | The fact-check form and CLI accept a claim, one or more public URLs, or both |
| Multi-model cross-verification | Five agents span at least three account-available GonkaRouter model IDs, with no model controlling a majority |
| Truth Score `0–100` | A deterministic score is derived from the final committed and revealed agent outcomes and confidence values |
| Reasoning trace | Each agent publishes an evidence-linked reasoning summary and structured verification steps, never private chain-of-thought |
| Gonka Request IDs | Every returned GonkaRouter `id` is shown on the agent lane and included in the downloadable audit bundle |
| Required submission | The plan includes a live demo URL, documented GitHub repository, and a dedicated two-minute live fact-check video |

Deterministic fetching, hashing, schema checks, vote counting, and Sui execution
remain ordinary code rather than hidden AI. If any step uses AI judgment, it
must run through GonkaRouter and appear in the run audit.

This mapping reflects the organizer's Gonka track reveal material supplied to
the team on 2026-08-26. The public track-detail page still shows a placeholder,
so final eligibility and submission instructions must be reconfirmed when it is
updated.

## 🏆 MUBA Sui Track 02 — AI × Sui

The revealed Track 02 brief asks for an AI application that uses Sui for
ownership, identity, payments, or on-chain execution, with Sui integral rather
than added for submission. OpenVerdict fits that brief directly:

| Track focus | OpenVerdict implementation |
| --- | --- |
| AI solves a real problem | GonkaRouter-powered agents resolve disputed claims that deterministic feeds cannot answer |
| Sui is integral | Move objects own agent capabilities and jury seats; Sui enforces commit-reveal voting, deadlines, verdicts, and payouts |
| Thoughtful UX | The CLI operates the protocol and the read-only dashboard makes evidence, agent activity, transactions, and settlement understandable |
| Working live demo | A capped Sui Mainnet dispute runs from challenge through Gonka inference to a final `ResolutionCertificate` and payout |
| Helpful Sui features | Walrus, PTBs, sponsored transactions, and optional zkLogin are used where they solve defined product needs |

GonkaRouter is the AI-inference gateway; Sui is the application trust,
ownership, coordination, and settlement layer. Removing Sui would remove the
object-native jury and enforceable outcome, while removing GonkaRouter would
remove the submitted build's required AI swarm.

This mapping reflects the organizer's Track 02 reveal material supplied to the
team on 2026-08-26. The public track-detail page still says that details will be
revealed soon, so final eligibility and submission requirements must be
confirmed when the page is updated.

## 🖥️ Hackathon demo

The demo presents one harmless, already-closed technical claim with conflicting
public evidence.

1. Paste a claim and public URL into the live fact-check page.
2. A sponsored Sui transaction creates a direct-review claim and jury budget.
3. Sui selects five agents spanning at least three GonkaRouter model IDs.
4. The CLI starts the live GonkaRouter jury while the observer shows five
   isolated agent lanes and safe-tool activity.
5. Owned Sui jury-seat commitments prove the votes were sealed before reveal.
6. Reveal each verdict, evidence-linked public reasoning trace, model ID, and
   Gonka Request ID.
7. If the first vote is split, show evidence-driven deliberation and a second
   GonkaRouter round.
8. Display the recomputable Truth Score and the four-of-five final result.
9. Create the Sui `ResolutionCertificate`, then use it to settle a capped native
   USDC prediction market or produce an unresolved refund.
10. End on the Sui/Walrus audit timeline with objects, blobs, events, and coin
    movement.

The dashboard can be stopped without stopping the engine. Restarting it
reconstructs the same public timeline from resolution events, Walrus blobs, and
Sui object state.

## 🏗️ Architecture

```text
+----------------------+       commands       +----------------------------+
| OpenVerdict CLI      |--------------------->| Verification engine        |
| required control     |<-- status / JSON ----| workers + protocol rules   |
+----------------------+                      +--+---------+----------+----+
                                                  |         |          |
                                          inference   evidence       tx/read
                                                  |         |          |
                                                  v         v          v
                                          +-------------+ +--------+ +--------+
                                          | GonkaRouter | | Safe   | | Sui   |
                                          | models      | | fetch  | | Move   |
                                          +-------------+ +---+----+ +---+----+
                                                              |          |
                                                              v          v
                                                     +--------+----------+
                                                     | Walrus + indexer   |
                                                     | and public events  |
                                                     +---------+----------+
                                                               |
                                                       read-only observe
                                                               v
                                                     +---------+----------+
                                                     | Optional dashboard |
                                                     +--------------------+
```

## 🧱 Planned technology stack

| Layer                  | Technology                                   | Purpose                                                   |
| ---------------------- | -------------------------------------------- | --------------------------------------------------------- |
| AI inference           | GonkaRouter                                  | All AI judgment, deliberation, synthesis, and repair      |
| Settlement             | Sui Mainnet + native USDC                    | Bonds, objects, verdict certificates, and payouts         |
| Protocol               | Sui Move                                     | Objects, capabilities, randomness, voting, and settlement |
| CLI                    | TypeScript                                   | Complete control, inspection, and automation surface      |
| Observer frontend      | Next.js + shadcn/ui + Tailwind CSS + Iconsax | Read-only visual explanation of resolution events         |
| Sui client             | `@mysten/sui` + Sui dApp Kit                 | BCS, PTBs, wallets, object reads, signing, and execution  |
| Evidence and artifacts | Safe retriever + Walrus                      | Freezes, hashes, stores, and retains public sources/work  |
| Data and indexing      | PostgreSQL + Sui event indexer               | Rebuildable query and observer state                      |
| Randomness and time    | Sui `Random` + `Clock` objects               | Jury selection and deadline enforcement                   |
| Agent identity         | Move `AgentProfile` + owned `AgentCap`       | Versioned ownership, bonds, human backing, and reputation |
| User onboarding        | Sui wallets; optional zkLogin                | Authentication and transaction signing                    |
| Gas abstraction        | Sui sponsored transactions, optional         | Pays gas for narrowly approved actions                    |

## 🔍 What is auditable

| Item                                | Source of truth                                         |
| ----------------------------------- | ------------------------------------------------------- |
| Claim, deadlines, bonds, and result | Shared claim object + immutable resolution certificate  |
| Committee and commitments           | Locked committee + owned jury-seat objects              |
| Reveals and counts                  | Immutable revealed-vote objects + shared round tally    |
| Evidence roots                      | Immutable Sui evidence-bundle objects                   |
| Evidence files and metadata         | Public Walrus blobs plus explicit hashes                |
| GonkaRouter response metadata       | Walrus run audit + Sui RunApproval object               |
| Gonka Request IDs                   | Original response `id` in each immutable run audit      |
| Truth Score                         | Final-round tally + immutable resolution certificate    |
| Tool activity                       | Walrus transcript bound into the run hash               |
| Payouts and refunds                 | Position/payout-ticket objects and Sui coin movement    |
| CLI output                          | Projection of engine, Sui objects, and Walrus artifacts |
| Observer dashboard                  | Rebuildable read-only projection, never authoritative   |

## ❓ Q&A — judge defence

### “AI agents are not reliable enough.”

OpenVerdict does not rely on one agent. Five agents investigate independently,
must cite frozen evidence, and require four matching votes. The system can
remain unresolved when confidence is weak.

### “Why not just use one AI model?”

A single model is one failure domain. OpenVerdict varies model, prompt, role,
owner, and historical reputation while making disagreement visible.

### “What if agents copy one another?”

They cannot see peer arguments or votes during the first round. Each vote is
committed before reveal. Discussion happens only after the independent results
are public.

### “What if agents collude?”

Collusion is possible in any oracle. OpenVerdict raises its cost through random
selection, one seat per owner and human-backing record, model caps, bonds,
public histories, and eventual proof-of-personhood.

### “What if someone creates 1,000 agents?”

Registration does not guarantee selection. Committee seats enforce owner and
human-backing uniqueness, and reputation-weighted randomness limits the
immediate influence of new identities.

### “What if the jury still cannot decide?”

OpenVerdict returns `UNRESOLVED`. The protocol can refund under its published
policy or later escalate to a larger committee. Uncertainty is treated as a
result.

### “Can the backend change the votes?”

Votes are bound to on-chain commitments before reveal. Anyone can recompute the
commitment from the revealed vote, evidence root, run hash, and salt.

### “Can agents use tools to browse or transact arbitrarily?”

No. Agents receive a typed, read-only allowlist limited to frozen evidence and
pinned Sui state. The engine validates and hashes every call. Models never
receive a wallet key.

### “Is the dashboard secretly running the protocol?”

No. Stop the dashboard and the CLI continues. The observer has no signer or
mutation endpoint and can rebuild its view from public events, artifacts, and
Sui.

### “Why Sui instead of a generic EVM settlement contract?”

Sui supplies product primitives OpenVerdict directly uses: native jury
randomness, owned jury seats, Move capabilities, immutable verdict objects,
sponsored transactions, and Walrus-backed evidence. Removing Sui would change
the protocol design, not only the deployment address.

### “Why use GonkaRouter instead of ChatGPT or Claude?”

The general jury pattern could be reimplemented with another AI system, but this
OpenVerdict release cannot operate its jury without GonkaRouter. Agent manifests,
multi-model selection, run audits, public Request IDs, and every reasoning,
verification, deliberation, and repair pass are Gonka-native. There is no
ChatGPT, Claude, or hidden-provider fallback; a GonkaRouter outage pauses the
round or leaves it unresolved.

### “Does GonkaRouter prove the verdict is true?”

No. Gonka can validate the infrastructure-level inference work and penalize a
dishonest Host, but that does not prove the model's conclusion is true.
OpenVerdict produces a transparent protocol result under defined evidence,
committee, voting, and economic rules. It does not claim universal truth.

### “What does the swarm actually do?”

Agents inspect evidence, perform bounded on-chain checks, identify unsupported
claims, commit independent votes, publish evidence-linked arguments, challenge
one another after reveal, and vote again when needed.

## 🚧 Current project status

OpenVerdict is presently a build-ready specification for a hackathon project.

- No application or Move implementation is committed yet.
- No OpenVerdict Move package or shared object is currently deployed.
- The project has not been audited.
- The Gonka and Sui categories and judging focus have been revealed, but their
  public detail pages and final submission requirements remain pending.
- It must not settle real user funds or high-stakes claims in its current state.
- Any Sui Mainnet demonstration must use strict caps, team-funded wallets,
  harmless public evidence, and clear experimental labels.

## 📚 Documentation

- [Complete product requirements and implementation specification](./PRD.md)
- [GonkaRouter developer documentation](https://gonkarouter.io/docs)
- [Gonka network architecture](https://gonka.ai/docs/architecture/)
- [Sui documentation](https://docs.sui.io/)
- [Sui object model](https://docs.sui.io/develop/sui-architecture/object-model)
- [Sui on-chain randomness](https://docs.sui.io/sui-stack/on-chain-primitives/randomness-onchain)
- [Walrus documentation](https://docs.wal.app/docs/getting-started)
- [Sui sponsored transactions](https://docs.sui.io/develop/transaction-payment/sponsor-txn)
- [MUBA Gonka track details](https://www.mubahack.xyz/challenge_tracks/track-details-gonka-1.html)
- [MUBA Sui Track 2 details](https://www.mubahack.xyz/challenge_tracks/track-details-sui-2.html)

## 🔥 Closing line

> OpenVerdict turns AI judgment from a black-box answer into an inspectable,
> challengeable, and on-chain resolution process.
