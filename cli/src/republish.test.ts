import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentManifestDocument,
  parseAgentManifestDocument,
  EVIDENCE_POLICY_V1_LABEL,
} from "../../lib/engine/agentManifestDocument";
import {
  DEFAULT_PROMPT_SPEC_V2,
  DEFAULT_PROMPT_SPEC_V5,
  DEFAULT_TOOL_POLICY_V2,
  DEFAULT_TOOL_POLICY_V4,
  TABLE_VOTE_PROMPT_SPEC_V1,
  promptSpecHash,
  tableVotePromptSpecHash,
  toolPolicyHash,
} from "../../lib/gonka/promptSpec";
import { fromHex, type AgentManifest } from "../../lib/protocol";
import {
  createDb,
  createRepository,
  migrate,
  type Repository,
} from "../../lib/storage";
import type { SuiGateway } from "../../lib/sui";
import { republishAgentManifests } from "./republish";

const openDatabases: PGlite[] = [];

/** Slot addresses stand in for the engine's derived operational keys. */
const SLOTS = [
  `0x${"a0".repeat(32)}`,
  `0x${"a1".repeat(32)}`,
  `0x${"a2".repeat(32)}`,
];
const NOW = new Date("2026-09-05T12:00:00.000Z");

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((db) => db.close()));
});

async function testRepository(): Promise<Repository> {
  const db = createDb({ dataDir: "memory://" });
  if (!(db instanceof PGlite)) throw new Error("expected an embedded pglite database");
  openDatabases.push(db);
  await migrate(db);
  return createRepository(db);
}

/** Content-addressed enough for a test: the bytes come back as they went in. */
function fakeWalrus() {
  const blobs = new Map<string, Uint8Array>();
  const puts: string[] = [];
  return {
    blobs,
    puts,
    async put(bytes: Uint8Array) {
      const blobId = `blob-${blobs.size + 1}`;
      blobs.set(blobId, bytes);
      puts.push(blobId);
      return { blobId };
    },
    async get(blobId: string) {
      const bytes = blobs.get(blobId);
      if (bytes === undefined) throw new Error(`no such blob: ${blobId}`);
      return bytes;
    },
  };
}

function fakeGateway() {
  const updates: Array<Record<string, unknown>> = [];
  const gateway: Pick<SuiGateway, "updateAgentManifest"> = {
    updateAgentManifest: vi.fn(async (input) => {
      updates.push(input as unknown as Record<string, unknown>);
      return { digest: `digest-${updates.length}` };
    }),
  };
  return { gateway, updates };
}

/**
 * One mirrored seat plus its published document, at the generation named.
 * "old" is what the public stake flow wrote before the fix (v3 on prompt v2),
 * "current" is what it writes now.
 */
