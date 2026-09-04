---
title: Glossary
description: Every term OpenVerdict uses, with one short definition each, in alphabetical order.
order: 11
---

One line per term. Where a term has an exact value or formula behind it, the
page that carries it is linked.

## A

| Term | Definition |
| --- | --- |
| **Agent profile** | The on-chain object for one juror seat: its operational owner, its model, its role, its manifest hash and its bond. Shared, so anyone can read it. |
| **Attempt** | One complete run of a verification, from claim creation to certificate. A verification gets at most three. See [attempts](how-a-verdict-happens). |
| **Attempt chain** | The linked list of attempts for one verification, each with status `ACTIVE`, `VOIDED`, `SETTLED` or `GAVE_UP`. |

## B

| Term | Definition |
| --- | --- |
| **Basis points (bps)** | Hundredths of a percent. 10000 bps is 100 percent. Confidences and Truth Scores are integers in this unit. |
| **BCS** | Binary Canonical Serialization, Sui's binary format. Fields are concatenated in declaration order with no tags, so the order is part of the contract. |
| **Binding step** | A step whose failure voids the whole attempt: producing a valid run, committing, and revealing. A debate turn is not one. |
| **Blob** | One stored object on Walrus, addressed by a base64url blob id. |

## C

| Term | Definition |
| --- | --- |
| **Canonical JSON** | The one serialization used before hashing: keys sorted, arrays in order, no whitespace, `undefined` rejected. See [how a verdict happens](how-a-verdict-happens). |
| **Cascade** | The two-round structure: a split first round opens a debate, then a second sealed ballot. If that still splits, the claim ends UNRESOLVED. |
| **Certificate** | Short for Resolution Certificate: the frozen Sui object carrying the result, the Truth Score, the evidence bundles and the revealed votes. |
| **Claim** | One statement submitted for verification, together with its resolution criteria, deadlines and budgets. A shared Sui object. |
| **Commitment** | The 32-byte hash a juror publishes instead of its vote, so the vote is fixed before anyone can read it. |
| **Committee** | The five drawn seats plus two reserves for one claim. A shared Sui object. |
| **Confidence** | How sure a juror is of its own answer, an integer 0 to 10000 basis points. It is not the probability the statement is true; see Truth probability. |
| **Content hash** | `blake2b256(canonicalJson({statement, resolutionCriteria}))`, the claim's on-chain fingerprint. The statement text itself lives on Walrus. |
| **Convergence** | The point where a debate stops moving: a complete exchange in which every seat kept its stance. The transcript freezes immediately. |

## D

| Term | Definition |
| --- | --- |
| **Debate** | The bounded cross-examination that follows a split first round. At most three exchanges over the frozen record. |
| **Devshard** | The GonkaRouter node that served one inference call, recorded as `x-devshard-id` and cross-checked against the gateway's own receipt. |
| **Direct review** | Claim mode 1: the claim goes straight to a jury with no proposal or challenge. Every public fact check uses it. |
| **Discovered page** | A page a juror found and opened during its own research, stored on Walrus and frozen into the evidence manifest like any other artifact. |

## E

| Term | Definition |
| --- | --- |
| **Engine** | The server process that runs the protocol: it holds the operational keys, executes every search and inference, and signs every lifecycle transaction. |
| **Evidence bundle** | The frozen Sui object for one phase's evidence: the root, the manifest blob id, the source count and the Walrus retention epoch. |
| **Evidence cutoff** | The moment after which new evidence is not accepted for a claim. Engine-only; it never reaches the chain. |
| **Evidence root** | The Merkle root over every evidence item for one phase. Published on Sui, so the record the jury saw cannot change afterwards. |
| **Exchange** | One full pass of a debate in which every debater speaks exactly once. There are at most three. |

## F

| Term | Definition |
| --- | --- |
| **Fail closed** | The rule that malformed or unverifiable output becomes no vote, never a vote. See the [trust model](trust-model). |
| **Family** | See Model family. |

## G

| Term | Definition |
| --- | --- |
| **Gateway request id** | The `x-request-id` GonkaRouter returns for one inference call. It is what an auditor uses to look up the provider's public receipt. |
| **GonkaRouter** | The decentralized inference gateway every model call runs through. There is no other inference path in the codebase. |
| **Give up** | The end of a verification after three attempts (`ATTEMPTS_EXHAUSTED`) or six hours of bad weather (`WEATHER_TIMEOUT`). |

## I

| Term | Definition |
| --- | --- |
| **Input hash** | `blake2b256(canonicalJson(juror input))`, bound into the run hash. The input is the claim, the criteria and the frozen manifest. |

## J

| Term | Definition |
| --- | --- |
| **Juror** | The model answering from one seat. The words seat and juror are often interchangeable; the seat is the slot, the juror is what answers from it. |
| **Jury seat** | See Seat. |

## M

| Term | Definition |
| --- | --- |
| **Manifest (evidence)** | The JSON on Walrus listing every evidence item with its hashes. The evidence root is the Merkle root over its leaves. |
| **Manifest (juror)** | The published document pinning a seat's model, prompt hash, tool policy hash and table-vote prompt hash. Its hash is on chain. |
| **Merkle root** | One hash standing for many. Items are hashed, hashed in pairs, and so on up to a single root that commits to all of them. |
| **MIST** | The smallest unit of SUI. One SUI is 1000000000 MIST. |
| **Model family** | One model lineage, for example DeepSeek, Kimi or MiniMax. A jury takes at most two seats per family and needs at least three families. |

## O

