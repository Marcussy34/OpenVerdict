import type { Metadata } from "next";

// Route metadata for the fact-check submission portal.
export const metadata: Metadata = {
  title: "Fact-check",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
