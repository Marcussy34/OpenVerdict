---
title: FAQ
description: The questions engineers and judges ask first, answered against what the code actually does.
order: 12
---

The first section repeats the product questions from the landing page, with the
same answers. The rest are the ones that come up once somebody starts reading
the code.

## About the protocol

### What is OpenVerdict?

An adversarial AI jury protocol for factual disputes, not an agent swarm.
Instead of one model or one editor deciding, a committee of five juror seats
drawn on chain from three model families researches the claim independently.
Every search and page open is executed by the engine and recorded. Each seat
seals a secret ballot under commit-reveal, a deadlock is cross-examined over
the frozen evidence, and the outcome settles as a Resolution Certificate on Sui
that anyone can recompute.

### How are verdicts decided?

Each juror seals a blake2b-256 commitment to its vote, then opens it in the
reveal round, so no juror can anchor on or herd around another's reasoning
before sealing its own stance. A verdict needs a four-of-five quorum. A split
round goes to a bounded cross-examination, at most three exchanges citing only
the frozen record, and a second sealed ballot. If the quorum is still missing,
or the quorum itself is UNSURE, the claim finalizes as UNRESOLVED rather than
being forced into a yes or no.

### What actually settles on chain?

The claim, the drawn jury seats, every commitment and reveal, the round tally
and the final Resolution Certificate are Move objects on Sui. The package ids
for testnet are on the [contracts page](contracts), read live from the release
config, and the observer only ever reads them.

### Where does the evidence live?

Submitted URLs are crawled through a proxy that blocks internal addresses,
sanitised to plain text and Merkle-frozen to Walrus before the jury convenes.
The evidence root is recorded on chain, so a verdict can always be checked
against the exact record it saw. Pages the jurors open during their own
research are stored on Walrus the same way, and every research step is hashed
into the run record that the commitment binds.

### Which models sit on a jury?

Panels are drawn through GonkaRouter across DeepSeek-V4-Flash, Kimi-K2.6 and
MiniMax-M2.7: five seats, at least three distinct model families, at most two
seats per model. Seats are assigned by Sui native randomness, not by the
operator.

### Who actually runs the jurors?

Today the OpenVerdict engine executes every juror run itself, and all AI
reasoning goes through GonkaRouter only: the adapter refuses any other
inference host in code, and a juror that cannot reach the gateway fails closed
instead of falling back. Jurors are standardized seats, not user-owned bots.
Prompts and tool policies are hashed into on-chain manifests, so nobody,
including the operator, can steer a seat without breaking hashes anyone can
recheck. Trust here comes from verifiability rather than decentralized
execution; an attested executor is the disclosed roadmap step.

### What happens when a juror fails?

No vote is ever invented for it. A verification is all or nothing: a juror
error at a binding step voids the whole attempt, the failure and the seat's
research trail stay public, and the engine relaunches a fresh attempt once all
three model families and web search answer a health probe, up to three
attempts. Nothing partial is ever finalized.

### Can I check a verdict myself?

Yes, and you should. The verifier page recomputes every commitment, Merkle
root, run hash and Truth Score in your browser from the published record, can
resend a juror's exact recorded conversation to the same model, and can open a
sealed juror bundle through Seal once its reveal deadline has passed. The
[audit guide](audit-guide) walks through all three routes. Nothing in that path
trusts this server.

## Design questions

### Why three model families, and not one model five times?

Five instances of one model are one opinion sampled five times. They share
training data, tokenizer, refusal behaviour and blind spots, so a wrong answer
tends to be wrong five times in the same direction. Three families make a
jury's errors less correlated.

It does not make them independent. This is disclosed: five LLM jurors remain
correlated even across families, and the diversity constraints reduce shared
failure modes without removing them.

### Why at most two seats per model family?

Because three families across five seats can only be arranged as 2 + 2 + 1. Cap
a family at two and the jury is forced to reach for a third family. Without the
cap, a draw could return four seats from one family and one from another, which
is close to the one-model case the diversity rule exists to avoid.

The rule is checked twice: as a per-candidate cap during the draw
(`count_model(selected, model_hash) < 2` at `jury.move:1184`), and as a
post-draw assertion that at least three distinct families are present
(`selected_diversity_valid`, `jury.move:1218-1236`).

### Why commit-reveal, rather than just publishing votes?

Because a jury that can see votes as they land is not five opinions, it is one
opinion plus four reactions. Publishing a hash first fixes each vote before any
of them is readable. The salt, 32 random bytes, makes the hash unguessable, so
nobody can brute force the sealed answer by hashing the three outcomes at every
confidence.

The reveal then has to reproduce that exact hash, using fields the juror cannot
change, so a vote can be hidden but never altered. `reveal_vote` rebuilds the
preimage from the seat's own stored claim id, profile id, seat id, phase and
evidence root, and aborts with `E_COMMITMENT_MISMATCH` if the hashes differ.

### Why is the whole attempt voided when one seat fails?

Because the alternative is worse. If four seats out of five could settle a
claim, then a jury with one broken seat is a four-seat jury, and the quorum
rule silently becomes four of four. Voiding keeps the rule honest: a
certificate means five seats participated and four of them agreed.

It also removes any incentive to let a seat fail. Nothing partial ships.

### Why does a debate stop at three exchanges?

Because a bounded argument converges or it does not, and an unbounded one just
costs money. Three exchanges give every seat a chance to answer, to be
answered, and to move. If nobody moves after a complete exchange the debate is
over immediately, which is usually before the third.

### Why can round two use no tools?

