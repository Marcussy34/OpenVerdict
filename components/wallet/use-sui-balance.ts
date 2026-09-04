"use client";

import { useEffect, useState } from "react";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { formatSui } from "@/lib/web/format-sui";

/**
 * The connected address's SUI balance, read once through the dapp-kit client.
 *
 * One implementation for the two places that need it: the wallet menu, which
 * reads only while it is open, and the stake card, which needs the raw MIST to
 * compare against the seat minimum. Callers gate the read with `enabled`.
 *
 * The read is carried with the address it was made for, so a reconnection
 * never shows the last wallet's number, and a failed read stays null so the
 * caller shows nothing rather than a wrong figure.
 */
export function useSuiBalance(
  address: string | null | undefined,
  enabled = true,
): { mist: string | null; formatted: string | null } {
  const client = useCurrentClient();
  const [read, setRead] = useState<{ address: string; mist: string } | null>(null);

  useEffect(() => {
    if (!enabled || !address) return;
    let cancelled = false;
    client.core
      .getBalance({ owner: address, coinType: "0x2::sui::SUI" })
      .then((result) => {
        // Resolving later, so nothing here is set during the render pass.
        if (!cancelled) setRead({ address, mist: result.balance.balance });
      })
      .catch(() => {
        // A failed read shows nothing rather than a wrong number.
      });
    return () => {
      cancelled = true;
    };
  }, [client, address, enabled]);

  // Derived, never stored: a read for another address simply does not apply.
  const mist = read !== null && read.address === address ? read.mist : null;
  return { mist, formatted: mist === null ? null : formatSui(mist) };
}
