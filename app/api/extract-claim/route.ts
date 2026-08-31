import { buildHandler } from "@/lib/claim-extraction/handler";
import { getServerClaimExtractionRuntime } from "@/lib/engine/server";
import {
  rateLimitPublic,
  requirePublicWritesEnabled,
} from "../_lib/guard";

/** POST /api/extract-claim: extract one checkable claim from a guarded URL. */
export const POST = buildHandler({
  getRuntime: getServerClaimExtractionRuntime,
  requirePublicWritesEnabled,
  rateLimitPublic,
});
