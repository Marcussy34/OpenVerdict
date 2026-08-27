"use client";

import * as React from "react";
import Link from "next/link";
import { Cpu, ArrowRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { shortModel } from "@/components/globe/network";

export type JuryMember = {
  id: string;
  role: string;
  model: string;
  active: boolean;
};

/** Model family → identity hue, matched to the globe's node colours. */
function familyClass(modelId: string) {
  const id = modelId.toLowerCase();
  if (id.includes("deepseek")) return "bg-family-a";
  if (id.includes("kimi") || id.includes("moonshot")) return "bg-family-b";
  return "bg-family-c";
}

function MemberChip({ member }: { member: JuryMember }) {
  return (
    <span className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-2xs">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          member.active ? familyClass(member.model) : "bg-muted-foreground/40",
        )}
        aria-hidden
      />
      <span className="font-mono text-[11px] font-medium text-ocean">
        {shortModel(member.model)}
      </span>
      <span className="h-3 w-px bg-border" aria-hidden />
      <span className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
        {member.role.replace(/_/g, " ")}
      </span>
    </span>
  );
}

/**
 * The registered jury pool as a continuous rail — the model diversity the
 * protocol depends on, read live from the agent registry. Duplicated once so
 * the loop is seamless; the copy is hidden from assistive tech.
 */
export function JuryMarquee({
  members,
  className,
}: {
  members: JuryMember[];
  className?: string;
}) {
  if (!members.length) return null;

  return (
    <div
      className={cn(
        "ov-edge flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-card/70 py-2.5 pl-4 backdrop-blur-sm sm:gap-4",
        className,
      )}
    >
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        <Cpu size="13" variant="Bold" className="text-primary" />
        <span className="hidden sm:inline">Jury pool</span>
      </span>
      <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

      <div className="ov-fade-x relative min-w-0 flex-1 overflow-hidden">
        <div className="ov-marquee flex w-max items-center gap-2.5">
          {members.map((member) => (
            <MemberChip key={member.id} member={member} />
          ))}
          <span aria-hidden className="flex items-center gap-2.5">
            {members.map((member) => (
              <MemberChip key={`dup-${member.id}`} member={member} />
            ))}
          </span>
        </div>
      </div>

      <Link
        href="/agents"
        className="hidden shrink-0 items-center gap-1 pr-4 font-mono text-[10px] font-semibold tracking-[0.12em] text-primary uppercase hover:underline sm:flex"
      >
        Registry
        <ArrowRight size="12" variant="Bold" />
      </Link>
    </div>
  );
}
