import type { Metadata } from "next";

// Route metadata for the claim verification portal (route stays /fact-check).
export const metadata: Metadata = {
  title: "Verify a claim",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
