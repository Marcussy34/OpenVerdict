import type { Metadata } from "next";

// Route metadata for independent proof verifier.
export const metadata: Metadata = {
  title: "Verify a run",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
