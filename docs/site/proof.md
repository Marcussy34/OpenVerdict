---
title: See for yourself
navTitle: Proof
description: One settled claim walked link by link from the Move package to the model receipts, every step on a public explorer, none of it served from our database.
order: 3.5
---

Everything on this page is a link a judge can click. The ids belong to one real
claim on Sui testnet, "Humans use only ten percent of their brains.", which
settled on 2026-09-03 as NO with a Truth Score of 2.00. Objects open on
SuiVision, transactions on Suiscan, files on the Walrus aggregator, and model
receipts on GonkaRouter's public endpoint, which needs no login. The
[audit guide](audit-guide) walks the same claim through the recomputation; this
page only shows where the record lives.

## The contracts

| What | Link |
| --- | --- |
| Move package, current version | [`0xee51ceb6…`](https://testnet.suivision.xyz/package/0xee51ceb63c64d2f375b38af711701160e83e41b203debe9cc3f1bd8b3da90fcf) |
| Package version this claim ran on (an earlier upgrade) | [`0x15c6e53c…`](https://testnet.suivision.xyz/package/0x15c6e53ce00b814c68eed17a056cce13dc59416418500a0f4dbba73fac530f65) |
| Original package address, the type prefix on every object | [`0xa9f3c2db…`](https://testnet.suivision.xyz/package/0xa9f3c2dbdfad3ff900b9d2f4df605621d619a9e7575034f508eb5d39263c5bc7) |
| Seal time-lock policy package | [`0xf54eb611…`](https://testnet.suivision.xyz/package/0xf54eb61116372f8506ca332457b2fee61231a559e44923429f54fab355d0f0c5) |
| Juror registry, a shared object holding the fee, the minimum stake and every eligible seat | [`0x4020f3cb…`](https://testnet.suivision.xyz/object/0x4020f3cbe51c1cdf6d004696e7cdf0d19f67fde2572b72a5f39a51d119f8ebab) |

Sui keeps the original package address in every object type across upgrades,
so an old claim stays readable after each new version.

## The claim, step by step on Sui

| Step | Link |
| --- | --- |
| The claim object, with its deadlines and escrowed budgets | [object `0x273220b5…`](https://testnet.suivision.xyz/object/0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6) · [creation transaction](https://suiscan.xyz/testnet/tx/VLrd2pKXsN89XFgR1KDj2MHVA5HKsFVDe79yx51MyoW) · [in the app](https://app.openverdict.info/claims/0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6) |
| The jury drawn with `sui::random` | [transaction `tirSffTy…`](https://suiscan.xyz/testnet/tx/tirSffTyp91svMB5geYqYv1hDAvPsyAPWpsQTLZUCKM) · [committee object](https://testnet.suivision.xyz/object/0xcb8560e363f87e690ef55e1a7d4d49c039cc0efe8b43179e1b49e36dfcfe39b6) |
| The evidence root frozen before any reasoning (immutable object) | [object `0xad34aa81…`](https://testnet.suivision.xyz/object/0xad34aa81f48e0ca2756cbf7db7785b9097152f61229ef9ee7251d582608f2805) · [freeze transaction](https://suiscan.xyz/testnet/tx/2scmEgKxrHj9iFBcfhu1Y1JR7nxSHVh6J59H7EgYwBqX) · [manifest on Walrus](https://aggregator.walrus-testnet.walrus.space/v1/blobs/T9-7bdVdYwexoURkc5SSDQfJ59KEFqdH3G0SEeSVQnk) |
| Juror 1's run hash and sealed bundle pinned on chain before its vote | [transaction `FKDaAKuk…`](https://suiscan.xyz/testnet/tx/FKDaAKuki8Hsjk1ZiYvvm4WTQjiKMoWiTsVgdXxqbWaE) |
| Juror 1's sealed vote, a blake2b-256 commitment and nothing else | [transaction `Fgc3kP5b…`](https://suiscan.xyz/testnet/tx/Fgc3kP5b2zaidMT4geQLf2pUesPb5mgPFhUsJkhisXm9) |
| Juror 1's reveal, recomputed by Move and frozen as a RevealedVote | [transaction `2a8Pg3xU…`](https://suiscan.xyz/testnet/tx/2a8Pg3xUHeheVGV7xFRK1XaSjRBujMnbwQbvBKc9dcho) · [object `0xea1afadf…`](https://testnet.suivision.xyz/object/0xea1afadf2dbc5de23e7829f967fdf68606aa6c79b6ed19939d21c22930b3d291) |
| The resolution certificate, immutable, result NO, 200 basis points | [object `0x42954c91…`](https://testnet.suivision.xyz/object/0x42954c917d0b7e34cb4634091a5ece1921a89a931f4872f690971b62fdcee706) · [finalize transaction](https://suiscan.xyz/testnet/tx/572tT7FGmL6FG3ZEzf2DkorPzaStVymnvxNVMgF2bkXi) |

The finalize transaction also mints the payout tickets, five jury rewards of
1,900,000 MIST and one protocol fee ticket of 500,000 MIST. The JurySeat
objects themselves are consumed at reveal, which is why the reveal links to the
RevealedVote and not to a seat.

## The jurors' work on Walrus

Each juror's sealed bundle was published before its commit, and the plaintext
bundle was published at reveal. The plaintext holds the exact prompt, the
model's reply, the research transcript and the gateway ids.

| Juror | Model | Sealed bundle | Revealed bundle |
| --- | --- | --- | --- |
| 1 | DeepSeek V4 Flash | [`v17mZYbl…`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/v17mZYblTP61eNT0ZXh0MVIUm0CmAkdV7dgKIT8jWu4) | [`Fj6fvRo1…`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/Fj6fvRo1hcWF2-vqcq6-3QvSvL8dQZkmni4N8YFVsAU) |
| 2 | DeepSeek V4 Flash | | [`i1kpXtoM…`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/i1kpXtoM_1ARthwkXY6VOmPoVghAlK0OBWZY3WFyVxg) |
| 3 | MiniMax M2.7 | | [`7ojXvH1a…`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/7ojXvH1aRhP3EkKB4AE9FrifbZcj9daAuBZi4pnETow) |
| 4 | MiniMax M2.7 | | [`-luVHOzV…`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/-luVHOzV3cCDQ3LXE1h4GozaBIeFNmMvl9d9AegbD2w) |
| 5 | Kimi K2.6 | | [`vb_I9Dgk…`](https://aggregator.walrus-testnet.walrus.space/v1/blobs/vb_I9Dgk-H2XK3ju-CWaRqhtLBmGJAZW3VKr_zc_M2U) |

## The model receipts on Gonka

Every inference returned a gateway request id. Each one resolves at
GonkaRouter's public receipts endpoint with no credentials and reports the
model, the executing devshard, the timing and the outcome. The same ids are
inside each juror's run hash on Sui, so they were committed before the votes
were revealed.

| Juror | Model | Devshard | Receipt |
| --- | --- | --- | --- |
| 1 | DeepSeek V4 Flash | 70083 | [`req-…322552`](https://api.gonkarouter.io/v1/receipts/req-1788405572969008592-322552) |
| 2 | DeepSeek V4 Flash | 70083 | [`req-…322716`](https://api.gonkarouter.io/v1/receipts/req-1788405644080853952-322716) |
| 3 | MiniMax M2.7 | 69838 | [`req-…322507`](https://api.gonkarouter.io/v1/receipts/req-1788405558293151563-322507) |
| 4 | MiniMax M2.7 | 69974 | [`req-…322603`](https://api.gonkarouter.io/v1/receipts/req-1788405589541212346-322603) |
| 5 | Kimi K2.6 | 70076 | [`req-…323242`](https://api.gonkarouter.io/v1/receipts/req-1788405913983739329-323242) |

Three model families, four distinct executing hosts, five public receipts.

## Stakes and sponsored gas

| What | Link |
| --- | --- |
| A seat opened by a wallet with a real 0.1 SUI stake | [profile `0xc32aa5db…`](https://testnet.suivision.xyz/object/0xc32aa5db303d2d479133cd8476afedf1fa8f4eac1241bd90b57a3fb2723d6037) |
| Gas paid by Shinami's gas station, not by the user | [transaction `9ToB29r3…`](https://suiscan.xyz/testnet/tx/9ToB29r3WWJv7odpai4HkTMjjccmu3aCndrxEAoViGjw) |

## Recompute it

Open [app.openverdict.info/verify](https://app.openverdict.info/verify) and paste
the claim link, or run the auditor from a terminal:

```bash
pnpm ov audit 0x273220b56d87edea0a6db35f85c0fc8f36591461ee6be6962e86bb4586ee4ac6
```

On 2026-09-05 that passed 111 of 111 checks, every commitment rebuilt from the
revealed fields, every run hash rebuilt from the bundle, every receipt matched,
and the certificate's score reproduced from the votes. The
[audit guide](audit-guide) explains each check.
