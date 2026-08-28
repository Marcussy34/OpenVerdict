"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { SwarmGlobe, type SwarmClaim, type SwarmAgent } from "@/components/globe/swarm-globe";
import { Hero } from "@/components/landing/hero";
import { HeroShrink } from "@/components/landing/hero-shrink";
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

export default function HomePage() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [claims, setClaims] = useState<ClaimInspection[]>([]);
  const [registry, setRegistry] = useState<RegistryAgent[]>([]);
  const [network, setNetwork] = useState<string | null>(null);
  const [packageId, setPackageId] = useState<string | null>(null);
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

      <HeroShrink
        cardRef={cardRef}
        reveal={<Productivity cardRef={cardRef} claims={claims} />}
      >
        <Hero latest={latest} network={network}>
          {globe}
        </Hero>
      </HeroShrink>

      <Propositions claims={swarmClaims} agents={swarmAgents} />
      <Banner />
      <Manifesto />
      <Opportunity />
      <Faq />
      <LandingFooter network={network} packageId={packageId} />
    </>
  );
}
