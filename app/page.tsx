"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { SwarmGlobe, type SwarmClaim, type SwarmAgent } from "@/components/globe/swarm-globe";
import { DockLayer } from "@/components/landing/dock-layer";
import { Hero } from "@/components/landing/hero";
import { Productivity } from "@/components/landing/productivity";
import { Propositions } from "@/components/landing/propositions";
import { Banner } from "@/components/landing/banner";
import { Manifesto } from "@/components/landing/manifesto";
import { Opportunity } from "@/components/landing/opportunity";
import { Faq } from "@/components/landing/faq";
import { LandingFooter } from "@/components/landing/footer";
import type { ClaimInspection } from "@/lib/engine/contract";

/** Read-only agent registry rows the globe narrates. */
type RegistryAgent = {
  agentProfileId: string;
  modelId: string;
  role: string;
  active: boolean;
};

/**
 * Where the single WebGL globe lives.
 * `none`   — first paint, before the client has measured anything.
 * `dock`   — desktop with motion allowed: the globe rides the docking layer.
 * `static` — reduced motion or a narrow viewport: it just sits in the hero.
 */
type GlobeMode = "none" | "dock" | "static";

export default function HomePage() {
  const heroSlotRef = useRef<HTMLDivElement>(null);
  const cardSlotRef = useRef<HTMLDivElement>(null);

  const [claims, setClaims] = useState<ClaimInspection[]>([]);
  const [registry, setRegistry] = useState<RegistryAgent[]>([]);
  const [network, setNetwork] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
  const [mode, setMode] = useState<GlobeMode>("none");

  // The choreography is a client-only decision, so it is made after mount —
  // the server and the first client render agree on "none".
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setMode(wide.matches && !still.matches ? "dock" : "static");
    decide();
    wide.addEventListener("change", decide);
    still.addEventListener("change", decide);
    return () => {
      wide.removeEventListener("change", decide);
      still.removeEventListener("change", decide);
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/claims")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.claims) setClaims(data.claims as ClaimInspection[]);
      })
      .catch(() => {});
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.agents) setRegistry(data.agents as RegistryAgent[]);
      })
      .catch(() => {});
    fetch("/api/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (ignore || !data) return;
        if (typeof data.network === "string") setNetwork(data.network);
        if (typeof data.packageId === "string") setPackageId(data.packageId);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  /** The newest claim carrying a settled outcome; otherwise the newest claim. */
  const latest = useMemo(
    () => claims.find((c) => c.state >= 9 && c.result) ?? claims[0] ?? null,
    [claims],
  );

  const swarmClaims = useMemo<SwarmClaim[]>(
    () =>
      claims
        .filter((c) => c.statement)
        .slice(0, 6)
        .map((c) => ({
          id: c.claimId,
          statement: c.statement,
          score:
            typeof c.result?.truthScoreBps === "number"
              ? Math.round(c.result.truthScoreBps / 100)
              : null,
          label: c.result?.result ?? null,
        })),
    [claims],
  );

  const swarmAgents = useMemo<SwarmAgent[]>(
    () => registry.map((a) => ({ role: a.role, model: a.modelId })),
    [registry],
  );

  const globe = (
    <SwarmGlobe claims={swarmClaims} agents={swarmAgents} className="lg:max-w-none" />
  );

  return (
    <>

      <Hero
        heroSlotRef={heroSlotRef}
        plateVisible={mode !== "dock"}
        latest={latest}
        network={network}
      >
        {mode === "static" && globe}
      </Hero>

      <Productivity cardSlotRef={cardSlotRef} claims={claims} />

      {/* Rendered after both slots so the layer's first frame can measure them. */}
      {mode === "dock" && (
        <DockLayer heroSlotRef={heroSlotRef} cardSlotRef={cardSlotRef}>
          {globe}
        </DockLayer>
      )}

      <Propositions claims={swarmClaims} agents={swarmAgents} />
      <Banner />
      <Manifesto />
      <Opportunity />
      <Faq />
      <LandingFooter network={network} packageId={packageId} />
    </>
  );
}
