"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useDAppKit, useWalletConnection } from "@mysten/dapp-kit-react";
import { isEnokiWallet, isGoogleWallet } from "@mysten/enoki";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SuiMark } from "@/components/brand/logos";
import { useSuiBalance } from "@/components/wallet/use-sui-balance";

// The v2 modal registers a browser custom element, so it must never be prerendered.
const ConnectModal = dynamic(
  () =>
    import("@mysten/dapp-kit-react/ui").then((module) => module.ConnectModal),
  { ssr: false },
);

/** "0x67a4…227a": six characters, an ellipsis, four. One helper, so the header
 *  chip and the menu's address row always show the same shape. */
function truncateAddress(address: string, lead = 6, tail = 4) {
  return address.length > lead + tail + 1
    ? `${address.slice(0, lead)}…${address.slice(-tail)}`
    : address;
}

export function WalletConnectButton() {
  const dAppKit = useDAppKit();
  const connection = useWalletConnection();
  const connectedAddress = connection.account?.address ?? null;
  const [connectRequest, setConnectRequest] = useState(0);
  const [signInOpen, setSignInOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The SUI balance shown in the dropdown (owner request), read through the
  // shared hook the stake card also uses. It runs only while the menu is open:
  // that is both the one place the number appears and the moment it should be
  // fresh.
  const { formatted: balance } = useSuiBalance(connectedAddress, menuOpen);

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
        className="ov-nav-chip"
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
    // Google-only onboarding behind a compact modal. Identify the wallet by
    // Enoki's metadata feature, NEVER by display name — any extension can
    // register a wallet-standard wallet named "Google". The generic dapp-kit
    // modal remains only as a fallback when Enoki keys are not configured.
    const googleWallet = dAppKit.stores.$wallets
      .get()
      .find((wallet) => isEnokiWallet(wallet) && isGoogleWallet(wallet));
    const connectWithGoogle = async () => {
      if (!googleWallet) {
        setConnectRequest((request) => request + 1);
        return;
      }
      setSignInOpen(false);
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
          className="ov-nav-chip"
          onClick={() => setSignInOpen(true)}
        >
          <Wallet size="16" variant="Bold" aria-hidden="true" />
          Sign in
        </Button>
        <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
          <DialogContent className="max-w-xs gap-4 p-6" aria-describedby={undefined}>
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-base">Sign in</DialogTitle>
            </DialogHeader>
            <Button
              variant="outline"
              className="min-h-[48px] w-full justify-center gap-2.5 font-semibold"
              onClick={() => void connectWithGoogle()}
            >
              {googleWallet?.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={googleWallet.icon}
                  alt=""
                  className="h-4.5 w-4.5"
                  aria-hidden="true"
                />
              ) : null}
              Sign in with Google
            </Button>
          </DialogContent>
        </Dialog>
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
          className="ov-nav-chip max-w-40 font-mono tabular-nums"
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
          {/* One line, not all 66 characters: the shortened address with its
              own copy control. See WalletAddressRow. */}
          <WalletAddressRow
            address={address}
            copyState={copyState}
            onCopy={() => void copyAddress(address)}
          />
          {balance !== null && (
            // One row: the Sui mark holds the left edge, the amount sits on
            // the right in the mono face so digits line up between reads.
            // The mark is ink, not the Sui brand blue: one palette everywhere.
            <p className="mt-1.5 flex items-center justify-between gap-2">
              <SuiMark className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-xs tabular-nums text-foreground">
                {balance} <span className="text-muted-foreground">SUI</span>
              </span>
            </p>
          )}
        </div>

        {/* The "Copy address" item is gone: the address row above copies, and
            one copy control is enough. A failed clipboard still needs saying. */}
        {copyState === "error" && (
          <p className="px-2 pb-1 text-xs text-destructive" role="alert">
            Couldn&apos;t copy the address. Try again.
          </p>
        )}

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

/** How the menu's copy control is doing right now. */
type CopyState = "idle" | "copied" | "error";

/**
 * The address line in the wallet menu: the same head-and-tail shape the header
 * chip shows, in the mono face, with the copy control on the row itself. The
 * whole address stays in the title attribute, and the row carries a full
 * menu-row hit target because it is the menu's only copy control.
 *
 * Exported so the row can be rendered without a live wallet connection.
 */
export function WalletAddressRow({
  address,
  copyState,
  onCopy,
}: {
  address: string;
  copyState: CopyState;
  onCopy: () => void;
}) {
  const label =
    copyState === "copied"
      ? "Address copied"
      : copyState === "error"
        ? "Copy failed"
        : "Copy address";

  return (
    <>
      <button
        type="button"
        onClick={onCopy}
        title={address}
        aria-label={label}
        // Full width of the menu, so the copy control sits on the same right
        // edge as the balance below it; the hover pad hangs past both edges.
        className="-mx-1.5 mt-0.5 flex min-h-[44px] w-[calc(100%+0.75rem)] items-center justify-between gap-1.5 rounded-md px-1.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="font-mono text-xs text-muted-foreground">
          {truncateAddress(address, 12, 8)}
        </span>
        {copyState === "copied" ? (
          // The accent, not the yes green: green is reserved for protocol
          // outcomes, and the filled glyph already reads as done.
          <CopySuccess
            size="14"
            variant="Bold"
            className="text-primary"
            aria-hidden="true"
          />
        ) : (
          <Copy
            size="14"
            variant="Linear"
            className="text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </button>
      {/* The label change alone is not reliably announced, so say it. */}
      <span className="sr-only" role="status">
        {copyState === "copied" ? "Address copied" : ""}
      </span>
    </>
  );
}
