#!/usr/bin/env node
/**
 * `ov`: the public OpenVerdict CLI (docs/superpowers/specs/2026-09-03-ov-cli-design.md).
 *
 *   pnpm ov <command> [options]      (or skills/openverdict/scripts/ov.sh)
 *
 * Commands: weather, board (alias claims), agents, agent, extract, submit,
 * status, watch, audit, trace, help.
 * Global options: --base <url>, --json, --no-banner, --no-color, --timeout <duration>.
 * Exit codes: 0 success, 2 input or request error, 3 the claim voided or gave
 * up (watch), 4 watch stopped before the end, 5 rate limited or writes disabled.
 * The banner goes to stderr so `--json` output on stdout stays parseable.
 */
import { Api, DEFAULT_BASE, OvError, realSleep } from "../lib/ov/api";
import { renderBanner, wantsColor } from "../lib/ov/banner";
import {
  agentCommand,
  agentsCommand,
  auditCommand,
  boardCommand,
  extractCommand,
  helpText,
  isCommand,
  resolveCommand,
  statusCommand,
  submitCommand,
  traceCommand,
  watchCommand,
  weatherCommand,
  type CommandEnv,
} from "../lib/ov/commands";
import { parseDuration } from "../lib/ov/render";

type CliOptions = {
  command?: string;
  positionals: string[];
  base?: string;
  json: boolean;
  /** `ov audit --json <file>` keeps the auditor's meaning: a file path. */
  jsonFile?: string;
  banner: boolean;
  color: boolean;
  timeoutMs?: number;
  help: boolean;
  limit?: number;
  urls: string[];
  text?: string;
  file?: string;
  criteria?: string;
  forMs?: number;
  since?: number;
  verbose: boolean;
  out?: string;
  run?: string;
  quiet: boolean;
  juror?: number;
  round?: 1 | 2;
  full: boolean;
  trace: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    positionals: [],
    json: false,
    banner: true,
    color: true,
    help: false,
    urls: [],
    verbose: false,
    quiet: false,
    full: false,
    trace: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("--") && next.length > 2)) {
        throw new OvError(`${argument} needs a value`);
      }
      index += 1;
      return next;
    };
    const whole = (flag: string) => {
      const number = Number(value());
      if (!Number.isInteger(number) || number < 0) throw new OvError(`${flag} expects a whole number`);
      return number;
    };
    switch (argument) {
      case "--base":
        options.base = value();
        break;
      case "--json":
        // The auditor's --json takes a file; everywhere else it is a switch.
        if (options.command === "audit") options.jsonFile = value();
        else options.json = true;
        break;
      case "--no-banner":
        options.banner = false;
        break;
      case "--no-color":
        options.color = false;
        break;
      case "--timeout":
        options.timeoutMs = parseDuration(value());
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--limit": {
        const limit = whole("--limit");
        if (limit < 1 || limit > 200) throw new OvError("--limit expects a whole number from 1 to 200");
        options.limit = limit;
        break;
      }
      case "--url":
        options.urls.push(value());
        break;
      case "--text":
        options.text = value();
        break;
      case "--file":
        options.file = value();
        break;
      case "--criteria":
        options.criteria = value();
        break;
      case "--for":
        options.forMs = parseDuration(value());
        break;
      case "--since":
        options.since = whole("--since");
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--out":
        options.out = value();
        break;
      case "--run":
        options.run = value();
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--juror": {
        const juror = whole("--juror");
        if (juror < 1) throw new OvError("--juror expects a juror number from 1 up");
        options.juror = juror;
        break;
      }
      case "--round": {
        const round = whole("--round");
        if (round !== 1 && round !== 2) throw new OvError("--round expects 1 or 2");
        options.round = round;
        break;
      }
      case "--full":
        options.full = true;
        break;
      case "--trace":
        options.trace = true;
        break;
      default:
        if (argument.startsWith("--")) throw new OvError(`unknown option ${argument}`);
        if (options.command === undefined) options.command = argument;
        else options.positionals.push(argument);
    }
  }
  return options;
}

