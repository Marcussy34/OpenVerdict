"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Renders a ```mermaid fence from a documentation page.
 *
 * The library is imported inside the effect, so its ~500 kB never enters the
 * shared bundle and only a docs page that actually draws a diagram pays for
 * it. Until it resolves the source stays on the page as text, which is also
 * what a reader sees with JavaScript off.
 *
 * The theme is the app palette: paper ground, hairline ink strokes, ink text,
 * and the blue accent for the one thing a diagram wants to emphasise. No other
 * hue is introduced.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The id must be a valid CSS selector; React's useId is not.
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          fontFamily:
            "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
          fontSize: 14,
          theme: "base",
          themeVariables: THEME,
          // useMaxWidth would scale a wide diagram down to the column and
          // make its labels unreadable. Natural size plus a scrolling box
          // keeps every label at reading size.
          flowchart: {
            curve: "linear",
            htmlLabels: true,
            padding: 10,
            nodeSpacing: 26,
            rankSpacing: 34,
            useMaxWidth: false,
          },
          sequence: { useMaxWidth: false, mirrorActors: false, wrap: true },
          state: { useMaxWidth: false },
        });
        const { svg: rendered } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(rendered);
      } catch {
        // A malformed diagram must never take the page down: the source stays
        // visible and the reader still gets the content.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart, reactId]);

  // Measure once the drawing is in the DOM, and again when the window resizes,
  // because the column narrows on a phone.
  useEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    const measure = () => setOverflows(box.scrollWidth > box.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [svg]);

  if (svg) {
    return (
      <figure className="mt-6">
        <div
          ref={containerRef}
          // Wide diagrams scroll inside their own box, never the page. Mermaid
          // injects its own stylesheet per diagram, so a reader who asked for
          // less motion has any animation in it stopped here rather than in
          // the library's config.
          className="ov-scroll overflow-x-auto border border-[var(--ov-line)] bg-card p-5 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-none motion-reduce:[&_*]:!animate-none motion-reduce:[&_*]:!transition-none"
          // The source is repository Markdown, never user input, and mermaid
          // runs at securityLevel "strict", which sanitises its own output with
          // DOMPurify and disables click handlers and raw HTML labels.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {/* Only shown when the drawing really is wider than its box, so the
            reader knows there is more to the right rather than assuming the
            diagram is cut off. */}
        {overflows ? (
          <figcaption className="mt-2 text-[13px] leading-snug text-muted-foreground">
            Wider than the column: scroll the diagram sideways to see all of it.
          </figcaption>
        ) : null}
      </figure>
    );
  }

  return (
    <pre
      className="ov-scroll mt-6 overflow-x-auto border border-[var(--ov-line)] bg-surface-2 p-4 font-mono text-[13px] leading-[1.6] text-ocean"
      aria-label={failed ? "Diagram source (could not be drawn)" : "Diagram source"}
    >
      {chart}
    </pre>
  );
}

/**
 * The app palette, expressed as mermaid theme variables. Values are the same
 * literals as the CSS tokens in app/globals.css: paper #f7f7f5, card #ffffff,
 * ink #04122b, muted ink #5a6b7e, hairline rgba(0,0,0,0.15), accent #0e76ff.
 */
const THEME: Record<string, string> = {
  background: "#ffffff",
  primaryColor: "#f7f7f5",
  primaryTextColor: "#04122b",
  primaryBorderColor: "rgba(0,0,0,0.28)",
  secondaryColor: "#f3f3f3",
  secondaryTextColor: "#04122b",
  secondaryBorderColor: "rgba(0,0,0,0.28)",
  tertiaryColor: "#ffffff",
  tertiaryTextColor: "#04122b",
  tertiaryBorderColor: "rgba(0,0,0,0.15)",
  lineColor: "#5a6b7e",
  textColor: "#04122b",
  mainBkg: "#f7f7f5",
  nodeBorder: "rgba(0,0,0,0.28)",
  clusterBkg: "#ffffff",
  clusterBorder: "rgba(0,0,0,0.15)",
  titleColor: "#04122b",
  edgeLabelBackground: "#ffffff",
  // Sequence diagrams.
  actorBkg: "#f7f7f5",
  actorBorder: "rgba(0,0,0,0.28)",
  actorTextColor: "#04122b",
  actorLineColor: "#5a6b7e",
  signalColor: "#04122b",
  signalTextColor: "#04122b",
  labelBoxBkgColor: "#f3f3f3",
  labelBoxBorderColor: "rgba(0,0,0,0.28)",
  labelTextColor: "#04122b",
  loopTextColor: "#04122b",
  noteBkgColor: "#eef4fb",
  noteBorderColor: "#0e76ff",
  noteTextColor: "#04122b",
  activationBkgColor: "#e6e6e4",
  activationBorderColor: "rgba(0,0,0,0.28)",
  sequenceNumberColor: "#ffffff",
  // State diagrams.
  altBackground: "#f3f3f3",
  transitionColor: "#5a6b7e",
  transitionLabelColor: "#04122b",
  stateLabelColor: "#04122b",
  stateBkg: "#f7f7f5",
  compositeBackground: "#ffffff",
  compositeBorder: "rgba(0,0,0,0.15)",
  compositeTitleBackground: "#f3f3f3",
  innerEndBackground: "#04122b",
  specialStateColor: "#04122b",
};
