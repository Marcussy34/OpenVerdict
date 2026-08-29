# Session checkpoint — 2026-08-29 (pre-compaction #4, supersedes 08-28)

> Resume map. Repo is the source of truth; this file is the index.
> **THE BIG CHANGE: production is LIVE and healthy at https://openverdict.info.**
> Active work at compaction: an UNFINISHED brainstorm on consolidating 15
> routes to 7 (see "UX consolidation" below — designed, NOT approved, NOT
> started). User has ~1 week left, has NOT yet reviewed what was built, and
> explicitly wants architecture/functionality changes and possible pivots to
> stay on the table. Do not treat the current build as settled.
> Companions: docs/STATUS.md, docs/demo/runbook.md, CHECKPOINT-08-27/08-28.

## Production is live (tip 94a9a37)

```
https://openverdict.info          200, apex + www both serve (NO redirect between them)
/api/status  suiHealthy ✓ gonkaMode live walrusMode testnet dbHealthy ✓ paused false
/api/agents  7 jurors, 3 model families
/api/claims  200, docket empty (no claim has run through the hosted app yet)
```

- Domain `openverdict.info` bought, NS delegated to Vercel (`ns1/ns2.vercel-dns.com`),
  verified at the `.info` registry. Both apex and `www` attached + verified.
- Vercel project `open-verdict`, team `marcus-tans-projects-0956f18f`,
  stable alias `open-verdict-nine.vercel.app`.
- Neon `neon-teal-book` provisioned + connected (prod/preview/dev), injects a
  real `DATABASE_URL` (us-east-1 pooler). Migrations self-run at engine.ts:138.

## The 5 stacked deploy faults fixed tonight (each hid the next)

| Commit | Fault |
|---|---|
| `152f5b1` | Five distinct wiring failures collapsed into one opaque `engine_not_wired` 503. Now logged server-side. **This is what made everything else diagnosable — keep it.** |
| `065fadb` | `??` treats a blank env var as a real value. Vercel stores value-less vars as `""`, so `OPENVERDICT_RELEASE_MANIFEST=""` reached `existsSync("")`. Added `readEnv()` (blank/whitespace = unset) + 4 tests. Also gitignored `.vercel/`. |
| `06dc288` | Manifest path arrives at runtime, so Next's tracer never bundled `config/release.testnet.json`. Added `outputFileTracingIncludes: {"/*": ["./config/*.json"]}`. |
| `4662347` | `/* webpackIgnore: true */` on the `@mysten/walrus` dynamic import hid it from the tracer → "Cannot find package". Dropped it, added to `serverExternalPackages`. |
| `6fd98b6` | PGlite fallback mkdir'd on a read-only serverless root (`EROFS /var/task/.pglite`). Added `PGLITE_DATA_DIR` override. |
| `94a9a37` | `buildServerEngine` passes NO `initialAgents`, so a hosted deploy could never have jurors and any draw died on "live mode requires the registered manifest". New `scripts/seed-testnet-agents.ts`. |

## Agent seeding — VERIFIED against chain, do not redo

`scripts/seed-testnet-agents.ts` reads the 7 AgentCaps already registered on
testnet under the deterministic owners from `OPENVERDICT_AGENT_SEED` and writes
matching manifests into Neon. **Registers nothing, spends no SUI.** Canonical
cap per owner = lowest objectId (agrees with testnet-canary.ts + prune-registry.ts).

Verified 7/7 against `sui_getObject`: owner address, `manifest_hash`,
`model_hash`, `role_hash`, `human_backing_hash`, object type, `active:true`
all match. Split: 3× DeepSeek-V4-Flash (SOURCE_AUTHENTICITY), 2× MiniMax-M2.7
+ 2× Kimi-K2.6 (SKEPTIC). Satisfies minDistinctModels 3 / maxSeatsPerModel 2.

**Known placeholders in the seeded manifests** (local metadata, no on-chain
counterpart): `registeredAtMs` = seed time not real registration time;
`registeredCheckpoint: 0`; `publicKey` holds the owner ADDRESS not a key
(mirrors testnet-canary.ts). Also `reputation: {}` was stored while chain
carries real values (all 10000 bps, resolved_runs 0) — offered to fix, user
did not take it up.

