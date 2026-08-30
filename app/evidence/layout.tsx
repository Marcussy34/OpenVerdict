import type { Metadata } from "next";

// Route metadata for evidence artifact views.
export const metadata: Metadata = {
  title: "Evidence",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
