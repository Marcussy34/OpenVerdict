import type { Metadata } from "next";

// Route metadata for claims explorer.
export const metadata: Metadata = {
  title: "Claims",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
