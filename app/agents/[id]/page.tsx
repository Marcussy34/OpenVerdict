"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader, ExperimentalTag, MetaTag } from "@/components/viz/page-header";
import { Panel, FieldLabel } from "@/components/viz/panel";
import { HashChip } from "@/components/viz/hash-chip";
import { suiObjectUrl, suiAccountUrl, walrusBlobUrl } from "@/lib/web/explorer";
import { ModelBadge, modelFamily } from "@/components/viz/model-badge";
import { cn } from "@/lib/utils";
import type { AgentDirectoryEntry } from "@/lib/engine/contract";
import type { AgentManifestDocument } from "@/lib/protocol/types";
import {
  Profile2User,
  Cpu,
  ShieldTick,
  Activity,
  TickCircle,
  CloseCircle,
  DocumentCode,
  KeySquare,
} from "@/components/icons";

interface AgentDetailPageProps {
  params: Promise<{ id: string }>;
}

type ManifestResponse = AgentManifestDocument & {
  manifestBlobId?: string;
};

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
  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!agent) return;
    // Captured outside the closure: TypeScript does not carry the null guard into it.
    const agentProfileId = agent.agentProfileId;
    let ignore = false;
    async function loadManifest() {
      try {
        const response = await fetch(
          `/api/agents/${encodeURIComponent(agentProfileId)}/manifest`,
          { cache: "no-store" },
        );
        if (ignore) return;
        if (response.status === 404) {
          setManifestError("No published manifest document was found");
          return;
        }
        if (response.status === 503) {
          setManifestError("The verification engine is not available");
          return;
        }
        if (!response.ok) {
          setManifestError("The manifest document could not be loaded");
          return;
        }
        setManifest((await response.json()) as ManifestResponse);
      } catch {
        if (!ignore) setManifestError("The manifest document could not be loaded");
      } finally {
        if (!ignore) setManifestLoading(false);
      }
    }
    void loadManifest();
    return () => {
      ignore = true;
    };
  }, [agent]);

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
  const manifestBlobId =
    manifest?.manifestBlobId ??
    (agent as AgentDirectoryEntry & { manifestBlobId?: string }).manifestBlobId;

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
              <FieldLabel>Registered label</FieldLabel>
              <p className="text-base font-semibold text-ocean">
                {agent.role.replace(/_/g, " ")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                A recorded manifest label with no behavioral effect: every juror
                runs the same protocol prompts and tools. The label is committed
                inside the on-chain registration hash.
              </p>
            </div>
          </div>

          <dl className="space-y-2">
            {([
              ["Agent profile object id", agent.agentProfileId, "chain", suiObjectUrl(agent.agentProfileId)],
              ["Owner account address", agent.owner, "default", suiAccountUrl(agent.owner)],
              ["Manifest Blake2b-256 hash", agent.manifestHash, "sealed", undefined],
            ] as const).map(([label, value, tone, href]) => (
              <div
                key={label}
                className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <FieldLabel>{label}</FieldLabel>
                <HashChip
                  value={value}
                  tone={tone}
                  head={12}
                  tail={10}
                  href={href}
                />
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      <Panel label="Published manifest document" icon={DocumentCode} tone="sealed">
        {manifestLoading ? (
          <div className="space-y-2">
            <div className="h-9 animate-pulse rounded-lg bg-surface-2" />
            <div className="h-44 animate-pulse rounded-lg bg-surface-2" />
          </div>
        ) : manifest ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface p-3">
                <FieldLabel className="mb-1">Version</FieldLabel>
                <p className="text-sm font-semibold text-ocean">{manifest.version}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <FieldLabel className="mb-1">Network</FieldLabel>
                <p className="text-sm font-semibold text-ocean">{manifest.network}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <FieldLabel className="mb-1">Stake kind</FieldLabel>
                <p className="text-xs font-semibold break-words text-ocean">
                  {manifest.backingKind}
                </p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["Manifest hash", agent.manifestHash, "sealed", undefined],
                ["Prompt hash", manifest.promptHash, "chain", undefined],
                ["Tool policy hash", manifest.toolPolicyHash, "default", undefined],
                ["Evidence policy hash", manifest.evidencePolicyHash, "default", undefined],
                ["Staker hash", manifest.humanBackingHash, "sealed", undefined],
                ["Operational owner", manifest.operationalOwner, "chain", manifest.operationalOwner ? suiAccountUrl(manifest.operationalOwner) : undefined],
              ] as const).map(([label, value, tone, href]) => (
                <div key={label} className="space-y-1.5 rounded-lg border border-border bg-card p-2.5">
                  <FieldLabel>{label}</FieldLabel>
                  <HashChip
                    value={value}
                    tone={tone}
                    head={12}
                    tail={10}
                    href={href}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <FieldLabel>Manifest blob id</FieldLabel>
              {manifestBlobId ? (
                <HashChip value={manifestBlobId} tone="sealed" head={14} tail={10} href={walrusBlobUrl(manifestBlobId)} />
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  The current agent directory response does not expose this blob id.
                </p>
              )}
            </div>

            <div className={cn("grid gap-4", manifest.version !== "2" && "lg:grid-cols-2")}>
              {(manifest.version === "3" ||
                manifest.version === "4" ||
                manifest.version === "5") && (
                <div className="space-y-1.5">
                  <FieldLabel>Tool policy budgets</FieldLabel>
                  <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    {(() => {
                      // Every research policy version (v2 to v4) shares the base
                      // budgets; v3 adds the two-sided rules, v4 the batch size.
                      const policy = manifest.toolPolicy as Record<string, unknown>;
                      const rows: Array<[string, string]> = [
                        ["Provider", String(policy.provider)],
                        ["Policy version", String(policy.version)],
                        ["Searches", String(policy.maxSearches)],
                        ["Opens", String(policy.maxOpens)],
                        ["Turns", String(policy.maxTurns)],
                        ["Results per search", String(policy.resultsPerSearch)],
                        ["Page slice chars", String(policy.pageSliceChars)],
                        ["Max page chars", String(policy.maxPageChars)],
                      ];
                      if ("maxOpensPerTurn" in policy) {
                        rows.splice(4, 0, ["Opens per turn", String(policy.maxOpensPerTurn)]);
                      }
                      if ("requireChallengeSearch" in policy) {
                        rows.push([
                          "Challenge search",
                          policy.requireChallengeSearch ? "required" : "optional",
                        ]);
                      }
                      if ("minCitationDomains" in policy) {
                        rows.push(["Citation sites (min)", String(policy.minCitationDomains)]);
                      }
                      if ("minOpensPerSide" in policy) {
                        rows.push(["Opens per side (min)", String(policy.minOpensPerSide)]);
                      }
                      return rows;
                    })().map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-border bg-surface p-2.5">
                        <dt className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                          {label}
                        </dt>
                        <dd className="mt-1 font-mono text-xs font-semibold text-ocean">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <div className="space-y-1.5">
                <FieldLabel>Prompt spec text</FieldLabel>
                <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
                  {JSON.stringify(manifest.promptSpec, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-muted-foreground">
            {manifestError ?? "The manifest document is not available"}
          </div>
        )}
      </Panel>

      {/* Reputation */}
      <Panel label="On-chain reputation counters (static in v1)" icon={ShieldTick} tone="yes">
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Counters registered on-chain for every agent, in basis points
          (10,000 = 100%). In this release the protocol records them at their
          baseline and does not yet update them, and every eligible agent keeps
          an equal selection weight; what differentiates jurors today is the
          live track record (seats served, reveals, agreement, earnings).
        </p>

        {reputationEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-muted-foreground">
            No counters could be read from the chain for this agent.
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
                      {typeof bps === "number" ? `${bps} bps · ${pct}%` : "Not recorded"}
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

      {/* Stake */}
      <Panel label="Stake & committee diversity" icon={KeySquare} tone="sealed">
        <p className="text-xs leading-relaxed text-muted-foreground">
          A juror agent receives the{" "}
          <strong className="font-semibold text-ocean">ZKLOGIN_BACKED</strong> label only after
          its Google zkLogin address signs the canonical stake message. Any account can stake
          on a juror: a browser wallet, an operator key, or a Google sign-in through zkLogin,
          which is authentication and nothing more, there so people without a wallet can stake
          too. Every stake resolves to a staker hash, and a committee seats at most one seat
          per staker hash, so a single draw spreads across stakers.
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