## zkLogin / Google / Enoki — state

- Google OAuth client configured by the user. Origins (no trailing slash) and
  redirect URIs (WITH trailing slash) both cover: `http://localhost:3000`,
  `https://open-verdict-nine.vercel.app`, `https://openverdict.info`,
  `https://www.openverdict.info`. Enoki portal has the same 4 origins.
- **UNCONFIRMED, ASK THE USER:** whether Google Auth Platform → Audience was
  switched from *Testing* to *In production*. In Testing only ≤100 explicitly
  listed test users can sign in AND consent expires every 7 days. Publishing
  is one click with no review because zkLogin requests only `openid`
  (non-sensitive). Unverified apps still show the "Advanced → Go to" screen
  and cap at 100 new users. Also unconfirmed: whether Enoki's Save was pressed.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is now BAKED into the production bundle
  (verified by grepping chunks for `apps.googleusercontent.com`), so Enoki
  sign-in is reachable. It was blank before, which made all the console work inert.
- Enoki is skipped when `!isEnokiNetwork(network)` → **localnet has no Google
  sign-in**. Production is testnet so this is fine.

## UX consolidation — DESIGNED, NOT APPROVED, NOT STARTED

Brainstorm (superpowers:brainstorming, architectural path) got as far as a
design presented in chat. User never answered "does this shape look right"
before the conversation moved to domains. **Nothing implemented. No spec file
written.** Resume by re-presenting and getting approval.

Decision already made by the user: **optimize for hackathon judges first** —
consolidate NAVIGATION, keep the evidence of engineering visible.

Trust tiers (derived from `app/api/_lib/guard.ts`, corrected mid-session):

| Tier | Gate | Covers |
|---|---|---|
| Watch | none | whole docket, live juries, verdicts, evidence, verification, status |
| Ask | *currently none*, user WANTS zkLogin | submit a claim (`POST /api/fact-checks`) |
| Judge | zkLogin | `POST /api/agents/register` |
| Operator | Bearer token | claim create, evidence admin |

Proposed 15 routes → 7:

```
/            landing (unchanged)
/app         console: submit + live docket   (absorbs /fact-check + /claims)
/claims/[id] one claim surface: observer when live, report when settled,
             evidence drawer, verifier panel  (absorbs /observe + /evidence/[id])
/agents      registry, zkLogin gate on "back an agent"
/learn       PROMOTED into the nav (currently orphaned — this is the onboarding fix)
/verify      blank-slate tool, footer
/legal       one page, 3 anchors (absorbs /privacy /terms /risk)
/status      footer
```
Nav 5 chips → 3: Console · Jury · Learn.

The 7 fragmentation problems found: two competing front doors (`/` and `/app`,
the latter not even in nav and its 5 desk cards duplicate the nav); one claim
spread over 3 URLs with the liveliest screen 2 clicks deep; submit is a
dead-end `router.push`; `/learn` orphaned (linked from only 2 places);
`/verify` detached from what it verifies; `/status` operator-facing but in
primary nav; 3 legal routes for 201 lines.

**Open design questions:** (a) does `/agents/[id]` stay a route for
deep-linking or collapse to an expanding row; (b) how hard the submit gate
should be — recommendation was zkLogin default + `OPENVERDICT_PUBLIC_WRITES`
as the demo-day circuit breaker, plus localStorage draft rescue because the
OAuth redirect is pinned to origin+"/" and will otherwise eat a typed claim.

## ERC-8004 / ERC-8126 framing (researched, use in the pitch)

**Sui has NO native agent identity/reputation standard.** Mapped docs.sui.io
for "agent" → nothing relevant; ecosystem search → only generic NIST/CSA/IETF
work. Both ERCs are real: `ERC-8004: Trustless Agents`, `ERC-8126: AI Agent
Verification`.

