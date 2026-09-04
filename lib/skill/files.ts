/**
 * The agent skill, served over HTTP.
 *
 * `skills/openverdict/` is the one copy. The route handlers read it from disk
 * at request time, exactly as the docs site reads its Markdown, so a served
 * file can never drift from the folder an agent installs. The Dockerfile
 * copies the whole repository into the runtime image and next.config.ts traces
 * these paths, so the reads work in production too.
 *
 * The only transformation is on the way out: relative references between the
 * skill's own files become absolute URLs, because an agent that fetched
 * SKILL.md by link has no folder to resolve them against.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/** The canonical skill folder, relative to the repository root. */
export const SKILL_DIR = "skills/openverdict";

/**
 * Public path to the file it serves, relative to SKILL_DIR. `SKILL.md` is at
 * the root so the handoff line stays one short URL; everything else sits under
 * `/skill/` so the namespace has one owner.
 */
export const SKILL_FILES: Record<string, string> = {
  "SKILL.md": "SKILL.md",
  "reference.md": "references/reference.md",
  "faq.md": "references/faq.md",
  "scripts/ov.sh": "scripts/ov.sh",
  "scripts/run.sh": "scripts/run.sh",
};

/** Where each skill file answers, relative to the origin. */
export function skillUrlPath(publicPath: string): string {
  return publicPath === "SKILL.md" ? "/SKILL.md" : `/skill/${publicPath}`;
}

/** Markdown for the two documents, plain text for the shell launchers. */
export function skillContentType(publicPath: string): string {
  return publicPath.endsWith(".md")
    ? "text/markdown; charset=utf-8"
    : "text/plain; charset=utf-8";
}

/**
 * The file's bytes, or null when the public path is not one of ours. The map
 * is the allowlist: no caller-supplied path ever reaches the filesystem.
 */
export async function readSkillFile(publicPath: string): Promise<string | null> {
  const relative = SKILL_FILES[publicPath];
  if (relative === undefined) return null;
  return readFile(path.join(process.cwd(), SKILL_DIR, relative), "utf8");
}

/**
 * Pointers to the skill's two reference documents become absolute URLs on
 * `origin`, so an agent that fetched SKILL.md by link can follow them; an agent
 * that installed the folder reads the file on disk, where the relative paths
 * are already correct.
 *
 * Only the `references/` documents are rewritten. The launcher paths stay
 * relative on purpose: `bash "<skill dir>/scripts/ov.sh"` is a command to run
 * against a checkout, not a link to fetch, and a URL there would be wrong.
 */
export function absolutizeSkillLinks(markdown: string, origin: string): string {
  let out = markdown;
  for (const [publicPath, relative] of Object.entries(SKILL_FILES)) {
    if (!relative.startsWith("references/")) continue;
    out = out.split(relative).join(`${origin}${skillUrlPath(publicPath)}`);
  }
  return out;
}
