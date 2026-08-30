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

## Protocol v4 (prompt spec v4 + tool policy v4): batched opens, 2026-08-30 evening

Applies only to agents whose manifest document is version 5. Version 4
documents keep the v3 behaviour byte for byte: the v3 prompt hash
`0x07cdea1d…` and policy hash `0xeba334fd…` did not move (the v4 text is
derived from the v3 text by replacing the open action line and extending the
Method sentence with "Open the two or three most credible results of a search
together instead of one per turn").

- An `open` action may name `urls` (one to `maxOpensPerTurn` = 3 urls, no
  duplicates, each already seen in results or `submittedUrls`) instead of a
  single `url`; the single-url form still works, and `from` applies to all.
- The engine validates the whole batch first: a fourth url, a duplicate or an
  unseen url refuses the action (`INVALID_ACTION` or `URL_NOT_SEEN` naming
  the offending url, costs a turn, no open budget). It then charges one open
  slot per page, fetches the allowed pages in parallel (refs follow request
  order, not arrival order), and returns one `open_many` tool result whose
  pages carry the usual open fields or `{url, error}` (`OPEN_FAILED`, or
  `BUDGET_OPENS` for the pages beyond the remaining budget).
- Transcript: one step per page with the same turn and model request id,
  consecutive indexes, and `batch: {size, position}`; failed pages are error
  steps with the same marker. Every v3 rule, the verifier's side counting and
  the run view keep working unchanged; the run view addresses the
  conversation by turn and labels each page "page N of M opened together".
- Simplification: a page in a batch costs a slot even when it is already
  open (a single-url re-read of an open page stays free, as in v3).
- Bundle core v5 = core v4 with spec v4 and policy v4 (same hash formulas).
  The verifier accepts v5 with the v4 checks plus "opens per turn within
  policy". Manifests: the seven juror profiles get version 5 documents
  through the same scripted, idempotent path (dry run first).

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
