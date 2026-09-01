# Pitch talk track (4-slide deck)

What to SAY for each point on the simplified deck. Slide text stays short; this
is the expansion you speak. Verify the two example stories' dates against
current news before the stage; they are stated here as of the team's last
check (the Polymarket incident is from March 2025, Meta's change from 2025).

## Slide 1 · Title (10-15 s)

SAY: "OpenVerdict is a decentralized verification protocol for factual
claims. Independent AI models
research a claim on Gonka's decentralized inference network, vote under
commit-reveal, and Sui settles a verdict anyone can recompute. It is live on
Sui testnet right now, and everything I show you is real chain state."

## Slide 2 · Problem

**Point 1: High-stakes outcomes, one trusted decider.**
SAY: "Whenever a disputed question is worth money, somebody has to declare the
answer. Today that somebody is a token vote, a back office, or one AI model.
None of them show their work, and all of them can be wrong or captured."

**Point 2: The referees are stepping back.**
SAY: "At the same time, the human referees are leaving the field. Professional
fact-checking is being wound down across the big platforms exactly when
generative AI makes convincing falsehoods free to produce at scale."

**Point 3: Even "just ask five AIs" can't be checked.**
SAY: "The obvious fix is to ask several AIs instead of one. But if their votes
live in a server log the operator can edit, you have not removed trust, you
have just hidden it. Verification has to be a property of the system, not a
promise from whoever runs it."

**Example A: Polymarket and Kalshi.**
SAY: "Prediction markets are the sharpest version of this. Polymarket does
billions in volume, and its disputed markets resolve through UMA's
token-weighted oracle: in March 2025 the Ukraine mineral-deal market resolved
YES even though no deal was signed, after whale-weighted voting. Kalshi is the
regulated version, and its outcomes are decided by the exchange's own
resolution desk. Real money, and at the last mile you are trusting either
whales or a back office."

**Example B: Meta ends fact-checking.**
SAY: "And on the information side, Meta shut down its third-party
fact-checking program in 2025 and moved to crowd notes. Research on community
notes shows most proposed notes never display, and the ones that do arrive
hours after a post has already peaked. The referee walked off the pitch just
as the flood started."

## Slide 3 · Solution

**Point 1: A jury of rival AI models, all reasoning on Gonka.**
SAY: "OpenVerdict convenes a randomized panel instead of trusting one answer
box: five seats across three model families, drawn on-chain with Sui's native randomness, at most two seats per
model, so no vendor can steer a verdict. Every juror researches the live web
on both sides of the claim, and every single inference runs on Gonka through
gonkarouter.io: the adapter refuses any other host in code, and a juror that
cannot reach Gonka fails closed instead of falling back."

**Point 2: Secret votes, public debate.**
SAY: "The jurors cannot herd, because votes lock on Sui as hash commitments
before anything is revealed, and four matching votes out of five settle the
claim in a single round; that is the common case, about ten minutes end to
end. When the jury splits, the courtroom picture earns its keep: each
revealed juror defends its own vote in a public, structured debate, citing
only evidence already on the record, and then a second round votes with that
whole record in front of it. If there is still no supermajority, the claim
finalizes as UNRESOLVED. The protocol never manufactures certainty, and seats
are never paid for agreeing with the majority, so there is no incentive to
fake consensus either."

**The optimistic lane (bonded claims).**
SAY: "For markets and DAOs there is also an optimistic lane, the pattern UMA
proved: a bonded proposer states the answer, and if nobody challenges it
inside the window, it finalizes with zero AI spend. A challenge is what
convenes the jury, and the losing side's bond pays for the review. The jury
is the court of appeal, not a toll on every claim."
NOTE for accuracy on stage: the live public demo uses the direct jury path
(every submitted fact-check convenes a jury immediately); the optimistic lane
is on-chain and exercised in the localnet E2E, so say "bonded claims can",
not "the demo does".

**Point 3: Don't trust it. Recompute it.**
SAY: "The output is an immutable certificate on Sui with a zero-to-hundred
Truth Score. Every search, every page opened, every prompt and vote is hashed
onto Walrus, reveal keys are time-locked in Seal so sealed bundles open even
without us, and the verifier page reruns fifteen checks per juror in your own
browser. Sui is the judge here, not us: deadlines, thresholds and settlement
are enforced in Move. You do not have to trust OpenVerdict; that is the whole
point."

**Money line (the foot of the slide).**
SAY: "Economically it runs in SUI: requesters escrow a claim budget, seats
that validly reveal earn payout tickets, and anyone can back a jury seat with
a Google account. The next step on the roadmap is delegated staking behind
seats, like backing a validator."

## Slide 4 · One-liner (close)

Read it slowly, one line per breath:
"OpenVerdict is a decentralized verification protocol for factual claims,
where independent AI models research, vote in secret, and debate in public on
Gonka, and every verdict settles on Sui as a certificate anyone can
recompute."

Then: "It is live. Submit a claim and watch the jury think. Thank you."

## Judge Q&A crib

- **Naming rule for the stage:** top-level identity is "decentralized
  verification protocol" (say "oracle" with integrators: "we fill the oracle
  slot for markets and DAOs"). Jury and court are explanation-layer metaphors
  only, and the SOLUTION slide is that layer: its bullets say jury, debate and
  judge on purpose while the headline stays protocol. Never lead with them.
- **Is this an oracle?** Yes, technically; that is the slot we fill. The
  difference is what's inside the box: a panel you can audit instead of an
  answer you must trust.
- **One round or two?** Round 1 settles at 4-of-5 in about ten minutes.
  A split triggers the public debate plus a second commit-reveal round
  (about twenty-one minutes); still no supermajority finalizes UNRESOLVED.
  Separately, bonded claims can resolve optimistically: no jury at all
  unless someone challenges.
- **Business model?** Pay-per-verification in SUI is the live flow (the free
  form is a subsidized tier); delegated seat staking with pro-rata backer
  yield is the recorded next step (PRD §1.1 item 20). Majority-only rewards
  are rejected by design: paying for agreement manufactures herding.
- **Isn't the engine centralized?** Execution yes, trust no: the operator can
  halt but cannot forge. Selection, deadlines, commitments, reveals and
  settlement are chain-enforced; every artifact recomputes. Nautilus attested
  execution is the disclosed closure.
- **Relation to DIVE?** Our own earlier prototype of the concept; OpenVerdict
  is the clean reimplementation built in the hackathon window, disclosed in
  the PRD, and this time the decisions, not just the identities, live on-chain.
- **What if models are wrong together?** Three families reduce but do not
  remove correlation; disclosed in the README. UNSURE and UNRESOLVED are
  first-class outcomes; the Truth Score is a recomputable average, never
  marketed as truth.
- **Proof the model saw those bytes?** Disclosed gap: re-execution and
  Gonka's public receipts corroborate; gateway-signed receipts and attested
  forwarding are the closure path.
- **Did a jury ever split for real?** Yes, live on testnet (claim
  0xc6d4f4ae…, 2026-09-01): a provider storm felled six of ten seats across
  two rounds, four revealed jurors all leaned YES, and the protocol still
  finalized UNRESOLVED at 82 rather than fake a supermajority, with every
  recomputation passing. Honesty under failure, on the record.
