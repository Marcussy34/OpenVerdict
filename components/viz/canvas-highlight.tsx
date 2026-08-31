"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

type CanvasHighlight = {
  /** Light the canvas branch under this node id; null clears it. */
  highlight: (nodeId: string | null) => void;
};

const CanvasHighlightContext = createContext<CanvasHighlight>({
  highlight: () => {},
});

/**
 * No-op outside a canvas page, so the shared proof components can call it
 * unconditionally and stay portable to the report and audit pages.
 */
export function useCanvasHighlight(): CanvasHighlight {
  return useContext(CanvasHighlightContext);
}

export function CanvasHighlightProvider({
  onHighlight,
  children,
}: {
  onHighlight: (nodeId: string | null) => void;
  children: ReactNode;
}) {
  const value = useMemo<CanvasHighlight>(
    () => ({ highlight: onHighlight }),
    [onHighlight],
  );
  return (
    <CanvasHighlightContext.Provider value={value}>
      {children}
    </CanvasHighlightContext.Provider>
  );
}
