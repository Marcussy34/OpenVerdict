import type { AgentDirectoryEntry } from "@/lib/engine/contract";

/**
 * The directory entry plus the staked-seat fields. Read defensively: seats
 * registered before real stake shipped carry neither, and the fields only
 * appear once the engine records a staker for that profile.
 */
export type StakedAgentEntry = AgentDirectoryEntry & {
  staker?: string;
  stakeMist?: string;
};

/** How the seat was staked, in words. */
export function stakeKindLabel(agent: AgentDirectoryEntry): string {
  switch (agent.backing?.kind) {
    case "WALLET":
      return "Wallet stake";
    case "ZKLOGIN":
      return "Google sign-in stake";
    case "ALLOWLIST":
      return "Demo allowlist";
    default:
      return "Unverified";
  }
}

/** Mist to SUI with two decimals, e.g. "0.10". */
export function formatStakeSui(mist: string): string {
  try {
    return (Number(BigInt(mist)) / 1_000_000_000).toFixed(2);
  } catch {
    return "0.00";
  }
}

/** "0x12ab…cd34" for a staker address. */
export function shortAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * "Staked 0.10 SUI by 0x12ab…cd34", or null when this seat carries no
 * recorded stake (the operator posted its bond under the old free path).
 */
export function stakeSentence(agent: StakedAgentEntry): string | null {
  if (!agent.stakeMist || !agent.staker) return null;
  return `Staked ${formatStakeSui(agent.stakeMist)} SUI by ${shortAddress(agent.staker)}`;
}
