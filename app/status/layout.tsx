import type { Metadata } from "next";

// Route metadata for engine and contract status.
export const metadata: Metadata = {
  title: "Status",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
