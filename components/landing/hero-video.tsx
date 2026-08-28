"use client";

import * as React from "react";
import Image from "next/image";
import { useReducedMotion } from "motion/react";

const POSTER = "/media/landing/openverdict-core-poster.jpg";
const subscribeToHydration = () => () => {};

/** Server HTML stays static; the client opts into video after hydration. */
function useHydrated() {
  return React.useSyncExternalStore(subscribeToHydration, () => true, () => false);
}

/**
 * Decorative hero media with a real loading, reduced-motion, and codec fallback.
 * The poster always owns first paint; motion is added only after hydration.
 */
export function HeroVideo() {
  const reduceMotion = useReducedMotion() ?? false;
  const mounted = useHydrated();
  const stageRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [ready, setReady] = React.useState(false);

  // The hero can remain mounted during the dock transition. Pause its decoder
  // once the whole stage leaves view instead of burning cycles in the background.
  React.useEffect(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video || reduceMotion) return;

    if (typeof IntersectionObserver === "undefined") {
      void video.play().catch(() => {});
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { rootMargin: "200px" },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    <div ref={stageRef} aria-hidden="true" className="absolute inset-0 isolate overflow-hidden">
      <Image
        src={POSTER}
        alt=""
        fill
        sizes="100vw"
        preload
        className="object-cover object-[72%_50%]"
      />

      {mounted && !reduceMotion && (
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          poster={POSTER}
          onCanPlay={() => setReady(true)}
          className={`absolute inset-0 size-full object-cover object-[72%_50%] motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-out ${ready ? "opacity-100" : "opacity-0"}`}
        >
          <source src="/media/landing/openverdict-core.webm" type="video/webm" />
          <source src="/media/landing/openverdict-core.mp4" type="video/mp4" />
        </video>
      )}

      {/* Preserve the reference's copy-safe left field and ground-row contrast. */}
      <div className="absolute inset-0 bg-gradient-to-r from-night via-night/80 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-night/80 via-transparent to-night/20" />
    </div>
  );
}
