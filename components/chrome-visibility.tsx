"use client";

import { usePathname } from "next/navigation";

// The canvas claim page (/claims/<id>, and nothing deeper) is a full-viewport
// stage: the global header and footer stay out of its way (owner request,
// 2026-08-31). Every other route keeps the normal chrome.
const CANVAS_ROUTE = /^\/claims\/[^/]+\/?$/;

export function ChromeVisibility({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (CANVAS_ROUTE.test(pathname)) return null;
  return <>{children}</>;
}