ERC-8004 defines Identity + Reputation + Validation registries. Its Validation
Registry explicitly lists "stakers re-running the job... **trusted judges**".
Mapping: Identity ≈ `AgentProfile` + `AgentCap` (richer — bonded, human-backed);
Validation ≈ the entire OpenVerdict jury; Reputation ≈ the inert struct.

Defensible pitch line: *Ethereum is standardising this via ERC-8004/8126; Sui
has no equivalent; OpenVerdict implements that architecture natively on Sui,
and the piece those standards leave pluggable — the validation layer — is our
whole protocol.* **NEVER claim "ERC-8004 compliant"** — different chain,
different interfaces, capability-shaped not ERC-721-shaped.

## Known gaps / candidate next work

- **`Reputation` is inert.** 7 dimensions declared; grep shows it is written
  ONLY by `initial_reputation()` at agent_registry.move:153 and :509. No
  update path exists. This is exactly ERC-8004's Reputation Registry and is
  the only unticked box in that mapping. Wiring it = new Move + redeploy +
  new packageId (invalidates the manifest and production). Advice given: do
  NOT touch Move with a live package unless the user decides it is worth it.
- Selection is deliberately unweighted by reputation (comment at
  agent_registry.move:53). That is a defensible non-goal, not an omission.
- **No claim has ever run through the HOSTED app.** The 08-27 canary ran
  locally. A live end-to-end costs ~0.1 SUI and minutes; user was offered and
  deferred. This is the last unproven link.
- `components/landing/claim-form.tsx` still in tree, rendered nowhere.
- `.env.example` still defaults SUI_NETWORK / NEXT_PUBLIC_SUI_NETWORK to
  `localnet`, contradicting "testnet is the demo network" (STATUS.md:53).
- `docs/demo/runbook.md:70` still scripts "submit a fact-check (no wallet
  needed)" — contradicts the intended zkLogin submit gate.

## Environment facts (do NOT relearn)

- **`vercel env pull` REDACTS values for CLI-added vars** (proved with a probe
  var set to a known value → pulled back `""`). Integration-created vars
  (Neon's `DATABASE_URL`) DO pull real values. Never conclude "env is empty"
  from a pull.
- **Env var changes need a REDEPLOY** to take effect; `NEXT_PUBLIC_*` are
  baked at build time. `vercel redeploy <url>` rebuilds same commit + new env.
- `.vercel/` is now gitignored. To avoid writing it into the repo, link inside
  the scratchpad: `vercel link --yes --project open-verdict --cwd <scratch>
  --scope marcus-tans-projects-0956f18f`, then pass `--cwd <scratch>`.
  Account-scoped ops need no link: `vercel domains add <domain> <project>`.
- Read instrumented server errors with `vercel logs <deployment-url> --json`
  (the table view TRUNCATES the message).
- Vercel preview deploys get unique URLs NOT in the OAuth allowlist → zkLogin
  fails there with `origin_mismatch`. Test auth on prod/alias only.
- Deadlines are CEILINGS not durations. testnet ladder = 5/10/15/30/45/60/75/90
  min; localnet = compressed 14 min. `advance()` (engine.ts:791) is on-demand,
  so real settle time is worker+model speed. **Round 2 usually never runs** —
  at REVEAL_1 a threshold tally settles immediately (engine.ts:807-809).
- The DB is SECURITY-SENSITIVE, not a cache: `vote_packages.salt_hex` holds
  commit-reveal salts. They cannot go on Sui without destroying juror
  independence. Answer to "why not store everything on Sui": this.
- `git status` carries a PARALLEL AGENT's landing-video WIP (docs/landing-
  background-video.md, public/media/landing/*, tools/landing-video/*). Do NOT
  commit it. Stage explicit paths ALWAYS.

## Resume protocol after /compact

Read this file. `git log --oneline -12` for the ladder. Confirm production
health with `curl -s https://openverdict.info/api/status` (expect suiHealthy +
dbHealthy true, 7 agents on /api/agents). Check `git status` for the parallel
agent's edits before touching anything. Then: the user drives — they intend to
review what exists and may change architecture, functionality, or pivot. The
UX consolidation design above is the one piece of unfinished thinking waiting
for a yes/no; do not start it unprompted.
