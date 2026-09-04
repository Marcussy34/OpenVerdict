"use client";

import { useRef, useState } from "react";
import {
  Code,
  Copy,
  CopySuccess,
  Cpu,
  MessageProgramming,
  type IconComponent,
} from "@/components/icons";
import { cn } from "@/lib/utils";

/** The literal a card shows until a claim link is pasted. */
const PLACEHOLDER = "<link>";

/** One command line: the text, and one button that copies it. */
function CommandRow({
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

function HandoffCard({
  title,
  icon: Icon,
  sentence,
  children,
}: {
  title: string;
  icon: IconComponent;
  sentence: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border border-border bg-card p-4">
      <h3 className="ov-micro ov-micro-sm flex items-center gap-2 text-muted-foreground">
        <Icon size="14" variant="Bold" className="text-primary" />
        {title}
      </h3>
      {/* A floor of two lines keeps the three command blocks on one baseline. */}
      <p className="min-h-[2.5rem] text-[13px] leading-[1.5] text-foreground/75">{sentence}</p>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/**
 * The agent path of the Audit page: three ways to hand one claim to an agent,
 * each a single sentence and a command that carries the pasted link. No hex,
 * no fields: everything a reader needs to audit without understanding the
 * preimage lives here.
 */
export function AgentHandoff({ href, origin }: { href: string | null; origin: string }) {
  const ready = href !== null;
  const link = href ?? PLACEHOLDER;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <HandoffCard
          title="Any AI agent"
          icon={MessageProgramming}
          sentence="Paste this into Claude, ChatGPT, Codex or any agent."
        >
          <CommandRow
            text={`Read ${origin}/llms.txt, then audit ${link} and explain the verdict.`}
            ready={ready}
            label="the agent prompt"
          />
        </HandoffCard>

        <HandoffCard
          title="Claude Code"
          icon={Cpu}
          sentence="Open Claude Code in the repository from the submission. The audit skill loads itself."
        >
          <CommandRow text={`audit ${link}`} ready={ready} label="the Claude Code line" />
        </HandoffCard>

        <HandoffCard
          title="Terminal"
          icon={Code}
          sentence="No key, no wallet, no database."
        >
          <CommandRow text={`pnpm ov audit ${link}`} ready={ready} label="the audit command" />
          <p className="text-[11px] text-muted-foreground">Or the reasoning trail:</p>
          <CommandRow text={`pnpm ov trace ${link}`} ready={ready} label="the trace command" />
        </HandoffCard>
      </div>

      {/* The claim of the audit, in the auditor's own words (audit skill, "How to present"). */}
      <p className="border border-border bg-surface px-4 py-3 text-[13px] leading-[1.6] text-muted-foreground">
        This audit proves the record is unchanged and evidence-bound (every commitment and run
        hash recomputes to what Sui holds, and the certificate carries the recomputed score); it
        does not prove the claim is true, and it does not prove byte for byte what the model
        received (GonkaRouter&rsquo;s public receipt corroborates the call; a gateway-signed
        receipt is the disclosed gap).
      </p>
    </div>
  );
}
