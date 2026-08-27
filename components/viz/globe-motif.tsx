import { cn } from "@/lib/utils";

/**
 * A hairline echo of the hero's swarm globe — meridians, two latitudes and one
 * link arc between nodes — drawn as static SVG so it costs nothing on inner
 * pages. It sits behind the page header and keeps the light product surfaces
 * visually attached to the night stage the site opens on.
 */
export function GlobeMotif({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 240 240"
      fill="none"
      className={cn("pointer-events-none absolute text-sea", className)}
      style={{
        maskImage: "radial-gradient(70% 70% at 55% 45%, #000, transparent 76%)",
      }}
    >
      <g stroke="currentColor" strokeWidth="1" opacity="0.5">
        <circle cx="120" cy="120" r="92" />
        <ellipse cx="120" cy="120" rx="31" ry="92" />
        <ellipse cx="120" cy="120" rx="63" ry="92" />
        <ellipse cx="120" cy="120" rx="92" ry="31" />
        <ellipse cx="120" cy="120" rx="92" ry="63" />
      </g>
      {/* One evidence link leaving the surface and landing again. */}
      <path
        d="M46 166 Q 120 24 196 96"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 7"
        strokeLinecap="round"
      />
      <circle cx="46" cy="166" r="3.5" fill="currentColor" />
      <circle cx="196" cy="96" r="3.5" fill="currentColor" />
      <circle cx="120" cy="52" r="2.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
