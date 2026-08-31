"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DeliberationGraph } from "@/lib/viz/deliberation-graph";
import { graphSpan, visibleAt } from "@/lib/viz/replay";

type ReplaySpeed = 1 | 10 | 30;

function clampTime(value: number, startMs: number, endMs: number): number {
  return Math.min(endMs, Math.max(startMs, value));
}

export function useReplay(
  graph: DeliberationGraph,
  terminal: boolean,
): {
  active: boolean;
  playing: boolean;
  t: number;
  startMs: number;
  endMs: number;
  speed: ReplaySpeed;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
  visible: DeliberationGraph;
} {
  const { startMs, endMs } = useMemo(() => graphSpan(graph), [graph]);
  const [activeState, setActive] = useState(false);
  const [playingState, setPlaying] = useState(false);
  const [tState, setT] = useState(startMs);
  const [speed, setSpeedState] = useState<ReplaySpeed>(10);
  const timeRef = useRef(startMs);

  // Everything the consumer sees is derived, so a terminal flip or a graph
  // change needs no state-writing effect (React Compiler rules): a replay is
  // only ever active on a terminal claim, only playing inside a real span,
  // and t is always clamped to the current span.
  const active = activeState && terminal;
  const playing = playingState && active && startMs < endMs;
  const t = active ? clampTime(tState, startMs, endMs) : startMs;

  const start = useCallback((): void => {
    if (!terminal) return;
    timeRef.current = startMs;
    setT(startMs);
    setActive(true);
    setPlaying(startMs < endMs);
  }, [endMs, startMs, terminal]);

  const stop = useCallback((): void => {
    setPlaying(false);
    setActive(false);
  }, []);

  const toggle = useCallback((): void => {
    if (!terminal) return;
    if (!active) {
      start();
      return;
    }
    if (playing) {
      setPlaying(false);
      return;
    }

    if (timeRef.current >= endMs) {
      timeRef.current = startMs;
      setT(startMs);
    }
    setPlaying(startMs < endMs);
  }, [active, endMs, playing, start, startMs, terminal]);

  const seek = useCallback((time: number): void => {
    if (!terminal) return;
    const next = clampTime(time, startMs, endMs);
    timeRef.current = next;
    setT(next);
    setActive(true);
    if (next >= endMs) setPlaying(false);
  }, [endMs, startMs, terminal]);

  const setSpeed = useCallback((nextSpeed: ReplaySpeed): void => {
    setSpeedState(nextSpeed);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    let previousTime: number | undefined;

    // RAF timestamps keep replay progress independent of display refresh rate.
    const advance = (time: number): void => {
      if (previousTime === undefined) {
        previousTime = time;
        frameId = requestAnimationFrame(advance);
        return;
      }

      const wallDelta = Math.max(0, time - previousTime);
      previousTime = time;
      const next = Math.min(endMs, timeRef.current + wallDelta * speed);
      timeRef.current = next;
      setT(next);

      if (next >= endMs) {
        setPlaying(false);
        return;
      }
      frameId = requestAnimationFrame(advance);
    };

    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [endMs, playing, speed]);

  const visible = useMemo(
    () => active ? visibleAt(graph, t) : graph,
    [active, graph, t],
  );

  return {
    active,
    playing,
    t,
    startMs,
    endMs,
    speed,
    start,
    stop,
    toggle,
    seek,
    setSpeed,
    visible,
  };
}
