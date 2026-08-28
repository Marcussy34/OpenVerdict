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

/**
 * Opportunity-list marks. Drawn on their own 96-unit grid rather than the
 * 240 one above: these render at 64–88px, where a 1px stroke on a 240 box
 * thins to a quarter of a pixel and the drawing goes wispy. Heavier stroke,
 * fewer lines, each one saying its own sentence.
 */
const MARK_DASH = { strokeDasharray: "2 2.6" } as const;

function MarkFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/** Five seats drawn onto a ring around one claim — circles and squares, so the
 *  panel reads as mixed model families rather than five of the same thing. */
export function JuryMark({ className }: { className?: string }) {
  return (
    <MarkFrame className={className}>
      <circle cx="48" cy="48" r="30" {...MARK_DASH} />
      {/* spokes: the draw binding each seat to the claim */}
      <path
        d="M48 48 48 18M48 48 76.5 38.7M48 48 65.6 72.3M48 48 30.4 72.3M48 48 19.5 38.7"
        strokeWidth={0.8}
        {...MARK_DASH}
      />
      {/* the claim under review */}
      <path d="M48 40 56 48 48 56 40 48Z" />
      {/* the five seats */}
      <circle cx="48" cy="18" r="5" />
      <path d="M72 34.7h9v8h-9z" />
      <circle cx="65.6" cy="72.3" r="5" />
      <path d="M25.9 68.3h9v8h-9z" />
      <circle cx="19.5" cy="38.7" r="5" />
    </MarkFrame>
  );
}

/** The evidence stack, frozen and stamped before anyone deliberates. */
export function SealMark({ className }: { className?: string }) {
  return (
    <MarkFrame className={className}>
      <path d="M18 74 48 88 78 74 48 60Z" {...MARK_DASH} />
      <path d="M18 63 48 77 78 63 48 49Z" {...MARK_DASH} />
      <path d="M18 52 48 66 78 52 48 38Z" />
      <path d="M18 52v11M78 52v11M18 63v11M78 63v11" strokeWidth={0.8} />
      {/* the seal pressed onto the top plate */}
      <path d="M48 38V28" strokeWidth={0.8} />
      <circle cx="48" cy="19" r="9" />
      <path d="M44 15.5 52 22.5M52 15.5 44 22.5" strokeWidth={0.9} />
    </MarkFrame>
  );
}

/** One identity resolving to exactly one seat — the allotment is the frame. */
export function SeatMark({ className }: { className?: string }) {
  return (
    <MarkFrame className={className}>
      <path d="M14 20h68v56H14z" {...MARK_DASH} />
      <circle cx="48" cy="40" r="10" />
      <path d="M30 68a18 18 0 0 1 36 0" />
      {/* the single seat token this address holds */}
      <path d="M74 12h12v12H74z" />
      <path d="M77.5 18.5 79.5 21 83 16.5" strokeWidth={1.1} />
    </MarkFrame>
  );
}

/** Run the numbers again, get the same verdict. */
export function RecomputeMark({ className }: { className?: string }) {
  return (
    <MarkFrame className={className}>
      <path d="M48 14a34 34 0 1 1-25.5 11.5" />
      <path d="M40 7.5 47.5 14 40 20.5" />
      <path d="M32 42h32M32 52h22" {...MARK_DASH} />
      <path d="M36 66 44 74 60 56" strokeWidth={1.6} />
    </MarkFrame>
  );
}
