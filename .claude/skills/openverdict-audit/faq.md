# Judge questions, short honest answers

Answers are drawn from the repository as of 2026-09-03 (README, PRD, runbook, checkpoint, Move sources, verifier). When a question is about one specific claim, answer from the dossier first and use these as the protocol background.

## 1. How do you know the vote was not changed?

Each juror committed a blake2b-256 hash of its vote on Sui before any vote was revealed. The hash covers the outcome, the confidence, the run hash, the frozen evidence root, the claim id, the seat id, the juror's profile id, the phase and a secret salt. At reveal the Move contract rebuilt that hash from the revealed values and refused anything that did not match. The auditor recomputes the same hash from the reveal transaction's inputs, independently of the app server, and compares it to the `VoteCommitted` event in the commit transaction. Both transaction digests are in the dossier and open on Suiscan.

## 2. Could the operator fake a verdict?

Not without breaking hashes anyone can check. The operator does not pick the jurors (Sui's native randomness does), cannot change a vote after its commitment, cannot swap evidence after the root is frozen on chain, cannot edit the certificate (an immutable Sui object), cannot invent a vote for a failed seat (the failure is public and voids the attempt), and cannot substitute a model (the served model must equal the manifest model, and GonkaRouter's public receipt names the model and node for each committed request id). What the operator still holds in this build is the pipeline upstream of the commitment: the engine runs the research and holds the run attestor and evidence freezer capabilities. The README labels this "detectable rather than impossible".

## 3. What if GonkaRouter lied?

The record would still be internally consistent, so this is the disclosed gap: there is no proof yet that the model received exactly the recorded bytes. Three things narrow it. The request id of every call sits inside the run hash committed on Sui before the reveal, and GonkaRouter's public receipt for that id confirms the model, the devshard, the timing and the outcome (checked on every revealed run). "Re-run this juror" resends the exact recorded conversation to the same model at the same settings; a matching verdict is corroboration, a differing one a reason to look closer, not proof of tampering. A gateway-signed receipt is on GonkaRouter's roadmap, and an attested forwarder (Sui Nautilus) is the full closure.

## 4. What if a model hallucinated?

A juror may cite only pages it opened in that run or ids from the frozen manifest, and every quote must be an exact sentence from the archived page; a quote the engine cannot find is blanked and recorded as not found, and a YES or NO without a valid citation fails closed. Outputs are strict-schema validated with at most two repair rounds; a still-invalid answer fails the seat in public and voids the attempt. Prose that a model writes where an evidence id belongs is dropped and recorded as a public repair, while the vote, the confidence and every other evidence array still fail closed. The trace shows what the juror cited, not whether it was right; that is why five jurors, three families, a quorum and UNRESOLVED exist.

## 5. Why three model families?

Identical models share training blind spots and alignment priors, so five copies of one model debating is one opinion five times. The Move rule requires at least three distinct families in every committee and at most two seats per model, so no single vendor can dictate the quorum. The honest limit: five LLM jurors are correlated even across families; diversity reduces but cannot remove shared failure modes.

## 6. Why five seats and four to settle?

Five seats fit three families with at most two seats per model. Four of five is a supermajority, not a simple majority, so a 3 to 2 split does not settle; it goes to the debate. The constants are `COMMITTEE_SIZE` = 5 and `REQUIRED_MATCHING` = 4 in `jury.move`. The Move rule can finalize on four matching reveals of five, but since round two at the table (2026-09-02) the engine voids an attempt with a missing commit or reveal, so in practice every seat must finish and the four-of-five rule is about agreement, not attendance.

## 7. What is UNRESOLVED?

A claim result, never a juror's vote. It happens when four or more jurors reveal UNSURE, or when no four jurors match after the debate and the table vote. The claim still finalizes with a certificate, and the truth score still stands as the average of the final-round beliefs. The system never forces fake certainty, and fees are refunded.

## 8. What happens when a provider is down?

