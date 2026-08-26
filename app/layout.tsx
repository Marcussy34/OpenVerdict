import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenVerdict",
  description:
    "Decentralized intelligence verification engine — GonkaRouter AI juries coordinated and settled on Sui, evidence preserved on Walrus.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
