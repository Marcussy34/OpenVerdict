import type { Metadata } from "next";
import "./globals.css";
import { Archivo, Archivo_Narrow, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WalletProviders } from "@/components/wallet/providers";

// Archivo carries every heading and paragraph; the big display sizes run at 400.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-sans" });
// Archivo Narrow carries every uppercase micro-label: eyebrows, chips, buttons.
const archivoNarrow = Archivo_Narrow({ subsets: ["latin"], variable: "--font-narrow" });
// Mono carries every hash, object id, digest, bps value and score in the UI.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "OpenVerdict",
  description:
    "Decentralized intelligence verification engine — GonkaRouter AI juries coordinated and settled on Sui, evidence preserved on Walrus.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Light is the demo theme; every token lives in globals.css :root.
    <html
      lang="en"
      className={cn(
        "font-sans",
        archivo.variable,
        archivoNarrow.variable,
        geistMono.variable,
      )}
      suppressHydrationWarning
    >
      <body className="antialiased min-h-screen flex flex-col bg-background">
        {/* Ambient shell: a fine engineering grid under one soft Sui-blue wash. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="ov-grid absolute inset-0" />
          <div className="ov-glow absolute inset-0" />
        </div>

        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          Skip to content
        </a>

        <WalletProviders>
          <div className="relative z-10 flex min-h-screen flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
        </WalletProviders>
      </body>
    </html>
  );
}
