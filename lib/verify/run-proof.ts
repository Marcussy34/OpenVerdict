import { canonicalJsonBytes, canonicalJsonString } from "../gonka/canonical";
import { composeSystemPrompt } from "../gonka/promptSpec";
import { citationSites } from "../research/citations";
import { RunRecordV1Bcs } from "../protocol/bcs";
import { blake2b256, fromHex, toHex } from "../protocol/hash";
import type { RunProof } from "../engine/contract";
import type {
  HexString,
  PublicRunBundle,
  PublicRunBundleV3,
  PublicRunBundleV4,
  PublicRunBundleV5,
  SealedRunBundleV2,
} from "../protocol/types";

const utf8 = new TextEncoder();
const decoder = new TextDecoder();

export type BrowserRunProof = Omit<RunProof, "bundle" | "sealed"> & {
  bundle: PublicRunBundle | null;
  sealed?: SealedRunBundleV2 | null;
};

export type RunProofCheck = {
  key:
    | "promptHash"
    | "toolPolicyHash"
    | "systemPrompt"
    | "inputHash"
    | "outputHash"
    | "toolTranscriptHash"
    | "citations"
    | "challengeSearch"
    | "bothSidesOpened"
    | "citationSites"
    | "counterEvidenceSummary"
    | "opensPerTurn"
    | "runHash"
    | "sealedCore";
  label: string;
  expected: string;
  actual: string | null;
  ok: boolean;
  detail?: string;
};

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function canonicalHash(value: unknown): HexString {
  return toHex(blake2b256(canonicalJsonBytes(value)));
}

