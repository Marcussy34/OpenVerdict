# Juror research v2: two-sided research, corroboration, full transparency

Date: 2026-08-30. Status: decided by the acting lead (owner delegated the call:
"you make the best architectural decision"). Supersedes the single-source
behaviour of juror research v1 (docs/superpowers/specs/2026-08-29-juror-research-design.md).

## Why

On hosted claim #16 a juror ran one search, opened one page, and answered.
That satisfies v1's independence rule (a YES or NO must cite a page the juror
found itself) but it is confirmation gathering, not weighing evidence. The
owner also asked that every step be visible and auditable. Three gaps:

1. Nothing asks a juror to look for evidence against the claim.
2. One site is enough to answer; no corroboration.
3. The run view hides most of what the sealed bundle already records
   (per-turn node identity, the full conversation, the audit fields).

## Protocol v3 (prompt spec v3 + tool policy v3)

Applies only to agents whose manifest document is version 4. Version 3
documents (prompt spec v2, policy v2) keep v1 behaviour byte for byte, because
their hashes are on chain and their earlier runs must keep verifying.

- `search` actions carry `intent: "support" | "challenge"`. A search without
  intent is refused (`INVALID_ACTION`, costs a turn, not a search).
- Before a YES or NO is accepted the engine enforces, in order, each with at
  most two nudges: `RESEARCH_REQUIRED` (v1 rule, unchanged),
  `CHALLENGE_REQUIRED` (at least one challenge search, and one of its results
  opened when it returned any), `CORROBORATION_REQUIRED` (found, search-origin
  citations from at least `minCitationDomains` = 2 distinct sites), and a
  non-empty `counterEvidenceSummary` (validation error, repair path). UNSURE
  is never blocked by the new rules; a juror that cannot meet them answers
  UNSURE or fails closed, exactly as v1 handles exhausted nudges.
- Budgets: 4 searches, 5 opens, 10 turns (one more of each per side).
- The prompt asks for primary sources over aggregators and for UNSURE when
  credible sources conflict. The output keeps its schema; `counterEvidenceSummary`
  is added as an optional field so every earlier output stays valid.
- Transcript: search steps record the intent; opened pages record the sides
  (intents of the searches that listed the url); counts gain
  `challengeSearches`.
- Bundle core v4 = core v3 with prompt spec v3 and policy v3; same hash
  formulas. The verifier accepts v3 and v4 and, for v4, checks from the
  bundle's own policy: challenge search present, both sides opened (or the
  challenge search was empty), citations span N sites, counter-evidence
  summary present (all trivially true for UNSURE).
- Manifests: the seven juror profiles get version 4 documents on Walrus and
  `agent_registry::update_agent_manifest` transactions (the scripted path,
  idempotent, dry run first).

## Transparency

Nothing new needs to be captured: the sealed bundle already holds every
attempt record (gateway request id, devshard, served model id, vLLM
fingerprint, tokens, latency, raw reply), the final request's full message
list (the accumulated conversation), the prompt spec, the policy, the
transcript with page hashes and Walrus ids, and the validated output. The
run view now shows all of it: a provenance strip (requested versus served
model, node ids, explorer and Walrus links), per-turn "what the model was
sent" and "what the model said" with the node that answered, the system
prompt and budgets, evidence for and against the claim with the reasoning
trace, the engine's refusals (nudges) as events, a generic view of every
remaining audit field, and the whole public bundle as JSON next to the hash
checks.

## Costs and risks

- Each seat spends one or two more page opens: roughly 20 to 40 s more per
  seat. DeepSeek and MiniMax fit the 140 s research budget; Kimi (40 to 72 s
  per run) fails closed more often. With `REQUIRED_MATCHING = 4` a round
  tolerates one lost seat, so the ladder is unchanged.
- Router-side model substitution (seen on claim #17) still costs seats; the
  adapter's fail-closed model check stays.
- Old bundles verify under their own policy; new checks apply to v4 only.
