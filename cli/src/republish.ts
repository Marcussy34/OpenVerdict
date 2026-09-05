import {
  buildAgentManifestDocument,
  parseAgentManifestDocument,
} from "../../lib/engine/agentManifestDocument";
import { CURRENT_SEAT_GENERATION } from "../../lib/engine/seatGeneration";
import {
  blake2b256,
  fromHex,
  type AgentManifest,
  type AgentManifestDocument,
} from "../../lib/protocol";
import type { AgentManifestRecord, Repository } from "../../lib/storage";
import type { SuiGateway } from "../../lib/sui";
import type { WalrusStore } from "../../lib/walrus";

const utf8 = new TextEncoder();

/** What happened to one seat, in the order the operator reads it. */
export type RepublishSeatStatus = "republished" | "dry run" | "up to date";

export interface RepublishSeatRow {
  agentProfileId: string;
  modelId: string;
  role: string;
  /** The slot whose key signs update_agent_manifest for this seat. */
  slotIndex: number;
  oldVersion: string;
  oldPromptHash: string;
  newVersion: string;
  newPromptHash: string;
  /** The blob the seat points at after this command, so the old one unless it moved. */
  manifestBlobId: string;
  status: RepublishSeatStatus;
  digest?: string;
}

export interface RepublishReport {
  dryRun: boolean;
  /** Seats selected, in mirror order. */
  seats: RepublishSeatRow[];
  republished: number;
  upToDate: number;
}

export interface RepublishSelection {
  /** Explicit seats, active or not. Takes precedence over `active`. */
  agentProfileIds?: readonly string[];
  /** Every mirror row the engine still counts as eligible. */
  active?: boolean;
  /** Reads and rebuilds, but uploads nothing, signs nothing and saves nothing. */
  dryRun?: boolean;
}

/**
 * Everything the republish touches, injected so the whole flow can be tested
 * without a chain, a Walrus network or a signer.
 */
export interface RepublishDependencies {
  repository: Repository;
  walrus: Pick<WalrusStore, "get" | "put">;
  gateway: Pick<SuiGateway, "updateAgentManifest">;
  /** Operational slot addresses in slot order; a seat's owner must be one. */
  slotAddresses: readonly string[];
  /** The seat's own AgentCap: the mirror row's id when it checks out, else a scan. */
  resolveAgentCapId(input: {
    owner: string;
    agentProfileId: string;
    agentCapId?: string;
  }): Promise<string>;
  now?: () => Date;
}

/**
 * Move existing seats onto the current prompt generation.
 *
 * The published manifest document is the source of truth for a seat's identity
 * (network, backing, owner, role, model, evidence policy), so each seat is
 * rebuilt from its own document with only the prompt generation replaced. The
 * seat's operational key signs update_agent_manifest, because
 * register_staked_agent hands the AgentCap to the operational owner.
 *
 * Every seat is read, checked and rebuilt before the first write, so the
 * mistakes that stop a run (an owner that is no derived slot, a document
 * Walrus cannot return) surface with nothing published. The writes themselves
 * are one transaction per seat, so a failure inside them leaves the seats
 * before it republished.
 */