Inside an attempt: a call that has not answered after 25 s is hedged to the same model, shed or timed-out calls are retried inside the seat window, and every attempt lands in the audit trail. If a seat still fails at a binding step, the whole attempt is voided in public and nothing partial is finalized. The engine relaunches once all three families and web search answer a health probe, at most three attempts, and gives up after six hours of bad weather after a void (`WEATHER_TIMEOUT`) or after three voids (`ATTEMPTS_EXHAUSTED`). New submissions during bad weather are queued and launched one per ten minutes when the weather clears; a queued submission expires after six hours.

## 9. What does staking on a seat do?

Stake is what a staker is willing to put behind a juror, and any account can stake: a browser wallet, an operator key, or a Google sign-in through Sui zkLogin. It gives the seat skin in the game. Every stake resolves to a staker hash, and the draw seats at most one juror per owner and per staker hash, so a jury spreads across operators and stakers. That is a diversity rule, not an identity claim: zkLogin is authentication only, there so people without a wallet can stake too. Today the team operates all seven jurors.

## 10. How is the truth score computed?

Confidence is read as the juror's probability that its own vote is correct. A YES counts as its confidence, a NO as 10000 minus it, an UNSURE as 5000, in basis points. The score is the plain mean over the valid final-round reveals, rounded half-up, shown as basis points divided by 100. Example: five NO votes at 9500, 10000, 10000, 9500, 10000 give 500 + 0 + 0 + 500 + 0 = 1000, mean 200 bps, score 2.00. No weights, no judgment calls; the same integer arithmetic runs on chain in `jury::truth_score_bps`.

## 11. What is on Sui, what is on Walrus, what is off-chain?

On Sui: the claim with its deadlines and budgets, the committee and the jury seats, each run approval (run hash and sealed blob reference), each vote commitment, each revealed vote, the round tallies, the evidence bundles (Merkle roots), the resolution certificate with the truth score, and the payout tickets. On Walrus: the statement and criteria, every page a juror opened (raw and canonical), the evidence manifests, the sealed and revealed run bundles, the debate transcripts, and failure records. Off-chain: the engine's Postgres index and event log (a rebuildable projection, never authoritative), the salts and Seal keys before reveal, and the live inference itself on Gonka hosts (recorded through GonkaRouter's request ids and receipts).

## 12. How is this different from asking one model?

One model can be wrong or manipulated, and nobody can recheck a chat. Here five jurors from three families research independently, seal their votes before seeing each other's, and every search, page, quote and vote is hashed into a public record anyone can recompute. A verdict needs four matching votes, a split goes to a bounded debate over frozen evidence, and honest deadlock ends as UNRESOLVED.

## 13. How is this different from a swarm?

Swarms let context accumulate unchecked, so the first answer becomes everyone's prompt and hallucinations loop. Here nobody sees a ballot until all are sealed (commit-reveal); the evidence is frozen before the debate and a juror may cite only ids from that record; turns are capped at three exchanges and stop early when nobody moves; the second vote is a sealed ballot over the frozen record, not a negotiated consensus; and a missing quorum exits cleanly to UNRESOLVED. Jurors are standardized, manifest-pinned seats, not free-floating worker processes.

## 14. What does a judge need to reproduce this?

The public repository, Node 22 or newer, pnpm, and `pnpm install`. Then `pnpm audit:claim <claim link or id>`: no key, no database, no wallet. The auditor uses the app's public API, Sui JSON-RPC, the Walrus aggregator and GonkaRouter's public receipts. In the browser, `/verify` recomputes commitments, truth scores and the 15 run checks. The tests (`pnpm test`, `pnpm test:move`) run offline.

## 15. What is the cost per claim?

Reading and verifying are free (no account, no wallet, no gas). The demo tier is free to the requester, a rate-limited subsidy rather than the business model. On the operator's side a testnet claim costs about 0.26 SUI plus 0.06 WAL for transactions and storage, plus GonkaRouter credits for inference and Firecrawl credits for web search; the docs give no per-claim figure for those two. In future, requesters pay in SUI and staked seats share earnings.

## 16. What would mainnet change?