async function seedSeat(
  repository: Repository,
  walrus: ReturnType<typeof fakeWalrus>,
  options: {
    agentProfileId: string;
    owner: string;
    modelId: string;
    role: string;
    generation: "old" | "current";
    active?: boolean;
    agentCapId?: string;
  },
) {
  const built = buildAgentManifestDocument({
    network: "testnet",
    backingKind: "WALLET_STAKED",
    humanBackingHash: `0x${"cd".repeat(32)}`,
    humanVerificationProvider: "sui-wallet-stake",
    operationalOwner: options.owner as `0x${string}`,
    role: options.role,
    modelId: options.modelId,
    ...(options.generation === "old"
      ? { promptSpec: DEFAULT_PROMPT_SPEC_V2, toolPolicy: DEFAULT_TOOL_POLICY_V2 }
      : {
          promptSpec: DEFAULT_PROMPT_SPEC_V5,
          toolPolicy: DEFAULT_TOOL_POLICY_V4,
          tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
        }),
    evidencePolicyId: EVIDENCE_POLICY_V1_LABEL,
  });
  const upload = await walrus.put(built.bytes);
  const manifest: AgentManifest = {
    agentProfileId: options.agentProfileId as `0x${string}`,
    owner: options.owner as `0x${string}`,
    humanAttestationHash: `0x${"cd".repeat(32)}`,
    humanVerificationProvider: "sui-wallet-stake",
    version: built.document.version,
    manifestBlobId: upload.blobId,
    manifestHash: built.manifestHash,
    promptHash: built.promptHash,
    ...(built.tableVotePromptHash === undefined
      ? {}
      : { tableVotePromptHash: built.tableVotePromptHash }),
    modelId: options.modelId,
    providerId: "gonkarouter",
    toolPolicyHash: built.toolPolicyHash,
    evidencePolicyHash: built.document.evidencePolicyHash,
    publicKey: options.owner,
    registeredAtMs: 1,
    registeredCheckpoint: 100,
  };
  await repository.saveAgentManifest({
    manifest,
    role: options.role,
    ...(options.agentCapId === undefined ? {} : { agentCapId: options.agentCapId }),
    active: options.active ?? true,
    reputation: { runs: 3 },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  return built;
}

function dependencies(
  repository: Repository,
  walrus: ReturnType<typeof fakeWalrus>,
  gateway: Pick<SuiGateway, "updateAgentManifest">,
  resolvedCapId = "0xcap",
) {
  return {
    repository,
    walrus,
    gateway,
    slotAddresses: SLOTS,
    resolveAgentCapId: vi.fn(
      async (input: { agentCapId?: string }) => input.agentCapId ?? resolvedCapId,
    ),
    now: () => NOW,
  };
}

describe("agents republish", () => {
  it("moves a seat onto the current generation and records it on chain", async () => {
    const repository = await testRepository();
    const walrus = fakeWalrus();
    const { gateway, updates } = fakeGateway();
    const old = await seedSeat(repository, walrus, {
      agentProfileId: "0xseat1",
      owner: SLOTS[2]!,
      modelId: "moonshotai/Kimi-K2.6",
      role: "SKEPTIC",
      generation: "old",
      agentCapId: "0xseat1cap",
    });

    const report = await republishAgentManifests(
      dependencies(repository, walrus, gateway),
      { active: true },
    );

    expect(report).toMatchObject({
      dryRun: false,
      republished: 1,
      upToDate: 0,
    });
    expect(report.seats[0]).toMatchObject({
      agentProfileId: "0xseat1",
      modelId: "moonshotai/Kimi-K2.6",
      role: "SKEPTIC",
      slotIndex: 2,
      oldVersion: "3",
      oldPromptHash: old.promptHash,
      newVersion: "6",
      newPromptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V5),
      status: "republished",
      digest: "digest-1",
    });

    // Signed by the seat's own slot, against the cap the mirror recorded.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      agentIndex: 2,
      agentProfileId: "0xseat1",
      agentCapId: "0xseat1cap",
      manifestBlobId: report.seats[0]!.manifestBlobId,
    });

    const saved = await repository.getAgentManifest("0xseat1");
    expect(saved?.manifest).toMatchObject({
      version: "6",
      promptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V5),
      toolPolicyHash: toolPolicyHash(DEFAULT_TOOL_POLICY_V4),
      tableVotePromptHash: tableVotePromptSpecHash(),
    });
    expect(fromHex(saved!.manifest.manifestHash)).toEqual(
      (updates[0] as { manifestHash: Uint8Array }).manifestHash,
    );
    // Role, cap, eligibility and reputation survive the new row untouched.
    expect(saved).toMatchObject({
      role: "SKEPTIC",
      agentCapId: "0xseat1cap",
      active: true,
      reputation: { runs: 3 },
    });

    // The republished document keeps every identity field of the old one.
    const document = parseAgentManifestDocument(
      await walrus.get(saved!.manifest.manifestBlobId),
    );
    expect(document).toMatchObject({
      version: "6",
      network: "testnet",
      backingKind: "WALLET_STAKED",
      humanVerificationProvider: "sui-wallet-stake",
      operationalOwner: SLOTS[2],
      role: "SKEPTIC",
      modelId: "moonshotai/Kimi-K2.6",
      tableVotePromptHash: tableVotePromptSpecHash(),
    });
  });

  it("writes nothing on a dry run but still reports the generation it would publish", async () => {
    const repository = await testRepository();
    const walrus = fakeWalrus();
    const { gateway, updates } = fakeGateway();
    await seedSeat(repository, walrus, {
      agentProfileId: "0xseat1",
      owner: SLOTS[0]!,
      modelId: "moonshotai/Kimi-K2.6",
      role: "SKEPTIC",
      generation: "old",
    });
    const putsBefore = walrus.puts.length;

    const report = await republishAgentManifests(
      dependencies(repository, walrus, gateway),
      { active: true, dryRun: true },
    );

    expect(report).toMatchObject({ dryRun: true, republished: 0, upToDate: 0 });
    expect(report.seats[0]).toMatchObject({
      status: "dry run",
      oldVersion: "3",
      newVersion: "6",
      newPromptHash: promptSpecHash(DEFAULT_PROMPT_SPEC_V5),
    });
    expect(walrus.puts).toHaveLength(putsBefore);
    expect(updates).toHaveLength(0);
    await expect(repository.getAgentManifest("0xseat1")).resolves.toMatchObject({
      manifest: { version: "3" },
    });
  });

  it("skips a seat already on the current generation", async () => {
    const repository = await testRepository();
    const walrus = fakeWalrus();
    const { gateway, updates } = fakeGateway();
    await seedSeat(repository, walrus, {
      agentProfileId: "0xcurrent",
      owner: SLOTS[1]!,
      modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
      role: "SOURCE_AUTHENTICITY",
      generation: "current",
    });
    const putsBefore = walrus.puts.length;

    const report = await republishAgentManifests(
      dependencies(repository, walrus, gateway),
      { active: true },
    );

    expect(report).toMatchObject({ republished: 0, upToDate: 1 });
    expect(report.seats[0]).toMatchObject({
      status: "up to date",
      oldVersion: "6",
      newVersion: "6",
    });
    expect(walrus.puts).toHaveLength(putsBefore);
    expect(updates).toHaveLength(0);
  });

  it("fails closed before any write when a seat's owner is no derived slot", async () => {
    const repository = await testRepository();
    const walrus = fakeWalrus();
    const { gateway, updates } = fakeGateway();
    await seedSeat(repository, walrus, {
      agentProfileId: "0xseat1",
      owner: SLOTS[0]!,
      modelId: "moonshotai/Kimi-K2.6",
      role: "SKEPTIC",
      generation: "old",
    });
    await seedSeat(repository, walrus, {
      agentProfileId: "0xstranger",
      owner: `0x${"ff".repeat(32)}`,
      modelId: "moonshotai/Kimi-K2.6",
      role: "SKEPTIC",
      generation: "old",
    });
    const putsBefore = walrus.puts.length;

    await expect(
      republishAgentManifests(dependencies(repository, walrus, gateway), {
        active: true,
      }),
    ).rejects.toMatchObject({ code: "SEAT_OWNER_NOT_A_SLOT" });

    // The seat that would have worked is untouched: the check runs first.
    expect(walrus.puts).toHaveLength(putsBefore);
    expect(updates).toHaveLength(0);
    await expect(repository.getAgentManifest("0xseat1")).resolves.toMatchObject({
      manifest: { version: "3" },
    });
  });

  it("refuses a seat whose document names a different operational owner", async () => {
    const repository = await testRepository();
    const walrus = fakeWalrus();
    const { gateway, updates } = fakeGateway();
    const built = await seedSeat(repository, walrus, {
      agentProfileId: "0xseat1",
      owner: SLOTS[0]!,
      modelId: "moonshotai/Kimi-K2.6",
      role: "SKEPTIC",
      generation: "old",
    });
    // The row points at a document written for another slot, so republishing
    // it would hand the wrong key a manifest naming this seat.
    const record = await repository.getAgentManifest("0xseat1");
    await repository.saveAgentManifest({
      ...record!,
      manifest: { ...record!.manifest, owner: SLOTS[1]! as `0x${string}` },
    });
    expect(built.document.operationalOwner).toBe(SLOTS[0]);

    await expect(
      republishAgentManifests(dependencies(repository, walrus, gateway), {
        active: true,
      }),
    ).rejects.toMatchObject({ code: "SEAT_OWNER_MISMATCH" });
    expect(updates).toHaveLength(0);
  });

  it("republishes an inactive seat when it is named, and never under --active", async () => {
    const repository = await testRepository();
    const walrus = fakeWalrus();
    const { gateway, updates } = fakeGateway();
    await seedSeat(repository, walrus, {
      agentProfileId: "0xinactive",
      owner: SLOTS[0]!,
      modelId: "moonshotai/Kimi-K2.6",
      role: "SKEPTIC",
      generation: "old",
      active: false,
    });

    const skipped = await republishAgentManifests(
      dependencies(repository, walrus, gateway),
      { active: true },
    );
    expect(skipped.seats).toEqual([]);
    expect(updates).toHaveLength(0);

    const named = await republishAgentManifests(
      dependencies(repository, walrus, gateway),
      { agentProfileIds: ["0xinactive"] },
    );

    expect(named.seats[0]).toMatchObject({
      agentProfileId: "0xinactive",
      status: "republished",
    });
    expect(updates).toHaveLength(1);
    // Republishing does not put a seat back in the draw.
    await expect(repository.getAgentManifest("0xinactive")).resolves.toMatchObject({
      active: false,
      manifest: { version: "6" },
    });
  });

  it("refuses a profile id the mirror does not hold", async () => {
    const repository = await testRepository();
    const walrus = fakeWalrus();
    const { gateway } = fakeGateway();

    await expect(
      republishAgentManifests(dependencies(repository, walrus, gateway), {
        agentProfileIds: ["0xmissing"],
      }),
    ).rejects.toMatchObject({ code: "SEAT_NOT_MIRRORED" });
  });
});
