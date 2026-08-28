"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { SwarmGlobe } from "@/components/globe/swarm-globe";
import { Hero } from "@/components/landing/hero";
import { HeroShrink } from "@/components/landing/hero-shrink";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Productivity } from "@/components/landing/productivity";
import { Propositions } from "@/components/landing/propositions";
import { Banner } from "@/components/landing/banner";
import { Manifesto } from "@/components/landing/manifesto";
import { Opportunity } from "@/components/landing/opportunity";
import { Faq } from "@/components/landing/faq";
import { LandingFooter } from "@/components/landing/footer";
import type { ClaimInspection } from "@/lib/engine/contract";

export default function HomePage() {
  const cardRef = useRef<HTMLDivElement>(null);
  const entranceRef = useRef(-1);
  const [claims, setClaims] = useState<ClaimInspection[]>([]);
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

  const globe = <SwarmGlobe className="lg:max-w-none" />;

  return (
    <>

      <SmoothScroll />
      <HeroShrink
        cardRef={cardRef}
        entranceRef={entranceRef}
        reveal={
          <Productivity cardRef={cardRef} entranceRef={entranceRef} claims={claims} />
        }
      >
        <Hero latest={latest} network={network}>
          {globe}
        </Hero>
      </HeroShrink>

      <Propositions />
      <Banner />
      <Manifesto />
      <Opportunity />
      <Faq />
      <LandingFooter network={network} packageId={packageId} />
    </>
  );
}