function one(options: CliOptions, what: string): string {
  const [first, extra] = options.positionals;
  if (first === undefined) throw new OvError(`${options.command} needs ${what}`);
  if (extra !== undefined) throw new OvError(`${options.command} accepts one ${what}, got more`);
  return first;
}

async function run(options: CliOptions, env: CommandEnv): Promise<number> {
  // `ov claims` is the board under the name the console uses.
  switch (options.command === undefined ? undefined : resolveCommand(options.command)) {
    case "weather":
      return weatherCommand(env);
    case "board":
      return boardCommand(env, options.limit === undefined ? {} : { limit: options.limit });
    case "agents":
      if (options.positionals.length > 0) throw new OvError("agents takes no argument; one seat is ov agent <id>");
      return agentsCommand(env);
    case "agent":
      return agentCommand(env, one(options, "a seat id, id prefix or link"));
    case "extract":
      if (options.positionals.length > 0) throw new OvError("extract takes --url, --text or --file, not a bare argument");
      return extractCommand(env, {
        ...(options.urls[0] === undefined ? {} : { url: options.urls[0] }),
        ...(options.text === undefined ? {} : { text: options.text }),
        ...(options.file === undefined ? {} : { file: options.file }),
      });
    case "submit":
      return submitCommand(env, {
        claim: one(options, "the claim text in quotes"),
        ...(options.text === undefined ? {} : { text: options.text }),
        urls: options.urls,
        ...(options.criteria === undefined ? {} : { criteria: options.criteria }),
      });
    case "status":
      return statusCommand(env, one(options, "a claim id or link"));
    case "watch":
      return watchCommand(env, {
        target: one(options, "a claim id or claim link"),
        ...(options.forMs === undefined ? {} : { budgetMs: options.forMs }),
        ...(options.since === undefined ? {} : { since: options.since }),
        verbose: options.verbose,
      });
    case "audit":
      return auditCommand(env, {
        target: one(options, "a claim id or link"),
        ...(options.jsonFile === undefined ? {} : { jsonPath: options.jsonFile }),
        ...(options.out === undefined ? {} : { outPath: options.out }),
        ...(options.run === undefined ? {} : { run: options.run }),
        quiet: options.quiet,
        ...(options.trace
          ? {
              trace: {
                full: options.full,
                ...(options.juror === undefined ? {} : { juror: options.juror }),
                ...(options.round === undefined ? {} : { round: options.round }),
              },
            }
          : {}),
      });
    case "trace":
      return traceCommand(env, {
        target: one(options, "a claim id or link"),
        full: options.full,
        ...(options.juror === undefined ? {} : { juror: options.juror }),
        ...(options.round === undefined ? {} : { round: options.round }),
      });
    default:
      throw new OvError(`unknown command ${options.command}; try ov help`);
  }
}

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);
  const base = options.base ?? DEFAULT_BASE;
  const env = process.env;
  const color = wantsColor(env, Boolean(process.stderr.isTTY), !options.color);
  const showBanner = options.banner && env.OV_NO_BANNER !== "1" && env.OV_NO_BANNER !== "true";
  if (showBanner) {
    const banner = renderBanner({ base, command: `ov ${argv.join(" ")}`.trim(), color });
    process.stderr.write(`${banner.join("\n")}\n\n`);
  }
  if (options.command === undefined || options.command === "help" || options.help) {
    const topic = options.command === "help" ? options.positionals[0] : options.command;
    process.stdout.write(`${helpText(topic && isCommand(topic) ? topic : undefined)}\n`);
    return 0;
  }
  const commandEnv: CommandEnv = {
    api: new Api({
      base,
      fetch: globalThis.fetch,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }),
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
    json: options.json,
    now: Date.now,
    sleep: realSleep,
    color,
    ...(process.stdout.columns ? { width: process.stdout.columns } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  return run(options, commandEnv);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: ${message}\n`);
    // AuditInputError and anything unexpected count as input or request errors.
    process.exitCode = error instanceof OvError ? error.exitCode : 2;
  });
