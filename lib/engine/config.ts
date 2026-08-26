import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { GonkaRouterAdapter } from "../gonka";
import type {
  RetrievalPolicy,
  RetrievalRejection,
  RetrievedArtifact,
} from "../evidence";
import type { AgentManifest } from "../protocol";
import type { DbHandle } from "../storage";
import type { SignerRegistry, SuiGateway } from "../sui";
import type { WalrusStore } from "../walrus";

export interface EngineAgentConfig {
  manifest: AgentManifest;
  role: string;
  agentCapId?: string;
  active?: boolean;
  reputation?: Record<string, number>;
}

export interface EngineConfig {
  network: "localnet" | "testnet" | "mainnet";
  manifestPath: string;
  db: DbHandle;
  walrus: WalrusStore;
  gonka: GonkaRouterAdapter;
  /** Required for real-chain operation; tests can inject suiGateway instead. */
  suiClient?: SuiGrpcClient;
  /** Required for real-chain operation; tests can inject suiGateway instead. */
  signers?: SignerRegistry;
  suiGateway?: SuiGateway;
  initialAgents?: EngineAgentConfig[];
  retrievalPolicy?: RetrievalPolicy;
  retrieve?: (
    url: string,
    policy: RetrievalPolicy,
  ) => Promise<RetrievedArtifact | RetrievalRejection>;
  now?: () => number;
  eventPollIntervalMs?: number;
}