export async function republishAgentManifests(
  deps: RepublishDependencies,
  selection: RepublishSelection,
): Promise<RepublishReport> {
  const records = await selectSeats(deps.repository, selection);
  const slots = new Map(
    deps.slotAddresses.map((address, index) => [address.toLowerCase(), index]),
  );
  const planned: Array<{
    record: AgentManifestRecord;
    document: AgentManifestDocument;
    slotIndex: number;
    built: ReturnType<typeof buildAgentManifestDocument>;
    row: Omit<RepublishSeatRow, "status" | "digest">;
  }> = [];
  for (const record of records) {
    const slotIndex = slots.get(record.manifest.owner.toLowerCase());
    if (slotIndex === undefined) {
      throw Object.assign(
        new Error(
          `seat ${record.manifest.agentProfileId} is owned by ${record.manifest.owner}, which is none of the ${deps.slotAddresses.length} derived agent slots; check OPENVERDICT_AGENT_SEED and OPENVERDICT_AGENT_SLOTS`,
        ),
        { code: "SEAT_OWNER_NOT_A_SLOT" },
      );
    }
    const document = await readSeatDocument(deps.walrus, record);
    // The signing key and the owner the document names have to be the same
    // address, or the republished document would describe a different seat.
    if (
      document.operationalOwner.toLowerCase() !== record.manifest.owner.toLowerCase()
    ) {
      throw Object.assign(
        new Error(
          `seat ${record.manifest.agentProfileId} document names operational owner ${document.operationalOwner}, but the mirror row says ${record.manifest.owner}`,
        ),
        { code: "SEAT_OWNER_MISMATCH" },
      );
    }
    const built = buildAgentManifestDocument({
      network: document.network,
      backingKind: document.backingKind,
      humanBackingHash: document.humanBackingHash,
      humanVerificationProvider: document.humanVerificationProvider,
      operationalOwner: document.operationalOwner,
      role: document.role,
      modelId: document.modelId,
      ...CURRENT_SEAT_GENERATION,
      evidencePolicyId: document.evidencePolicyId,
    });
    planned.push({
      record,
      document,
      slotIndex,
      built,
      row: {
        agentProfileId: record.manifest.agentProfileId,
        modelId: document.modelId,
        role: document.role,
        slotIndex,
        oldVersion: record.manifest.version,
        oldPromptHash: record.manifest.promptHash,
        newVersion: built.document.version,
        newPromptHash: built.promptHash,
        manifestBlobId: record.manifest.manifestBlobId,
      },
    });
  }

  const dryRun = selection.dryRun === true;
  const seats: RepublishSeatRow[] = [];
  for (const { record, document, slotIndex, built, row } of planned) {
    if (
      record.manifest.manifestHash.toLowerCase() === built.manifestHash.toLowerCase()
    ) {
      seats.push({ ...row, status: "up to date" });
      continue;
    }
    if (dryRun) {
      seats.push({ ...row, status: "dry run" });
      continue;
    }

    const upload = await deps.walrus.put(built.bytes, {
      identifier: `agent-${record.manifest.agentProfileId.slice(2, 18)}-manifest-v${built.document.version}.json`,
    });
    const agentCapId = await deps.resolveAgentCapId({
      owner: record.manifest.owner,
      agentProfileId: record.manifest.agentProfileId,
      ...(record.agentCapId === undefined ? {} : { agentCapId: record.agentCapId }),
    });
    const update = await deps.gateway.updateAgentManifest({
      agentIndex: slotIndex,
      agentProfileId: record.manifest.agentProfileId,
      agentCapId,
      manifestHash: fromHex(built.manifestHash),
      manifestBlobId: upload.blobId,
      modelHash: blake2b256(utf8.encode(document.modelId)),
      roleHash: blake2b256(utf8.encode(`OPENVERDICT_ROLE_${document.role}`)),
    });

    // A new version is a new row. The mirror reads the newest row per profile
    // (checkpoint first, then created_at), so the checkpoint is carried over
    // unchanged and the fresh timestamp is what makes this row win.
    const timestamp = (deps.now?.() ?? new Date()).toISOString();
    const manifest: AgentManifest = {
      ...record.manifest,
      version: built.document.version,
      manifestBlobId: upload.blobId,
      manifestHash: built.manifestHash,
      promptHash: built.promptHash,
      toolPolicyHash: built.toolPolicyHash,
      ...(built.tableVotePromptHash === undefined
        ? {}
        : { tableVotePromptHash: built.tableVotePromptHash }),
      evidencePolicyHash: built.document.evidencePolicyHash,
    };
    await deps.repository.saveAgentManifest({
      ...record,
      manifest,
      agentCapId: record.agentCapId ?? agentCapId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    seats.push({
      ...row,
      manifestBlobId: upload.blobId,
      status: "republished",
      digest: update.digest,
    });
  }

  return {
    dryRun,
    seats,
    republished: seats.filter((seat) => seat.status === "republished").length,
    upToDate: seats.filter((seat) => seat.status === "up to date").length,
  };
}

/**
 * Explicit ids take any row, active or not; --active takes the rows the
 * weather gate still counts. Both read the newest row per profile, which is
 * the row the engine itself runs a seat from.
 */
async function selectSeats(
  repository: Repository,
  selection: RepublishSelection,
): Promise<AgentManifestRecord[]> {
  const mirror = await repository.listAgentManifests();
  const ids = selection.agentProfileIds ?? [];
  if (ids.length > 0) {
    const byProfileId = new Map(
      mirror.map((record) => [record.manifest.agentProfileId.toLowerCase(), record]),
    );
    // Deduplicated so a repeated id cannot pay for the same seat twice.
    return [...new Set(ids.map((id) => id.toLowerCase()))].map((id) => {
      const record = byProfileId.get(id);
      if (record === undefined) {
        throw Object.assign(
          new Error(`${id} has no row in the engine's agent mirror`),
          { code: "SEAT_NOT_MIRRORED" },
        );
      }
      return record;
    });
  }
  if (selection.active !== true) {
    throw Object.assign(
      new Error("name at least one agent profile id, or pass --active"),
      { code: "NO_SEATS_SELECTED" },
    );
  }
  return mirror.filter((record) => record.active);
}

/** The seat's published document, which carries every identity field. */
async function readSeatDocument(
  walrus: Pick<WalrusStore, "get">,
  record: AgentManifestRecord,
): Promise<AgentManifestDocument> {
  try {
    return parseAgentManifestDocument(await walrus.get(record.manifest.manifestBlobId));
  } catch (error) {
    throw Object.assign(
      new Error(
        `seat ${record.manifest.agentProfileId} manifest document ${record.manifest.manifestBlobId} could not be read from Walrus`,
      ),
      { code: "SEAT_DOCUMENT_UNREADABLE", cause: error },
    );
  }
}
