"use client";

import { useRef, useState } from "react";
import { Copy, CopySuccess, MessageProgramming } from "@/components/icons";
import { cn } from "@/lib/utils";

/** The literal the prompt carries until a claim link is pasted; the reader replaces it. */
const PLACEHOLDER = "<claim link>";

/** One command line: the text, and one button that copies it. Exported so the
 *  claim report can carry the same instruction without a second copy of it. */
export function CommandRow({
  text,
  ready,
  label,
}: {
  text: string;
  /** False before a claim link is pasted: the text is still a template. */
  ready: boolean;
  label: string;
}) {
  const [copied, setCopied] = useState(false);
  const line = useRef<HTMLElement>(null);

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
    <div className="flex items-stretch border border-border bg-surface">
      <code
        ref={line}
        className={cn(
          "min-w-0 flex-1 px-3 py-2.5 font-mono text-[11px] leading-[1.6] break-all",
          ready ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {text}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!ready}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="grid w-11 shrink-0 place-items-center border-l border-border text-muted-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
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
 * The agent path of the Audit page: one instruction for any AI agent (owner:
 * "just have one for the agent to understand and setup"). The prompt carries
 * the pasted claim link when there is one and a placeholder otherwise, so it
 * can be copied either way.
 */
export function AgentHandoff({ href, origin }: { href: string | null; origin: string }) {
  const link = href ?? PLACEHOLDER;
  return (
    <section className="flex min-w-0 flex-col gap-3 border border-border bg-card p-4">
      <h3 className="ov-micro ov-micro-sm flex items-center gap-2 text-muted-foreground">
        <MessageProgramming size="14" variant="Bold" className="text-primary" />
        Any AI agent
      </h3>
      <p className="text-[13px] leading-[1.5] text-foreground/75">
        Paste this into Claude, ChatGPT, Codex or any agent
        {href === null ? ", with the claim link in place of the placeholder." : "."}
      </p>
      <CommandRow
        text={`Read ${origin}/llms.txt, then audit ${link} and explain the verdict.`}
        ready
        label="the agent prompt"
      />
    </section>
  );
}
