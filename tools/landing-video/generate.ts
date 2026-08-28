import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Modality } from "@google/genai/node";
import { Command, InvalidArgumentError } from "commander";

const IMAGE_MODEL = "gemini-3-pro-image";
const VIDEO_MODEL = "veo-3.1-generate-001";

const KEYFRAME_PROMPT = `
Create a photorealistic editorial product photograph of a museum-grade kinetic network instrument,
not fantasy concept art and not a glossy CGI globe. Wide 16:9 frame. Leave the left 40 percent as an
almost empty matte midnight-navy studio sweep for large white website copy. The instrument occupies the
right side in an asymmetric three-quarter view and implies Earth through an open spherical armature:
precision-milled dark titanium meridian ribs, sparse latitude rails, and geographically plausible
continent fields made from hundreds of tiny off-white ceramic pins. There is no glass shell around the
sphere. Dozens of small physical compute contacts sit across the continents. Hair-thin sapphire optical
fibers connect selected contacts across the armature in an irregular global mesh, visibly attached at
both ends. Exactly five larger jury anchors are distinct machined ceramic-and-titanium components with a
narrow electric-blue illuminated seam. Suspend one small solid sapphire plumb weight shaped like an
abstract waterdrop inside the armature as a restrained Sui reference; it is hardware, not a floating
logo. Use exact HEX #0E76FF only for live optical signal and exact HEX #F3F3F3 for ceramic hardware and
cool highlights. Sandblasted metal, subtle machining marks, microscopic edge wear, realistic fasteners,
honest cable tension, real contact shadows, physically plausible occlusion, controlled reflections.
Photographed on an 85mm product lens at f/8, ISO 100, one large softbox above-right and a narrow rim light,
deep focus, neutral exposure, no fog. Quiet, severe, engineered, institutional, tactile, expensive.
`.trim();

const KEYFRAME_NEGATIVE_PROMPT = [
  "words",
  "letters",
  "numbers",
  "logos",
  "watermarks",
  "interface panels",
  "people",
  "hands",
  "generic blockchain globe",
  "stock network icon",
  "glass sphere",
  "hologram",
  "wireframe globe",
  "neon halo",
  "lens flare",
  "bloom",
  "volumetric fog",
  "floating dots",
  "floating logo",
  "thick cables",
  "perfect symmetry",
  "plastic surfaces",
  "octane render look",
  "video game asset",
  "warped geometry",
  "deformed globe",
  "incorrect geography labels",
  "visual noise",
  "grain",
  "warm orange lighting",
  "bright background",
].join(", ");

const VIDEO_PROMPT = `
One continuous locked-off product shot with no cuts, no camera movement, no zoom, and no focus pull.
The photographed kinetic sculpture is bolted in place and remains completely motionless for the entire
clip: the titanium globe does not rotate, the sapphire waterdrop does not swing, no hardware
moves, and nothing enters or leaves the frame. Preserve every pin, continent, cable, fastener, anchor,
material, shadow, and the empty navy space on the left exactly as photographed. The only animation is
light inside the existing attached optical fibers. One narrow #0E76FF signal travels along the existing
fiber routes from contact to contact around the world. The blue seam already built into each of the
exactly five existing ceramic jury anchors brightens once in sequence, holds briefly, then returns to its
starting brightness. No light spills beyond the physical fibers. At the final frame all illumination is
identical to frame one. Subtle, restrained, physically plausible electronics demonstration, seamless
cyclic action. The final frame must match the supplied starting frame exactly.
`.trim();

const VIDEO_NEGATIVE_PROMPT = [
  "camera movement",
  "camera shake",
  "cuts",
  "zoom",
  "rack focus",
  "object motion",
  "globe rotation",
  "pendulum motion",
  "morphing hardware",
  "melting metal",
  "bending armature",
  "new objects",
  "incoming objects",
  "outgoing objects",
  "second globe",
  "armillary sphere",
  "bronze hardware",
  "gold hardware",
  "missing network nodes",
  "detached nodes",
  "broken connections",
  "changing continents",
  "literal brand logo",
  "neon bloom",
  "hologram",
  "magical particles",
  "text",
  "logos",
  "watermarks",
  "flicker",
  "lighting changes",
  "background movement",
  "motion blur",
  "grain",
].join(", ");

type VideoOperation = Awaited<
  ReturnType<GoogleGenAI["models"]["generateVideos"]>
>;

function integer(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError(`Expected an integer, received ${value}`);
  }
  return parsed;
}

