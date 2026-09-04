/**
 * Claim link parsing for the browser.
 *
 * A mirror of `parseAuditTarget` (lib/audit/audit-claim.ts) with none of the
 * auditor's dependencies, so the Audit page accepts exactly what `ov audit`
 * accepts without pulling the whole auditor into the client bundle. Keep the
 * two in step: the shapes below are the ones documented in docs/API.md.
 */

const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

export type ClaimLink = {
  /** Lowercase claim object id. */
  claimId: string;
  /** Set when the link pointed at one juror run. */
  runId?: string;
  /** Origin of the pasted link; absent when a bare id was pasted. */
  origin?: string;
};

export type ClaimLinkResult =
  | { ok: true; link: ClaimLink }
  | { ok: false; reason: string };

/**
 * Accepts a claim link (/claims/<id>, /claims/<id>/report,
 * /claims/<id>/runs/<runId>, the /api/ forms of those) or a bare 0x id.
 * A queue link is rejected by name: a queued submission has no verdict yet.
 */
export function parseClaimLink(input: string): ClaimLinkResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Paste a claim link or id." };

  if (HEX_ID.test(trimmed)) {
    return { ok: true, link: { claimId: trimmed.toLowerCase() } };
  }
  if (/^0x/i.test(trimmed)) {
    return { ok: false, reason: "That is not a claim id. Ids are 0x and 64 hex characters." };
  }

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: "That is not a claim link or id." };
  }

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments[0] === "api") segments.shift();

  if (segments[0] === "fact-check" && segments[1] === "queue") {
    return { ok: false, reason: "That is a queued submission, not a claim yet." };
  }
  if (segments[0] !== "claims" || segments[1] === undefined) {
    return { ok: false, reason: "That is not a claim link or id." };
  }

  const claimId = segments[1];
  if (!HEX_ID.test(claimId)) {
    return { ok: false, reason: `That is not a claim id: ${claimId}` };
  }
  const link: ClaimLink = { claimId: claimId.toLowerCase(), origin: url.origin };
  if (segments[2] === "runs" && segments[3] !== undefined && HEX_ID.test(segments[3])) {
    link.runId = segments[3].toLowerCase();
  }
  return { ok: true, link };
}

/**
 * The canonical claim link to hand an agent. A bare id takes the origin the
 * reader is on, so a link copied here reaches the deployment they are reading.
 */
export function claimHref(link: ClaimLink, fallbackOrigin: string): string {
  return `${link.origin ?? fallbackOrigin}/claims/${link.claimId}`;
}
