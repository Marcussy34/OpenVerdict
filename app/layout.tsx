import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WalletProviders } from "@/components/wallet/providers";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "OpenVerdict",
  description:
    "Decentralized intelligence verification engine — GonkaRouter AI juries coordinated and settled on Sui, evidence preserved on Walrus.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className="antialiased min-h-screen flex flex-col">
        <WalletProviders>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </WalletProviders>
      </body>
    </html>
  );
}