function requireRange(name: string, value: number, min: number, max: number) {
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}; received ${value}`);
  }
}

function requireBillableConfirmation(confirmed: boolean | undefined) {
  if (!confirmed) {
    throw new Error(
      "This command calls billable Google models. Re-run with --confirm-billable after reviewing docs/landing-background-video.md.",
    );
  }
}

function gcloud(args: string[]): string {
  return execFileSync("gcloud", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function resolveProject(explicit?: string): string {
  const project =
    explicit ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    gcloud(["config", "get-value", "project"]);
  if (!project || project === "(unset)") {
    throw new Error("No Google Cloud project is configured. Pass --project or set GOOGLE_CLOUD_PROJECT.");
  }
  return project;
}

function normalizeBucket(value: string): string {
  const bucket = value.replace(/^gs:\/\//, "").replace(/\/$/, "");
  if (!bucket || bucket.includes("/")) {
    throw new Error("--bucket must be a bucket name or a gs://bucket URI without a path.");
  }
  return bucket;
}

function extensionForMime(mimeType?: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function mimeForKeyframe(file: string): string {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".png") return "image/png";
  throw new Error("--keyframe must be a PNG, JPEG, or WebP image.");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForVideo(
  client: GoogleGenAI,
  initial: VideoOperation,
  label: string,
): Promise<VideoOperation> {
  const deadline = Date.now() + 45 * 60 * 1_000;
  let operation = initial;
  let checks = 0;

  while (!operation.done) {
    if (Date.now() >= deadline) {
      throw new Error(`${label} did not complete within 45 minutes (${operation.name ?? "unknown operation"}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    operation = await client.operations.getVideosOperation({ operation });
    checks += 1;
    console.log(`${label}: still generating (${checks * 15}s elapsed)`);
  }

  if (operation.error) {
    throw new Error(`${label} failed: ${JSON.stringify(operation.error)}`);
  }
  return operation;
}

const program = new Command()
  .name("landing-video")
  .description("Generate the OpenVerdict landing keyframe and cyclic Veo takes.");

program
  .command("keyframes")
  .description("Generate Gemini image keyframe candidates locally.")
  .option("--project <id>", "Google Cloud project ID")
  .option("--model <id>", "Image model ID", IMAGE_MODEL)
  .option("--count <number>", "Number of candidates (1-4)", integer, 2)
  .option("--seed <number>", "Base seed; each candidate increments it", integer, 8_292_026)
  .option(
    "--output-dir <path>",
    "Local candidate directory",
    "artifacts/landing-video/keyframes",
  )
  .option("--confirm-billable", "Confirm that this command may consume Google Cloud credits")
  .action(async (options) => {
    requireBillableConfirmation(options.confirmBillable);
    requireRange("--count", options.count, 1, 4);

    const project = resolveProject(options.project);
    const outputDir = path.resolve(options.outputDir);
    await mkdir(outputDir, { recursive: true });

    const client = new GoogleGenAI({ vertexai: true, project, location: "global" });
    console.log(`Generating ${options.count} keyframes with ${options.model} in ${project}...`);
    const responses = await Promise.all(
      Array.from({ length: options.count }, (_, index) => {
        const seed = options.seed + index;
        return client.models
          .generateContent({
            model: options.model,
            contents: `${KEYFRAME_PROMPT}\n\nExclude these elements: ${KEYFRAME_NEGATIVE_PROMPT}.`,
            config: {
              responseModalities: [Modality.IMAGE],
              imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
              candidateCount: 1,
              temperature: 1,
              seed,
              labels: { workflow: "openverdict-landing" },
            },
          })
          .then((response) => ({ response, seed }));
      }),
    );

    const files: Array<Record<string, unknown>> = [];
    for (const [index, { response, seed }] of responses.entries()) {
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const image = parts.find(
        (part) => part.inlineData?.data && part.inlineData.mimeType?.startsWith("image/"),
      )?.inlineData;
      if (!image?.data) {
        files.push({ index: index + 1, seed, filtered: true, reason: "No image part returned" });
        continue;
      }
      const extension = extensionForMime(image.mimeType);
      const filename = `openverdict-core-${String(index + 1).padStart(2, "0")}.${extension}`;
      const file = path.join(outputDir, filename);
      await writeFile(file, Buffer.from(image.data, "base64"));
      files.push({
        index: index + 1,
        seed,
        filename,
        mimeType: image.mimeType,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        filtered: false,
      });
      console.log(`Saved ${file}`);
    }

    if (!files.some((entry) => entry.filtered === false)) {
      throw new Error("The image model returned no usable keyframes.");
    }

    await writeJson(path.join(outputDir, "manifest.json"), {
      generatedAt: new Date().toISOString(),
      project,
      model: options.model,
      prompt: KEYFRAME_PROMPT,
      negativePrompt: KEYFRAME_NEGATIVE_PROMPT,
      files,
    });
  });

