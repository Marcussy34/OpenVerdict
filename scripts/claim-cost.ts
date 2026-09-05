#!/usr/bin/env node
/**
 * Public claim cost CLI, the arithmetic behind docs/site/cost.md.
 *
 *   pnpm cost:claim <link|id> [--base <url>] [--rpc <url>] [--sui-usd <n>]
 *       [--wal-usd <n>] [--gonka-usd-per-mtoken <model=price,...>]
 *       [--firecrawl-usd-per-credit <n>] [--json <file>] [--quiet]
 *   pnpm cost:claim --board [...]        every claim the observer lists
 *   pnpm cost:claim --run-total [...]    the board plus every paying address
 *
 * Reads nothing but public sources: the observer API, Sui JSON-RPC and the
 * Walrus system object. No price is built in. Without the rate flags the
 * output stays in MIST, FROST, tokens and credits.
 *
 * Exit codes: 0 measured, 2 input or fetch error (one line on stderr).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AuditInputError, DEFAULT_BASE, DEFAULT_RPC_URLS, parseAuditTarget } from "../lib/audit/audit-claim";
import {
  boardTargets,
  measureClaimCost,
  measureRunTotals,
  parseModelPrices,
  renderClaimCost,
  renderRunTotals,
  type ClaimCostMeasurement,
  type CostRates,
} from "../lib/cost/claim-cost";

/** The address that signs claim creation, evidence freeze and finalize. */
const DEFAULT_OPERATOR = "0xff3538d73840319aa0439ca047118b584a423b48c94ac0776f6cef25d73b9e1a";

type CliOptions = {
  input?: string;
  base: string;
  rpc: string;
  json?: string;
  board: boolean;
  runTotal: boolean;
  operator: string;
  lanes: string[];
  quiet: boolean;
  help: boolean;
  rates: CostRates;
};

const USAGE =
  "usage: pnpm cost:claim <link|id> [--base <url>] [--rpc <url>] [--sui-usd <n>] [--wal-usd <n>]\n" +
  "                      [--gonka-usd-per-mtoken <model=price,...>] [--firecrawl-usd-per-credit <n>]\n" +
  "                      [--json <file>] [--quiet]\n" +
  "       pnpm cost:claim --board [...]\n" +
  "       pnpm cost:claim --run-total [--operator <address>] [--lane <address>] [...]";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    base: DEFAULT_BASE,
    rpc: DEFAULT_RPC_URLS[0] ?? "",
    board: false,
    runTotal: false,
    operator: DEFAULT_OPERATOR,
    lanes: [],
    quiet: false,
    help: false,
    rates: {},
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new AuditInputError(`${argument} needs a value`);
      }
      index += 1;
      return next;
    };
    const numberValue = (): number => {
      const raw = value();
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new AuditInputError(`${argument} expects a non-negative number, got ${raw}`);
      }
      return parsed;
    };
    switch (argument) {
      case "--base":
        options.base = value();
        break;
      case "--rpc":
        options.rpc = value();
        break;
      case "--json":
        options.json = value();
        break;
      case "--board":
        options.board = true;
        break;
      case "--run-total":
        options.runTotal = true;
        break;
      case "--operator":
        options.operator = value();
        break;
      case "--lane":
        options.lanes.push(value());
        break;
      case "--sui-usd":
        options.rates.suiUsd = numberValue();
        break;
      case "--wal-usd":
        options.rates.walUsd = numberValue();
        break;
      case "--firecrawl-usd-per-credit":
        options.rates.firecrawlUsdPerCredit = numberValue();
        break;
      case "--gonka-usd-per-mtoken":
        options.rates.gonkaUsdPerMillionTokens = parseModelPrices(value());
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (argument.startsWith("--")) throw new AuditInputError(`unknown option ${argument}`);
        if (options.input !== undefined) {
          throw new AuditInputError("only one claim link or id is accepted");
        }
        options.input = argument;
    }
  }
  return options;
}

function writeJson(path: string, body: unknown): string {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(body, null, 2)}\n`);
  return absolute;
}

/** One line per claim, so a board run stays readable. */
function renderBoardSummary(claims: readonly ClaimCostMeasurement[]): string {
  const rows = [
    "| Claim | State | Seats | Gas (SUI) | WAL | Tokens | Credits |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const claim of claims) {
    const tokens = claim.models.reduce((n, m) => n + m.inputTokens + m.outputTokens, 0);
    rows.push(
      `| ${claim.claimId.slice(0, 10)} | ${claim.stateLabel} | ${claim.seats} | ${(claim.totalGasMist / 1e9).toFixed(6)} | ${(claim.walPaidFrost / 1e9).toFixed(6)} | ${tokens} | ${claim.research.credits} |`,
    );
  }
  return rows.join("\n");
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stderr.write(`${USAGE}\n`);
    return 0;
  }
  const log = options.quiet ? undefined : (line: string) => process.stderr.write(`cost: ${line}\n`);
  const measureOptions = {
    fetch: globalThis.fetch,
    base: options.base,
    rpcUrl: options.rpc,
    lanes: options.lanes,
    ...(log === undefined ? {} : { log }),
  };

  if (options.runTotal) {
    const totals = await measureRunTotals({ ...measureOptions, operator: options.operator });
    if (options.json) {
      const path = writeJson(options.json, totals);
      process.stderr.write(`cost: JSON written to ${path}\n`);
    }
    process.stdout.write(`${renderRunTotals(totals, options.rates)}\n`);
    process.stdout.write(`${renderBoardSummary(totals.claims)}\n`);
    return 0;
  }

  if (options.board) {
    const targets = await boardTargets(options.base, measureOptions);
    const claims: ClaimCostMeasurement[] = [];
    for (const target of targets) claims.push(await measureClaimCost(target, measureOptions));
    if (options.json) {
      const path = writeJson(options.json, { version: 1, generatedAt: new Date().toISOString(), claims });
      process.stderr.write(`cost: JSON written to ${path}\n`);
    }
    for (const claim of claims) process.stdout.write(`${renderClaimCost(claim, options.rates)}\n`);
    process.stdout.write(`${renderBoardSummary(claims)}\n`);
    return 0;
  }

  if (options.input === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const target = parseAuditTarget(options.input, { base: options.base });
  const measurement = await measureClaimCost(target, measureOptions);
  if (options.json) {
    const path = writeJson(options.json, {
      version: 1,
      generatedAt: new Date().toISOString(),
      rates: options.rates,
      claim: measurement,
    });
    process.stderr.write(`cost: JSON written to ${path}\n`);
  }
  process.stdout.write(`${renderClaimCost(measurement, options.rates)}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 2;
  });
