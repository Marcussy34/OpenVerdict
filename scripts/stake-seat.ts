#!/usr/bin/env node
/**
 * Stake 0.1 SUI on a juror seat through the public API, end to end.
 *
 *   pnpm stake:seat --base http://127.0.0.1:3000 --model <id> --role SKEPTIC
 *   pnpm stake:seat --base https://app.openverdict.info --key suiprivkey1...
 *   pnpm stake:seat --no-sponsor            the staking key pays its own gas
 *
 * Exactly the flow the stake card runs in the browser: POST /api/agents/stake/
 * prepare, build the one register_staked_agent transaction from what came back,
 * ask POST /api/sponsor to attach gas, sign, execute, then POST /api/agents/
 * stake/confirm. Without --key on testnet it derives a throwaway staking key
 * and funds it with 0.2 SUI from the operator. No secret is ever printed.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Keypair } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI, fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  SignerRegistry,
  buildRegisterStakedAgentTransaction,
  createFallbackClient,
  executeAndWait,
  loadReleaseManifest,
  type OpenVerdictSuiClient,
  type ReleaseManifest,
} from "../lib/sui";
import type { StakeConfirmation, StakePreparation } from "../lib/engine/contract";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = "config/release.testnet.json";
const DEFAULT_BASE = "http://127.0.0.1:3000";
const DEFAULT_ROLE = "SKEPTIC";
/** Enough for the stake plus a few transactions when the key pays its own gas. */
const THROWAWAY_FUNDING_MIST = 200_000_000n;

/** process.env first, then .env, the way the other operator scripts read it. */
function env(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim();
  if (fromProcess) return fromProcess;
  try {
    const raw = readFileSync(join(repositoryRoot, ".env"), "utf8");
    const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1]?.trim() || undefined;
}

function sui(mist: string | bigint): string {
  return (Number(mist) / Number(MIST_PER_SUI)).toFixed(4);
}

/** Decode a bech32 suiprivkey through the registry's supported-scheme list. */
function keypairFromSecret(secret: string): Keypair {
  return SignerRegistry.fromEnv({ SUI_OPERATOR_SECRET_KEY: secret }).getOperator();
}

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    // Non-JSON bodies (a proxy error page) surface as their raw text.
  }
  return { status: response.status, json };
}

function describe(json: unknown): string {
  if (json && typeof json === "object") {
    const payload = json as Record<string, unknown>;
    const error = typeof payload.error === "string" ? payload.error : "error";
    const message = typeof payload.message === "string" ? ` (${payload.message})` : "";
    return `${error}${message}`;
  }
  return String(json).slice(0, 200);
}

/**
 * The register_staked_agent PTB the wallet signs, from what prepare returned.
 *
 * The stake never comes out of the gas coin (buildRegisterStakedAgentTransaction
 * pins useGasCoin: false), because a sponsored kind must not touch the fund's
 * coin. That also means the staking key needs a second SUI coin whenever it
 * pays its own gas.
 */
function buildStakeTransaction(
  manifest: ReleaseManifest,
  preparation: StakePreparation,
): Transaction {
  return buildRegisterStakedAgentTransaction(manifest, {
    stakeMist: preparation.minStakeMist,
    manifestHash: hexBytes(preparation.args.manifestHash),
    manifestBlobId: preparation.args.manifestBlobId,
    modelHash: hexBytes(preparation.args.modelHash),
    roleHash: hexBytes(preparation.args.roleHash),
    stakerHash: hexBytes(preparation.args.stakerHash),
    operationalOwner: preparation.args.operationalOwner,
  });
}

