---
title: Limits
description: What the current deployment does not do, what is specified but not enforced, and what is on the roadmap.
order: 10
---

This page is the honest inventory. Everything here is disclosed in `README.md`
or `docs/STATUS.md` and reproduced rather than softened.

## Disclosed by design

- **The pipeline upstream of the commitment is trusted infrastructure.** The
  run attestor and evidence freezer are single, team-held capabilities.
- **No proof the model received exactly the recorded bytes.** Re-execution is
  soft corroboration until gateway-signed receipts land. See the receipt gap on
  the [trust model](trust-model) page.
- **Seal keys and salts are stored in plaintext** in the engine's Postgres on
  testnet. Encrypt at rest before any mainnet use.
- **Five LLM jurors are correlated** even across model families. Diversity
  constraints reduce shared failure modes; they cannot remove them.
- **DNS validation before a fetch leaves a residual rebinding window.**
  Production needs socket-level IP pinning.
- **The rate limiter is per instance and best effort.** A real deployment needs
  an edge limiter, and the limiter is only meaningful behind a trusted proxy.
- **Unaudited.** Capped, team-funded demo value only.

## Specified but not enforced

- **Slashing.** The bond exists and slashing for proven protocol violations is
  specified, but no Move module implements it.
- **No appeal mechanism.** UNRESOLVED is the only escape hatch.
- **Reputation counters are dead weight.** They initialise at 10000 basis
  points and nothing ever updates them.
- **Selection weight is a flat constant.** Every record registers at 10000 and
  only an admin capability can change it.
- **Roles have no behavioural effect** beyond the debate instructions and the
  committee diversity requirement.
- **Pooled and delegated stake is not on chain.** One staker per seat today.
- **Unstaking has no mid-claim rule.** Nothing observes an active seat, so an
  unstake can mature while a claim is open. There is also no builder, API route
  or UI for it: unstaking means hand-building the transaction.
- **Payout routing is never cleaned up on unstake.** The recipient dynamic
  field persists, so a profile keeps routing to the former staker.
- **The legacy bond withdrawal path still exists** and pays the operational
  owner, not the staker.

## Centralised today

- A single host runs the web app, all three engine workers and Postgres.
- The upgrade capability is held by one operator key, and the admin, pause,
  evidence and run attestor capabilities all went to the same publisher
  address at init.
- The operator key signs every lifecycle transaction and is also a gas wallet.
- **Every juror seat is run by the engine.** Operational signing slots come
  from a deterministic pool derived server-side, so the operational owner of a
  staked seat is an OpenVerdict-controlled key, not the staker's.
- Run approval is serialised on the operator's single gas coin and its
  capability, one transaction at a time.
- No content security policy header, because wallet extensions and the sign-in
  popup inject scripts.
- The dashboard is a rebuildable read-only projection, never authoritative.

## Testnet and demo only

- Live on Sui testnet only. Mainnet is gated on a funding decision.
- The demo tier is free and subsidised, a rate-limited subsidy rather than a
  business model.
- Public writes sit behind a flag plus rate limiting.
- Gas sponsorship degrades to wallet-paid gas when no key is configured.
- The prediction pool is a capped demo, and the direct fact-check budget is
  capped at one SUI.

## Structural caps

- The registry holds at most 32 eligibility records and the draw refuses a
  larger snapshot. The registry is already at 32, so a new agent means retiring
  an old one.
- The draw needs at least seven active records and gives up after 160 attempts.
- The gateway serves exactly three model families, so a fourth is not available
  yet.
- When one of the three is down for long enough to matter, the operator can
  lower the draw to two families in degraded mode. A jury of two families is a
  smaller jury, with more correlated failure than three, and every certificate
  and report drawn under it says so.
- Round two has not been exercised live under the current fixed window.
- The deliberation prompt is engine-only and sits outside the manifest hash
  chain, unlike the research and table-vote prompts.
- A container restart drops in-flight research and those seats fail closed, so
  deployments happen between claims.

## Roadmap

**Closing the trust gap**

- Gateway-signed receipts, so a reader can prove the bytes the model received.
- Attested execution in a Sui Nautilus enclave, which would also cover the
  pages the web returned.
- Multiple attestors replacing the single team-held run attestor and evidence
  freezer.
- Encrypting Seal keys and salts at rest, socket-level IP pinning, an edge rate
  limiter and a security audit before mainnet.

**Economics**

- A paid tier in SUI replacing the free demo tier, with the requester's payment
  funding the round's jury pool.
- Pooled stake: several stakers per seat sharing rewards pro rata after fees.
- Stake-weighted draws under a cap.
- Seat weights derived from on-chain track record, Brier-score based and
  recomputed after every settlement. This needs a registry update path that
  does not exist yet.
- A bounded accuracy bonus for certificate-aligned seats. Majority-only pay is
  explicitly rejected, because paying for agreement buys agreement.
- Sponsored juror commits and reveals, and sponsored operator lifecycle
  transactions.

**Decentralization**

- Self-hosted juror workers bringing their own gateway keys and paying their
  own inference.
- Independent operators with their own keys.
- A permissionless reveal entry after the deadline, which needs a new package
  version and extended parity vectors.
- Walrus Sites for a fully independent verifier.

Explicitly not worth doing now: DeepBook, Kiosk, a bridge, a GraphQL indexer
and passkey wallets.

## Documentation drift to be aware of

Three inconsistencies survive in the repository and are worth knowing before
you cite a number from it:

- Test counts disagree between `README.md` and `docs/STATUS.md`.
- Three statements about a per-staker cap in the draw survive in `docs/PRD.md`
  and in the repository's agent guide. They are superseded: there is no cap per
  staker.
- `docs/STATUS.md` carries a last-updated date earlier than some of its own
  entries.

Where these pages and those files disagree, these pages follow the code.