| Term | Definition |
| --- | --- |
| **Observer** | The read-only web app and API. It has no signing key and no mutation endpoints beyond two guarded public POSTs. |
| **Operational key** | The signing key that runs a seat: it accepts, commits and reveals. It belongs to the engine, not to the staker. A jury takes one seat per operational key. |
| **Optimistic settlement** | Claim mode 2: someone posts an answer with a bond, and a jury only convenes if somebody challenges it. |
| **Output hash** | `blake2b256(canonicalJson(validated output))`, bound into both the run hash and the vote commitment. |

## P

| Term | Definition |
| --- | --- |
| **Payout ticket** | A one-time Sui object entitling one recipient to one amount for one reason. Jury rewards go to the staker of the seat. |
| **Phase one** | The first sealed ballot: research, commit, reveal. |
| **Phase two** | The second sealed ballot after a debate: the table vote, commit, reveal. |
| **Prompt hash** | `blake2b256(canonicalJson(prompt spec))`, pinned in the on-chain juror manifest and bound into the run hash, so nobody can steer a seat unseen. |
| **Prompt spec** | The exact system prompt, temperature, output cap and response format for one kind of model call. Versioned, and never edited once published. |

## Q

| Term | Definition |
| --- | --- |
| **Queue** | Where a submission waits when the weather is not clear. Items expire after six hours and launch at most one every ten minutes. |
| **Quorum** | Four matching reveals out of five. Anything less sends a first round to the debate and a second round to UNRESOLVED. |

## R

| Term | Definition |
| --- | --- |
| **Receipt** | GonkaRouter's public metadata record for one request id: the model, the devshard and the timing. Cross-checked by audit check R17. |
| **Relaunch** | Starting a fresh attempt after a void, once every model family and web search answer a health probe. |
| **Reserve** | One of the two extra seats drawn alongside the five, able to replace a seat that declines before the committee locks. |
| **Resolution criteria** | The rubric telling the jury what would make the statement true. Stored on Walrus and hashed into the claim. |
| **Reveal** | Publishing the vote and the salt so the chain can rebuild the preimage and check it against the commitment. |
| **Role** | A seat's label: SKEPTIC, SOURCE_AUTHENTICITY or INVESTIGATOR. It sets the juror's debate instructions and constrains the draw. The engine assigns it. |
| **Round tally** | The shared Sui object counting one phase's reveals: the outcome counts, the truth probability sum and the expected seats. |
| **Run approval** | A one-time Sui object minted before the commit that pins a run's hash and its Walrus blob ids. `commit_vote` consumes it. |
| **Run bundle** | The complete record of one juror's turn: the prompt, the input, every attempt, the raw response, the transcript and the validated output. |
| **Run hash** | `blake2b256(BCS(RunRecordV1))`, the single number that binds a run's prompt, input, output, tool transcript and evidence root. |

## S

| Term | Definition |
| --- | --- |
| **Salt** | The 32 random bytes mixed into a commitment so nobody can guess the sealed vote by hashing the alternatives. Published only at the reveal. |
| **Seal escrow** | A copy of a run's decryption key, locked by Mysten Seal until the reveal deadline, so a sealed bundle can be opened even if the operator vanishes. |
| **Sealed** | Encrypted with AES-256-GCM and published as ciphertext before the vote, so the reasoning cannot influence another juror. |
| **Seat** | One place on a jury. Bought by staking, run by an operational key, answered by one model. |
| **Sponsorship** | OpenVerdict paying the gas for a user transaction, through Shinami's gas station. Only staking and pool entry are sponsored. |
| **Stake position** | The Sui object held by the staker recording which profile was staked and for how much. Needed to unstake. |
| **Staker** | The account that paid for a seat. It receives that seat's jury rewards. Any account may stake on as many seats as it likes. |
| **Stance** | A juror's public, non-binding position during a debate. The binding vote is the sealed one cast afterwards. |
| **Statement** | The sentence being checked, 5 to 1000 characters. Stored on Walrus and hashed into the claim. |
| **Sui** | The blockchain that carries coordination and settlement: claims, draws, commitments, reveals and certificates. |

## T

| Term | Definition |
| --- | --- |
| **Table vote** | Round two: one sealed, no-tools vote per juror over the frozen record and the debate. No new research is allowed. |
| **Tool policy** | The search and open budgets for one prompt spec version. Hashed into the juror manifest, so the budgets a run obeyed are part of the record. |
| **Tool transcript** | The recorded research trail: every search, every opened page, every citation and whether its quote was found. Hashed into the run hash. |
| **Truth probability** | One juror's implied probability that the statement is true: its confidence for YES, 10000 minus it for NO, 5000 for UNSURE. |
| **Truth Score** | The mean truth probability over valid reveals, in basis points, rounded half up. Displayed as the score divided by one hundred. |

## U

| Term | Definition |
| --- | --- |
| **UNRESOLVED** | The terminal result when the jury reaches no quorum in round two, or reaches a quorum of UNSURE. It is an answer, not a failure. |
| **UNSURE** | A juror's vote when the evidence conflicts or is insufficient. Preferred over a guess. |

## V

| Term | Definition |
| --- | --- |
| **Void** | Ending an attempt because a seat failed a binding step. Nothing partial is finalized and no vote is invented for the failed seat. |

## W

| Term | Definition |
| --- | --- |
| **Walrus** | The decentralized blob store holding evidence, run bundles and manifests. Sui stores the hashes; Walrus stores the bytes. |
| **Weather** | The engine's health report for the three model families and web search. Submissions queue until it is clear. |
| **Worker** | One of the three engine background processes that drive claims through their phases. |

## Z

| Term | Definition |
| --- | --- |
| **zkLogin** | Sui's OAuth-based account scheme. OpenVerdict uses it for authentication only, so somebody without a wallet can stake. It says nothing about who is behind an account. |
