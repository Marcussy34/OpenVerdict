# OpenVerdict — agent guide

Decentralized intelligence verification engine: GonkaRouter AI juries,
coordinated and settled on Sui, evidence on Walrus. Spec of record: `PRD.md`
(§1.1 lists where code corrected spec). Current state: `docs/STATUS.md`.
Plan: `docs/superpowers/plans/2026-08-26-openverdict-build.md`.

## Commands

```bash
pnpm test          # vitest (lib/**, cli/**, workers/**, tests/**)
pnpm test:move     # sui move test (cd move/openverdict)
pnpm typecheck && pnpm lint && pnpm build
pnpm dev           # observer on :3000
pnpm cli -- --help # openverdict CLI (tsx)
pnpm e2e:localnet  # full localnet lifecycle (spawns `sui start`)
```

## Hard rules

- The u8 state/outcome codes in `lib/protocol/constants.ts` and the Move
  modules are a SHARED WIRE CONTRACT — never renumber either side alone.
- `computeVoteCommitment` (TS) and `jury::compute_commitment` (Move) must stay
  byte-identical; the parity vectors in `tests/integration/parity.test.ts` +
  `move/openverdict/tests/parity_tests.move` enforce it — extend both together.
- `lib/engine/contract.ts` is the seam between engine and consumers (API/CLI/
  UI). Change it deliberately and update all three sides.
- ESM everywhere; `@noble/hashes` v2 subpaths need `.js` suffixes.
- `@mysten/sui` is v2 (`SuiGrpcClient`, `$kind` result unions, `getObject`
  throws when missing) — do not write v1 (`SuiClient`) API calls.
- Models never fetch, never hold keys or transaction authority; every URL they
  see or open is engine-executed and recorded in the sealed run transcript;
  salts and seal keys never leave the engine; malformed model output or an
  unverifiable citation must never become a vote (fail closed).
- The observer has NO signer and no mutation endpoints beyond the two guarded
  public POSTs; keep it that way.
- zkLogin is authentication / one-account-one-seat backing — never describe it
  as proof of personhood (PRD §14.4).
- Move: functions taking `&Random` must be private `entry fun`; draw-and-
  resolve in one call.
- Icons: iconsax-react in app-level code (not lucide). shadcn/ui + Tailwind
  utilities; no custom CSS files.
- Everything inside a run bundle (attempts, hedges, repairs, transcript) is
  part of the sealed core and of the public record; never strip or rewrite
  it. Prompt specs and tool policies are hashed into on-chain manifests:
  never change a published version's text, add a new version.
- The Seal escrow of a reveal key is insurance: its failure is logged and
  never costs a seat; votes still fail closed on any unverifiable output.
- Deploy only between claims: a container restart drops in-flight research
  and those seats fail closed.
- Two hosts, one deployment: openverdict.info is the landing, app.openverdict.info
  the console. `proxy.ts` + `lib/web/host-routing.ts` own the rules (www to
  apex, apex console paths to the app host, app root to `/app`); they are
  no-ops without `NEXT_PUBLIC_APP_URL`. `NEXT_PUBLIC_*` values are Dockerfile
  build ARGs: add a new one there or it never reaches the client bundle.
- Move or SDK work: load the `sui-dev-skills` skill first (Mysten's
  conventions for Move 2024 and `@mysten/sui` v2). The Seal policy package
  lives in `move/openverdict_seal` (`sui move test` there too).

## Layout

See the Repository layout section in `README.md`. Ownership seams the build
used (protocol/gonka/research/evidence/walrus/seal/sui/storage/events/engine/
verify/cli/workers/app) still make good boundaries for parallel work.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
