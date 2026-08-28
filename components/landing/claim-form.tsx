"use client";

import * as React from "react";
import { SplitButton } from "./primitives";
import { useClaimSubmission, MAX_CLAIM } from "@/components/claim/use-claim-submission";

/**
 * The landing's claim entry — the same submission path as /fact-check, wearing
 * the footer's dark skin. Two underlined rows: the claim, and the source the
 * jury will be frozen against (the engine refuses a claim with no evidence).
 * Validation, the live character count and the engine's own errors all render
 * inline.
 */
export function ClaimForm() {
  const [claim, setClaim] = React.useState("");
  const [url, setUrl] = React.useState("");
  const { submit, submitting, errorMessage, isEngineOffline } = useClaimSubmission();
  const tooLong = claim.length > MAX_CLAIM * 0.9;
  const errorId = errorMessage || isEngineOffline ? "landing-claim-error" : undefined;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        await submit({ claim, urls: [url] });
      }}
      className="w-full"
      noValidate
    >
      <div className="border-b border-[#F3F3F3]/40 pb-3 transition-colors focus-within:border-[#F3F3F3]/80">
        <label htmlFor="landing-claim" className="sr-only">
          Claim statement
        </label>
        <input
          id="landing-claim"
          value={claim}
          maxLength={MAX_CLAIM}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="Enter a claim…"
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorId}
          className="w-full min-w-0 bg-transparent pb-1 text-[19px] leading-snug text-[#F3F3F3] placeholder:text-[#F3F3F3]/50 focus:outline-none"
        />
      </div>

      <div className="mt-4 flex items-end gap-4 border-b border-[#F3F3F3]/40 pb-3 transition-colors focus-within:border-[#F3F3F3]/80">
        <label htmlFor="landing-url" className="sr-only">
          Evidence source URL
        </label>
        <input
          id="landing-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Evidence source — https://…"
          aria-describedby={errorId}
          className="min-w-0 flex-1 bg-transparent pb-1 text-[15px] leading-snug text-[#F3F3F3] placeholder:text-[#F3F3F3]/50 focus:outline-none"
        />
        <SplitButton
          type="submit"
          disabled={submitting || claim.trim().length === 0}
          className="mb-0.5"
        >
          {submitting ? "Submitting…" : "Submit"}
        </SplitButton>
      </div>

      {/* Just the counter now; the helper line came out at the user's request. */}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        <span
          className={`ov-micro ov-micro-sm tabular-nums ${
            tooLong ? "text-[#ffd479]" : "text-[#F3F3F3]/45"
          }`}
        >
          {claim.length}/{MAX_CLAIM}
        </span>
      </div>

      {(errorMessage || isEngineOffline) && (
        <p
          id="landing-claim-error"
          role="alert"
          className="mt-3 border-l-2 border-[#ffd479] bg-black/20 py-2 pl-3 text-[13px] leading-snug text-[#ffd479]"
        >
          {isEngineOffline
            ? "The verification engine is not reachable right now. Client-side proof tools stay available on the verifier."
            : errorMessage}
        </p>
      )}
    </form>
  );
}
