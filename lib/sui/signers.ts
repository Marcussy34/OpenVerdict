import {
  decodeSuiPrivateKey,
  type Keypair,
} from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { blake2b256 } from "../protocol/hash";

export interface BoundAgentSigner {
  keypair: Keypair;
  address: string;
  index: number;
  agentProfileId?: string;
  agentCapId?: string;
}

export class SignerRegistryError extends Error {
  override readonly name = "SignerRegistryError";
  readonly code = "SIGNER_NOT_CONFIGURED" as const;
}

/** Holds the operator and the explicitly test-only deterministic demo agents. */
export class SignerRegistry {
  readonly #operator?: Keypair;
  readonly #challenger?: Keypair;
  readonly #agents: BoundAgentSigner[];
  readonly #byProfileId = new Map<string, BoundAgentSigner>();
  readonly #byAddress = new Map<string, BoundAgentSigner>();

  constructor(
    operator?: Keypair,
    agents: BoundAgentSigner[] = [],
    challenger?: Keypair,
  ) {
    this.#operator = operator;
    this.#agents = agents;
    this.#challenger = challenger;
    for (const agent of agents) this.#byAddress.set(agent.address, agent);
  }

  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    agentCount = 5,
  ): SignerRegistry {
    const operatorSecret = env.SUI_OPERATOR_SECRET_KEY?.trim();
    const operator = operatorSecret ? keypairFromSecretKey(operatorSecret) : undefined;
    const seed = env.OPENVERDICT_AGENT_SEED?.trim();
    const agents = seed ? deriveDemoAgents(seed, agentCount) : [];
    const challengerSecret = env.SUI_CHALLENGER_SECRET_KEY?.trim();
    const challenger = challengerSecret
      ? keypairFromSecretKey(challengerSecret)
      : seed
        ? deriveTestOnlyKey(seed, "CHALLENGER")
        : undefined;
    return new SignerRegistry(operator, agents, challenger);
  }

  getOperator(): Keypair {
    if (!this.#operator) {
      throw new SignerRegistryError("SUI_OPERATOR_SECRET_KEY is not configured");
    }
    return this.#operator;
  }

  operatorAddress(): string | undefined {
    return this.#operator?.toSuiAddress();
  }

  getChallenger(): Keypair {
    if (!this.#challenger) {
      throw new SignerRegistryError(
        "SUI_CHALLENGER_SECRET_KEY or OPENVERDICT_AGENT_SEED is required",
      );
    }
    return this.#challenger;
  }

  challengerAddress(): string | undefined {
    return this.#challenger?.toSuiAddress();
  }

  listAgentAddresses(): string[] {
    return this.#agents.map((agent) => agent.address);
  }

  listAgents(): readonly BoundAgentSigner[] {
    return this.#agents;
  }

  getAgentAt(index: number): BoundAgentSigner {
    const agent = this.#agents[index];
    if (!agent) throw new SignerRegistryError(`demo agent signer ${index} is not configured`);
    return agent;
  }

  getAgentByProfileId(agentProfileId: string): BoundAgentSigner {
    const agent = this.#byProfileId.get(agentProfileId);
    if (!agent) {
      throw new SignerRegistryError(`no signer bound to agent profile ${agentProfileId}`);
    }
    return agent;
  }

  getAgentByOwner(owner: string): BoundAgentSigner {
    const agent = this.#byAddress.get(owner);
    if (!agent) throw new SignerRegistryError(`no signer configured for agent owner ${owner}`);
    return agent;
  }

  bindAgentProfile(input: {
    agentProfileId: string;
    agentCapId?: string;
    owner?: string;
    index?: number;
  }): BoundAgentSigner {
    const agent =
      input.owner === undefined
        ? this.getAgentAt(input.index ?? 0)
        : this.getAgentByOwner(input.owner);
    agent.agentProfileId = input.agentProfileId;
    if (input.agentCapId !== undefined) agent.agentCapId = input.agentCapId;
    this.#byProfileId.set(input.agentProfileId, agent);
    return agent;
  }
}

function keypairFromSecretKey(secret: string): Keypair {
  const decoded = decodeSuiPrivateKey(secret);
  if (decoded.scheme === "ED25519") return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  if (decoded.scheme === "Secp256k1") return Secp256k1Keypair.fromSecretKey(decoded.secretKey);
  if (decoded.scheme === "Secp256r1") return Secp256r1Keypair.fromSecretKey(decoded.secretKey);
  throw new SignerRegistryError(`unsupported operator key scheme: ${decoded.scheme}`);
}

function deriveDemoAgents(seed: string, count: number): BoundAgentSigner[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new SignerRegistryError("agentCount must be a non-negative integer");
  }
  const encoder = new TextEncoder();
  return Array.from({ length: count }, (_, index) => {
    // TEST-ONLY: deterministic keys must never be funded or reused in production.
    const keypair = deriveTestOnlyKey(`${seed}:${index}`, "AGENT", encoder);
    return { keypair, address: keypair.toSuiAddress(), index };
  });
}

function deriveTestOnlyKey(
  seed: string,
  role: string,
  encoder = new TextEncoder(),
): Ed25519Keypair {
  // TEST-ONLY: deterministic keys must never be funded or reused in production.
  return Ed25519Keypair.fromSecretKey(
    blake2b256(encoder.encode(`OPENVERDICT_TEST_ONLY_${role}:${seed}`)),
  );
}
