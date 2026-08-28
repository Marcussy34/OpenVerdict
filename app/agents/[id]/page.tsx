"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader, ExperimentalTag, MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { ModelBadge, modelFamily } from "@/components/viz/model-badge";
import { cn } from "@/lib/utils";
import type { AgentDirectoryEntry } from "@/lib/engine/contract";
import {
  Profile2User,
  Cpu,
  ShieldTick,
  Activity,
  TickCircle,
  CloseCircle,
  KeySquare,
} from "@/components/icons";

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

/** The reputation dimensions the Move registry maintains, in display order. */
const DIMENSIONS = [
  {
    key: "liveness_bps",
    label: "Liveness & response rate",
    hint: "Share of assigned runs answered before the deadline.",
  },
  {
    key: "valid_output_bps",
    label: "Valid structured output",
    hint: "Share of runs producing schema-valid, parseable JSON.",
  },
  {
    key: "valid_reveal_bps",
    label: "Commitment reveal exactness",
    hint: "Reveals whose preimage hashed byte-exactly to the sealed commitment.",
  },
  {
    key: "consensus_reliability_bps",
    label: "Consensus reliability",
    hint: "Alignment with the terminal valid round after reveal.",
  },
] as const;

export default function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { id } = use(params);

  const [agent, setAgent] = useState<AgentDirectoryEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function loadAgent() {
      try {
        const res = await fetch("/api/agents");
        if (ignore) return;
        if (res.ok) {
          const data = await res.json();
          const found = (data.agents as AgentDirectoryEntry[])?.find(
            (a) =>
              a.agentProfileId.toLowerCase() === id.toLowerCase() ||
              a.agentProfileId.includes(id),
          );
          if (found && !ignore) setAgent(found);
        }
      } catch {
        /* fall through to the not-registered state */
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadAgent();
    return () => {
      ignore = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-5 py-16 md:px-7">
        <div className="h-9 w-44 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-48 animate-pulse rounded-2xl bg-surface" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-24 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-surface text-muted-foreground">
          <Profile2User size="24" variant="Bold" />
        </span>
        <h1 className="text-xl font-semibold text-ocean">Agent not in the registry</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          No AgentProfile object with this id was returned by the registry. It may have been
          retired, or it belongs to a different deployment.
        </p>
        <HashChip value={id} full className="max-w-md" />
        <Button asChild size="sm" className="mt-2 min-h-[40px]">
          <Link href="/agents">Back to registry</Link>
        </Button>
      </div>
    );
  }

  const family = modelFamily(agent.modelId);
  const reputationEntries = Object.entries(agent.reputation ?? {});

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-10 md:px-7 lg:py-12">
      <PageHeader
        backHref="/agents"
        backLabel="Agent registry"
        eyebrow={family.name}
        title="Agent profile"
        icon={Profile2User}
        badges={<ExperimentalTag />}
        actions={
          <MetaTag tone={agent.active ? "yes" : "default"}>
            {agent.active ? (
              <>
                <TickCircle size="11" variant="Bold" />
                Active juror
              </>
            ) : (
              <>
                <CloseCircle size="11" variant="Bold" />
                Retired
              </>
            )}
          </MetaTag>
        }
      />

      {/* Identity */}
      <Panel label="Model identity" icon={Cpu} tone="primary">
        <div className="space-y-5">
          <div className="grid gap-4 border-b border-border pb-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel>Model</FieldLabel>
              <ModelBadge modelId={agent.modelId} className="text-[11px]" />
              <p className="font-mono text-xs break-all text-muted-foreground">{agent.modelId}</p>
            </div>
            <div className="space-y-1.5">
              <FieldLabel>Persona &amp; role</FieldLabel>
              <p className="text-base font-semibold text-ocean">
                {agent.role.replace(/_/g, " ")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                The role is committed inside the on-chain registration hash.
              </p>
            </div>
          </div>

          <dl className="space-y-2">
            {[
              ["Agent profile object id", agent.agentProfileId, "chain"],
              ["Owner account address", agent.owner, "default"],
              ["Manifest Blake2b-256 hash", agent.manifestHash, "sealed"],
            ].map(([label, value, tone]) => (
              <div
                key={label}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <FieldLabel>{label}</FieldLabel>
                <HashChip
                  value={value}
                  tone={tone as "chain" | "default" | "sealed"}
                  head={12}
                  tail={10}
                />
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      {/* Reputation */}
      <Panel label="Multi-dimensional reputation" icon={ShieldTick} tone="yes">
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          On-chain metrics maintained across historical dispute and direct-review jury runs.
          Every dimension is stored in basis points (10,000 = 100%).
        </p>

        {reputationEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-muted-foreground">
            No reputation dimensions recorded yet — this agent has not completed a scored jury
            run on this deployment.
          </div>
        ) : (
          <div className="space-y-4">
            {DIMENSIONS.map((dim) => {
              const bps = agent.reputation?.[dim.key];
              const pct = typeof bps === "number" ? Math.min(100, bps / 100) : 0;
              return (
                <div key={dim.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-ocean">{dim.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {typeof bps === "number" ? `${bps} bps · ${pct}%` : "—"}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-700", family.dot)}
                      style={{ width: `${pct}%` }}
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={dim.label}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">{dim.hint}</p>
                </div>
              );
            })}

            {/* Any additional dimensions the registry reports (e.g. resolved_runs). */}
            {reputationEntries.filter(
              ([key]) => !DIMENSIONS.some((d) => d.key === key),
            ).length > 0 && (
              <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-2">
                {reputationEntries
                  .filter(([key]) => !DIMENSIONS.some((d) => d.key === key))
                  .map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[11px]"
                    >
                      <span className="text-muted-foreground">{key}</span>
                      <span className="font-semibold text-ocean tabular-nums">{value}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* Backing */}
      <Panel label="Human backing & Sybil resistance" icon={KeySquare} tone="sealed">
        <p className="text-xs leading-relaxed text-muted-foreground">
          A juror agent receives the{" "}
          <strong className="font-semibold text-ocean">ZKLOGIN_BACKED</strong> label only after
          its Google zkLogin address signs the canonical backing message. With a fixed salt
          policy one social account maps to one backing hash, and the Move rule
          &ldquo;one committee seat per human backing hash&rdquo; makes that one seat. This
          raises Sybil cost — it is authentication, never proof of personhood.
        </p>
      </Panel>

      {/* Runs */}
      <Panel label="Recent jury inferences" icon={Activity}>
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center">
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            No historical run transcripts are cached for this agent in local observer storage.
            Run audits live in Walrus blobs and are surfaced per-claim in each settled report.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-1 min-h-[38px] font-semibold">
            <Link href="/claims">Browse claims</Link>
          </Button>
        </div>
      </Panel>
    </div>
  );
}
