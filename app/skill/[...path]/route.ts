/**
 * GET /skill/<file>: the rest of the agent skill, for an agent that fetched
 * /SKILL.md and wants its references or its launchers.
 *
 * Served paths are an allowlist in lib/skill/files.ts, so no caller-supplied
 * path reaches the filesystem. Bodies are read from skills/openverdict/ at
 * request time and never copied.
 */
import { NextResponse } from "next/server";

import { absolutizeSkillLinks, readSkillFile, skillContentType } from "@/lib/skill/files";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const publicPath = path.join("/");
  const body = await readSkillFile(publicPath);
  if (body === null) return NextResponse.json({ error: "skill_file_not_found" }, { status: 404 });
  const origin = new URL(request.url).origin;
  const contentType = skillContentType(publicPath);
  // Only Markdown carries pointers to the other documents.
  const out = contentType.startsWith("text/markdown") ? absolutizeSkillLinks(body, origin) : body;
  return new NextResponse(out, {
    headers: { "content-type": contentType, "cache-control": "public, max-age=300" },
  });
}