Not the protocol: the same Move rules, hashes and checks. Real value would sit behind claims, so the disclosed V1 limitations close first: Seal keys and salts encrypted at rest, an edge rate limiter, socket-level IP pinning in the evidence fetcher, reviewed capability owners with the attestor signer in a KMS, multi-attestor, and a third-party audit. The PRD sequences a capped mainnet demo after a canary, then production after review. Everything today is capped, team-funded demo value.

## 17. Who were the jurors on this claim, and who picked them?

The dossier's Jury section lists each seat's model and role. Nobody picked them: `select_committee` draws five seats and two reserves with Sui's native `Random` under the diversity rules (three families, at most two seats per model, a skeptic and a source-authenticity role, distinct owners). The selection transaction digest is in the dossier.

## 18. Can a juror see another juror's vote before voting?

No. Votes are sealed as commitments on Sui, and a reveal opens only when all five seats have committed or the commit deadline has passed. In the debate the round-one votes are public by design, and the table vote is sealed again.

## 19. Do the jurors browse the web or hold keys?

They research, but only through the engine: every search and page open is executed server-side (SSRF-hardened, https only), recorded in the sealed transcript and hashed into the on-chain run hash. Models never fetch, never hold keys, never sign; every seat transaction is signed by the juror's own keypair held by the engine. No wallet keys are near a model.

## 20. What does a passed check prove, and what does it not?

Passed means the recomputed value equals the recorded one: the commitment recomputes, the run hash matches what Sui holds, the sealed core decrypts to the revealed bundle, the citations point at opened pages, the certificate carries the recomputed score. It does not mean the juror was right, and it does not prove the claim is true. OpenVerdict certifies the process, not universal truth.

## 21. What does UNAVAILABLE mean in the audit?

A public source did not answer (a Sui RPC, the Walrus aggregator, or the GonkaRouter receipts endpoint returned an error, a 404 or a 429). The check was not run, so it is neither passed nor failed; the dossier gives the manual URL to retry. A 429 from the receipts endpoint means the lookup was rate limited; retry the direct URL later.

## 22. Why did this claim need more than one attempt?

Because a verification is all or nothing: any juror error at a binding step (a failed run, a missing commit, a missing reveal) voids the whole attempt, and the engine relaunches when the weather clears. The dossier's attempt line names the void reason, the seat and the model of each earlier attempt, and every attempt stays public on the claim page. The voids recorded on testnet so far were Gonka weather (rate limits, timeouts, provider errors), a seat's invalid output, Walrus write errors, and a few engine bugs fixed the same day; quote the reason the dossier records for this claim rather than generalizing.

## 23. What is the Seal escrow for?

If a juror committed but never revealed, its sealed work would stay closed and the operator would be the only one holding the key. Seal removes that: at commit time the reveal key is encrypted under an on-chain time-lock policy, and after the reveal deadline anyone recovers it from Mysten's key servers with a throwaway keypair, no wallet and no gas, and opens the sealed bundle. Before the deadline the key servers refuse. Escrow is insurance only; it can never cost a seat its vote.

## 24. Is the dashboard running the protocol?

No. It is a read-only projection over public chain events, Walrus blobs and the engine's event feed. It holds no private keys, signs nothing and has no mutation endpoint. Stop it and the CLI continues; a restarted dashboard rebuilds the same timeline from Sui and Walrus.

## 25. Does GonkaRouter prove truth?

No, and the project never claims it does. Gonka validates that inference work happened on its network; OpenVerdict's evidence, voting and economic rules produce a protocol result: a resolution certificate with a truth score, not universal truth.

## 26. Why are the jurors paid for valid work and not for being right?

Because paying for agreement manufactures herding, punishes honest UNSURE votes and corrupts UNRESOLVED as an outcome. At settlement the committee budget splits across the seats that validly revealed, as one-time payout tickets; commit late, fail the schema or refuse to reveal, and the seat earns nothing. Weighting seats by a calibration track record (Brier score) is the recorded roadmap, not shipped code.

## 27. What if Gonka is down right now?

