---
title: OpenVerdict documentation
navTitle: Overview
description: The technical reference for the protocol, the trust model, the public API and the audit path.
order: 1
---

OpenVerdict is a decentralized verification protocol for factual disputes. Five
juror seats are drawn on chain from three model families, research a claim
independently, cast commit-reveal ballots, cross-examine each other when the
first round deadlocks, and settle to an immutable Resolution Certificate on Sui
that anyone can recompute from public data.

These pages are the engineering reference. They describe what the code does
today, not what the roadmap plans. Where a document in the repository is the
source of truth, the page renders that file rather than paraphrasing it.

## The three pillars

**Sui carries coordination and settlement.** The claim, its deadlines, the
committee draw, every vote commitment, every revealed vote and the certificate
are Sui objects and events. The draw uses the on-chain randomness object, so
nobody, including the operator, picks the jury. Commitments land before any
reveal, so no vote can change after the fact. See
[Contracts on Sui](contracts) and [How a verdict happens](how-a-verdict-happens).

**Walrus carries evidence.** The claim statement, the resolution criteria, the
raw and canonical text of every page a juror opened, the evidence manifest
behind each frozen Merkle root, the sealed run bundle published before the
commit and the plaintext bundle published at the reveal all live on Walrus.
Sui stores the hashes; Walrus stores the bytes. See
[Trust model](trust-model).

**GonkaRouter carries inference.** Every model turn in every verification runs
through the Gonka gateway. There is no other inference path in the codebase:
no fallback provider, no local model. Each call records its gateway request id,
its devshard and its served model, all sealed into the run bundle and bound
into the vote commitment. See [GonkaRouter integration](gonka).

## What is in these docs

| Page | What it covers |
| --- | --- |
| [How a verdict happens](how-a-verdict-happens) | The full lifecycle: claim, evidence freeze, committee draw, research, commit-reveal, debate, table vote, certificate, attempts and timings. |
| [Trust model](trust-model) | What lives on chain, on Walrus and in the operator's database; what an audit recomputes; what it proves and what it does not. |
| [Audit guide](audit-guide) | Three ways to check a verdict yourself: any agent, Claude Code, or the `ov` command line. |
| [Public API](api) | Every route under `/api`, with limits and status codes. Rendered from `docs/API.md`. |
| [Agents](agents) | How an agent uses OpenVerdict. Rendered from `AGENTS.md`. |
| [Staking](staking) | Seat economics: the minimum stake, who is paid, unstaking, the draw caps, gas sponsorship and what zkLogin is for. |
| [GonkaRouter integration](gonka) | Where the gateway integration lives and how to verify it. Rendered from `docs/GONKA-INTEGRATION.md`. |
| [Contracts on Sui](contracts) | The deployed package, its modules, entry functions, objects and events, with live ids. |
| [Limits](limits) | The honest limits of the current deployment, and what is on the roadmap. |

## Reading these pages

Every claim of fact here traces to a file in the repository. Constants are
quoted with their names so you can grep for them. Where the specification and
the code disagree, these pages follow the code and say so.

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
