import { SuiGrpcClient } from "@mysten/sui/grpc";
import type { ReleaseManifest } from "./manifest";

/** Construct the current Sui v2 gRPC client with its required network tag. */
export function createSuiClients(manifest: ReleaseManifest): SuiGrpcClient {
  return new SuiGrpcClient({
    network: manifest.network,
    baseUrl: manifest.suiRpcUrl,
  });
}
