"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { ResolutionEvent } from "@/lib/engine/contract";

export type EventStreamStatus =
  | "connecting"
  | "connected"
  | "delayed"
  | "disconnected"
  | "error";

interface UseClaimEventsReturn {
  events: ResolutionEvent[];
  status: EventStreamStatus;
  isDelayed: boolean;
  lastEventId: number | null;
  error: string | null;
  reconnect: () => void;
}

const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds before marking delayed per PRD §34.3

/**
 * Client hook: EventSource wrapper for the live one-way resolution event stream.
 * Features Last-Event-ID resume cursor, automatic heartbeat watchdog, and "Delayed observer data" detection.
 */
export function useClaimEvents(claimId: string | null | undefined): UseClaimEventsReturn {
  const [events, setEvents] = useState<ResolutionEvent[]>([]);
  const [status, setStatus] = useState<EventStreamStatus>(() => (claimId ? "connecting" : "disconnected"));
  const [lastEventId, setLastEventId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lastHeartbeatRef = useRef<number>(0);
  const heartbeatWatchdogRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectRef = useRef<() => void>(() => {});

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (heartbeatWatchdogRef.current) {
      clearInterval(heartbeatWatchdogRef.current);
      heartbeatWatchdogRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!claimId) {
      return;
    }

    cleanup();
    lastHeartbeatRef.current = Date.now();

    // Construct stream URL with optional cursor
    let url = `/api/claims/${encodeURIComponent(claimId)}/events`;
    if (lastEventId !== null) {
      url += `?from=${lastEventId + 1}`;
    }

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStatus("connected");
        setError(null);
        lastHeartbeatRef.current = Date.now();
      };

      // Process standard events and specific message events
      es.onmessage = (e) => {
        lastHeartbeatRef.current = Date.now();
        setStatus("connected");

        try {
          if (!e.data || e.data.trim() === "" || e.data === ": heartbeat") return;
          const parsedEvent: ResolutionEvent = JSON.parse(e.data);

          setEvents((prev) => {
            // Deduplicate by sequence/eventId
            if (prev.some((ev) => ev.sequence === parsedEvent.sequence || ev.eventId === parsedEvent.eventId)) {
              return prev;
            }
            const updated = [...prev, parsedEvent].sort((a, b) => a.sequence - b.sequence);
            return updated;
          });

          if (parsedEvent.sequence !== undefined) {
            setLastEventId(parsedEvent.sequence);
          }
        } catch {
          // Ignore parse errors on comments/heartbeats
        }
      };

      es.onerror = () => {
        // SSE network failure or 503 from backend
        setStatus("delayed");
        setError("Delayed observer data — reconnecting stream...");
        es.close();

        // Attempt exponential-style reconnect after 3s
        retryTimeoutRef.current = setTimeout(() => {
          connectRef.current();
        }, 3_000);
      };

      // Heartbeat watchdog: if no event or ping for 30s, trigger "delayed" state
      heartbeatWatchdogRef.current = setInterval(() => {
        const timeSinceLastMessage = Date.now() - lastHeartbeatRef.current;
        if (lastHeartbeatRef.current > 0 && timeSinceLastMessage > HEARTBEAT_TIMEOUT_MS) {
          setStatus("delayed");
        }
      }, 5_000);
    } catch {
      setTimeout(() => {
        setStatus("error");
        setError("Failed to establish event stream");
      }, 0);
    }
  }, [claimId, lastEventId, cleanup]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      cleanup();
    };
  }, [claimId, connect, cleanup]);

  const handleManualReconnect = useCallback(() => {
    setStatus("connecting");
    connect();
  }, [connect]);

  return {
    events,
    status,
    isDelayed: status === "delayed",
    lastEventId,
    error,
    reconnect: handleManualReconnect,
  };
}
