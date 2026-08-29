# OpenVerdict — Product Status Snapshot

> Last updated: 2026-08-29. Source of truth for claims below: the code and its
> test suites (`pnpm test`, `pnpm test:move`), not this file.

## What the product is right now

A complete, tested implementation of the OpenVerdict verification engine —
Sui Move protocol, TypeScript engine + CLI, and read-only observer — running
end-to-end against a fake (deterministic) inference adapter, with the localnet
operational proof and public deployments in flight.

## Layer inventory

| Layer | Where | State | Evidence |
| --- | --- | --- | --- |
| Protocol (Move) | `move/openverdict` — 8 modules: agent_registry, claim, evidence, jury, settlement, demo_fact_checker, demo_binary_pool, display_meta | ✅ | 66/66 `sui move test`; commit–reveal enforced on-chain; immutable certificates; one-time payout tickets; Object Display metadata |
| Cross-language contract | `lib/protocol` + `tests/integration/parity.test.ts` + `tests/parity_tests.move` | ✅ | 6 blake2b256/BCS vectors asserted byte-identical in BOTH suites |
| Inference adapter | `lib/gonka` | ✅ | Live-verified GonkaRouter API (4096-token cap, `msg_…` ids, visible retries, redaction); deterministic fake for offline juries |
| Evidence pipeline | `lib/evidence`, `lib/walrus` | ✅ | SSRF suite (DNS-first, per-hop revalidation, streaming caps); Merkle manifests; local + SDK Walrus stores + retention |
| Engine | `lib/engine` (contract.ts seam), `lib/sui` (builders per entry point, SuiGateway + fake), `lib/storage` (drizzle/pglite/pg), `lib/events` (phase-gated serializer) | ✅ | Full lifecycle: direct review + optimistic; 234/234 vitest incl. engine lifecycle + zkLogin registration tests over FakeSuiGateway |
| CLI | `cli/` (`openverdict`, PRD §27.3 surface) | ✅ | `--json` NDJSON, preflight prints, stable exit codes |
| Workers | `workers/` | ✅ | evidence / inference / resolution loops, graceful shutdown |
| Observer + fact-check UI | `app/`, `components/` — 23 routes | ✅ | Builds/typechecks/lints; SSE with resume; strict pre-reveal redaction; client-side `/verify` |
| API guards | `app/api/_lib/guard.ts` | ✅ | Operator bearer token, public-write flag, trusted-proxy-gated rate limits |
| Wallet + zkLogin onboarding | `components/wallet`, `components/agents` | ✅ | dapp-kit v2 + Enoki (env-gated); zkLogin-backed agent registration (T7b): SDK signature verification, blake2b backing hash, one-social-account-one-seat, guarded POST /api/agents/register |
| Localnet E2E + sponsorship | `scripts/localnet-e2e.ts`, `scripts/cockpit-demo.ts` | ✅ | `pnpm e2e:localnet` exits 0 (3 lifecycle paths, sponsored deposit, CLI parity, recomputed Truth Score); cockpit harness leaves a finalized + a sealed claim live for the observer |

## What is NOT true yet

- Live testnet canary COMPLETE (2026-08-27): full lifecycle with live GonkaRouter juries — 5/5 SCHEMA_VALID across 3 model families, YES @ 9700 bps recomputed == on-chain, certificate `0x8efdabe0…1a8634` (see docs/demo/runbook.md table).
- Live GonkaRouter inference VERIFIED 2026-08-27: account catalog = deepseek-ai/DeepSeek-V4-Flash-0731, MiniMaxAI/MiniMax-M2.7, moonshotai/Kimi-K2.6 (3 families); real completion returned id `devshard-…` (the OpenAI-compatible endpoint id shape — preserved verbatim as the Gonka Request ID). Full live jury round runs at the testnet canary.
- Multi-process production stack PROVEN 2026-08-28: a claim submitted through
  the public API/form reached a SCORED verdict fully worker-driven — 5/5
  commits + reveals, round-1 threshold, certificate `0x76264101…` on localnet
  in under 4 minutes. Getting there fixed a six-layer concurrency stack
  (commits f313c2e…fe1b6a1): advisory-lock tick serialization, cross-process
  profile→signer self-healing, stale-gas retry, per-claim worker error
  isolation, in-gateway approveRun serialization (previously only the E2E
  harness proxy had it), and factory-rebuilt transaction retries.
- PUBLIC AND LIVE 2026-08-29 on Vercel at https://openverdict.info (apex and
  www both serve; Neon Postgres attached). `/api/status` reports suiHealthy,
  gonkaMode live, walrusMode testnet, dbHealthy. Seven jurors bound and
  verified 7/7 against chain. Railway abandoned in favour of Vercel. Five
  stacked deploy faults fixed to get there: see docs/CHECKPOINT-2026-08-29.md.
  Not yet proven: a claim run end-to-end through the HOSTED app.
- Landing redesign v3 SHIPPED 2026-08-28 (Sharplink-style: Archivo type,
  #0E76FF/#F3F3F3, globe hero docking into a live stat card, sticky protocol
  stack, FAQ, footer claim form + rising wordmark; commit 83322e1).
- Unaudited; hackathon-grade trust model (single run-attestor + evidence-freezer capabilities, documented).

## Keys only the user can provide

| Key | Unlocks |
| --- | --- |
| `GONKA_ROUTER_API_KEY` | Live multi-model juries + real Gonka Request IDs (submission requirement) |
| `NEXT_PUBLIC_ENOKI_API_KEY` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | "Continue with Google" social onboarding |
| Mainnet funding decision | Mainnet canary (testnet is the demo network until then) |

## Diagrams

`docs/diagrams/` — architecture, claim lifecycle, jury round, onboarding tiers.
All black-and-white with paired light/dark exports; sources are `.excalidraw`.

## Plan of record

`docs/superpowers/plans/2026-08-26-openverdict-build.md` (status ledger at top).
Spec of record: `PRD.md` (see §1.1 implementation addendum for where code
corrected spec).