Then the claim does not launch. The engine probes DeepSeek, MiniMax, Kimi and the web search provider every two minutes with research-shaped requests (three parallel 400-token calls per family; the search row is a credit check). When any row fails, a new submission is queued instead of started (the API answers 202 with a queue id), and it launches by itself on the first clear probe, one engine launch every ten minutes, or expires after six hours. Nothing is held on unknown weather (no probe in the last five minutes): such a submission launches at once. If a family fails after the launch, the seat fails closed, the attempt is voided in public and relaunched on the next clear probe, up to three attempts. `ov weather` and `GET /api/weather` show the four rows; the console shows them as chips.

## 28. Why did my submission queue, and how long will it wait?

Because the last probe, less than five minutes old, showed at least one of the four rows not ok; the CLI printed which one and its status (429 shedding, TIMEOUT, 402 no search credits). The Move rules require three model families in every committee, and a jury without web search answers UNSURE on everything, so launching into a known-bad window would burn one of the three attempts for nothing. The queue holds the request exactly as submitted and starts it when all four rows answer, oldest first, one launch per ten minutes; it expires after six hours ("The families did not all answer within six hours. Submit again."). Nobody can say how long the weather takes to clear; `ov watch <queueId>` polls every 30 s and follows the claim the moment it launches.

## 29. Why can one seat void the whole attempt?

Because a verification is all or nothing: every step is five for five or void, and a verdict never carries an empty chair. The quorum is four matching reveals of five, and that rule is about agreement, not attendance. If a seat's run fails (`INVALID_SCHEMA`, `CITATION_INVALID`, `TIMEOUT`, `PROVIDER_ERROR`), or a seat misses its commit (`MISSING_COMMIT`) or its reveal (`MISSING_REVEAL`), no vote is invented for it and nothing partial is finalized; the failure record with its research trail stays public on Walrus and on the claim page, and the engine relaunches the whole attempt when the weather clears, up to three attempts. A skipped debate turn is not a binding step: it is recorded and the debate goes on. The void is an engine fact, public on the claim page ("Attempt n of 3 voided: Seat k (<model>) failed: ..."), not a chain state, because the settlement contract has no mid-flight cancel once a claim leaves CREATED.

## 30. How long does a verification take?

Counted from the claim's creation on Sui (testnet ladder, 2026-09-03): the committee is drawn about a minute in and the evidence is frozen right after; seats accept within a minute; the first commit deadline is at +10 minutes and the reveal window closes at +12 minutes, so a one-round verdict lands about 11 to 12 minutes after launch (measured 10.6 minutes on "Humans use only ten percent of their brains."). A split opens a debate of up to 14 minutes that stops early when nobody moves, then a 4-minute table-vote commit window and a 2-minute reveal, so a two-round verdict lands about 32 minutes after launch. The POST itself takes under a minute before the claim id exists. A queued submission adds the wait for clear weather plus the ten-minute launch spacing.

## 31. What are the limits on a public submission?

A claim of 5 to 1000 characters; optional evidence text up to 20000 characters; up to five https URLs of at most 2048 characters each; optional resolution criteria up to 2000 characters. Five submissions per minute per client behind the hosted proxy, plus a global ceiling of 60 per minute; the extractor (`POST /api/extract-claim`, one URL or 40 to 20000 characters of text, up to three candidates) shares those buckets. Public writes can be switched off on a deployment (403 `writes_disabled`). Reading, watching and auditing have no limit of that kind and need no account. The demo tier is free to the requester.

## 32. What does `ov watch` show, and what does it not?

It prints one dated line per public event from the same stream the console reads: the claim created on Sui, the evidence frozen with its root, the five seats drawn with their models, each run approved, each vote committed (k of 5), each phase change, each vote revealed with its outcome and confidence, each debate turn with its stance, the convergence marker, output repairs, and the final line with the result, the score and the certificate. In parallel it polls the claim record every 60 s for a void, a relaunch or a give-up, which the stream may not carry. It does not show a juror's research while it runs (the transcript is sealed until the reveal), it does not show a sealed vote before the reveal, and it never predicts the result: a claim is settled only when the final line lands, and the audit afterwards is what proves the record unchanged.