program
  .command("video")
  .description("Generate Veo takes from one selected keyframe and download them.")
  .requiredOption("--keyframe <path>", "Selected local PNG, JPEG, or WebP keyframe")
  .requiredOption("--bucket <name>", "Existing Cloud Storage bucket name")
  .option("--project <id>", "Google Cloud project ID")
  .option("--model <id>", "Veo model ID", VIDEO_MODEL)
  .option("--takes <number>", "Number of independent takes (1-4)", integer, 1)
  .option("--duration <seconds>", "Clip duration: 4, 6, or 8", integer, 8)
  .option("--resolution <value>", "720p or 1080p", "1080p")
  .option("--seed <number>", "Base seed; each take increments it", integer, 8_292_026)
  .option(
    "--output-dir <path>",
    "Local raw-video directory",
    "artifacts/landing-video/raw",
  )
  .option("--confirm-billable", "Confirm that this command may consume Google Cloud credits")
  .action(async (options) => {
    requireBillableConfirmation(options.confirmBillable);
    requireRange("--takes", options.takes, 1, 4);
    if (![4, 6, 8].includes(options.duration)) {
      throw new Error(`--duration must be 4, 6, or 8; received ${options.duration}`);
    }
    if (!["720p", "1080p"].includes(options.resolution)) {
      throw new Error(`--resolution must be 720p or 1080p; received ${options.resolution}`);
    }

    const project = resolveProject(options.project);
    const bucket = normalizeBucket(options.bucket);
    const keyframe = path.resolve(options.keyframe);
    const keyframeMimeType = mimeForKeyframe(keyframe);
    await readFile(keyframe); // Fail before uploading or starting billable work.

    const outputDir = path.resolve(options.outputDir);
    await mkdir(outputDir, { recursive: true });
    gcloud(["storage", "buckets", "describe", `gs://${bucket}`, "--project", project]);

    const runPrefix = `openverdict/landing/${timestamp()}`;
    const keyframeUri = `gs://${bucket}/${runPrefix}/keyframe${path.extname(keyframe).toLowerCase()}`;
    console.log(`Uploading selected keyframe to ${keyframeUri}...`);
    gcloud(["storage", "cp", keyframe, keyframeUri, "--project", project]);

    const client = new GoogleGenAI({ vertexai: true, project, location: "global" });
    const sourceImage = { gcsUri: keyframeUri, mimeType: keyframeMimeType };
    const started: Array<{ index: number; seed: number; operation: VideoOperation }> = [];

    // Start every requested take before polling so generation can run concurrently.
    for (let index = 0; index < options.takes; index += 1) {
      const seed = options.seed + index;
      const outputGcsUri = `gs://${bucket}/${runPrefix}/take-${String(index + 1).padStart(2, "0")}/`;
      console.log(`Starting take ${index + 1}/${options.takes} with ${options.model} (seed ${seed})...`);
      const operation = await client.models.generateVideos({
        model: options.model,
        source: { prompt: VIDEO_PROMPT, image: sourceImage },
        config: {
          numberOfVideos: 1,
          outputGcsUri,
          durationSeconds: options.duration,
          seed,
          aspectRatio: "16:9",
          resolution: options.resolution,
          negativePrompt: VIDEO_NEGATIVE_PROMPT,
          enhancePrompt: true,
          generateAudio: false,
          // Supplying the selected keyframe at both ends gives the model a real loop constraint.
          lastFrame: sourceImage,
          labels: { workflow: "openverdict-landing" },
        },
      });
      started.push({ index, seed, operation });
    }

    const settled = await Promise.allSettled(
      started.map(async ({ index, seed, operation }) => {
        const label = `take ${index + 1}`;
        const result = await waitForVideo(client, operation, label);
        const uri = result.response?.generatedVideos?.[0]?.video?.uri;
        if (!uri) {
          throw new Error(`${label} completed without a downloadable GCS URI.`);
        }
        const filename = `veo-take-${String(index + 1).padStart(2, "0")}.mp4`;
        const file = path.join(outputDir, filename);
        console.log(`Downloading ${uri} to ${file}...`);
        gcloud(["storage", "cp", uri, file, "--project", project]);
        return { index: index + 1, seed, filename, gcsUri: uri, operation: result.name };
      }),
    );

    // Preserve every take's outcome so a later failure never hides a completed operation.
    const completed = settled.map((result, index) => {
      const startedTake = started[index];
      if (result.status === "fulfilled") return result.value;
      return {
        index: index + 1,
        seed: startedTake?.seed,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });

    await writeJson(path.join(outputDir, "manifest.json"), {
      generatedAt: new Date().toISOString(),
      project,
      model: options.model,
      durationSeconds: options.duration,
      resolution: options.resolution,
      generateAudio: false,
      firstFrameGcsUri: keyframeUri,
      lastFrameGcsUri: keyframeUri,
      prompt: VIDEO_PROMPT,
      negativePrompt: VIDEO_NEGATIVE_PROMPT,
      takes: completed,
    });

    const failures = completed.filter((take) => "error" in take);
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} of ${completed.length} Veo takes failed. See ${path.join(outputDir, "manifest.json")} for every operation result.`,
      );
    }
  });

await program.parseAsync();