Because round two is about the record, not about new facts. Every juror already
researched in round one, and the debate happened over frozen evidence. Letting
round two search again would mean voting on evidence nobody else saw and
nothing was frozen against.

### Why is UNSURE worth 5000 basis points?

Because it is the honest midpoint. A juror answering UNSURE is saying the
evidence does not decide the question, so its contribution to the Truth Score
should pull toward neither end.

## Operational questions

### What happens when a model provider is down?

Nothing launches. The engine probes the three model families and web search
together, and a submission arriving under bad weather is refused outright:
the API answers 503 with the weather report, nothing is stored, and the page
says which families are down so you can send it again yourself. There is no
queue. A verification already in flight that loses a seat fails closed, voids,
and relaunches only once every family answers a probe again.

Web search counts as a family for this purpose because a jury with no web
search answers UNSURE on everything, which is a useless verdict rather than a
failure.

Relaunches are spaced: at most one engine-relaunched jury every ten minutes.
That limit exists because three concurrent juries drew a rate-limit storm from
the shared gateway on 2026-09-03.

### What does UNRESOLVED mean?

That the jury did not reach four matching votes, or that four of them agreed on
UNSURE. It is a real answer, published with a certificate on chain like any
other. It means the evidence available did not settle the question, not that
the system broke.

A voided attempt is a different thing: it has no certificate at all.

### Who pays, and who earns?

Requesters fund a claim's budgets in SUI when it is created. The public demo
form is a team-subsidized tier of the same flow. At settlement the committee
budget, minus the protocol fee of 500 basis points by default, splits evenly
across the seats that validly revealed, as one-time payout tickets:

```
fee          = committee_budget * protocol_fee_bps / 10000
juror_budget = committee_budget - fee
reward       = juror_budget / number of valid reveals
```

Commit late, fail the schema, or refuse to reveal, and that seat earns nothing.
A seat's tickets go to whoever staked on it, so opening a seat with 0.1 SUI is
how anyone earns from jury work. There is no accuracy bonus and no
majority-only pay: paying for agreement would buy agreement. Pooling several
stakers behind one seat is recorded direction, not shipped code.

### What is not on chain?

The statement text, the resolution criteria, every evidence page, every run
bundle and every manifest. All of them live on Walrus, and Sui holds only their
hashes. That is deliberate: chain storage is expensive and permanent, and a
hash is enough to prove the bytes did not change.

Also not on chain: the engine's database, which is a rebuildable projection;
the salts and reveal keys before publication, which is disclosed as a testnet
limitation; and the deliberation prompt, which sits outside the manifest hash
chain unlike the research and table-vote prompts.

### Can the operator cheat, and how would it show?

Not without breaking a hash anyone can recompute. Specifically it cannot pick
the jurors, change a vote after its commitment, swap evidence after the freeze,
edit the result or the score, invent a vote for a failed seat, substitute a
model, rewrite a bundle or a page, keep a sealed bundle closed past its
deadline, or steer a seat's prompt.

Each of those is a recomputation the auditor performs, and a mismatch is a
`FAIL` row with both values printed side by side. For example, a swapped
evidence page changes the manifest, which changes the Merkle root, which no
longer matches the root in the `EvidenceFrozen` event, the root bound to each
seat, and the root inside every commitment: check S4 fails and so does every
C2.

What the operator can do is decide when claims launch, pause, deploy, or simply
not run. A withheld claim has no certificate; it does not have a false one. And
the run attestor and evidence freezer are single, team-held capabilities today,
so the pipeline upstream of the commitment is trusted infrastructure. The full
list is on the [trust model](trust-model) page.

### What is the one thing an audit cannot prove?

That the bytes in the record are the bytes the model actually received. The
gateway does not sign its replies yet. Three things stand in: the gateway's own
public receipt for each request id, re-execution of the recorded conversation
against the same model, and, on the roadmap, running the engine inside an
attested enclave.

Re-execution is corroboration, not proof. Machines on a decentralized network
are not bit-for-bit identical, so a differing rerun is a reason to look closer
rather than evidence of tampering.

### Why is there no appeal?

There is no appeal mechanism defined anywhere in the protocol. UNRESOLVED is
the only escape hatch. That is a real limitation and it is listed on the
[limits](limits) page.

## Practical questions

### Do I need a wallet or an account?

No. Reading a verdict, watching a jury and submitting a claim are free and need
no account. A wallet is only for staking on a seat.

### How long does a verdict take?

About twelve minutes for a one-round verdict and about thirty-two minutes for a
two-round one, measured from the submission. The exact deadline ladder is on
the [lifecycle page](how-a-verdict-happens).

### How do I stake, and how do I get my money back?

Stake at least 0.1 SUI on a seat through the console; OpenVerdict sponsors the
gas. Unstaking deactivates the seat and returns the bond twenty-four hours
later. Note that there is no builder, API route or user interface for
unstaking yet: today it means hand-building the transaction. See
[staking](staking).

### Can I run my own juror?

Not yet. Every seat is run by an engine-controlled operational key today.
Self-hosted juror workers bringing their own gateway keys are on the roadmap.

### Is this on mainnet?

No. Sui testnet only, and mainnet is gated on a funding decision. The contracts
are unaudited and the demo tier is capped, team-funded value.

### What does a verdict cost the requester?

On the public tier, nothing: it is subsidised and rate limited to five
submissions per minute. The claim itself carries three budgets in MIST, and the
public path defaults the committee budget to 10000000 MIST and the evidence
budget to 0, with the whole direct-review budget capped at one SUI.

### Where do I report something?

Open an issue at
[github.com/Marcussy34/OpenVerdict/issues](https://github.com/Marcussy34/OpenVerdict/issues).
