"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WeatherReport } from "@/lib/engine/contract";

/**
 * The one claim-submission path the UI has: validate, POST /api/fact-checks,
 * then route to the claim page the engine created.
 *
 * Shared by the full form on /fact-check and the single-line form in the
 * landing footer, so both enforce the same bounds and surface the same engine
 * errors. Bounds mirror the route's own validation — the server is still the
 * authority; these only keep obviously-invalid payloads off the wire.
 */

export const MIN_CLAIM = 5;
export const MAX_CLAIM = 1000;
export const MAX_TEXT = 20_000;
export const MAX_URLS = 5;

export type ClaimSubmissionInput = {
  claim: string;
  text?: string;
  urls?: string[];
  resolutionCriteria?: string;
};

/** A submission the jury refused: bad weather, nothing stored, submit again. */
export type ClaimSubmissionRefusal = {
  message: string;
  weather: WeatherReport;
};

export function useClaimSubmission() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEngineOffline, setIsEngineOffline] = useState(false);
  const [refusal, setRefusal] = useState<ClaimSubmissionRefusal | null>(null);
  // The last input, so a refusal block can send exactly it again.
  const lastInput = useRef<ClaimSubmissionInput | null>(null);

  async function submit(input: ClaimSubmissionInput) {
    lastInput.current = input;
    setErrorMessage(null);
    setIsEngineOffline(false);
    setRefusal(null);

    const trimmedClaim = input.claim.trim();
    if (trimmedClaim.length < MIN_CLAIM) {
      setErrorMessage(`Claim statement must be at least ${MIN_CLAIM} characters long.`);
      return false;
    }
    if (trimmedClaim.length > MAX_CLAIM) {
      setErrorMessage(`Claim statement cannot exceed ${MAX_CLAIM} characters.`);
      return false;
    }

    const filteredUrls = (input.urls ?? []).map((u) => u.trim()).filter((u) => u.length > 0);
    for (const u of filteredUrls) {
      if (!u.startsWith("https://") && !u.startsWith("http://")) {
        setErrorMessage(`Invalid URL '${u}': must start with https:// or http://`);
        return false;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/fact-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: trimmedClaim,
          text: input.text?.trim() || undefined,
          urls: filteredUrls,
          resolutionCriteria: input.resolutionCriteria?.trim() || undefined,
        }),
      });

      if (res.status === 503) {
        // Two different 503s: the jury refusing bad weather, or no engine.
        const refused = await res.json().catch(() => null);
        if (refused?.error === "WEATHER_NOT_CLEAR" && refused.weather) {
          setRefusal({ message: refused.message, weather: refused.weather });
          return false;
        }
        setIsEngineOffline(true);
        return false;
      }

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.message || data.error || "Failed to submit the claim");
        return false;
      }
      if (data.claimId) {
        // Straight into the live transcript: the jury forms while the page loads.
        router.push(`/claims/${encodeURIComponent(data.claimId)}?view=live`);
        return true;
      }
      return false;
    } catch {
      setIsEngineOffline(true);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  /** Send the last input again, after the weather cleared. */
  async function resubmit() {
    const input = lastInput.current;
    return input === null ? false : submit(input);
  }

  return {
    submit,
    resubmit,
    submitting,
    errorMessage,
    isEngineOffline,
    setErrorMessage,
    refusal,
    setRefusal,
  };
}
