# Seal escrow for run bundle reveal keys (design, 2026-08-30 evening)

Status: designed by the lead under the owner's standing delegation; the
owner asked "what about Seal, do we have any use for it?" and this is the
answer plus the plan. Sources: the `@mysten/seal` 1.4.6 package (its shipped
`docs/index.md` and type definitions, unpacked locally), the Mysten
`sui-dev-skills` (Move 2024 and SDK v2 conventions), and our own code. The
Seal documentation site (seal-docs.wal.app) could not be re-read tonight;
the two facts taken from memory are marked "to confirm".

## What our "sealing" is today, and what Seal is

Today every juror run bundle is sealed by the engine with AES-256-GCM under a
random per-run key (`lib/engine/runBundle.ts`, `SealedRunBundleV2`). The
sealed blob goes to Walrus before the commit; the commitment binds the bundle
core; at reveal the engine publishes the key (`RunBundleSeal.keyHex`) and the
verifier decrypts the sealed blob and compares it with the revealed core.
This is our own envelope encryption, not Mysten's Seal.

Mysten Seal is decentralized secrets management: identity-based threshold
encryption (Boneh-Franklin over BLS12-381) where independent key servers
release a decryption key for an identity only when an on-chain Move policy
(`seal_approve*`) approves the request, evaluated by dry-running a
transaction. The SDK: `SuiGrpcClient(...).$extend(seal({serverConfigs}))`,
`client.seal.encrypt({threshold, packageId, id, data, aad})` returns the
encrypted object and "the 256-bit symmetric key that was used, usable for
backup"; `SessionKey.create({address, packageId, ttlMin, signer, suiClient})`
plus `client.seal.decrypt({data, sessionKey, txBytes})` where `txBytes` call
the policy. Testnet key servers named in the SDK guide: committee-mode
`0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98` through
`https://seal-aggregator-testnet.mystenlabs.com`, and the independent server
`0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75`.
Verified on chain 2026-08-30 23:05 with `SealClient.getKeyServers()` (probe
script node_modules/.cache/seal-servers.mts): the committee server answers
through the aggregator, the independent one is `mysten-v1-1` at
`https://seal-key-server-testnet-1.mystenlabs.com`, both key type 0, public
keys fetched. From the developer Mac only the public JSON-RPC endpoint
reaches the objects (`fullnode.testnet.sui.io` fails locally); the Railway
container reaches the fullnode, and browsers do too.

## The use we have for it

The weakness Seal removes: today the reveal key exists only inside the
engine until the juror's reveal transaction. If the engine dies, the operator
lane stalls, or a seat misses the reveal window, the sealed bundle on Walrus
stays sealed forever and the seat's evidence is lost, even though it was
committed on chain. With Seal the key is also escrowed under a time-lock
policy, so after the phase's reveal deadline anyone can obtain it from the
key servers and open the sealed bundle without us. "Sealed until the
chain says the phase is over" becomes a rule enforced outside the operator.

What it does not change: the engine still holds the plaintext (it produced
it), votes are still revealed by agent-signed transactions, and the hash
checks are untouched. Early disclosure by a misbehaving key server would
only expose a sealed juror bundle before its reveal, which cannot influence
the other seats (they run inside the same engine and are bound by their own
commitments), so a low threshold is acceptable on testnet.

## Design: escrow the AES key, keep everything else

1. Identity. For run `(claimId, jurySeatId, phase)` the Seal identity bytes
   are `bcs(claimId as address) || bcs(jurySeatId as address) || bcs(phase
   as u8) || bcs(deadlineMs as u64)` where `deadlineMs` is the claim's
   reveal deadline for that phase (`firstRevealDeadlineMs` or
   `secondRevealDeadlineMs`). The SDK takes it as a hex string `id`; the
   full Seal identity is the policy package id followed by these bytes.

