---
title: What a verdict costs
navTitle: Cost
description: Every component of one verification priced from public data, what the whole testnet run has cost so far, and what a claim would have to be charged to cover it.
order: 3.6
---

Every figure on this page was measured on 2026-09-05 from public sources, and
every one of them can be recomputed by anyone. The two claims below are the two
that have settled on the current board, and the auditor finds no failed check
on either. Sui gas comes from the transaction effects on a public JSON-RPC node. Walrus
storage comes from the register transaction that paid for each blob. Model
tokens come from the sealed run bundles, which record every attempt including
the repairs. Research calls come from the sealed tool transcripts. Nothing on
this page is read from the operator's database, and the script in
[Recompute it](#recompute-it) rebuilds the whole table from the same public
endpoints.

One line is an estimate rather than a measurement, and it says so. Everything
else is a number that exists on a chain, in a blob or on a published price
list.

Testnet SUI and testnet WAL have no market value. The dollar columns convert
native units at the mainnet rate of the day, so they read as what the same work
would cost if this deployment ran on mainnet.

## What was measured

| Claim | Result | Truth Score | Attempt | Ran | Checks |
| --- | --- | --- | --- | --- | --- |
| [The Great Wall of China is visible to the naked eye from the Moon.](https://app.openverdict.info/claims/0x7842b5da07ead75bb95c9a0d2dc46b20f1edf7aafe6921f5e1e94ae87828d092) | NO | 3.20 | 1 of 3 | 2026-09-05 09:19:06Z to 09:23:51Z | 86 of 86 |
| [Bitcoin's total supply is capped at 21 million coins.](https://app.openverdict.info/claims/0xd86526512ffcc78c3460064b46b56252d5d2d3adc69aedc24ad9c8325c81ac8c) | YES | 96.60 | 2 of 3 | 2026-09-05 09:30:46Z to 09:34:28Z | 86 of 86 |

Both juries seated five seats across two model families under the degraded
diversity rule the certificate records. Neither claim split, so neither opened
a debate. Attempt 1 of the Bitcoin claim was voided on an invalid schema, and
its cost appears in [The entire run](#the-entire-run).

## Unit prices

| Input | Unit | Price | Source | Read |
| --- | --- | --- | --- | --- |
| SUI | 1 SUI | $0.7753 | [CoinGecko](https://www.coingecko.com/en/coins/sui) | 2026-09-05 |
| WAL | 1 WAL | $0.02693 | [CoinGecko](https://www.coingecko.com/en/coins/walrus-2) | 2026-09-05 |
| GonkaRouter inference | 1,000,000 tokens, prompt or completion | $0.0012 | [gonkarouter.io/pricing](https://gonkarouter.io/pricing) | 2026-09-05 |
| Firecrawl search | 1 search of at most 10 results | 2 credits | [firecrawl.dev/pricing](https://www.firecrawl.dev/pricing) | 2026-09-05 |
| Firecrawl page open | 1 page returned | 1 credit | [firecrawl.dev/pricing](https://www.firecrawl.dev/pricing) | 2026-09-05 |
| Firecrawl credit, Hobby plan | 1 credit | $0.0038 | $19 a month for 5,000 credits | 2026-09-05 |
| Firecrawl credit, Standard plan | 1 credit | $0.00099 | $99 a month for 100,000 credits | 2026-09-05 |
| Hosting, the estimate | 1 month | $5 | [Railway Hobby minimum](https://railway.com/pricing) | 2026-09-05 |

GonkaRouter charges one rate for every model it serves and bills prompt and
completion tokens the same, so the three families on this deployment share a
price. Firecrawl's credit price depends on the plan, and the plan a deployment
is on is not public. The tables below use the Hobby rate, which is the smallest
paid plan. On the Standard rate the research line falls to about a quarter of
what they show.

## One verification

A verification is five juror seats, each researching the claim on its own,
sealing its work to Walrus, pinning a hash on Sui, committing a hidden vote and
then revealing it. Four components carry the money. Sui gas pays for the
protocol transactions and for the two transactions every Walrus write needs.
Walrus pays for the bytes. GonkaRouter pays for the model turns. Firecrawl pays
for the searches and page opens the engine runs on the jury's behalf.

### Sui gas

Every row is the sum of the transactions named, with gas taken as computation
plus storage less the storage rebate, which is what the sender actually paid.

| Step | What it pays for | Transactions | Great Wall | Bitcoin |
| --- | --- | --- | --- | --- |
| Claim creation | The claim object, its deadlines and the escrowed budgets | 1 | 0.003256 SUI | 0.005213 SUI |
| Committee draw | Five seats drawn with the on-chain randomness object | 1 | 0.046312 SUI | 0.046382 SUI |
| Evidence freeze | The phase-one Merkle root, frozen as an immutable object | 1 | 0.004095 SUI | 0.004095 SUI |
| Run approval | One per seat, pinning the run hash before any vote | 5 | 0.025108 SUI | 0.025108 SUI |
| Vote commitment | One per seat, a hash and nothing else | 5 | -0.011930 SUI | -0.011930 SUI |
| Phase change | Commit window closed, reveal window opened | 1 | 0.001059 SUI | 0.001059 SUI |
| Vote reveal | One per seat, recomputed by Move and frozen | 5 | 0.000557 SUI | 0.000557 SUI |
| Finalize | The certificate, the Truth Score and the payout tickets | 1 | 0.018271 SUI | 0.018271 SUI |
| Walrus register | One per blob, reserving storage and paying WAL | 18 | 0.101367 SUI | 0.101367 SUI |
| Walrus certify | One per blob, confirming the storage nodes hold it | 18 | 0.026811 SUI | 0.026801 SUI |
| **Total** | | **56** | **0.214905 SUI** | **0.216921 SUI** |

Three things in that table are worth a second look.

The vote commitment is negative. Committing consumes objects the run approval
created, and Sui refunds the storage they held, so the seat key ends the
transaction with more SUI than it started with. The reveal is nearly free for
the same reason.

The committee draw is the single most expensive protocol transaction, ahead of
the finalize that mints the certificate. It reads Sui's shared randomness
object and mints five seats in one call.

Walrus writes cost more gas than the protocol itself does. Registering and
certifying the blobs is the larger half of the bill on both claims.

| Gas | Great Wall | Bitcoin |
| --- | --- | --- |
| Protocol transactions | 20 | 20 |
| Walrus register and certify transactions | 36 | 36 |
| Protocol share of the gas | 40.4 percent | 40.9 percent |
| Walrus share of the gas | 59.6 percent | 59.1 percent |

### Walrus storage

Each write is one Sui object, so a blob written twice is paid for twice. The
raw and canonical copies of an evidence artifact are two writes even when the
bytes are identical.

| Blob | What it holds | Count | Great Wall | Bitcoin |
| --- | --- | --- | --- | --- |
| Claim statement | The statement, written before the claim exists | 1 | 3,040,632 FROST | 3,022,425 FROST |
| Resolution criteria | The instruction the jury is bound to | 1 | 3,022,425 FROST | 3,022,425 FROST |
| Evidence artifact | The frozen evidence, raw bytes and canonical text | 2 | 6,081,264 FROST | 6,044,850 FROST |
| Evidence manifest | The leaves behind the Merkle root on Sui | 1 | 3,040,632 FROST | 3,022,425 FROST |
| Opened page | The canonical text of each page the jury opened | 3 | 9,121,896 FROST | 9,067,275 FROST |
| Sealed run bundle | One per seat, published before its commit | 5 | 15,200,703 FROST | 15,112,125 FROST |
| Revealed run bundle | One per seat, published at its reveal | 5 | 15,199,065 FROST | 15,112,125 FROST |
| **Total** | | **18** | **0.054707 WAL** | **0.054404 WAL** |

Blob size does not move this number. Walrus erasure codes every blob across a
thousand shards, and the coding overhead dominates at these sizes, so the
shortest statement and the largest run bundle reserve exactly the same encoded
size and round to the same number of storage units. What a claim pays Walrus is
set by how many blobs it writes, not by how large they are.

| Check | Value |
| --- | --- |
| Smallest blob written | 53 bytes |
| Largest blob written | 82,889 bytes |
| Encoded size reserved for either | 66,034,000 bytes |
| Storage units, at 1 MiB each | 63 |
| Epochs bought | 10, one epoch per day |
| Storage price at the time of the write | 3,998 FROST per unit per epoch |
| Write price at the time of the write | 7,995 FROST per unit |
| Paid, storage | 2,518,740 FROST |
| Paid, write | 503,685 FROST |
| Recomputed today at the live price | 2,461,410 plus 492,219 FROST |

The register transaction splits the exact WAL it is about to spend and destroys
the remainders, so the two paid figures are readable on chain rather than
inferred. Recomputing them today with the Walrus SDK's `storageCost` helper
gives a little less, because the price per storage unit is a live value on the
Walrus system object and it has moved since the write.

### GonkaRouter inference

The bundle records every attempt a seat made, not only the one that was
accepted. Hedges that hit a provider error and repair turns that fixed a
malformed answer are model time the operator paid for, so they are counted
here.

| Model family | Calls | Priced calls | Prompt tokens | Completion tokens |
| --- | --- | --- | --- | --- |
| Great Wall, DeepSeek V4 Flash | 20 | 16 | 82,056 | 892 |
| Great Wall, MiniMax M2.7 | 23 | 19 | 69,026 | 4,233 |
| **Great Wall, total** | **43** | **35** | **151,082** | **5,125** |
| Bitcoin, DeepSeek V4 Flash | 10 | 6 | 10,843 | 738 |
| Bitcoin, MiniMax M2.7 | 22 | 19 | 48,158 | 3,230 |
| **Bitcoin, total** | **32** | **25** | **59,001** | **3,968** |

A priced call is one that came back with a usage record. The rest were provider
errors that returned nothing, and GonkaRouter's public receipt for a failed call
reports no tokens. The Great Wall claim spent much more model time than the
Bitcoin claim because its seats took more turns to reach a valid answer. That is
the honest reason the two claims differ, and it is why a single verification has
no fixed inference price.

### Web research

Search and open are engine-executed. The engine keeps one cache per claim, so
the first seat to run a query pays for it and the other four read the same
result.

| Step | Total | From the cache | Failed | Sent to Firecrawl | Credits |
| --- | --- | --- | --- | --- | --- |
| Great Wall, search | 5 | 1 | 0 | 4 | 8 |
| Great Wall, open | 21 | 18 | 0 | 3 | 3 |
| Bitcoin, search | 5 | 1 | 0 | 4 | 8 |
| Bitcoin, open | 10 | 4 | 3 | 3 | 3 |

Both claims landed on the same credit count. A failed open returned no page,
and Firecrawl's published table charges per page returned, so the failures on
the Bitcoin claim are counted apart and not billed. That is an assumption about
Firecrawl's billing rather than something a receipt proves, and the whole
question is worth a few credits either way.

### The four components together

| Component | Unit price | Great Wall | Great Wall USD | Bitcoin | Bitcoin USD |
| --- | --- | --- | --- | --- | --- |
| Sui gas | $0.7753 per SUI | 0.214905 SUI | $0.1666 | 0.216921 SUI | $0.1682 |
| Walrus storage | $0.02693 per WAL | 0.054707 WAL | $0.0015 | 0.054404 WAL | $0.0015 |
| GonkaRouter inference | $0.0012 per million tokens | 156,207 tokens | $0.0002 | 62,969 tokens | $0.0001 |
| Web research | $0.0038 per credit | 11 credits | $0.0418 | 11 credits | $0.0418 |
| **Total** | | | **$0.2101** | | **$0.2115** |

Inference is by far the cheapest thing a verification does. Five independent AI
jurors researching a claim and voting on it cost a small fraction of a cent,
and the settlement around them costs orders of magnitude more. Most of that
settlement bill is not the protocol itself. It is the gas for the two Sui
transactions that every Walrus write needs.

| Share of one verification | Great Wall | Bitcoin |
| --- | --- | --- |
| Sui gas | 79.3 percent | 79.5 percent |
| Web research | 19.9 percent | 19.8 percent |
| Walrus storage | 0.70 percent | 0.69 percent |
| GonkaRouter inference | 0.09 percent | 0.04 percent |

## A second round

Neither settled claim split, so neither opened a debate, and no claim on the
current board has been through one. The money cost of a second round is
therefore not yet measured. What the code adds is countable from
[How a verdict happens](how-a-verdict-happens).

| Round two adds | Count |
| --- | --- |
| Debate turns, at most three exchanges of five debaters | up to 15 model calls |
| Table vote, one sealed no-tools vote per seat | 5 model calls |
| Phase-two evidence freeze, the frozen debate transcript | 1 transaction |
| Second-round seats, run approvals, commits and reveals | about 16 transactions |
| Round-two blobs, manifest, transcript and per-seat bundles | about 13 blobs, so 26 more Walrus transactions |

Round two runs no searches and opens no pages, so it adds no research credits.
On the shape above a split claim would cost roughly twice a settled one, with
the extra weighted the same way, mostly Walrus writes rather than inference.

## The entire run

The public board serves what the operator's record holds today. It served the
four claim records below when this page was written, on 2026-09-05 at 10:37Z,
and new verifications keep landing on it. Verifications that ran before the
operator reset that record on 2026-09-05 are no longer served by the API, so
the model tokens and research calls they spent cannot be recovered. Their gas
is not lost, because every transaction these keys ever sent is on chain, and
the sweep below reaches back to the first one a public node will still return.

Three groups of addresses pay for this deployment.

| Group | Addresses | What it signs |
| --- | --- | --- |
| Operator | 1 | Claim creation, the evidence freeze, the committee draw, the phase changes and the finalize |
| Walrus writer lanes | 4 | Every register and certify transaction, and they hold the WAL |
| Juror seat keys | 27 | One seat's run approval, its commitment and its reveal |

Sweeping all of them on 2026-09-05 gives the whole on-chain bill.

| Group | Transactions read | Not returned | Gas | First | Last |
| --- | --- | --- | --- | --- | --- |
| Operator | 2,204 | 1,790 | 13.314653 SUI | 2026-08-27T07:57:49Z | 2026-09-05T10:31:17Z |
| Walrus writer lanes | 313 | 0 | 1.112566 SUI | 2026-09-04T16:31:36Z | 2026-09-05T10:33:05Z |
| Juror seat keys | 965 | 425 | 0.696661 SUI | 2026-08-27T08:01:42Z | 2026-09-05T10:33:24Z |
| **Total** | **3,482** | **2,215** | **15.123881 SUI** | | |
| **Total in USD** | | | **$11.7255** | | |

That total is a floor, not a ceiling. The public JSON-RPC endpoint is a pool of
nodes and they do not all keep the same history, so a request for an old
transaction sometimes comes back empty. The sweep counts what it could not read
rather than guessing at it, and those transactions carry gas that is not in the
figure above. A node with full history would report more.

Walrus is charged per blob rather than per address, because the WAL a writer
lane spends was transferred to it by the operator first, and counting both
movements would count the same money twice.

Here is what the board itself has cost. The voided attempt is a real cost, and
so is the verification that settled without reaching a verdict.

| Claim | Outcome | Transactions | Gas | Blobs | Walrus | Model tokens | Research credits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Great Wall, attempt 1 | settled NO | 56 | 0.214905 SUI | 18 | 0.054707 WAL | 156,207 | 11 |
| Bitcoin, attempt 1 | voided on an invalid schema | 21 | 0.101759 SUI | 5 | 0.015112 WAL | not public | not public |
| Bitcoin, attempt 2 | settled YES | 56 | 0.216921 SUI | 18 | 0.054404 WAL | 62,969 | 11 |
| Minimum wage, attempt 1 | settled UNRESOLVED | 76 | 0.284174 SUI | 28 | 0.082702 WAL | 131,626 | 35 |
| **Total** | | **209** | **0.817759 SUI** | **69** | **0.206925 WAL** | **350,802** | **57** |

| The board in USD | Amount |
| --- | --- |
| Sui gas | $0.6340 |
| Walrus storage | $0.0056 |
| GonkaRouter inference | $0.0004 |
| Web research | $0.2166 |
| **Total for three verifications** | **$0.8566** |
| **Average per verification** | **$0.2855** |

A voided attempt shows no model tokens because its seats never revealed. Their
bundles are still sealed on Walrus, so the tokens they spent are real but not
public, and the page counts only what a reader can check. The gas and the blobs
of a void are public, and they are counted.

Five transactions put the contracts on chain and four of them are readable
today. They are already inside the operator's total above rather than
additional to it.

| One-off | Transaction | Gas |
| --- | --- | --- |
| Package publish | [`8MCKzNsM`](https://suiscan.xyz/testnet/tx/8MCKzNsM7tF3MVdzFLo9Z85CE8Gw83Tk5qC5CHS1KEPb) | 0.335447 SUI |
| Upgrade | [`Ah4TwG4A`](https://suiscan.xyz/testnet/tx/Ah4TwG4AoQtJYWrnrAKmwy4yzPbuzPVb6upFbn2GGJXN) | 0.316185 SUI |
| Jury diversity upgrade | [`CEH1M5Jc`](https://suiscan.xyz/testnet/tx/CEH1M5Jc9JNTrNdpRsBjnd5cJpv9K44mJt5Nd67n7rsd) | 0.345809 SUI |
| Current upgrade | [`2VJFrmqw`](https://suiscan.xyz/testnet/tx/2VJFrmqwAaLE5UR9xH8bhYAcxqNgfiuf4z8jBGUVFc3L) | 0.346452 SUI |
| Seal policy publish | `6LnGu71K` | not returned by the public node |
| **Total measured** | | **1.343894 SUI** |

Three more amounts sit on chain without being consumed, so none of them is a
cost of running the protocol.

| Locked or owed | Amount | Where it goes |
| --- | --- | --- |
| Seat stakes, twenty staked seats at the minimum | 2.000000 SUI | back to the staker on unstaking |
| Escrow, per claim | 0.010000 SUI | out as payout tickets when the claim settles |
| Jury rewards minted so far, three settled claims | 0.028500 SUI | already the stakers' money, waiting to be withdrawn |

## What a claim would need to cost

Two numbers set a price. The variable cost is what one verification consumes,
which the tables above measure. The fixed cost is hosting, the one estimate on
this page.

| Input to the price | Value |
| --- | --- |
| Variable cost, Great Wall | $0.2101 |
| Variable cost, Bitcoin | $0.2115 |
| Variable cost, the average of the two | $0.2108 |
| Fixed cost, hosting for the app and its database | $5.00 a month |

Spreading the hosting over a month of claims gives a break-even price. The last
column compares it with the escrow the operator locks into each claim today.

| Claims a month | Hosting per claim | Variable per claim | Break-even price | Break-even in SUI | Times today's escrow |
| --- | --- | --- | --- | --- | --- |
| 10 | $0.5000 | $0.2108 | $0.7108 | 0.917 SUI | 91.7 |
| 100 | $0.0500 | $0.2108 | $0.2608 | 0.336 SUI | 33.6 |
| 1,000 | $0.0050 | $0.2108 | $0.2158 | 0.278 SUI | 27.8 |

Those rows price a verification that settles on its first attempt. One that has
to be relaunched pays for the attempt that failed as well, and the board's own
record of that is in [The entire run](#the-entire-run).

### What the protocol charges today

| What | Value | Where it is written |
| --- | --- | --- |
| Price to whoever submits a claim | nothing | the operator creates and funds every claim |
| Escrow locked into a claim at creation | 0.01 SUI | the claim object's budget, from `OPENVERDICT_DEFAULT_COMMITTEE_BUDGET` |
| Protocol fee | 500 basis points of that escrow | `protocol_fee_bps` on the [registry object]({{registryUrl}}) |
| Protocol fee per settled claim | 0.0005 SUI | 500 basis points of 0.01 SUI |
| Jury reward per settled claim | 0.0095 SUI, split across the five seats | `settlement.move` |
| Treasury the fee is paid to | the operator's own address | `treasury` on the registry object |
| Ceiling the fee can be raised to | 2,000 basis points | `MAX_PROTOCOL_FEE_BPS` in `agent_registry.move` |
| Minimum stake per seat, refundable | 0.1 SUI | `MIN_STAKE_MIST` in `agent_registry.move` |

Nothing is charged to whoever submits a claim, so there is no revenue to set
against the table above. The escrow is the operator's own money, and the fee
ticket the finalize mints is paid to the operator's own treasury. The fee is a
parameter rather than a constant, set on chain with `set_treasury_policy` under
the ceiling above, so raising it changes how an escrow is split and not what a
submitter pays. Covering the break-even price would mean charging the
submitter, which this deployment does not do.

The gap is wide but the shape of it is encouraging. The expensive parts are the
settlement receipts, which shrink with batching and with fewer, larger blobs,
and the research credits, which fall on a bigger plan. The jury itself, the
part that does the actual work, is close to free.

## Recompute it

The tool that produced every table above is in the repository and reads only
public sources.

```bash
# one claim, native units only
pnpm cost:claim 0xd86526512ffcc78c3460064b46b56252d5d2d3adc69aedc24ad9c8325c81ac8c

# the same claim in dollars, at the rates this page used
pnpm cost:claim 0xd86526512ffcc78c3460064b46b56252d5d2d3adc69aedc24ad9c8325c81ac8c \
  --sui-usd 0.7753 --wal-usd 0.02693 \
  --gonka-usd-per-mtoken 0.0012 --firecrawl-usd-per-credit 0.0038

# every claim on the board
pnpm cost:claim --board

# the board plus every address that paid for it
pnpm cost:claim --run-total
```

The auditor that proves the claims themselves is a separate tool, and the
[audit guide](audit-guide) walks it end to end.

```bash
pnpm ov audit 0xd86526512ffcc78c3460064b46b56252d5d2d3adc69aedc24ad9c8325c81ac8c
```

Both tools read Sui through the JSON-RPC fallback in
`config/release.testnet.json`, which is a public endpoint that needs no key.

Five caveats belong with the numbers.

Prices move. SUI, WAL and the Walrus price per storage unit are all live
values, so a rerun will not match this page to the last digit. The native units
will match, because they are on chain.

Testnet tokens are free to obtain and worth nothing. The dollar columns are a
mainnet equivalent, not a bill anyone paid.

Gas on mainnet uses the same units and the same rules, so the MIST figures
carry over. The reference gas price does not, and a busy network charges more.

The board moves. Rerunning the board or the run total will find a different
set of claims, because verifications keep landing and the operator's record
can be reset.

The Firecrawl plan of this deployment is not public, so the research line is
the only component priced from a plan the page had to choose rather than read.
