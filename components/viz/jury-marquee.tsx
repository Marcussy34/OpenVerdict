"use client";

import * as React from "react";
import Link from "next/link";
import { Cpu, ArrowRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { shortModel } from "@/components/globe/network";
import { ModelLogo, logoFamily } from "@/components/viz/model-logo";

export type JuryMember = {
  id: string;
  role: string;
  model: string;
  active: boolean;
};

/** The tint a member wears: its position among the members of the same model. */
function variantOf(members: readonly JuryMember[], index: number): number {
  const family = logoFamily(members[index]?.model);
  let count = 0;
  for (let i = 0; i < index; i += 1) {
    if (logoFamily(members[i]?.model) === family) count += 1;
  }
  return count;
}

function MemberChip({ member, variant }: { member: JuryMember; variant: number }) {
  return (
    <span className="flex shrink-0 items-center gap-2 border border-border bg-card py-1.5 pr-3 pl-1.5 shadow-2xs">
      <ModelLogo
        modelId={member.model}
        variant={variant}
        size={18}
        className={cn(!member.active && "opacity-45")}
      />
      <span className="font-mono text-[11px] font-medium text-ocean">
        {shortModel(member.model)}
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
      <span className="ov-micro ov-micro-sm flex shrink-0 items-center gap-1.5 text-muted-foreground">
        <Cpu size="13" variant="Bold" className="text-primary" />
        <span className="hidden sm:inline">Jury pool</span>
      </span>
      <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

      <div className="ov-fade-x relative min-w-0 flex-1 overflow-hidden">
        <div className="ov-marquee flex w-max items-center gap-2.5">
          {members.map((member, index) => (
            <MemberChip key={member.id} member={member} variant={variantOf(members, index)} />
          ))}
          <span aria-hidden className="flex items-center gap-2.5">
            {members.map((member, index) => (
              <MemberChip
                key={`dup-${member.id}`}
                member={member}
                variant={variantOf(members, index)}
              />
            ))}
          </span>
        </div>
      </div>

      <Link
        href="/agents"
        className="ov-micro ov-micro-sm hidden shrink-0 items-center gap-1 pr-4 text-primary hover:underline sm:flex"
      >
        Registry
        <ArrowRight size="12" variant="Bold" />
      </Link>
    </div>
  );
}
