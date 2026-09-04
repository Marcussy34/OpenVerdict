"use client";

import { useEffect, useId, useRef, useState } from "react";

/** Smallest rendered label size a diagram may be scaled down to. */
const MIN_LABEL_PX = 12;

/** How a drawing was sized for the width it currently has to live in. */
type Fit = {
  /** Width the figure takes, or null when the layout hook is absent. */
  width: number | null;
  /** Width the drawing itself is painted at. */
  drawn: number;
  /** True when the drawing is still wider than its box and has to scroll. */
  scrolls: boolean;
  /** True when the figure reaches past the reading column. */
  breaksOut: boolean;
};

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
 *
 * Sizing, in order, so a wide drawing is seen whole rather than clipped: a
 * diagram that fits the reading column is drawn at its own size; a wider one
 * breaks out to the right, keeping the column's left edge and reaching as far
 * as the page frame's content edge; wider still and it is scaled down to that
 * width while its labels stay readable; only when even the frame cannot hold
 * it at a readable size does it keep a scroll box, drawn at the smallest
 * readable scale and starting at its own left edge so nothing is hidden off
 * the left side.
 */
export function MermaidDiagram({ chart }: { chart: string }) {
  const reactId = useId();
  const figureRef = useRef<HTMLElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState<Fit | null>(null);

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
          // useMaxWidth would hand mermaid the sizing decision and let it
          // shrink a wide diagram to the reading column however small that
          // makes the labels. The drawing keeps its natural size here and the
          // effect below fits it to the page with a readability floor.
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

  // Fit the drawing to the space the page can give it, again whenever that
  // space changes, because the column narrows on a smaller window.
  useEffect(() => {
    const figure = figureRef.current;
    const box = boxRef.current;
    const drawing = box?.querySelector("svg");
    if (!figure || !box || !drawing) return;

    const natural = naturalWidth(drawing);
    const label = dominantLabelPx(drawing);
    // The smallest scale that still leaves this diagram's labels readable.
    const floor = label > 0 ? Math.min(1, MIN_LABEL_PX / label) : 0;
    // Both hooks come from the docs page; without them the figure keeps the
    // width its parent gives it and only the scaling below applies.
    const column = figure.closest<HTMLElement>("[data-docs-column]");
    const frame = figure.closest<HTMLElement>("[data-docs-frame]");

    const measure = () => {
      const chrome = horizontalChrome(box);
      const columnWidth = column
        ? column.getBoundingClientRect().width
        : box.getBoundingClientRect().width;
      const wanted = natural + chrome;
      let width = columnWidth;
      // A drawing wider than the reading column takes the room the page frame
      // still has to its right, and only as much of it as the drawing needs.
      if (column && frame && wanted > columnWidth) {
        width = Math.max(columnWidth, Math.min(wanted, frameWidth(column, frame)));
      }

      const inner = Math.max(0, width - chrome);
      const scale = natural > 0 ? Math.min(1, inner / natural) : 1;
      // Rounding runs the way that keeps the promise: a drawing with room to
      // spare keeps its own size, one scaled to the box rounds down so a stray
      // part of a pixel cannot bring a scrollbar back, and one that still has
      // to scroll rounds up so its labels never land under the floor.
      const drawn =
        scale >= floor
          ? natural <= inner
            ? natural
            : Math.floor(inner)
          : Math.ceil(natural * floor);
      const next: Fit = {
        width: column && frame ? Math.round(width) : null,
        drawn,
        scrolls: drawn > inner + 0.5,
        breaksOut: width > columnWidth + 0.5,
      };

      // The drawing carries a viewBox, so a width plus an automatic height
      // scales it whole. A drawing wider than its box must start at its own
      // left edge: a centred child of a scrolling box puts its left side out
      // of reach, which is what cut the sequence diagram off.
      drawing.style.width = `${next.drawn}px`;
      drawing.style.height = "auto";
      drawing.style.marginInline = next.scrolls ? "0" : "auto";
      setFit((previous) => (previous && sameFit(previous, next) ? previous : next));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Observing the column and the frame, never the figure, keeps the width
    // this sets from feeding back into the measurement.
    const observer = new ResizeObserver(measure);
    if (column) observer.observe(column);
    if (frame) observer.observe(frame);
    return () => observer.disconnect();
  }, [svg]);

  if (svg) {
    return (
      <figure
        ref={figureRef}
        // A figure that reaches past the column crosses the page's "on this
        // page" rail, so it is lifted above it: the rail returns as soon as
        // the reader scrolls past the drawing.
        className={fit?.breaksOut ? "relative z-[1] mt-6" : "mt-6"}
        style={fit?.width ? { width: fit.width, maxWidth: "none" } : undefined}
      >
        <div
          ref={boxRef}
          // A drawing too wide for the page scrolls inside its own box, never
          // the page. Mermaid injects its own stylesheet per diagram, so a
          // reader who asked for less motion has any animation in it stopped
          // here rather than in the library's config.
          className="ov-scroll overflow-x-auto border border-[var(--ov-line)] bg-card p-5 [&_svg]:h-auto [&_svg]:max-w-none motion-reduce:[&_*]:!animate-none motion-reduce:[&_*]:!transition-none"
          // The source is repository Markdown, never user input, and mermaid
          // runs at securityLevel "strict", which sanitises its own output with
          // DOMPurify and disables click handlers and raw HTML labels.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {/* Only shown when the drawing really is wider than its box, so the
            reader knows there is more to the right rather than assuming the
            diagram is cut off. */}
        {fit?.scrolls ? (
          <figcaption className="mt-2 text-[13px] leading-snug text-muted-foreground">
            Too wide for this window: scroll the diagram sideways to see the rest.
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

/** The drawing's own width in CSS pixels, from the viewBox mermaid gives it. */
function naturalWidth(svg: SVGSVGElement): number {
  const view = svg.viewBox?.baseVal;
  if (view && view.width > 0) return view.width;
  const attribute = Number.parseFloat(svg.getAttribute("width") ?? "");
  if (Number.isFinite(attribute) && attribute > 0) return attribute;
  return svg.getBoundingClientRect().width;
}

/**
 * The size most of a diagram's labels are set at. The smallest size would be
 * the wrong floor: a sequence diagram's autonumber badges are 12px ornament
 * beside 14px prose, and letting them veto every scale would keep every wide
 * diagram in a scroll box.
 */
function dominantLabelPx(svg: SVGSVGElement): number {
  const counts = new Map<number, number>();
  for (const node of svg.querySelectorAll("text, tspan, span, div, p")) {
    if (!hasOwnText(node)) continue;
    const size = Number.parseFloat(getComputedStyle(node).fontSize);
    if (!Number.isFinite(size) || size <= 0) continue;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount || (count === bestCount && size < best)) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

/** True when the element holds words of its own, not only child elements. */
function hasOwnText(node: Element): boolean {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3 && (child.textContent ?? "").trim() !== "") return true;
  }
  return false;
}

/** Border and padding the figure's box adds around the drawing. */
function horizontalChrome(box: HTMLElement): number {
  const style = getComputedStyle(box);
  return (
    (Number.parseFloat(style.paddingLeft) || 0) +
    (Number.parseFloat(style.paddingRight) || 0) +
    (Number.parseFloat(style.borderLeftWidth) || 0) +
    (Number.parseFloat(style.borderRightWidth) || 0)
  );
}

/**
 * How wide a figure may be when it breaks out: from the reading column's left
 * edge, which it always keeps so the documentation rail is never covered, to
 * the page frame's content edge.
 */
function frameWidth(column: HTMLElement, frame: HTMLElement): number {
  const style = getComputedStyle(frame);
  const right =
    frame.getBoundingClientRect().right - (Number.parseFloat(style.paddingRight) || 0);
  return right - column.getBoundingClientRect().left;
}

/** Nothing changed, so the render can be skipped. */
function sameFit(a: Fit, b: Fit): boolean {
  return (
    a.width === b.width &&
    a.drawn === b.drawn &&
    a.scrolls === b.scrolls &&
    a.breaksOut === b.breaksOut
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
