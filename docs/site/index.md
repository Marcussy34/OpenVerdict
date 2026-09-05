---
title: OpenVerdict documentation
navTitle: Overview
description: The complete technical reference: the protocol, the trust model, the contracts, the API and the audit path.
order: 1
---

OpenVerdict is a decentralized verification protocol for factual disputes. You
give it one statement. Five AI juror seats research it independently, vote in
secret, argue if they disagree, and the result settles on the Sui blockchain as
a record anyone can recompute from public data.

These pages are the engineering reference. They describe what the code does
today, not what the roadmap plans. Every number, hash and field name here is
copied from the source, and the file it came from is named next to it so you
can check. Where a document in the repository is the source of truth, the page
renders that file rather than paraphrasing it.

New to the vocabulary? Every term used here has a one-line definition in the
[glossary](glossary). The [FAQ](faq) answers the questions engineers and judges
ask first.

## The three pillars

![The three layers: Sui carries coordination and settlement, Walrus carries evidence, GonkaRouter carries inference.](/diagrams/architecture.png)

**Sui carries coordination and settlement.** Sui is a blockchain: a public
ledger no single party can edit. The claim, its deadlines, the committee draw,
every vote commitment, every revealed vote and the final certificate are Sui
objects and events. The draw uses Sui's on-chain randomness object, so nobody,
including the operator, picks the jury. Commitments land before any reveal, so
no vote can change after the fact. See [Contracts and deployment](contracts) and
[How a verdict happens](how-a-verdict-happens).

**Walrus carries evidence.** Walrus is decentralized blob storage. The claim
statement, the resolution criteria, the raw and canonical text of every page a
juror opened, the evidence manifest behind each frozen Merkle root, the sealed
run bundle published before the commit and the plaintext bundle published at
the reveal all live there. Sui stores the hashes; Walrus stores the bytes. See
[Trust model](trust-model).

**GonkaRouter carries inference.** GonkaRouter is a decentralized inference
gateway. Every model turn in every verification runs through it. There is no
other inference path in the codebase: no fallback provider, no local model. Each
call records its gateway request id, its devshard and its served model, all
sealed into the run bundle and bound into the vote commitment. See
[GonkaRouter integration](gonka).

## What is in these docs

| Page | What it covers |
| --- | --- |
| [How a verdict happens](how-a-verdict-happens) | The full lifecycle: claim, evidence freeze, committee draw, research, commit-reveal, debate, table vote, certificate, attempts and timings. |
| [Trust model](trust-model) | What lives on chain, on Walrus and in the operator's database; the hash chain; every audit check; what it proves and what it does not. |
| [See for yourself](proof) | One settled claim walked link by link: the package, the draw, the frozen evidence, each juror's sealed and revealed work, the certificate, and the Gonka receipts. |
| [Audit guide](audit-guide) | Three ways to check a verdict yourself, worked end to end on a real settled claim. |
| [What a verdict costs](cost) | Every component of one verification priced from public data, what the whole run has cost, and what a claim would have to be charged to cover it. |
| [Public API](api) | Every route under `/api`, the event stream catalogue, limits and status codes. |
| [Agents](agents) | How an agent uses OpenVerdict. Rendered from `AGENTS.md`. |
| [Staking](staking) | Seat economics: the minimum stake, who is paid, unstaking, the draw caps, gas sponsorship and what zkLogin is for. |
| [GonkaRouter integration](gonka) | Where the gateway integration lives and how to verify it. Rendered from `docs/GONKA-INTEGRATION.md`. |
| [Contracts and deployment](contracts) | Every Move module, entry function, struct, event and abort code, plus the release manifest, the environment and the host routing. |
| [Limits](limits) | What the current deployment does not do, and what is on the roadmap. |
| [Glossary](glossary) | Every term the product uses, one short definition each. |
| [FAQ](faq) | The questions engineers and judges ask first. |

## One worked example, used throughout

These pages keep returning to one real, settled claim on Sui testnet, so every
formula can be checked against numbers that actually exist.

| | |
| --- | --- |
| Statement | Humans use only ten percent of their brains. |
| Claim id | `0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6` |
| Result | NO |
| Truth Score | 200 basis points, displayed as 2.00 |
| Rounds | One. All five jurors agreed, so there was no debate. |
| Certificate | `0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706` |

Open it at
[app.openverdict.info/claims/0x2732...4ac6](https://app.openverdict.info/claims/0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6),
or audit it in a terminal:

```bash
pnpm ov audit 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6
```

## Reading these pages

Every claim of fact traces to a file in the repository, and constants are
quoted with the names you can grep for. Where the specification in
`docs/PRD.md` and the code disagree, these pages follow the code and say so.

The protocol is live on Sui testnet only. The public console is at
`https://app.openverdict.info`, and the source is at
[github.com/Marcussy34/OpenVerdict](https://github.com/Marcussy34/OpenVerdict).

## The shortest possible summary

A claim is submitted. Its evidence is frozen to a Merkle root on Sui, with the
bytes on Walrus. Five seats are drawn by on-chain randomness under diversity
rules. Each seat researches the claim through an engine-executed search and
open loop, must run a challenge search as well as a supporting one, and must
cite at least two distinct sites for a YES or a NO. Each seat's run is sealed,
its hash approved on chain, and its vote committed as a hash before any reveal.
Four matching reveals out of five settle the claim. A split first round opens a
debate of at most three exchanges, freezes the transcript as phase-two
evidence, and puts one no-tools table vote to each juror. The certificate
records the result and the Truth Score, and everything needed to recompute both
is public.
