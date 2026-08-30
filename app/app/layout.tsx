import type { Metadata } from "next";

// Route metadata for the console dashboard.
export const metadata: Metadata = {
  title: "Console",
  description: "Submit a claim, follow a jury and read the certificate.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
