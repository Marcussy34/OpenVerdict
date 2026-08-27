import { cn } from "@/lib/utils";

/**
 * Dotted schematics — 1px dashed line drawings in the reference's technical
 * register. Every stroke is `currentColor` so a section can tint the whole set
 * by setting text colour; nothing here carries meaning a screen reader needs.
 */

const DASH = { strokeDasharray: "2 3.2" } as const;

function Frame({
  children,
  className,
  size = 240,
}: {
  children: React.ReactNode;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 240 240"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/** 01 — a sealed ballot dropping into the box: committed before revealed. */
export function BallotSealArt({ className, size }: { className?: string; size?: number }) {
  return (
    <Frame className={className} size={size}>
      {/* isometric box */}
      <path d="M60 140 120 172 180 140 120 108Z" {...DASH} />
      <path d="M60 140v26l60 32 60-32v-26" {...DASH} />
      <path d="M120 172v34" {...DASH} />
      {/* slot */}
      <path d="M96 140 120 152 144 140 120 128Z" />
      {/* the sealed envelope above it */}
      <path d="M92 66h56v34H92z" {...DASH} />
      <path d="m92 66 28 20 28-20" {...DASH} />
      <path d="M120 100v24" />
      <circle cx="120" cy="83" r="7" />
      {/* wax seal ticks */}
      <path d="M113 76.5 127 89.5M127 76.5 113 89.5" strokeWidth={0.9} />
    </Frame>
  );
}

/** 02 — evidence frozen to a pinned blob before deliberation opens. */
export function EvidencePinArt({ className, size }: { className?: string; size?: number }) {
  return (
    <Frame className={className} size={size}>
      {/* stacked sheets */}
      <path d="M56 152 120 186 184 152 120 118Z" {...DASH} />
      <path d="M56 134 120 168 184 134 120 100Z" {...DASH} />
      <path d="M56 116 120 150 184 116 120 82Z" {...DASH} />
      <path d="M56 116v18M184 116v18M56 134v18M184 134v18" />
      {/* the pin driven through the stack */}
      <path d="M120 32v72" />
      <path d="M120 32c-11 0-20 9-20 20 0 14 20 30 20 30s20-16 20-30c0-11-9-20-20-20Z" />
      <circle cx="120" cy="52" r="6" {...DASH} />
    </Frame>
  );
}

/** 03 — the certificate stamped and chained on-chain. */
export function CertificateArt({ className, size }: { className?: string; size?: number }) {
  return (
    <Frame className={className} size={size}>
      <path d="M74 58h92v112H74z" {...DASH} />
      <path d="M90 84h60M90 100h60M90 116h38" strokeWidth={0.9} />
      {/* seal */}
      <circle cx="150" cy="146" r="20" />
      <circle cx="150" cy="146" r="12" {...DASH} />
      <path d="M144 146l4.5 5 8-9" strokeWidth={1.2} />
      {/* chain links running off the page */}
      <path d="M40 190h34a10 10 0 0 0 0-20H58" />
      <path d="M200 190h-34a10 10 0 0 1 0-20h16" />
      <path d="M96 180h48" {...DASH} />
    </Frame>
  );
}

/** Opportunity-list marks: small, square, dashed. */
export function JuryMark({ className }: { className?: string }) {
  return (
    <Frame className={className} size={64}>
      <path d="M40 40h160v160H40z" {...DASH} />
      <circle cx="120" cy="120" r="30" />
      <circle cx="70" cy="70" r="12" {...DASH} />
      <circle cx="170" cy="70" r="12" {...DASH} />
      <circle cx="70" cy="170" r="12" {...DASH} />
      <circle cx="170" cy="170" r="12" {...DASH} />
      <path d="M80 80 100 100M160 80 140 100M80 160 100 140M160 160 140 140" strokeWidth={0.9} />
    </Frame>
  );
}

export function SealMark({ className }: { className?: string }) {
  return (
    <Frame className={className} size={64}>
      <path d="M50 110h140v90H50z" {...DASH} />
      <path d="M85 110V78a35 35 0 0 1 70 0v32" />
      <circle cx="120" cy="152" r="16" {...DASH} />
      <path d="M120 152v22" />
    </Frame>
  );
}

export function SeatMark({ className }: { className?: string }) {
  return (
    <Frame className={className} size={64}>
      <circle cx="120" cy="76" r="30" {...DASH} />
      <path d="M56 196c0-35 29-64 64-64s64 29 64 64" />
      <path d="M40 196h160" {...DASH} />
      <path d="M120 132v64" strokeWidth={0.9} />
    </Frame>
  );
}

export function RecomputeMark({ className }: { className?: string }) {
  return (
    <Frame className={className} size={64}>
      <path d="M120 42a78 78 0 1 1-55 23" />
      <path d="M62 40v28h28" />
      <path d="M84 120h72M84 148h48" {...DASH} />
      <circle cx="120" cy="120" r="52" {...DASH} />
    </Frame>
  );
}
