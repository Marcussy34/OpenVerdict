export const ZKLOGIN_AGENT_ROLES = [
  "SKEPTIC",
  "SOURCE_AUTHENTICITY",
  "INVESTIGATOR",
] as const;

export type ZkLoginAgentRole = (typeof ZKLOGIN_AGENT_ROLES)[number];

export type ZkLoginVerificationInput = {
  zkLoginAddress: string;
  message: Uint8Array;
  signature: string;
};

/** Injectable boundary so engine tests never depend on a live Sui endpoint. */
export interface ZkLoginVerifier {
  verify(input: ZkLoginVerificationInput): Promise<boolean>;
}

/** Bytes authorized by the social-login wallet for one network deployment. */
export const buildZkLoginBackingMessage = (
  zkLoginAddress: string,
  network: "localnet" | "testnet" | "mainnet",
): Uint8Array =>
  new TextEncoder().encode(
    `OpenVerdict agent backing v1\naddress: ${zkLoginAddress}\nnetwork: ${network}`,
  );
