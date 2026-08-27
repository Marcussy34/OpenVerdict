# OpenVerdict — Product Status Snapshot

> Last updated: 2026-08-27. Source of truth for claims below: the code and its
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

- Sui TESTNET package IS published (ids in `config/release.testnet.json`, publish digest `6RfnhZDHzk7NNNvCJqT5Cf2Z4aUjddbA6hJ9WsMe7ULL`), but the live-model canary has not completed green yet (operator gas exhausted — faucet round needed).
- Live GonkaRouter inference VERIFIED 2026-08-27: account catalog = deepseek-ai/DeepSeek-V4-Flash-0731, MiniMaxAI/MiniMax-M2.7, moonshotai/Kimi-K2.6 (3 families); real completion returned id `devshard-…` (the OpenAI-compatible endpoint id shape — preserved verbatim as the Gonka Request ID). Full live jury round runs at the testnet canary.
- No public URL yet: four Railway builds stuck at "scheduling on Metal builder" — needs a dashboard builder flip/retry.
- Frontend visual redesign (light + Sui blue, user-directed) in flight via a dedicated design agent.
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