function hexBytes(value: string): Uint8Array {
  const clean = value.startsWith("0x") ? value.slice(2) : value;
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** The StakePosition the seat's staker now owns, read back from the digest. */
async function stakePositionId(
  client: OpenVerdictSuiClient,
  digest: string,
): Promise<string | undefined> {
  const settled = await client.core.waitForTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
  if (settled.$kind === "FailedTransaction") return undefined;
  const objectTypes = settled.Transaction.objectTypes ?? {};
  for (const object of settled.Transaction.effects?.changedObjects ?? []) {
    if (object.idOperation !== "Created") continue;
    const type = objectTypes[object.objectId];
    if (type?.split("::").at(-1)?.split("<", 1)[0] === "StakePosition") {
      return object.objectId;
    }
  }
  return undefined;
}

/**
 * Move 0.2 SUI from the operator so a derived key can stake and pay gas.
 *
 * Sent as two coins of exactly the stake: the coin resolver stops at the first
 * coin that covers the stake, so the second one is always free to pay gas.
 */
async function fundThrowawayKey(
  client: OpenVerdictSuiClient,
  address: string,
  stakeMist: bigint,
): Promise<void> {
  const secret = env("SUI_OPERATOR_SECRET_KEY");
  if (!secret) {
    throw new Error(
      "SUI_OPERATOR_SECRET_KEY is required to fund a throwaway staking key; pass --key instead",
    );
  }
  const operator = keypairFromSecret(secret);
  const result = await executeAndWait(client, operator, () => {
    const tx = new Transaction();
    const coins = tx.splitCoins(tx.gas, [
      tx.pure.u64(stakeMist),
      tx.pure.u64(THROWAWAY_FUNDING_MIST - stakeMist),
    ]);
    tx.transferObjects([coins[0]!, coins[1]!], tx.pure.address(address));
    return tx;
  });
  console.log(
    `funded    ${address} with ${sui(THROWAWAY_FUNDING_MIST)} SUI (${result.digest})`,
  );
}

/** A self-paying staker needs one coin for the stake and another for gas. */
async function assertCanPayOwnGas(
  client: OpenVerdictSuiClient,
  owner: string,
): Promise<void> {
  const { objects } = await client.core.listCoins({
    owner,
    coinType: "0x2::sui::SUI",
    limit: 3,
  });
  if (objects.length < 2) {
    throw new Error(
      `${owner} owns ${objects.length} SUI coin object(s); paying its own gas needs two (one for the 0.1 SUI stake, one for gas). Split one with "sui client split-coin", or drop --no-sponsor.`,
    );
  }
}

async function main(): Promise<void> {
  const base = (flag("base") ?? DEFAULT_BASE).replace(/\/+$/, "");
  const role = flag("role") ?? DEFAULT_ROLE;
  const noSponsor = process.argv.includes("--no-sponsor");
  const manifestPath = join(
    repositoryRoot,
    env("OPENVERDICT_RELEASE_MANIFEST") ?? DEFAULT_MANIFEST,
  );
  const manifest: ReleaseManifest = await loadReleaseManifest(manifestPath);
  const modelId = flag("model") ?? manifest.gonka.models[0];
  if (!modelId) throw new Error(`${manifestPath} lists no Gonka models`);
  const client = createFallbackClient(manifest);

  const providedKey = flag("key");
  const staker = providedKey
    ? keypairFromSecret(providedKey)
    : Ed25519Keypair.generate();
  const stakerAddress = staker.toSuiAddress();
  console.log(`base      ${base}`);
  console.log(`network   ${manifest.network}`);
  console.log(`staker    ${stakerAddress}${providedKey ? "" : " (throwaway)"}`);
  console.log(`seat      ${modelId} / ${role}`);

  const prepared = await postJson(`${base}/api/agents/stake/prepare`, {
    address: stakerAddress,
    modelId,
    role,
  });
  if (prepared.status !== 200) {
    throw new Error(`prepare failed (${prepared.status}): ${describe(prepared.json)}`);
  }
  const preparation = prepared.json as StakePreparation;
  console.log(`prepared  slot ${preparation.args.operationalOwner}`);
  console.log(`manifest  ${preparation.args.manifestBlobId} on Walrus`);
  console.log(`stake     ${sui(preparation.minStakeMist)} SUI minimum`);
  // Funded only once the seat is reserved, so a rejected prepare costs nothing.
  if (!providedKey) {
    await fundThrowawayKey(client, stakerAddress, BigInt(preparation.minStakeMist));
  }

  // Ask the app to pay the gas first; a fund that is off, throttled or broken
  // just means the staking key pays for itself, exactly like the browser card.
  let sponsorship: { txBytes: string; sponsorSignature: string } | undefined;
  if (!noSponsor) {
    const tx = buildStakeTransaction(manifest, preparation);
    tx.setSender(stakerAddress);
    const transactionKind = toBase64(
      await tx.build({ client, onlyTransactionKind: true }),
    );
    const sponsored = await postJson(`${base}/api/sponsor`, {
      transactionKind,
      sender: stakerAddress,
    });
    if (sponsored.status === 200) {
      sponsorship = sponsored.json as { txBytes: string; sponsorSignature: string };
    } else {
      console.log(
        `sponsor   unavailable (${sponsored.status}): ${describe(sponsored.json)}`,
      );
    }
  }

  let digest: string;
  if (sponsorship) {
    // Sign exactly the bytes the gas station assembled, never a local rebuild.
    const transaction = fromBase64(sponsorship.txBytes);
    const senderSignature = await staker.signTransaction(transaction);
    const executed = await client.core.executeTransaction({
      transaction,
      signatures: [senderSignature.signature, sponsorship.sponsorSignature],
      include: { effects: true },
    });
    if (executed.$kind === "FailedTransaction") {
      throw new Error(
        executed.FailedTransaction.status.error?.message ??
          "sponsored stake transaction failed",
      );
    }
    digest = executed.Transaction.digest;
    console.log("gas       paid by OpenVerdict");
  } else {
    await assertCanPayOwnGas(client, stakerAddress);
    const result = await executeAndWait(client, staker, () =>
      buildStakeTransaction(manifest, preparation),
    );
    digest = result.digest;
    console.log("gas       paid by the staking key");
  }

  const positionId = await stakePositionId(client, digest);
  const confirmed = await postJson(`${base}/api/agents/stake/confirm`, {
    reservationId: preparation.reservationId,
    digest,
  });
  if (confirmed.status !== 200) {
    throw new Error(
      `confirm failed (${confirmed.status}) for digest ${digest}: ${describe(confirmed.json)}`,
    );
  }
  const confirmation = confirmed.json as StakeConfirmation;

  console.log(`profile   ${confirmation.agentProfileId}`);
  console.log(`position  ${positionId ?? "not found in the transaction"}`);
  console.log(`staked    ${sui(confirmation.stakeMist)} SUI by ${confirmation.staker}`);
  console.log(`gas float ${confirmation.gasFloat}`);
  console.log(`digest    ${digest}`);
  console.log(
    `explorer  ${manifest.explorerTxTemplate.replace("{digest}", digest) || digest}`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? // undici says only "fetch failed": the cause names the host or code.
        `${error.message}${error.cause ? ` (${String((error.cause as Error).message ?? error.cause)})` : ""}`
      : String(error);
  console.error(message);
  process.exitCode = 1;
});
