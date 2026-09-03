#!/usr/bin/env node
/**
 * Public claim auditor CLI (docs/superpowers/specs/2026-09-03-audit-skill-design.md).
 *
 *   pnpm audit:claim <link|id> [--base <url>] [--json <file>] [--out <file>] [--run <runId>] [--quiet]
 *
 * Prints the Markdown dossier to stdout (the verdict card only with --quiet),
 * writes it to --out (default .audit/<claimId>.md under the current directory)
 * and optionally dumps the raw sources and checks as JSON.
 * Exit codes: 0 every check passed or was unavailable, 1 any FAIL, 2 input or
 * fetch error (one line on stderr).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AuditInputError,
  auditClaim,
  parseAuditTarget,
  renderJson,
  renderMarkdown,
  renderVerdictCard,
} from "../lib/audit/audit-claim";

type CliOptions = {
  input?: string;
  base?: string;
  json?: string;
  out?: string;
  run?: string;
  quiet: boolean;
  help: boolean;
};

const USAGE =
  "usage: pnpm audit:claim <link|id> [--base <url>] [--json <file>] [--out <file>] [--run <runId>] [--quiet]";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new AuditInputError(`${argument} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (argument) {
      case "--base":
        options.base = value();
        break;
      case "--json":
        options.json = value();
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
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (argument.startsWith("--")) throw new AuditInputError(`unknown option ${argument}`);
        if (options.input !== undefined) throw new AuditInputError("only one claim link or id is accepted");
        options.input = argument;
    }
  }
  return options;
}

function writeFile(path: string, content: string): string {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options.input === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return options.help ? 0 : 2;
  }
  const target = parseAuditTarget(options.input, options.base ? { base: options.base } : {});
  // A run link or --run puts that run first in the dossier.
  const runFromFlag = options.run ? parseRunFlag(options.run) : undefined;
  if (runFromFlag) target.runId = runFromFlag;

  const result = await auditClaim(target, {
    fetch: globalThis.fetch,
    log: (line) => process.stderr.write(`audit: ${line}\n`),
  });

  let jsonPath: string | undefined;
  if (options.json) jsonPath = writeFile(options.json, renderJson(result));
  const markdown = renderMarkdown(result, { ...(jsonPath ? { jsonPath } : {}), ...(target.runId ? { runId: target.runId } : {}) });
  const outPath = writeFile(options.out ?? `.audit/${result.claim.claimId}.md`, markdown);
  process.stdout.write(options.quiet ? `${renderVerdictCard(result)}\n` : markdown);
  process.stderr.write(`audit: dossier written to ${outPath}${jsonPath ? `, JSON to ${jsonPath}` : ""}\n`);
  return result.exitCode;
}

/** --run accepts a bare run id or a run link. */
function parseRunFlag(value: string): string {
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return value.toLowerCase();
  const match = value.match(/\/runs\/(0x[0-9a-fA-F]{1,64})/);
  if (match?.[1]) return match[1].toLowerCase();
  throw new AuditInputError(`--run expects a run id or a run link, got ${value}`);
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
