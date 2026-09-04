import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  SKILL_DIR,
  SKILL_FILES,
  absolutizeSkillLinks,
  readSkillFile,
  skillContentType,
  skillUrlPath,
} from "./files";

const ORIGIN = "https://app.openverdict.info";

describe("the served skill", () => {
  it("serves every file in the allowlist, and nothing else", async () => {
    // The allowlist is the security boundary: no caller path reaches the disk.
    for (const publicPath of Object.keys(SKILL_FILES)) {
      const body = await readSkillFile(publicPath);
      expect(body, publicPath).toBeTypeOf("string");
      expect(body!.length, publicPath).toBeGreaterThan(0);
    }
    for (const bad of ["nope.md", "../package.json", "references/reference.md", "SKILL.md/../../.env"]) {
      expect(await readSkillFile(bad), bad).toBeNull();
    }
  });

  it("serves the canonical file, never a copy", async () => {
    const served = await readSkillFile("SKILL.md");
    const canonical = await readFile(path.join(process.cwd(), SKILL_DIR, "SKILL.md"), "utf8");
    expect(served).toBe(canonical);
  });

  it("hands an agent a skill it can act on: the frontmatter and the three rungs", async () => {
    const body = (await readSkillFile("SKILL.md"))!;
    expect(body.startsWith("---\nname: openverdict\n")).toBe(true);
    expect(body).toContain("## Start here");
    // Rung 1 needs nothing, rung 2 is the CLI, rung 3 is the skill folder.
    expect(body).toContain("https://app.openverdict.info/api");
    expect(body).toContain("git clone https://github.com/Marcussy34/OpenVerdict");
    expect(body).toContain("npx skills add Marcussy34/OpenVerdict");
  });

  it("turns the reference pointers into absolute URLs but leaves the launcher commands alone", () => {
    const source = [
      "See `references/reference.md` and `references/faq.md`.",
      'Run `bash "<skill dir>/scripts/ov.sh" weather`.',
    ].join("\n");
    const out = absolutizeSkillLinks(source, ORIGIN);
    expect(out).toContain(`${ORIGIN}/skill/reference.md`);
    expect(out).toContain(`${ORIGIN}/skill/faq.md`);
    // A launcher path is a command against a checkout, not a link to fetch.
    expect(out).toContain('bash "<skill dir>/scripts/ov.sh" weather');
    expect(out).not.toContain(`${ORIGIN}/skill/scripts`);
  });

  it("leaves no relative reference pointer in the served SKILL.md", async () => {
    const out = absolutizeSkillLinks((await readSkillFile("SKILL.md"))!, ORIGIN);
    expect(out).not.toContain("references/reference.md");
    expect(out).not.toContain("references/faq.md");
  });

  it("answers with markdown for the documents and plain text for the launchers", () => {
    expect(skillUrlPath("SKILL.md")).toBe("/SKILL.md");
    expect(skillUrlPath("reference.md")).toBe("/skill/reference.md");
    expect(skillUrlPath("scripts/ov.sh")).toBe("/skill/scripts/ov.sh");
    expect(skillContentType("SKILL.md")).toBe("text/markdown; charset=utf-8");
    expect(skillContentType("scripts/run.sh")).toBe("text/plain; charset=utf-8");
  });

  it("uses no em dash anywhere in the skill it serves", async () => {
    for (const publicPath of Object.keys(SKILL_FILES)) {
      expect(await readSkillFile(publicPath), publicPath).not.toContain("\u2014");
    }
  });
});
