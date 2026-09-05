import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Archivo, Archivo_Narrow, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/site-header";
import { LandingFooter } from "@/components/landing/footer";
import { ChromeVisibility } from "@/components/chrome-visibility";
import { WalletProviders } from "@/components/wallet/providers";

import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/web/site-urls";
import { isDocsHost, rewritePathForHost } from "@/lib/web/host-routing";

// Archivo carries every heading and paragraph; the big display sizes run at 400.
const archivo = Archivo({ subsets: ["latin"], variable: "--font-sans" });
// Archivo Narrow carries every uppercase micro-label: eyebrows, chips, buttons.
const archivoNarrow = Archivo_Narrow({ subsets: ["latin"], variable: "--font-narrow" });
// Mono carries every hash, object id, digest, bps value and score in the UI.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // On the app host the root path is the console, not the landing; the header
  // needs to know because the browser URL is "/" on both hosts.
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const consoleHost = rewritePathForHost(host, "/") !== null;
  // On the docs host every path is a documentation path, so the header and the
  // footer both have to name the app origin outright in their console links.
  const docsHost = isDocsHost(host);
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
            <ChromeVisibility>
              <SiteHeader consoleHost={consoleHost} docsHost={docsHost} />
            </ChromeVisibility>
            {/* The 72vh floor used to include main's 5rem of bottom padding;
                the spacer below carries that 5rem now, so the floor drops by
                it and every short page keeps the height it had. */}
            <main id="main" className="flex-1 min-h-[calc(72vh-5rem)]">
              {children}
            </main>
            {/* One footer for the whole product — the landing's deep-blue
                close, on every route. The 5rem of air above it was main's
                bottom padding; it belongs to the chrome, so the canvas claim
                route (which drops the chrome) is exactly one viewport tall
                and never scrolls. */}
            <ChromeVisibility>
              <div aria-hidden className="h-20 shrink-0" />
              <LandingFooter docsHost={docsHost} />
            </ChromeVisibility>
          </div>
        </WalletProviders>
      </body>
    </html>
  );
}
