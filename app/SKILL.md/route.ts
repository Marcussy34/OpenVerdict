/**
 * GET /SKILL.md: the agent skill itself, as one fetchable file.
 *
 * This is the whole entry point of the product for an agent: "Set up
 * https://app.openverdict.info/SKILL.md and take it from there." The body is
 * read from skills/openverdict/SKILL.md at request time, so the URL and the
 * folder an agent installs are always the same file.
 */
import { NextResponse } from "next/server";

import { absolutizeSkillLinks, readSkillFile, skillContentType } from "@/lib/skill/files";

export async function GET(request: Request): Promise<NextResponse> {
  const body = await readSkillFile("SKILL.md");
  if (body === null) return NextResponse.json({ error: "skill_not_found" }, { status: 404 });
  // The request's own origin, so a localhost fetch keeps pointing at localhost.
  const origin = new URL(request.url).origin;
  return new NextResponse(absolutizeSkillLinks(body, origin), {
    headers: {
      "content-type": skillContentType("SKILL.md"),
      // Short, because the skill is the agent contract and edits should land.
      "cache-control": "public, max-age=300",
    },
  });
}
