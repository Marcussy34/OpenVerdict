"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Hero } from "@/components/landing/hero";
import { HeroShrink } from "@/components/landing/hero-shrink";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { Productivity } from "@/components/landing/productivity";
import { Propositions } from "@/components/landing/propositions";
import { Banner } from "@/components/landing/banner";
import { Manifesto } from "@/components/landing/manifesto";
import { Opportunity } from "@/components/landing/opportunity";
import { Faq } from "@/components/landing/faq";
import type { ClaimInspection } from "@/lib/engine/contract";

export default function HomePage() {
  const cardRef = useRef<HTMLDivElement>(null);
  const entranceRef = useRef(-1);
  const [claims, setClaims] = useState<ClaimInspection[]>([]);
  useEffect(() => {
    let ignore = false;
    fetch("/api/claims")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!ignore && data?.claims) setClaims(data.claims as ClaimInspection[]);
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
        <Hero latest={latest} />
      </HeroShrink>

      <Propositions />
      <Banner />
      <Manifesto />
      <Opportunity />
      <Faq />
    </>
  );
}
