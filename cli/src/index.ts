#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
} from "commander";
import { z } from "zod";
import { buildHandler as buildClaimExtractionHandler } from "../../lib/claim-extraction/handler";
import type {
  Engine,
  FactCheckSubmission,
  ResolutionEvent,
} from "../../lib/engine/contract";
import {
  getServerClaimExtractionRuntime,
  getServerEngine,
} from "../../lib/engine/server";
import { OUTCOME, type VoteOutcome } from "../../lib/protocol";
import { SignerRegistry } from "../../lib/sui";

export interface CliDependencies {
  engine?: Engine;
  engineProvider?: () => Promise<Engine>;
  claimExtractionHandler?: (request: Request) => Promise<Response>;
  stdout?: (value: string) => void;
  stderr?: (value: string) => void;
  env?: Record<string, string | undefined>;
}

interface Preflight {
  type: "preflight";
  network: string;
  package: string;
  function: string;
  objects: Record<string, string>;
  signer: string;
}

const deadlinesSchema = z
  .object({
    evidenceCutoffMs: z.number().int().nonnegative(),
    proposalDeadlineMs: z.number().int().nonnegative(),
    challengeDeadlineMs: z.number().int().nonnegative(),
    firstCommitDeadlineMs: z.number().int().nonnegative(),
    firstRevealDeadlineMs: z.number().int().nonnegative(),
    discussionDeadlineMs: z.number().int().nonnegative(),
    secondCommitDeadlineMs: z.number().int().nonnegative(),
    secondRevealDeadlineMs: z.number().int().nonnegative(),
  })
  .strict();

const factCheckSchema = z
  .object({
    claim: z.string().min(1),
    text: z.string().optional(),
    urls: z.array(z.string()).default([]),
    resolutionCriteria: z.string().optional(),
  })
  .strict();

const claimExtractionResponseSchema = z
  .object({
    claims: z.array(
      z
        .object({
          claim: z.string(),
          reason: z.string(),
          quote: z.string(),
        })
        .strict(),
    ),
    language: z.string(),
    claim: z.string(),
    sourceUrl: z.string().optional(),
    modelId: z.string(),
    gonkaRequestId: z.string().optional(),
    gatewayRequestId: z.string().optional(),
  })
  .strict();

const claimExtractionErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

const claimCreateSchema = z
  .object({
    statement: z.string().min(1),
    resolutionCriteria: z.string().min(1),
    mode: z.union([z.literal(1), z.literal(2)]),
    deadlines: deadlinesSchema,
    committeeBudget: z.string().regex(/^\d+$/),
    evidenceBudget: z.string().regex(/^\d+$/),
  })
  .strict();

const challengeSchema = z
  .object({
    reason: z.string().min(1),
    evidenceUrls: z.array(z.string()).default([]),
  })
  .strict();

