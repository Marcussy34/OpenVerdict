"use client";

import { useRef, useState } from "react";
import { Copy, CopySuccess } from "@/components/icons";
import { cn } from "@/lib/utils";

/** One command line: the text, and one button that copies it. Exported so the
 *  claim report can carry the same instruction without a second copy of it. */
export function CommandRow({
  text,
  ready,
  label,
  tone = "hairline",
}: {
  text: string;
  /** False before a claim link is pasted: the text is still a template. */
  ready: boolean;
  label: string;
  /** "ink" is the dark block the Audit page's one line uses; the default is the
   *  hairline row every other command on the site is set in. */
  tone?: "hairline" | "ink";
}) {
  const [copied, setCopied] = useState(false);
  const line = useRef<HTMLElement>(null);
  const ink = tone === "ink";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // A browser that refuses the clipboard still lets the reader copy by
      // hand, so select the line rather than failing silently.
      if (line.current) window.getSelection()?.selectAllChildren(line.current);
    }
  };

  return (
    <div
      className={cn(
        "flex items-stretch",
        ink ? "bg-foreground" : "border border-border bg-surface",
      )}
    >
      <code
        ref={line}
        className={cn(
          "min-w-0 flex-1 font-mono break-all",
          ink
            ? "px-4 py-3 text-[12px] leading-[1.6] text-background"
            : "px-3 py-2.5 text-[11px] leading-[1.6]",
          !ink && (ready ? "text-foreground" : "text-muted-foreground"),
        )}
      >
        {text}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!ready}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className={cn(
          "grid shrink-0 place-items-center transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40",
          ink
            ? "w-12 text-background/60 hover:text-primary"
            : "w-11 border-l border-border text-muted-foreground hover:text-primary",
        )}
      >
        {copied ? (
          <CopySuccess size="15" variant="Bold" className="text-primary" />
        ) : (
          <Copy size="15" />
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${label} copied` : ""}
      </span>
    </div>
  );
}

/**
 * The agent path of the Audit page: one line, and nothing else (owner: "just
 * one line, then we can get this up and running in any agent"). The URL is the
 * skill itself, served from skills/openverdict/SKILL.md, so an agent that
 * fetches it can set itself up at whatever rung it can reach. The origin comes
 * from the page, so a localhost session hands over a localhost link.
 */
export function AgentHandoff({ origin }: { origin: string }) {
  return (
    <section className="mx-auto flex w-full max-w-xl min-w-0 flex-col items-center gap-6 py-12 text-center">
      <p className="ov-micro ov-micro-sm text-muted-foreground">Give this to your agent</p>
      <div className="w-full text-left">
        <CommandRow
          text={`Set up ${origin}/SKILL.md and take it from there.`}
          ready
          label="the setup line"
          tone="ink"
        />
      </div>
      <p className="text-[13px] leading-[1.6] text-muted-foreground">
        Works with any agent that can read a link: Claude, ChatGPT, Codex, Cursor, Gemini.
      </p>
    </section>
  );
}
