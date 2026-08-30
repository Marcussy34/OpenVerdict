# Sui stack map for OpenVerdict (2026-08-30 evening)

The owner asked how the rest of the Sui stack can serve the product. This is
the inventory: what is already in use, what is worth adding and why, what is
not worth it. Facts come from the repo, the Mysten `sui-dev-skills`, and the
package inventory on npm; items marked "verify" need a docs read once the
Firecrawl key is available.

## Already in use

- Sui Move package (jury, claims, registry, settlement, evidence), on-chain
  randomness (`&Random`, private entry draw-and-resolve), Clock deadlines,
  dynamic fields, capabilities (AdminCap, PauseCap, EvidenceCap,
  RunAttestorCap), Object Display for certificates, agent profiles and
  positions (`display_meta.move`, Publisher claimed at init).
- Walrus (testnet): every claim statement, evidence page, sealed run bundle,
  revealed bundle and agent manifest document is a Walrus blob cited on
  chain.
- zkLogin: the "Continue with Google" registration path for human-backed
  agent profiles (authentication, never proof of personhood), with Enoki
  in the dependency set; operator-sponsored transactions exist in
  `lib/sui/sponsor.ts`.
- SDK v2 (`SuiGrpcClient`), dApp Kit React for the wallet button.

## Worth adding, in order

1. Seal escrow of reveal keys (designed in
   `2026-08-30-seal-escrow-design.md`, building now): sealed bundles become
   openable by anyone after the reveal deadline through Seal's key servers,
   so committed evidence can no longer be lost with the engine. One small
   policy package, no change to the vote path.

2. Walrus Sites for the independent verifier (verify): host the client-side
   verifier (hash checks, sealed-core check, Seal recovery) as a Walrus
   Site so the tool that checks us does not run on our server. Needs the
   `site-builder` binary and a static build of the verify page; the page
   would fetch proofs from the observer or accept pasted bundles (it does
   both today). Verify: current site-builder release and testnet portal.

3. Nautilus attested engine (owner deferred): the AWS Nitro "prompt
   forwarder" that signs what was sent to GonkaRouter and what came back,
   verified on Sui. Needs an AWS account; two to four days.

4. Move Registry (MVR) name for the package (for example
   `@openverdict/core`), so transaction targets and manifests read as
   names instead of a 64-hex id; the SDK resolves MVR names automatically
   in v2. Cosmetic but cheap. Verify: testnet MVR registration flow.

5. SuiNS names for the operator and jurors (`openverdict.sui` on testnet,
   `deepseek-1.openverdict.sui` and so on) so explorers and the run view
   show names next to addresses (`@mysten/suins` 2.0.2, `nameService`
   reverse lookup in the gRPC client). Cosmetic; a few transactions.

6. Enoki sponsored transactions for human submitters and challengers
   (already sponsored by the operator key today): switching to Enoki
   moves gas to a managed gas station with rate limits and an app key;
   worthwhile when public writes open beyond the demo allowlist.

7. Permissionless reveal (protocol change on top of the Seal escrow): a
   jury.move entry that lets anyone reveal a committed seat after the
   deadline with the values recovered from the sealed bundle, so a slow
   operator lane never loses a vote. Needs a new package version and the
   parity vectors extended; plan it with the next Move upgrade.

## Not worth it now

- DeepBook, Kiosk, Bridge: no asset market or NFT trading in the product.
- GraphQL indexer: the observer's own Postgres already indexes what the UI
  needs; revisit when third parties want to query verdicts at scale.
- Passkey wallets: nice for submitters later; zkLogin already covers the
  no-seed-phrase story for the demo.
