"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { WeatherStrip } from "@/components/weather/weather-strip";
import { TimeDisplay } from "@/components/time-display";
import { FieldLabel } from "@/components/viz/panel";
import { Button } from "@/components/ui/button";
import { ArrowLeft2, Refresh, Warning2 } from "@/components/icons";
import type { QueuedFactCheck } from "@/lib/engine/contract";

export default function QueuedFactCheckPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const [item, setItem] = useState<QueuedFactCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let ignore = false;

    const fetchQueue = async () => {
      try {
        const res = await fetch(`/api/fact-checks/queue/${encodeURIComponent(id)}`);
        if (res.status === 404) {
          if (!ignore) {
            setNotFound(true);
            setLoading(false);
          }
          return;
        }
        if (!res.ok) {
          if (!ignore) {
            setError("Could not load queue status");
            setLoading(false);
          }
          return;
        }
        const data: QueuedFactCheck = await res.json();
        if (!ignore) {
          setItem(data);
          setLoading(false);
        }
        if (data.status === "LAUNCHED" && data.claimId) {
          router.replace(`/claims/${encodeURIComponent(data.claimId)}`);
        }
      } catch {
        if (!ignore) {
          setError("Could not reach the server");
          setLoading(false);
        }
      }
    };

    void fetchQueue();
    const timer = setInterval(() => {
      void fetchQueue();
    }, 10_000);

    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [id, router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-16 md:px-7 md:py-24">
        <div className="h-8 w-36 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-32 animate-pulse rounded-2xl bg-surface" />
        <div className="h-24 animate-pulse rounded-2xl bg-surface" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-5 py-24 text-center">
        <h1 className="text-2xl font-semibold text-ocean">Submission not found</h1>
        <p className="text-sm text-muted-foreground">
          No queued submission with this id.
        </p>
        <Button asChild size="sm" className="min-h-10">
          <Link href="/fact-check">Back to fact check</Link>
        </Button>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-5 py-24 text-center">
        <Warning2 size="24" className="text-unsure" />
        <p className="text-sm text-muted-foreground">{error ?? "Unable to load queue item"}</p>
        <Button
          size="sm"
          onClick={() => {
            setLoading(true);
            setError(null);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (item.status === "EXPIRED") {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-16 md:px-7 md:py-24">
        <div className="space-y-2">
          <h1 className="ov-display text-3xl font-semibold text-ocean">Submission expired</h1>
          <p className="text-sm text-muted-foreground">
            The families did not all answer within six hours. Submit again.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
          <FieldLabel>Claim statement</FieldLabel>
          <p className="text-base font-medium text-ocean">{item.statement}</p>
        </div>
        <Button asChild className="min-h-11 font-semibold">
          <Link href="/fact-check">Submit again</Link>
        </Button>
      </div>
    );
  }

  if (item.status === "CANCELLED") {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-16 md:px-7 md:py-24">
        <div className="space-y-2">
          <h1 className="ov-display text-3xl font-semibold text-ocean">Submission cancelled</h1>
          <p className="text-sm text-no">
            This submission could not be launched: {item.launchError ?? "Unknown launch error"}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
          <FieldLabel>Claim statement</FieldLabel>
          <p className="text-base font-medium text-ocean">{item.statement}</p>
        </div>
        <Button asChild variant="outline" className="min-h-11 font-semibold">
          <Link href="/fact-check">Back to fact check</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-5 py-16 md:px-7 md:py-24">
      <div className="space-y-3">
        <Link
          href="/fact-check"
          className="-ml-1 inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-ocean"
        >
          <ArrowLeft2 size="13" />
          Verify another claim
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="ov-display text-4xl font-semibold text-ocean">Queued</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-unsure/10 px-3 py-1 text-xs font-bold text-unsure">
            <Refresh size="13" className="motion-safe:animate-spin" />
            Waiting for clear weather
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          A jury needs all three model families and web search. Yours starts on the first clear probe.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-2 shadow-xs">
        <FieldLabel>Claim statement</FieldLabel>
        <p className="text-lg font-medium leading-relaxed text-ocean">
          {item.statement}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-xs">
        <FieldLabel>Live model family health</FieldLabel>
        <WeatherStrip initial={item.weather} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-3.5 space-y-1">
          <FieldLabel>Queued at</FieldLabel>
          <div>
            <TimeDisplay isoString={item.createdAt} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3.5 space-y-1">
          <FieldLabel>Expires at</FieldLabel>
          <div>
            <TimeDisplay isoString={item.expiresAt} />
          </div>
        </div>
      </div>
    </div>
  );
}
