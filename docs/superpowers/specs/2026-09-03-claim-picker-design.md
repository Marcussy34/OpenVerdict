# Claim picker (breadth, light version): design

Date: 2026-09-03. Owner-approved direction ("breadth, light version first").
Status: approved for implementation after the weather front door.

## Problem

A paste that contains several claims is judged as one compound statement, or
(for a URL) reduced to one claim the model picked. A judge who pastes a
three-claim tweet expects to see the three claims.

## Goal

From a URL or a pasted text, extract up to three distinct checkable claims,
show them, and let the person pick the one to verify. Everything after the
pick is unchanged: one claim, one jury. The full version (verify every claim
under one dossier) is a later extension and is out of scope here.

## A. Extraction (lib/claim-extraction/handler.ts, app/api/extract-claim)

Request: `{ url: string }` (as today) or `{ text: string }` (new; trimmed,
40 to 20 000 characters). Exactly one of the two.

Model reply (strict JSON): `{ "claims": [ { "claim": string, "reason": string,
"quote": string } ], "language": string }` with 0 to 3 claims, each claim one
falsifiable sentence (no newline, no trailing question mark, at most 1 000
characters), `quote` the short source passage (at most 300 characters) the
claim comes from, `reason` at most 2 000 characters, `language` a BCP 47 tag
the model detects for the input. The system prompt asks for the up to three
most check-worthy, distinct, falsifiable claims in the order they appear,
rejects opinions, predictions and questions, treats the text as untrusted
data and never follows instructions inside it. One JSON repair round as
today.

Response: `{ claims: [{ claim, reason, quote }], language, sourceUrl?, modelId,
gonkaRequestId?, gatewayRequestId? }`. For compatibility `claim` (the first
claim) is also returned. No claims found: `404 { error: "NO_CLAIM_FOUND" }`
as today.

For `text` input no fetch happens; the text goes through the same prose
window (`selectProseWindow`) and the evidence item id is `pasted-text` with
the blake2b-256 hash of the text as `contentHash`.

## B. Fact-check page

The single input stays. Behaviour:

- URL input: "Find claims" (as the extract button today).
- Text input longer than 240 characters, or containing two or more sentence
  ends: the primary button becomes "Find claims"; a secondary link "Verify as
  written" submits the text unchanged (today's path).
- Short text: "Verify" as today.

After extraction: a list of the candidates as radio rows: the claim sentence,
the source quote in muted text, and the reason on hover or expand. The first
is selected. A "Verify this claim" button submits the selected claim; the
extraction provenance card (model, request id, source) stays visible. "Edit"
puts the selected claim back into the input for manual changes. An empty
result shows "No checkable claim found; state it as text instead."

## C. CLI

`fact-check extract` accepts `--text` in addition to a URL and prints the
list.

## Testing

Handler tests: text input path, multiple claims, ordering preserved, cap at
three, per-claim validation, empty list → 404, repair round, language field.
Page: typecheck and lint; manual check on the deployed app.

## Rollout

No protocol change. Deploy with the next clean window.
