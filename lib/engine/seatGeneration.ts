import {
  DEFAULT_PROMPT_SPEC_V5,
  DEFAULT_TOOL_POLICY_V4,
  TABLE_VOTE_PROMPT_SPEC_V1,
} from "../gonka/promptSpec";
import type {
  PromptSpecV5,
  TableVotePromptSpecV1,
  ToolPolicyV4,
} from "../protocol/types";

/**
 * The one prompt generation every newly published seat manifest pins. Spread
 * it straight into buildAgentManifestDocument: research prompt v5 on tool
 * policy v4 plus the table-vote prompt yields a document version "6", which is
 * the only shape round two accepts.
 *
 * This is the single place to bump when a prompt spec changes. The engine
 * asserts each seat's stored hashes against the document it runs, so a bump
 * here reaches new seats only; every seat already on chain has to be moved
 * onto the new generation with `pnpm cli agents republish --active` in an idle
 * window, or its next run fails closed on the hash it still carries.
 */
export const CURRENT_SEAT_GENERATION: {
  promptSpec: PromptSpecV5;
  toolPolicy: ToolPolicyV4;
  tableVotePromptSpec: TableVotePromptSpecV1;
} = {
  promptSpec: DEFAULT_PROMPT_SPEC_V5,
  toolPolicy: DEFAULT_TOOL_POLICY_V4,
  tableVotePromptSpec: TABLE_VOTE_PROMPT_SPEC_V1,
};

/** The document version CURRENT_SEAT_GENERATION builds, for fail-closed checks. */
export const CURRENT_SEAT_DOCUMENT_VERSION = "6";