export function createCliProgram(dependencies: CliDependencies = {}): Command {
  const program = new Command();
  const writer = createWriter(dependencies);
  const engine = async (): Promise<Engine> =>
    dependencies.engine ??
    (dependencies.engineProvider ?? getServerEngine)();
  const environment = dependencies.env ?? process.env;
  // Local CLI extraction reuses the route logic without public HTTP guards.
  const claimExtractionHandler =
    dependencies.claimExtractionHandler ??
    buildClaimExtractionHandler({
      getRuntime: getServerClaimExtractionRuntime,
      requirePublicWritesEnabled: () => null,
      rateLimitPublic: () => null,
    });

  program
    .name("openverdict")
    .description("Headless OpenVerdict protocol control and diagnostics")
    .version("0.1.0")
    .option("--json", "emit deterministic newline-delimited JSON")
    .exitOverride()
    .configureOutput({
      writeOut: (value) => writer.raw(value),
      writeErr: () => undefined,
    });

  const factCheck = program.command("fact-check").description("direct public fact checks");
  factCheck
    .command("start")
    .requiredOption("--file <path>", "fact-check request JSON")
    .option("--follow", "follow public events after submission")
    .action(async (options, command) => {
      const service = await engine();
      const request = factCheckSchema.parse(await readJson(options.file));
      await preflight(writer, service, command, environment, {
        module: "demo_fact_checker",
        functionName: "start_fact_check",
        objects: { registry: "configured release registry" },
      });
      const result = await service.factCheckSubmit(request);
      const json = jsonMode(command);
      if (result.kind === "queued") {
        writer.value(json ? result : formatQueuedSubmission(result), json);
        return;
      }
      const launched = { claimId: result.claimId };
      writer.value(launched, json);
      if (options.follow) await followEvents(service, result.claimId, writer, json);
    });

  factCheck
    .command("extract")
    .description("extract up to three checkable claims")
    .argument("[url]", "source page URL")
    .option("--text <text>", "pasted source text")
    .action(async (
      url: string | undefined,
      options: { text?: string },
      command: Command,
    ) => {
      const body = claimExtractionRequestBody(url, options.text);
      const response = await claimExtractionHandler(
        new Request("http://localhost/api/extract-claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      const payload = await response.json() as unknown;
      if (!response.ok) throw claimExtractionError(payload, response.status);

      const result = claimExtractionResponseSchema.parse(payload);
      const json = jsonMode(command);
      writer.value(json ? result : formatExtractedClaims(result.claims), json);
    });

  factCheck
    .command("report")
    .requiredOption("--claim <id>", "claim object ID")
    .option("--verify", "recompute commitments, roots, and score")
    .action(async (options, command) => {
      const service = await engine();
      const report = await service.report(options.claim);
      const verification = options.verify
        ? (await service.inspect(options.claim, { verify: true })).verification
        : undefined;
      writer.value(
        verification === undefined ? report : { ...report, verification },
        jsonMode(command),
      );
    });

  const claim = program.command("claim").description("claim lifecycle operations");
  claim
    .command("create")
    .requiredOption("--file <path>", "claim request JSON")
    .action(async (options, command) => {
      const service = await engine();
      const request = claimCreateSchema.parse(await readJson(options.file));
      await preflight(writer, service, command, environment, {
        module: "claim",
        functionName: "create_claim",
        objects: { registry: "configured release registry" },
      });
      writer.value(await service.claimCreate(request), jsonMode(command));
    });

  claim
    .command("propose")
    .requiredOption("--claim <id>", "claim object ID")
    .requiredOption("--outcome <outcome>", "YES, NO, or UNSURE", parseOutcome)
    .action(async (options, command) => {
      const service = await engine();
      await preflight(writer, service, command, environment, {
        module: "claim",
        functionName: "propose_outcome",
        objects: { claim: options.claim, registry: "configured release registry" },
      });
      writer.value(
        await service.propose(options.claim, options.outcome),
        jsonMode(command),
      );
    });

  claim
    .command("challenge")
    .requiredOption("--claim <id>", "claim object ID")
    .requiredOption("--reason-file <path>", "challenge JSON")
    .action(async (options, command) => {
      const service = await engine();
      const reason = challengeSchema.parse(await readJson(options.reasonFile));
      await preflight(writer, service, command, environment, {
        module: "claim",
        functionName: "challenge_outcome",
        objects: { claim: options.claim, registry: "configured release registry" },
        signer: configuredSigner(environment, "challenger"),
      });
      writer.value(await service.challenge(options.claim, reason), jsonMode(command));
    });

  claim
    .command("advance")
    .requiredOption("--claim <id>", "claim object ID")
    .option("--follow", "follow public events after advancing")
    .action(async (options, command) => {
      const service = await engine();
      await preflight(writer, service, command, environment, {
        module: "claim/jury",
        functionName: "advance_phase|open_discussion|create_second_round_seats",
        objects: { claim: options.claim },
      });
      writer.value(await service.advance(options.claim), jsonMode(command));
      if (options.follow) await followEvents(service, options.claim, writer, jsonMode(command));
    });

  claim
    .command("finalize")
    .requiredOption("--claim <id>", "claim object ID")
    .action(async (options, command) => {
      const service = await engine();
      await preflight(writer, service, command, environment, {
        module: "settlement",
        functionName: "finalize_claim|finalize_unchallenged",
        objects: { claim: options.claim },
      });
      writer.value(await service.finalize(options.claim), jsonMode(command));
    });

  claim
    .command("inspect")
    .requiredOption("--claim <id>", "claim object ID")
    .option("--verify", "recompute commitments, roots, and score")
    .action(async (options, command) => {
      const service = await engine();
      writer.value(
        await service.inspect(options.claim, { verify: options.verify === true }),
        jsonMode(command),
      );
    });

  program
    .command("evidence")
    .description("evidence operations")
    .command("freeze")
    .requiredOption("--claim <id>", "claim object ID")
    .requiredOption("--phase <phase>", "round 1 or 2", parsePhase)
    .action(async (options, command) => {
      const service = await engine();
      await preflight(writer, service, command, environment, {
        module: "evidence",
        functionName: "freeze_evidence",
        objects: { claim: options.claim, phase: String(options.phase) },
      });
      writer.value(
        await service.evidenceFreeze(options.claim, options.phase),
        jsonMode(command),
      );
    });

  program
    .command("jury")
    .description("jury inference operations")
    .command("run")
    .requiredOption("--claim <id>", "claim object ID")
    .requiredOption("--phase <phase>", "round 1 or 2", parsePhase)
    .option("--follow", "follow public events after running")
    .action(async (options, command) => {
      const service = await engine();
      await preflight(writer, service, command, environment, {
        module: "jury",
        functionName: "approve_run",
        objects: { claim: options.claim, phase: String(options.phase) },
      });
      writer.value(await service.juryRun(options.claim, options.phase), jsonMode(command));
      if (options.follow) await followEvents(service, options.claim, writer, jsonMode(command));
    });

  const votes = program.command("votes").description("vote commitment and reveal operations");
  votes
    .command("commit")
    .requiredOption("--claim <id>", "claim object ID")
    .requiredOption("--phase <phase>", "round 1 or 2", parsePhase)
    .action(async (options, command) => {
      const service = await engine();
      await preflight(writer, service, command, environment, {
        module: "jury",
        functionName: "commit_vote",
        objects: { claim: options.claim, phase: String(options.phase) },
        signer: "selected agent signers",
      });
      writer.value(
        await service.votesCommit(options.claim, options.phase),
        jsonMode(command),
      );
    });

  votes
    .command("reveal")
    .requiredOption("--claim <id>", "claim object ID")
    .requiredOption("--phase <phase>", "round 1 or 2", parsePhase)
    .action(async (options, command) => {
      const service = await engine();
      await preflight(writer, service, command, environment, {
        module: "jury",
        functionName: "reveal_vote",
        objects: { claim: options.claim, phase: String(options.phase) },
        signer: "selected agent signers",
      });
      writer.value(
        await service.votesReveal(options.claim, options.phase),
        jsonMode(command),
      );
    });

  program
    .command("events")
    .description("resolution event stream")
    .command("follow")
    .requiredOption("--claim <id>", "claim object ID")
    .option("--public", "explicitly request the public visibility-filtered stream")
    .action(async (options, command) => {
      await followEvents(await engine(), options.claim, writer, jsonMode(command));
    });

  return program;
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const writer = createWriter(dependencies);
  try {
    await createCliProgram(dependencies).parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    const code = stableErrorCode(error);
    writer.error({ code, message: errorMessage(error) }, argv.includes("--json"));
    return error instanceof CommanderError ? 2 : 1;
  }
}

async function preflight(
  writer: ReturnType<typeof createWriter>,
  engine: Engine,
  command: Command,
  environment: Record<string, string | undefined>,
  input: {
    module: string;
    functionName: string;
    objects: Record<string, string>;
    signer?: string;
  },
): Promise<void> {
  const status = await engine.status();
  writer.preflight(
    {
      type: "preflight",
      network: status.network,
      package: status.packageId,
      function: `${status.packageId}::${input.module}::${input.functionName}`,
      objects: input.objects,
      signer:
        input.signer ??
        environment.SUI_OPERATOR_ADDRESS ??
        configuredSigner(environment, "operator"),
    },
    jsonMode(command),
  );
}

async function followEvents(
  engine: Engine,
  claimId: string,
  writer: ReturnType<typeof createWriter>,
  json: boolean,
): Promise<void> {
  for await (const event of engine.events(claimId)) writer.event(event, json);
}

function createWriter(dependencies: CliDependencies) {
  const stdout = dependencies.stdout ?? ((value: string) => process.stdout.write(`${value}\n`));
  const stderr = dependencies.stderr ?? ((value: string) => process.stderr.write(`${value}\n`));
  return {
    raw(value: string) {
      stdout(value.replace(/\n$/, ""));
    },
    value(value: unknown, json: boolean) {
      stdout(json ? JSON.stringify(value) : formatHuman(value));
    },
    event(event: ResolutionEvent, json: boolean) {
      stdout(
        json
          ? JSON.stringify(event)
          : `[${event.sequence}] ${event.phase} ${event.kind} (${event.source})`,
      );
    },
    preflight(value: Preflight, json: boolean) {
      stdout(
        json
          ? JSON.stringify(value)
          : [
              `Network: ${value.network}`,
              `Package: ${value.package}`,
              `Function: ${value.function}`,
              `Objects: ${JSON.stringify(value.objects)}`,
              `Signer: ${value.signer}`,
            ].join("\n"),
      );
    },
    error(value: { code: string; message: string }, json = false) {
      stderr(json ? JSON.stringify({ type: "error", ...value }) : `${value.code}: ${value.message}`);
    },
  };
}

function jsonMode(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

function parsePhase(value: string): 1 | 2 {
  if (value === "1") return 1;
  if (value === "2") return 2;
  throw new InvalidArgumentError("phase must be 1 or 2");
}

function parseOutcome(value: string): VoteOutcome {
  const normalized = value.toUpperCase();
  if (normalized === "YES") return OUTCOME.YES;
  if (normalized === "NO") return OUTCOME.NO;
  if (normalized === "UNSURE") return OUTCOME.UNSURE;
  throw new InvalidArgumentError("outcome must be YES, NO, or UNSURE");
}

function claimExtractionRequestBody(
  url: string | undefined,
  text: string | undefined,
): { url: string } | { text: string } {
  if (url !== undefined && text === undefined) return { url };
  if (url === undefined && text !== undefined) return { text };
  throw new InvalidArgumentError("provide exactly one URL argument or --text");
}

function claimExtractionError(payload: unknown, status: number): Error {
  const parsed = claimExtractionErrorSchema.safeParse(payload);
  if (!parsed.success) {
    return Object.assign(
      new Error(`Claim extraction failed with status ${status}.`),
      { code: "CLAIM_EXTRACTION_FAILED" },
    );
  }
  return Object.assign(
    new Error(parsed.data.message ?? parsed.data.error),
    { code: parsed.data.error },
  );
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function formatHuman(value: unknown): string {
  if (value === null) return "No state transition was needed.";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatExtractedClaims(
  claims: Array<{ claim: string; quote: string }>,
): string {
  return claims
    .map(({ claim, quote }, index) => `${index + 1}. ${claim}\n   ${quote}`)
    .join("\n");
}

function formatQueuedSubmission(
  submission: Extract<FactCheckSubmission, { kind: "queued" }>,
): string {
  return [
    `Queue ID: ${submission.queueId}`,
    ...submission.weather.families.map(
      (family) =>
        `${family.family}: ${family.ok ? "ok" : "down"} (${family.latencyMs} ms, status ${family.status})`,
    ),
  ].join("\n");
}

function stableErrorCode(error: unknown): string {
  if (error instanceof CommanderError || error instanceof z.ZodError) return "CLI_USAGE";
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "OPENVERDICT_ERROR";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configuredSigner(
  environment: Record<string, string | undefined>,
  role: "operator" | "challenger",
): string {
  try {
    const registry = SignerRegistry.fromEnv(environment);
    const address =
      role === "operator" ? registry.operatorAddress() : registry.challengerAddress();
    return address ?? `configured ${role} signer`;
  } catch {
    return `configured ${role} signer`;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  pathToFileURL(entryPath).href === pathToFileURL(fileURLToPath(import.meta.url)).href
) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
