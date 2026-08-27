"use client";

import { SplitButton, CornerPin } from "./primitives";
import { BrandMark } from "@/components/site-header";

/**
 * Section 5 — the black band. One statement, one pair of buttons, and a
 * hairline wireframe of the globe. No second WebGL canvas here: this is a
 * static SVG so the band costs nothing to scroll past.
 */
export function Banner() {
  return (
    <section data-header-theme="dark" className="ov-on-dark relative z-30 bg-black px-5 py-6 md:px-7 md:py-7">
      <div className="relative border border-dashed border-[#F3F3F3]/12 px-6 py-12 md:px-12 md:py-16">
        <CornerPin className="-top-[3px] -left-[3px]" />
        <CornerPin className="-top-[3px] -right-[3px]" />
        <CornerPin className="-bottom-[3px] -left-[3px]" />
        <CornerPin className="-right-[3px] -bottom-[3px]" />

        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="flex min-h-[380px] flex-col justify-between lg:min-h-[440px]">
            <span className="text-[#F3F3F3]">
              <BrandMark size={72} />
            </span>

            <h2 className="ov-display my-10 max-w-[560px] text-[clamp(1.9rem,3.4vw,2.75rem)] leading-[1.23] text-[#F3F3F3]">
              Truth for everyone,
              <br />
              <span className="text-[#F3F3F3]/50">engineered to verify.</span>
            </h2>

            <div className="flex flex-wrap items-center gap-[2px] gap-y-2">
              <SplitButton href="#submit">Submit a claim</SplitButton>
              <SplitButton href="/learn" tone="dark" chip={false}>
                How it works
              </SplitButton>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end">
            <WireGlobe />
          </div>
        </div>
      </div>
    </section>
  );
}

/** The globe as a drafting drawing — dashed meridians and one accent seal. */
function WireGlobe() {
  const dash = { strokeDasharray: "2.5 4" } as const;
  return (
    <svg
      aria-hidden
      viewBox="0 0 320 320"
      className="h-auto w-[74vw] max-w-[380px] text-[#F3F3F3]/40 lg:w-[30vw]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
    >
      <circle cx="160" cy="160" r="128" {...dash} />
      <ellipse cx="160" cy="160" rx="43" ry="128" {...dash} />
      <ellipse cx="160" cy="160" rx="87" ry="128" {...dash} />
      <ellipse cx="160" cy="160" rx="128" ry="43" {...dash} />
      <ellipse cx="160" cy="160" rx="128" ry="87" {...dash} />
      {/* two evidence links leaving the surface */}
      <path d="M58 216 Q 160 44 262 128" strokeDasharray="3 7" />
      <path d="M74 96 Q 176 268 258 208" strokeDasharray="3 7" opacity="0.6" />
      <rect x="46" y="204" width="5" height="5" fill="currentColor" />
      <rect x="259" y="125" width="5" height="5" fill="currentColor" />
      {/* the sealed record at the centre */}
      <rect x="146" y="146" width="28" height="28" stroke="currentColor" />
      <rect x="155" y="155" width="10" height="10" fill="var(--ov-accent)" stroke="none" />
    </svg>
  );
}