function stringHash(value: string): HexString {
  return toHex(blake2b256(utf8.encode(value)));
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function coreFromBundle(bundle: PublicRunBundle) {
  const { seal, ...core } = bundle;
  void seal;
  return core;
}

function matchesAll(actual: string, expected: string[]): boolean {
  return expected.every((value) => sameHex(actual, value));
}

export function isV3Bundle(
  bundle: PublicRunBundle,
): bundle is PublicRunBundleV3 {
  return bundle.version === 3;
}

export function isV4Bundle(
  bundle: PublicRunBundle,
): bundle is PublicRunBundleV4 {
  return bundle.version === 4;
}

export function isV5Bundle(
  bundle: PublicRunBundle,
): bundle is PublicRunBundleV5 {
  return bundle.version === 5;
}

function isResearchBundle(
  bundle: PublicRunBundle,
): bundle is PublicRunBundleV3 | PublicRunBundleV4 | PublicRunBundleV5 {
  return bundle.version === 3 || bundle.version === 4 || bundle.version === 5;
}

function isTwoSidedResearchBundle(
  bundle: PublicRunBundle,
): bundle is PublicRunBundleV4 | PublicRunBundleV5 {
  return bundle.version === 4 || bundle.version === 5;
}

/** Mirror the engine run identifier used for one claim seat and phase. */
export function deriveRunId(
  claimId: string,
  jurySeatId: string,
  phase: 1 | 2,
): HexString {
  return toHex(
    blake2b256(utf8.encode(`run:${claimId}:${jurySeatId}:${phase}`)),
  );
}

/** Wrap a pasted public bundle in the proof shape used by the shared viewer. */
export function proofFromBundle(
  bundle: PublicRunBundle,
  sealed: SealedRunBundleV2 | null = null,
): BrowserRunProof {
  return {
    runId: bundle.runId,
    claimId: bundle.claimId,
    phase: bundle.phase,
    agentProfileId: bundle.agentProfileId,
    jurySeatId: bundle.jurySeatId,
    promptHash: bundle.promptHash,
    inputHash: bundle.inputHash,
    outputHash: bundle.outputHash,
    runHash: bundle.runHash,
    gateway: bundle.gateway,
    sealedBlobId: bundle.seal.sealedBlobId,
    revealedBlobId: null,
    revealed: true,
    bundle,
    sealed,
  };
}

/** Recompute every public run proof inside the browser. */
export async function recomputeRunProof(
  proof: BrowserRunProof,
): Promise<RunProofCheck[]> {
  const bundle = proof.bundle;
  if (!bundle) throw new Error("The public run bundle is not revealed yet");

  const promptHash = canonicalHash(bundle.promptSpec);
  const inputHash = canonicalHash(bundle.input);
  const outputHash = canonicalHash(bundle.validatedOutput);
  const audit = bundle.audit;
  const runHash = toHex(
    blake2b256(
      RunRecordV1Bcs.serialize({
        run_id: audit.runId,
        claim_object_id: audit.claimObjectId,
        agent_profile_id: audit.agentProfileId,
        jury_seat_id: audit.jurySeatId,
        phase: audit.phase,
        attempt: audit.attempt,
        provider_id: audit.providerId,
        model_id: audit.modelId,
        gonka_request_id: audit.gonkaRequestId,
        prompt_hash: fromHex(audit.promptHash),
        input_hash: fromHex(audit.inputHash),
        output_hash: fromHex(audit.outputHash),
        tool_transcript_hash: fromHex(audit.toolTranscriptHash),
        evidence_root: fromHex(audit.evidenceRoot),
        requested_at_ms: audit.requestedAtMs,
        completed_at_ms: audit.completedAtMs,
      }).toBytes(),
    ),
  );

  const checks: RunProofCheck[] = [
    {
      key: "promptHash",
      label: "Prompt hash",
      expected: proof.promptHash,
      actual: promptHash,
      ok: matchesAll(promptHash, [proof.promptHash, bundle.promptHash, audit.promptHash]),
    },
  ];

  if (isResearchBundle(bundle)) {
    const actualToolPolicyHash = canonicalHash(bundle.toolPolicy);
    const expectedSystemPrompt = composeSystemPrompt(
      bundle.promptSpec,
      bundle.toolPolicy,
    );
    const actualSystemPrompt = bundle.request.messages[0]?.content;
    checks.push(
      {
        key: "toolPolicyHash",
        label: "Tool policy hash",
        expected: bundle.toolPolicyHash,
        actual: actualToolPolicyHash,
        ok: sameHex(actualToolPolicyHash, bundle.toolPolicyHash),
      },
      {
        key: "systemPrompt",
        label: "System prompt",
        expected: stringHash(expectedSystemPrompt),
        actual:
          actualSystemPrompt === undefined
            ? null
            : stringHash(actualSystemPrompt),
        ok: actualSystemPrompt === expectedSystemPrompt,
        ...(actualSystemPrompt === undefined
          ? { detail: "The request has no system message" }
          : {}),
      },
    );
  }

  checks.push(
    {
      key: "inputHash",
      label: "Input hash",
      expected: proof.inputHash,
      actual: inputHash,
      ok: matchesAll(inputHash, [proof.inputHash, bundle.inputHash, audit.inputHash]),
    },
    {
      key: "outputHash",
      label: "Output hash",
      expected: proof.outputHash,
      actual: outputHash,
      ok: matchesAll(outputHash, [proof.outputHash, bundle.outputHash, audit.outputHash]),
    },
  );

  if (isResearchBundle(bundle)) {
    const actualTranscriptHash = canonicalHash(bundle.transcript);
    const actualToolCallCount =
      bundle.transcript.counts.searches + bundle.transcript.counts.opens;
    const outputCitations = bundle.validatedOutput.citations ?? [];
    const openedById = new Map(
      bundle.transcript.opened.map((page) => [page.evidenceId, page]),
    );
    const openedCitationCount = outputCitations.filter((citation) =>
      openedById.has(citation.evidenceId),
    ).length;
    const allCitationsOpened = openedCitationCount === outputCitations.length;
    // A quote the engine could not find in the page is blanked in the
    // validated output and recorded in the transcript with found: false; a
    // quote that is still present must have been found.
    const recordedById = new Map(
      bundle.transcript.citations.map((citation) => [
        `${citation.evidenceId}|${citation.url}`,
        citation,
      ]),
    );
    const quotesConsistent = outputCitations.every((citation) => {
      const recorded = recordedById.get(`${citation.evidenceId}|${citation.url}`);
      if (recorded === undefined) return false;
      return recorded.found ? true : citation.quote.trim().length === 0;
    });
    const needsSearchCitation =
      bundle.validatedOutput.outcome === "YES" ||
      bundle.validatedOutput.outcome === "NO";
    const hasSearchCitation = outputCitations.some(
      (citation) => openedById.get(citation.evidenceId)?.origin === "SEARCH",
    );
    const citationsOk =
      allCitationsOpened &&
      quotesConsistent &&
      (!needsSearchCitation || hasSearchCitation);
    const citationCountLabel = `${outputCitations.length} of ${outputCitations.length} citations opened`;

    checks.push(
      {
        key: "toolTranscriptHash",
        label: "Tool transcript hash",
        expected: audit.toolTranscriptHash,
        actual: actualTranscriptHash,
        ok:
          sameHex(actualTranscriptHash, audit.toolTranscriptHash) &&
          actualToolCallCount === audit.toolCallCount,
        ...(actualToolCallCount === audit.toolCallCount
          ? {}
          : {
              detail: `Transcript records ${actualToolCallCount} tool calls, audit records ${audit.toolCallCount}`,
            }),
      },
      {
        key: "citations",
        label: "Citations",
        expected: citationCountLabel,
        actual: `${openedCitationCount} of ${outputCitations.length} citations opened`,
        ok: citationsOk,
        ...(citationsOk
          ? {}
          : {
              detail: "Citations must reference opened pages, keep only quotes found in them, and independently support YES or NO outcomes",
            }),
      },
    );

    if (isTwoSidedResearchBundle(bundle)) {
      const challengeSearchSteps = bundle.transcript.steps.filter(
        (step) =>
          step.action.action === "search" &&
          step.action.intent === "challenge",
      );
      const challengeSearchResults = challengeSearchSteps.filter(
        (step) => step.result.tool === "search",
      );
      const challengeReturnedNoResults =
        challengeSearchResults.length > 0 &&
        challengeSearchResults.every(
          (step) =>
            step.result.tool === "search" && step.result.results.length === 0,
        );
      const supportOpens = bundle.transcript.opened.filter((page) =>
        page.sides?.includes("support"),
      ).length;
      const challengeOpens = bundle.transcript.opened.filter((page) =>
        page.sides?.includes("challenge"),
      ).length;
      const foundOutputCitations = outputCitations.map((citation) => ({
        ...citation,
        found:
          recordedById.get(`${citation.evidenceId}|${citation.url}`)?.found ===
          true,
      }));
      const sites = citationSites(foundOutputCitations, {
        opened: bundle.transcript.opened,
        origins: new Map(
          bundle.transcript.opened.map((page) => [
            page.evidenceId,
            page.origin,
          ]),
        ),
      });
      const challengeSearchOk =
        !needsSearchCitation || challengeSearchSteps.length > 0;
      const bothSidesOpenedOk =
        !needsSearchCitation ||
        (supportOpens >= bundle.toolPolicy.minOpensPerSide &&
          (challengeOpens >= bundle.toolPolicy.minOpensPerSide ||
            challengeReturnedNoResults));
      const citationSitesOk =
        !needsSearchCitation ||
        sites.size >= bundle.toolPolicy.minCitationDomains;
      const hasCounterEvidenceSummary =
        (bundle.validatedOutput.counterEvidenceSummary?.trim().length ?? 0) >
        0;
      const counterEvidenceSummaryOk =
        !needsSearchCitation || hasCounterEvidenceSummary;

      checks.push(
        {
          key: "challengeSearch",
          label: "Challenge search present",
          expected: "At least one challenge search for YES or NO",
          actual: `${challengeSearchSteps.length} challenge searches`,
          ok: challengeSearchOk,
        },
        {
          key: "bothSidesOpened",
          label: "Both sides opened",
          expected: `${bundle.toolPolicy.minOpensPerSide} opens per side`,
          actual: `${supportOpens} support, ${challengeOpens} challenge`,
          ok: bothSidesOpenedOk,
          ...(challengeReturnedNoResults
            ? { detail: "Every challenge search returned zero results" }
            : {}),
        },
        {
          key: "citationSites",
          label: `Citations span ${bundle.toolPolicy.minCitationDomains} sites`,
          expected: `${bundle.toolPolicy.minCitationDomains} distinct sites`,
          actual: `${sites.size} distinct sites`,
          ok: citationSitesOk,
        },
        {
          key: "counterEvidenceSummary",
          label: "Counter-evidence summary present",
          expected: "Non-empty for YES or NO",
          actual: hasCounterEvidenceSummary ? "present" : "missing",
          ok: counterEvidenceSummaryOk,
        },
      );

      if (isV5Bundle(bundle)) {
        const opensByTurn = new Map<number, number>();
        for (const step of bundle.transcript.steps) {
          if (step.action.action !== "open") continue;
          opensByTurn.set(step.turn, (opensByTurn.get(step.turn) ?? 0) + 1);
        }
        const violatingTurns = [...opensByTurn.entries()].filter(
          ([, count]) => count > bundle.toolPolicy.maxOpensPerTurn,
        );
        const maximumObserved = Math.max(0, ...opensByTurn.values());
        checks.push({
          key: "opensPerTurn",
          label: "Opens per turn within policy",
          expected: `At most ${bundle.toolPolicy.maxOpensPerTurn} open steps per turn`,
          actual: `${maximumObserved} maximum open steps in one turn`,
          ok: violatingTurns.length === 0,
          ...(violatingTurns.length === 0
            ? {}
            : {
                detail: `Turns over policy: ${violatingTurns.map(([turn]) => turn).join(", ")}`,
              }),
        });
      }
    }
  }

  checks.push({
    key: "runHash",
    label: "Run hash",
    expected: proof.runHash,
    actual: runHash,
    ok: matchesAll(runHash, [proof.runHash, bundle.runHash]),
  });

  const sealed = proof.sealed ?? null;
  if (!sealed) {
    checks.push({
      key: "sealedCore",
      label: "Sealed core",
      expected: bundle.seal.coreHash,
      actual: null,
      ok: false,
      detail: "The sealed bundle was not provided",
    });
    return checks;
  }

  try {
    const seal = bundle.seal;
    const metadataMatches =
      sealed.algorithm === "AES-256-GCM" &&
      seal.algorithm === "AES-256-GCM" &&
      sameHex(sealed.ivHex, seal.ivHex) &&
      sealed.aad === bundle.runId &&
      seal.aad === bundle.runId &&
      sealed.runId === bundle.runId &&
      sameHex(sealed.coreHash, seal.coreHash) &&
      (!proof.sealedBlobId || proof.sealedBlobId === seal.sealedBlobId);
    if (!metadataMatches) {
      throw new Error("The sealed metadata does not match the revealed bundle");
    }

    const keyBytes = fromHex(seal.keyHex);
    const ivBytes = fromHex(seal.ivHex);
    if (keyBytes.byteLength !== 32 || ivBytes.byteLength !== 12) {
      throw new Error("The AES key or IV has an invalid length");
    }

    const key = await crypto.subtle.importKey(
      "raw",
      exactBuffer(keyBytes),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: exactBuffer(ivBytes),
        additionalData: exactBuffer(utf8.encode(bundle.runId)),
        tagLength: 128,
      },
      key,
      exactBuffer(decodeBase64(sealed.ciphertextBase64)),
    );
    const plaintext = new Uint8Array(plaintextBuffer);
    const actualCoreHash = toHex(blake2b256(plaintext));
    const decodedCore = JSON.parse(decoder.decode(plaintext)) as unknown;
    const coreMatches =
      canonicalJsonString(decodedCore) === canonicalJsonString(coreFromBundle(bundle));
    const hashMatches = matchesAll(actualCoreHash, [seal.coreHash, sealed.coreHash]);

    checks.push({
      key: "sealedCore",
      label: "Sealed core",
      expected: seal.coreHash,
      actual: actualCoreHash,
      ok: hashMatches && coreMatches,
      ...(coreMatches ? {} : { detail: "The decrypted core differs from the revealed bundle" }),
    });
  } catch (error) {
    checks.push({
      key: "sealedCore",
      label: "Sealed core",
      expected: bundle.seal.coreHash,
      actual: null,
      ok: false,
      detail: error instanceof Error ? error.message : "The sealed bundle could not be verified",
    });
  }

  return checks;
}
