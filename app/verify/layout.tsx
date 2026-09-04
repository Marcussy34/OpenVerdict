import type { Metadata } from "next";

// Route metadata for independent proof verifier.
export const metadata: Metadata = {
  title: "Audit a verdict",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
