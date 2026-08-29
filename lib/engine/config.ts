import type { GonkaRouterAdapter } from "../gonka";
import type {
  RetrievalPolicy,
  RetrievalRejection,
  RetrievedArtifact,
} from "../evidence";
import type { AgentManifest } from "../protocol";
import type { ResearchProvider } from "../research";
import type { DbHandle } from "../storage";
import type { OpenVerdictSuiClient, SignerRegistry, SuiGateway } from "../sui";
import type { WalrusStore } from "../walrus";
import type { ZkLoginVerifier } from "./zklogin";

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
  research?: ResearchProvider;
  /** Required for real-chain operation; tests can inject suiGateway instead. */
  suiClient?: OpenVerdictSuiClient;
  /** Required for real-chain operation; tests can inject suiGateway instead. */
  signers?: SignerRegistry;
  suiGateway?: SuiGateway;
  initialAgents?: EngineAgentConfig[];
  /** Stub in tests; defaults to Mysten SDK verification through GraphQL. */
  zkLoginVerifier?: ZkLoginVerifier;
  /** Required override for localnet; testnet/mainnet use Mysten's network URL. */
  zkLoginGraphqlUrl?: string;
  retrievalPolicy?: RetrievalPolicy;
  retrieve?: (
    url: string,
    policy: RetrievalPolicy,
  ) => Promise<RetrievedArtifact | RetrievalRejection>;
  now?: () => number;
  eventPollIntervalMs?: number;
}
