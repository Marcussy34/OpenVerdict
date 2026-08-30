import type { Metadata } from "next";

// Route metadata for juror agents registry.
export const metadata: Metadata = {
  title: "Agents",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