2. Policy package `openverdict_seal` (new, tiny, separate from the main
   package so nothing on the vote path changes):

   ```move
   module openverdict_seal::reveal_lock;

   use sui::bcs;
   use sui::clock::Clock;

   #[error]
   const ENotYetOpen: vector<u8> = b"the reveal deadline in this identity has not passed";
   #[error]
   const EMalformedIdentity: vector<u8> = b"identity must be claim, seat, phase, deadline";

   /// Seal policy: the key for an identity is released once the reveal
   /// deadline encoded in it has passed. The claim and seat ids only make
   /// the identity unique; the verifier binds them to the run off chain.
   entry fun seal_approve(id: vector<u8>, clock: &Clock) {
       let mut cursor = bcs::new(id);
       let _claim = cursor.peel_address();
       let _seat = cursor.peel_address();
       let _phase = cursor.peel_u8();
       let deadline_ms = cursor.peel_u64();
       assert!(cursor.into_remainder_bytes().length() == 0, EMalformedIdentity);
       assert!(clock.timestamp_ms() >= deadline_ms, ENotYetOpen);
   }
   ```

   To confirm against the Seal docs: the policy function must be named
   `seal_approve*`, take the identity bytes as its first parameter, abort
   when access is denied, and be evaluated by dry run (no side effects);
   the transaction sent to the key servers is built with
   `onlyTransactionKind: true`. These match the SDK guide's shape.

3. Engine (commit path, `engine.ts` around `sealRunBundle`): after sealing,
   `client.seal.encrypt({threshold, packageId: seal.packageId, id, data:
   keyBytes, aad: utf8(runId)})` and store the escrow inside the sealed
   bundle document: `SealedRunBundleV3 = SealedRunBundleV2 & { escrow: {
   provider: "seal", packageId, identityHex, deadlineMs, threshold,
   keyServers: [{objectId, weight, aggregatorUrl?}], encryptedObjectBase64
   } }`. The core hash, the commitment and every existing verifier check
   are unchanged; the escrow rides along in the sealed blob that the chain
   already cites. If Seal encryption fails (key servers unreachable) the
   engine logs and seals without escrow: the escrow is insurance, never a
   reason to lose a seat (fail open for the escrow only, fail closed for
   everything else, as today).

4. Configuration (`config/release.testnet.json`, `lib/sui/manifest.ts`):
   `seal: { packageId, threshold: 1, keyServers: [committee server via the
   aggregator, independent server] }`; localnet keeps `seal` absent (no
   escrow). Threshold 1 of 2 favours recoverability on testnet; mainnet
   would use 2 of 3 or more.

5. Verifier (`lib/verify/run-proof.ts`): a new check `sealEscrow` for
   sealed bundles that carry an escrow: identity decodes to this run's
   claim id, seat id and phase, the deadline equals the claim's reveal
   deadline for the phase (the proof route adds `claimDeadlines`), the
   package id and key servers match the release manifest, and the
   encrypted object parses (`EncryptedObject.parse`) with the same package
   id and identity. Bundles without escrow keep verifying as before.

6. Recovery (run view and /verify): "Open through Seal" button, enabled
   after the deadline. The browser makes an ephemeral Ed25519 keypair (no
   funds needed; the policy ignores the caller), creates a `SessionKey`
   for the policy package, builds the `seal_approve` transaction with the
   identity and the clock, calls `client.seal.decrypt`, gets the key,
   decrypts the sealed bundle locally and shows the core. If the seat was
   revealed, the recovered key must equal the revealed key (shown as a
   check); if the seat never revealed (the case that matters), the reader
   still sees the sealed juror's full research and verdict.

## What it proves and costs

Proves: a committed seat's sealed bundle is always openable after the
deadline by anyone (availability of evidence no longer depends on us), and
the sealed-until-deadline rule is enforced by independent key servers
reading the chain. Costs: one Seal encryption per run (local BLS work, no
transaction), one small Move package publish (cents of testnet SUI), about
a day of work; the browser bundle grows by the Seal SDK. Risk: testnet key
server availability affects only recovery, never the live flow.

## Later, on the same foundation

- Permissionless reveal: a Move entry that lets anyone reveal a committed
  seat after the deadline by supplying the decrypted salt and outcome (they
  are inside the sealed bundle), so a slow operator lane never loses a
  vote. Needs a jury.move change and a protocol version.
- Private submitter evidence: encrypt submitted evidence for the committee
  only until the reveal (same policy, different identity).

## Rollout

Move package build and test (`sui move build`, `sui move test`), publish on
testnet from inside the container with the operator key, record the package
id in the release manifest, deploy, run a claim, verify a run's escrow with
the local verifier, then open a revealed run through Seal from the browser
and compare the recovered key with the revealed one; finally open an
unrevealed (lost) seat of an older claim to demonstrate recovery.
