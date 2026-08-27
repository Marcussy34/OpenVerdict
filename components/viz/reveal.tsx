"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Entrance choreography. Content rises + fades once as it approaches the
 * viewport, staggered by `delay`, and snaps straight to its resting state under
 * reduced-motion. The positive viewport margin pre-triggers the animation just
 * below the fold so fast scrolling never reveals an empty section.
 */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
  once = true,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  once?: boolean;
  as?: "div" | "section" | "li";
}) {
  const reduce = useReducedMotion();
  const Comp = motion[as];

  return (
    <Comp
      className={className}
      // The reduced-motion branch lives in the TRANSITION, never in `initial`:
      // `useReducedMotion()` is null on the server and true on the client's
      // first render, so branching on the rendered style hydrates mismatched.
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "0px 0px 20% 0px" }}
      transition={{
        duration: reduce ? 0 : 0.55,
        delay: reduce ? 0 : delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </Comp>
  );
}

/** Grid/list wrapper that staggers each direct `Reveal` child by index. */
export function Stagger({
  children,
  className,
  itemClassName,
  step = 0.06,
  start = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Applied to each generated wrapper — pass `h-full` inside stretch grids. */
  itemClassName?: string;
  step?: number;
  start?: number;
}) {
  return (
    <div className={cn(className)}>
      {React.Children.map(children, (child, i) =>
        React.isValidElement(child) ? (
          <Reveal delay={start + i * step} className={itemClassName}>
            {child}
          </Reveal>
        ) : (
          child
        ),
      )}
    </div>
  );
}
