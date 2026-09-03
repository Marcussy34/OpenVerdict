import { describe, expect, it } from "vitest";
import { SignerRegistry } from "../sui";
import {
  DEFAULT_AGENT_SLOTS,
  MIN_AGENT_SLOTS,
  EngineNotWiredError,
  readAgentSlots,
  readEnv,
} from "./server";

/**
 * Regression: Vercel (and most dashboards) persist a variable created without
 * a value as an EMPTY STRING, not as absent. `??` only falls back on
 * null/undefined, so a blank OPENVERDICT_RELEASE_MANIFEST used to survive as
 * "" and reach existsSync(""), which fails with the useless message
 * "release manifest is missing: ". Blank must mean unset.
 */
describe("readEnv", () => {
  it("falls back when the variable is absent", () => {
    expect(readEnv(undefined, "config/release.localnet.json")).toBe(
      "config/release.localnet.json",
    );
  });

  it("falls back when the variable is an empty string", () => {
    expect(readEnv("", "config/release.localnet.json")).toBe(
      "config/release.localnet.json",
    );
  });

  it("falls back when the variable is only whitespace", () => {
    expect(readEnv("   ", "config/release.localnet.json")).toBe(
      "config/release.localnet.json",
    );
  });

  it("uses a real value, trimmed of stray whitespace", () => {
    expect(readEnv(" config/release.testnet.json ", "fallback")).toBe(
      "config/release.testnet.json",
    );
  });
});

describe("readAgentSlots", () => {
  it("defaults to sixteen slots and accepts a larger pool", () => {
    expect(readAgentSlots({})).toBe(DEFAULT_AGENT_SLOTS);
    expect(readAgentSlots({ OPENVERDICT_AGENT_SLOTS: "" })).toBe(DEFAULT_AGENT_SLOTS);
    expect(readAgentSlots({ OPENVERDICT_AGENT_SLOTS: " 32 " })).toBe(32);
  });

  it("refuses a pool that would unseat the demo agents", () => {
    for (const value of ["6", "0", "-1", "16.5", "sixteen"]) {
      expect(() => readAgentSlots({ OPENVERDICT_AGENT_SLOTS: value })).toThrow(
        EngineNotWiredError,
      );
    }
    expect(readAgentSlots({ OPENVERDICT_AGENT_SLOTS: String(MIN_AGENT_SLOTS) })).toBe(
      MIN_AGENT_SLOTS,
    );
  });
});

/**
 * A staked seat is re-bound on boot by ADDRESS, not by index: the gateway reads
 * the profile's owner off chain and looks it up across the derived slots. That
 * only works while every slot address stays a pure function of the seed and its
 * index, so growing the pool must never move an existing seat.
 */
describe("operational slot addresses", () => {
  it("keeps the demo slots in place as the pool grows", () => {
    const env = { OPENVERDICT_AGENT_SEED: "slot-growth-test-seed" };
    const seven = SignerRegistry.fromEnv(env, MIN_AGENT_SLOTS);
    const sixteen = SignerRegistry.fromEnv(env, DEFAULT_AGENT_SLOTS);

    expect(sixteen.listAgentAddresses()).toHaveLength(DEFAULT_AGENT_SLOTS);
    expect(sixteen.listAgentAddresses().slice(0, MIN_AGENT_SLOTS)).toEqual(
      seven.listAgentAddresses(),
    );
    expect(new Set(sixteen.listAgentAddresses()).size).toBe(DEFAULT_AGENT_SLOTS);
  });

  it("finds a staked seat's slot again by owner address", () => {
    const env = { OPENVERDICT_AGENT_SEED: "slot-rebind-test-seed" };
    const stakedOwner = SignerRegistry.fromEnv(env, DEFAULT_AGENT_SLOTS).getAgentAt(9)
      .address;

    // A fresh process, exactly as a restarted engine builds it.
    const rebooted = SignerRegistry.fromEnv(env, DEFAULT_AGENT_SLOTS);
    const bound = rebooted.bindAgentProfile({
      agentProfileId: `0x${"77".repeat(32)}`,
      owner: stakedOwner,
    });

    expect(bound.index).toBe(9);
    expect(rebooted.getAgentByProfileId(`0x${"77".repeat(32)}`).address).toBe(
      stakedOwner,
    );
    // A pool that never grew past the demo slots cannot sign for that seat.
    expect(() =>
      SignerRegistry.fromEnv(env, MIN_AGENT_SLOTS).getAgentByOwner(stakedOwner),
    ).toThrow("no signer configured for agent owner");
  });
});
