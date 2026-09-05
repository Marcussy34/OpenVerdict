# OpenVerdict, three-minute demo script

One take, about 420 spoken words, six tabs open before you start. Times are cumulative. Spoken lines are in quotes; everything else is what to do on screen.

## Before you start

Open these tabs in order and leave them on their first screen:

1. https://openverdict.info (landing)
2. https://docs.openverdict.info/trust-model (docs, scrolled to the hash chain)
3. https://app.openverdict.info/fact-check (live verify, the claim already pasted but not submitted)
4. https://app.openverdict.info/claims/0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6 (the settled claim "Humans use only ten percent of their brains.", NO, 2 / 100, three attempts)
5. The same claim's report: add `/report` to that link
6. https://app.openverdict.info/verify (Audit)

Claim to submit live: `The EU AI Act entered into force on 1 August 2024.` (bounded, dated, checkable; the jury settles it YES).

Check the weather first: `pnpm ov weather` or the status page. If a family is down and degraded mode is on, say so once when the jury is drawn ("two model families today, and the certificate will say so"). If the weather is not clear at all, the submission is refused on screen: show it and say "the jury will not sit without every family and web search, nothing was stored", then move on to the settled claim. The demo still works end to end from the record.

If a claim of the day split and went to a debate, use it instead of tab 4 for the replay segment: the round-two conversation is the strongest thirty seconds of the demo.

## Timeline

| Time | Screen | Say |
| --- | --- | --- |
| 0:00 | Tab 1, landing, scroll one screen. | "OpenVerdict is an adversarial AI jury for factual claims. Five AI jurors from different model families research a claim alone, cast secret ballots, and the verdict settles on Sui as a certificate anyone can recompute." |
| 0:07 | Tab 2, docs, the hash chain in view. | "Everything is documented, down to the hash chain the whole thing hangs on. Let's put a claim on trial." |
| 0:12 | Tab 3, live verify. Submit the claim. Land on the live claim page. | "One statement. The evidence is frozen first as a Merkle root on Sui, then five seats are drawn with Sui's native randomness, and each juror researches the open web on its own." |
| 0:25 | Stay on the live page while the first lines appear. | "A run takes about twelve minutes, so I will leave it working and show you one that finished." |
| 0:30 | Tab 4, the settled claim. Press Play at 10x, then 30x. | "Watch the replay. The committee is drawn. Each juror searches for and against, opens pages, quotes them, and seals its vote as a blake2b commitment on Sui. Nobody, not even the operator, can read a vote until every seat has sealed." |
| 0:50 | Replay reaches the reveals. | "Then the reveals. Sui recomputes every commitment before it accepts one. Four matching votes settle the claim; a split sends the jury into a public debate over the frozen record, then a sealed table vote." |
| 1:05 | Chat view: scroll the juror cards, open one trail. | "This is the conversation view: every search, every page, every quote, per juror." |
| 1:12 | Switch to Graph. Drag a node. | "And the same record as a graph: jurors, their research, their votes, all wired to the certificate." |
| 1:20 | Click the certificate node. | "The resolution certificate on Sui: NO, truth score 2 out of 100." |
| 1:27 | In the inspector: open the certificate on SuiVision, the finalize transaction on Suiscan, then a Walrus blob and a GonkaRouter request id from a juror's run. | "Every state change is a Sui transaction, every artifact a Walrus blob, every AI step a GonkaRouter request id. Nothing here is our word for it." |
| 1:45 | Tab 5, the report. Point at the attempts line, open Full view, scroll once. | "The report. This claim took three attempts: the first two were voided when a provider failed, and every void stays public. The full view is every step, every hash, every run proof." |
| 2:05 | Tab 6, Audit. Point at the one line. Switch to the terminal: `pnpm ov audit <the claim link>` (or an agent that already ran it). | "Give this one line to any agent and it sets itself up. The audit recomputes every commitment and run hash from public data, shows exactly what each juror received and did, and walks the decision trail that is stored on chain." |
| 2:25 | Tab 2 again, the trust model: hash chain and objects. | "Prompt, input, output and transcript hashes pin the run hash; the run hash and the evidence root pin the commitment; the commitment pins the reveal; the reveal pins the certificate. That is the whole trust model, and every object on it has an owner you can look up." |
| 2:40 | Back to the live claim (tab 3's page). | "Back to our live claim." If it settled: "There is the certificate." If not: "Still deliberating; it ends exactly the way you just saw, with a certificate anyone can recompute." |
| 2:52 | Landing, or the live page. | "OpenVerdict. Verdicts you can recompute. Built on Sui, Walrus, Seal and GonkaRouter." |
| 3:00 | End. | |

## If something goes wrong on stage

- The submission is refused: show the refusal, say the line above, continue with tab 4. Do not resubmit on stage.
- The replay is slow to start: switch to 30x immediately; the first reveal arrives within seconds at 30x.
- The inspector's explorer links take a while: SuiVision loads its details in the browser; open the transaction on Suiscan first, it is faster.
- The terminal is not ready: skip the CLI and read the Audit page's line; the report's Proof section already shows the same links.

## Things to say only if asked

- Why three attempts on the settled claim: a seat failed closed twice (a provider error, then an invalid citation), the attempt was voided and relaunched on the next clear weather probe, and all three attempts are on the report.
- Why a jury needs every family: the diversity rule is enforced by the Move draw, not by the app; degraded mode is an on-chain switch the operator can flip when a provider is down, and every certificate drawn under it says so.
- What the truth score is: the mean of juror probabilities from the final valid round, recomputable from the revealed votes.

## The identifiers, spoken (about ninety seconds)

Every piece of a juror's work in OpenVerdict is fingerprinted with a hash.

The prompt, the input, the model's answer, the research transcript and every page the juror opened are each hashed, those hashes are folded into one run hash, and that run hash is pinned on Sui before the juror is allowed to vote.

The vote itself is then locked on Sui as another hash, built from the outcome, the confidence, the run hash, a secret salt and the frozen evidence root, which is a Merkle root over every admitted page, so nobody can read it or change it before every seat has committed.

When the votes are revealed, the plaintext work files go to Walrus and Move recomputes each commitment from the revealed fields, rejecting any reveal that does not reproduce the hash it promised. The certificate at the end rests on those reveals, so one number on chain commits to the whole record beneath it.

An audit is simply walking that chain backwards from public data. Start at the certificate, follow its ids to the revealed votes, the run approvals and the evidence bundles, download every blob by its id, hash it again the same way, and compare against what Sui stored, checking along the way that each commitment landed before its reveal, that the evidence Merkle root was frozen before anyone reasoned, that each Gonka request id was inside the pinned run hash and matches the gateway's public receipt, and that the tally and the Truth Score follow from the votes. If every comparison matches, the record was not altered after it was sealed, the jurors could not have copied each other, and the verdict follows from that record by the published rules. It does not prove the claim is true, and it does not prove the model saw exactly those bytes, which is the one gap we disclose. What it proves is that the operator could not have tampered with the record without leaving a mismatch anyone can find, on the Audit page in a browser or with one terminal command.