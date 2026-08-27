"use client";

import { useEffect, type ReactNode } from "react";
import {
  createDAppKit,
  DAppKitProvider,
  useCurrentClient,
  useCurrentNetwork,
} from "@mysten/dapp-kit-react";
import { isEnokiNetwork, registerEnokiWallets } from "@mysten/enoki";
import { SuiGrpcClient } from "@mysten/sui/grpc";

type OpenVerdictNetwork = "localnet" | "testnet" | "mainnet";

const NETWORKS: OpenVerdictNetwork[] = ["localnet", "testnet", "mainnet"];
const GRPC_URLS: Record<OpenVerdictNetwork, string> = {
  localnet: "http://127.0.0.1:9000",
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
};

function getDefaultNetwork(value: string | undefined): OpenVerdictNetwork {
  return NETWORKS.includes(value as OpenVerdictNetwork)
    ? (value as OpenVerdictNetwork)
    : "testnet";
}

const defaultNetwork = getDefaultNetwork(process.env.NEXT_PUBLIC_SUI_NETWORK);

export const dAppKit = createDAppKit({
  networks: NETWORKS,
  defaultNetwork,
  autoConnect: true,
  // Browser extensions and Enoki use Wallet Standard; avoid the optional web-wallet SSR initializer.
  slushWalletConfig: null,
  createClient: (network) =>
    new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
});

// Register the concrete instance so every v2 hook retains the network type.
declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}

function SuppressExtensionNoise() {
  useEffect(() => {
    // MetaMask's Sui adapter rejects unhandled during its own session restore
    // on page load (extension code we cannot catch at the source). Suppress
    // ONLY that known message so every real rejection still surfaces.
    const onRejection = (event: PromiseRejectionEvent) => {
      const message =
        event.reason instanceof Error ? event.reason.message : String(event.reason);
      if (message.includes("Failed to connect to MetaMask")) event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
  return null;
}

function RegisterEnokiWallets() {
  const client = useCurrentClient();
  const network = useCurrentNetwork();
  const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    // Enoki is optional. Extension wallets remain available without these keys.
    if (!apiKey || !googleClientId || !isEnokiNetwork(network)) return;

    const { unregister } = registerEnokiWallets({
      client,
      network,
      apiKey,
      providers: {
        google: { clientId: googleClientId },
      },
    });

    return unregister;
  }, [apiKey, client, googleClientId, network]);

  return null;
}

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <SuppressExtensionNoise />
      <RegisterEnokiWallets />
      {children}
    </DAppKitProvider>
  );
}
