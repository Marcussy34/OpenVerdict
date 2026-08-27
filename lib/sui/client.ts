import type { ClientWithCoreApi } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { ReleaseManifest } from "./manifest";

type CoreCompatibleClient<T extends ClientWithCoreApi> = T;

/** The transports OpenVerdict supports through the shared Sui Core API. */
export type OpenVerdictSuiClient = CoreCompatibleClient<
  SuiGrpcClient | SuiJsonRpcClient
>;

type ClientManifest = Pick<
  ReleaseManifest,
  "network" | "suiRpcUrl" | "suiRpcFallbackUrl"
>;

/** Select JSON-RPC for the CLI localnet and gRPC for public networks. */
export function createSuiClients(manifest: ReleaseManifest): OpenVerdictSuiClient {
  if (manifest.network === "localnet") {
    return new SuiJsonRpcClient({
      network: "localnet",
      url: manifest.suiRpcUrl,
    });
  }
  return new SuiGrpcClient({
    network: manifest.network,
    baseUrl: manifest.suiRpcUrl,
  });
}

/** Construct the JSON-RPC fallback used when a public gRPC endpoint is unavailable. */
export function createFallbackClient(manifest: ClientManifest): SuiJsonRpcClient {
  return new SuiJsonRpcClient({
    network: manifest.network,
    url: manifest.suiRpcFallbackUrl ?? manifest.suiRpcUrl,
  });
}
