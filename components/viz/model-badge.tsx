"use client";

import { cn } from "@/lib/utils";

export type FamilyKey = "deepseek" | "kimi" | "minimax" | "other";

interface Family {
  key: FamilyKey;
  name: string;
  /** Short display form of the full model id, e.g. "DeepSeek-V4-Flash". */
  short: string;
  text: string;
  chip: string;
  dot: string;
}

/**
 * Model-family identity. Committee diversity (≥3 distinct families) is a core
 * protocol guarantee, so each family gets a persistent hue across the whole UI.
 */
export function modelFamily(modelId?: string | null): Family {
  const id = (modelId ?? "").toLowerCase();
  const short = (modelId ?? "unknown").split("/").pop() ?? "unknown";

  if (id.includes("deepseek"))
    return {
      key: "deepseek",
      name: "DeepSeek",
      short,
      text: "text-family-a",
      chip: "border-family-a/30 bg-family-a/10 text-family-a",
      dot: "bg-family-a",
    };
  if (id.includes("kimi") || id.includes("moonshot"))
    return {
      key: "kimi",
      name: "Kimi",
      short,
      text: "text-family-b",
      chip: "border-family-b/30 bg-family-b/10 text-family-b",
      dot: "bg-family-b",
    };
  if (id.includes("minimax"))
    return {
      key: "minimax",
      name: "MiniMax",
      short,
      text: "text-family-c",
      chip: "border-family-c/30 bg-family-c/10 text-family-c",
      dot: "bg-family-c",
    };
  return {
    key: "other",
    name: "Unknown",
    short,
    text: "text-muted-foreground",
    chip: "border-border bg-surface text-muted-foreground",
    dot: "bg-muted-foreground",
  };
}

export function ModelDot({ modelId, className }: { modelId?: string | null; className?: string }) {
  const fam = modelFamily(modelId);
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", fam.dot, className)}
    />
  );
}

export function ModelBadge({
  modelId,
  className,
  showFamily = true,
}: {
  modelId?: string | null;
  className?: string;
  showFamily?: boolean;
}) {
  const fam = modelFamily(modelId);
  return (
    <span
      title={modelId ?? undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium",
        fam.chip,
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", fam.dot)} />
      {showFamily && (
        <span className="shrink-0 font-semibold tracking-[0.08em] uppercase">{fam.name}</span>
      )}
      <span className="truncate opacity-80">{fam.short}</span>
    </span>
  );
}
