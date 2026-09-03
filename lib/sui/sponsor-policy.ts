import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";

/**
 * What the public sponsorship route is willing to pay gas for.
 *
 * The gas belongs to the OpenVerdict Shinami fund, so an unchecked kind is a
 * drain: anyone could post any programmable transaction and have us fund it.
 * The allowlist is therefore positive, not a blocklist. Only the two app
 * targets below (plus the coin plumbing the Sui SDK emits to build the stake
 * coin) may appear, and nothing may touch the sponsor's money.
 */

/** One app call plus its coin plumbing resolves well inside this bound. */
export const MAX_SPONSORED_COMMANDS = 8;

/**
 * The move calls the fund pays for, both in the deployed package: entering the
 * demo binary pool, and staking on a juror seat. A Google sign-in user can then
 * stake 0.1 SUI with no gas of their own.
 */
const APP_TARGETS: ReadonlyArray<{ module: string; function: string }> = [
  { module: "demo_binary_pool", function: "enter" },
  { module: "agent_registry", function: "register_staked_agent" },
];

const APP_TARGET_LABEL = APP_TARGETS.map(
  (entry) => `${entry.module}::${entry.function}`,
).join(" or ");

const SUI_FRAMEWORK = normalizeSuiAddress("0x2");

/**
 * `tx.coin({ type, balance, useGasCoin: false })` does not always resolve to
 * split-and-merge. Depending on where the stake comes from, the SDK's
 * CoinWithBalance resolver also emits `0x2::coin::redeem_funds` (draw from the
 * sender's address balance), `send_funds` (return the remainder to it),
 * `destroy_zero` (the coins covered the stake exactly) and `zero`.
 *
 * All four only move the SENDER's own coins, so the worst an attacker gets by
 * bundling one is a transfer of their own money, and only alongside a real pool
 * entry. The withdrawal check below is what stops them reaching the sponsor's.
 */
const FRAMEWORK_COIN_FUNCTIONS = new Set([
  "redeem_funds",
  "send_funds",
  "destroy_zero",
  "zero",
]);

export interface SponsoredKindPolicy {
  packageId: string;
  maxCommands?: number;
}

export type SponsoredKindVerdict = { ok: true } | { ok: false; reason: string };

function reject(reason: string): SponsoredKindVerdict {
  return { ok: false, reason };
}

/** Decide whether a base64/BCS TransactionKind may be sponsored from our fund. */
export function validateSponsoredKind(
  bytes: Uint8Array | string,
  { packageId, maxCommands = MAX_SPONSORED_COMMANDS }: SponsoredKindPolicy,
): SponsoredKindVerdict {
  let data: ReturnType<Transaction["getData"]>;
  try {
    data = Transaction.fromKind(bytes).getData();
  } catch {
    return reject("transaction bytes are not a valid TransactionKind");
  }

  const commands = data.commands;
  if (commands.length === 0) return reject("transaction kind has no commands");
  if (commands.length > maxCommands) {
    return reject(`transaction kind has more than ${maxCommands} commands`);
  }

  // The gas coin is Shinami's, not the sender's: touching it anywhere both
  // fails at the gas station and would spend our fund's coin as an input.
  for (const command of commands) {
    if (commandArguments(command).some((argument) => argument.$kind === "GasCoin")) {
      return reject("transaction kind references the gas coin");
    }
  }

  // A FundsWithdrawal can name the SPONSOR as the source, which would drain the
  // gas fund's address balance on a transaction the sponsor signs. Sender only.
  for (const input of data.inputs) {
    const withdrawal = input.$kind === "FundsWithdrawal" ? input.FundsWithdrawal : null;
    if (withdrawal && withdrawal.withdrawFrom.$kind !== "Sender") {
      return reject("transaction kind withdraws funds from the sponsor");
    }
  }

  const target = normalizeSuiAddress(packageId);
  let appCalls = 0;
  for (const command of commands) {
    switch (command.$kind) {
      case "SplitCoins":
      case "MergeCoins":
        // Coin plumbing over the sender's own coins.
        break;
      case "MoveCall": {
        const call = command.MoveCall;
        const callPackage = normalizeSuiAddress(call.package);
        if (
          callPackage === target &&
          APP_TARGETS.some(
            (entry) => entry.module === call.module && entry.function === call.function,
          )
        ) {
          appCalls += 1;
          break;
        }
        if (
          callPackage === SUI_FRAMEWORK &&
          call.module === "coin" &&
          FRAMEWORK_COIN_FUNCTIONS.has(call.function)
        ) {
          break;
        }
        return reject(
          `move call ${call.module}::${call.function} is not sponsorable`,
        );
      }
      default:
        return reject(`command ${command.$kind} is not sponsorable`);
    }
  }

  if (appCalls === 0) {
    return reject(`transaction kind does not call ${APP_TARGET_LABEL}`);
  }
  return { ok: true };
}

type CommandData = ReturnType<Transaction["getData"]>["commands"][number];
type CommandArgument = { $kind: string };

/** Every argument position of a command, flattened, for the gas coin sweep. */
function commandArguments(command: CommandData): CommandArgument[] {
  switch (command.$kind) {
    case "MoveCall":
      return command.MoveCall.arguments;
    case "SplitCoins":
      return [command.SplitCoins.coin, ...command.SplitCoins.amounts];
    case "MergeCoins":
      return [command.MergeCoins.destination, ...command.MergeCoins.sources];
    case "TransferObjects":
      return [...command.TransferObjects.objects, command.TransferObjects.address];
    case "MakeMoveVec":
      return command.MakeMoveVec.elements;
    case "Upgrade":
      return [command.Upgrade.ticket];
    default:
      return [];
  }
}
