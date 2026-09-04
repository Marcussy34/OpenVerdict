/**
 * The live research feed: one `research_step` event per recorded research
 * step (docs/superpowers/specs/2026-09-04-fast-path-design.md §5).
 *
 * Queries, result sites and opened URLs are public web material, so the event
 * is PUBLIC_NOW and not reveal-gated. The answer, the vote and the reasoning
 * stay sealed until reveal exactly as before: jurors never see the console,
 * independence is between jurors, and the operator already sees everything.
 */
import type { ResearchStepInfo } from "../research/loop";
import type { ResolutionEventInput } from "../events";

/**
 * What the engine hands to `emit`: the event minus the fields the repository
 * stamps itself (its id, its sequence and the time it occurred).
 */
export type ResearchStepEvent = Omit<
  ResolutionEventInput,
  "eventId" | "sequence" | "occurredAt"
>;

/** One `research_step` event for a step the seat's research loop just recorded. */
export function researchStepEvent(input: {
  claim: { claimId: string; state: number };
  seat: { jurySeatId: string; agentProfileId: string; phase: 1 | 2 };
  runId: string;
  step: ResearchStepInfo;
}): ResearchStepEvent {
  const { claim, seat, runId, step } = input;
  return {
    claimId: claim.claimId,
    phase: `INFERENCE_${seat.phase}`,
    kind: "research_step",
    source: "ENGINE",
    visibility: "PUBLIC_NOW",
    actorId: seat.agentProfileId,
    runId,
    payload: {
      claim_id: claim.claimId,
      jury_seat_id: seat.jurySeatId,
      agent_profile_id: seat.agentProfileId,
      run_id: runId,
      phase: seat.phase,
      ordinal: step.ordinal,
      kind: step.kind,
      // Undefined fields are omitted so a search line never carries empty
      // page keys and an answer line carries no research material at all.
      ...(step.intent === undefined ? {} : { intent: step.intent }),
      ...(step.query === undefined ? {} : { query: step.query }),
      ...(step.urls === undefined ? {} : { urls: step.urls }),
      ...(step.resultDomains === undefined
        ? {}
        : { result_domains: step.resultDomains }),
      ...(step.pageCount === undefined ? {} : { page_count: step.pageCount }),
    },
  };
}
