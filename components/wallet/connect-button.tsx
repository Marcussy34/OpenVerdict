"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  useDAppKit,
  useWalletConnection,
} from "@mysten/dapp-kit-react";
import {
  ArrowDown2,
  Copy,
  CopySuccess,
  LogoutCurve,
  Refresh,
  Wallet,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// The v2 modal registers a browser custom element, so it must never be prerendered.
const ConnectModal = dynamic(
  () =>
    import("@mysten/dapp-kit-react/ui").then((module) => module.ConnectModal),
  { ssr: false },
);

function truncateAddress(address: string) {
  return address.length > 11
    ? `${address.slice(0, 5)}…${address.slice(-4)}`
    : address;
}

export function WalletConnectButton() {
  const dAppKit = useDAppKit();
  const connection = useWalletConnection();
  const [connectRequest, setConnectRequest] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    };
  }, []);

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopyState("idle"), 2_000);
  }

  async function disconnect() {
    setDisconnecting(true);
    setDisconnectError(false);
    try {
      await dAppKit.disconnectWallet();
      setMenuOpen(false);
    } catch {
      setDisconnectError(true);
    } finally {
      setDisconnecting(false);
    }
  }

  if (connection.isConnecting || connection.isReconnecting) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="min-h-[44px] px-3"
        disabled
        aria-busy="true"
      >
        <Refresh
          size="16"
          variant="Linear"
          className="motion-safe:animate-spin"
          aria-hidden="true"
        />
        Connecting…
      </Button>
    );
  }

  if (!connection.account) {
    // Google-only onboarding: launch the Enoki zkLogin flow directly instead
    // of the generic wallet modal (which lists every installed extension).
    // The modal remains only as a fallback when Enoki keys are not configured.
    const connectWithGoogle = async () => {
      const googleWallet = dAppKit.stores.$wallets
        .get()
        .find((wallet) => /google/i.test(wallet.name));
      if (!googleWallet) {
        setConnectRequest((request) => request + 1);
        return;
      }
      try {
        await dAppKit.connectWallet({ wallet: googleWallet });
      } catch {
        // User closed the popup or the flow failed; leave the button idle.
      }
    };
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] px-3 font-semibold"
          onClick={() => void connectWithGoogle()}
        >
          <Wallet size="16" variant="Bold" aria-hidden="true" />
          Sign in
        </Button>
        {connectRequest > 0 && (
          <ConnectModal key={connectRequest} open />
        )}
      </>
    );
  }

  const { address } = connection.account;

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] max-w-40 gap-2 px-3 font-mono tabular-nums"
          aria-label={`Wallet ${address}`}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-live"
            aria-hidden="true"
          />
          <span className="truncate">{truncateAddress(address)}</span>
          <ArrowDown2 size="14" variant="Linear" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <div className="border-b border-border px-2 pb-2">
          <p className="text-xs font-medium text-ocean">Connected wallet</p>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {address}
          </p>
        </div>

        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void copyAddress(address)}
        >
          {copyState === "copied" ? (
            <CopySuccess size="17" variant="Bold" aria-hidden="true" />
          ) : (
            <Copy size="17" variant="Linear" aria-hidden="true" />
          )}
          <span aria-live="polite">
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy failed"
                : "Copy address"}
          </span>
        </button>

        <button
          type="button"
          className="flex min-h-[44px] w-full items-center gap-2 rounded-md px-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          onClick={() => void disconnect()}
          disabled={disconnecting}
          aria-busy={disconnecting}
        >
          <LogoutCurve size="17" variant="Linear" aria-hidden="true" />
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>

        {disconnectError && (
          <p className="px-2 pb-1 text-xs text-destructive" role="alert">
            Couldn&apos;t disconnect. Try again.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
