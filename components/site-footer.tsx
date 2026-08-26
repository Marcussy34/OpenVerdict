import Link from "next/link";
import { Judge, InfoCircle } from "iconsax-react";

export function SiteFooter() {
  return (
    <footer className="w-full border-t border-border/80 bg-muted/30 text-muted-foreground py-10 px-4 sm:px-6 lg:px-8 mt-auto">
      <div className="container mx-auto max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-8 border-b border-border/60">
          {/* Column 1: Brand & Purpose */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2 text-foreground font-bold text-base">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Judge size="16" variant="Bold" />
              </div>
              <span>OpenVerdict</span>
            </div>
            <p className="text-sm leading-relaxed max-w-md">
              Decentralized intelligence verification engine coordinating diverse GonkaRouter AI juries on Sui, with cryptographic commit-reveal and permanent evidence storage on Walrus.
            </p>
            <div className="flex items-start gap-2 pt-1 text-xs text-muted-foreground/90 bg-muted/60 p-2.5 rounded-md border border-border/50 max-w-md">
              <InfoCircle size="16" variant="Bold" className="shrink-0 text-foreground mt-0.5" />
              <span>
                <strong>Engine-first architecture:</strong> This frontend dashboard is a strict, read-only projection of authoritative on-chain Move objects, Walrus blobs, and public resolution events.
              </span>
            </div>
          </div>

          {/* Column 2: Protocol & Exploration */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Protocol
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/fact-check" className="hover:text-foreground transition-colors">
                  Direct Fact-Check
                </Link>
              </li>
              <li>
                <Link href="/claims" className="hover:text-foreground transition-colors">
                  Claims Directory
                </Link>
              </li>
              <li>
                <Link href="/agents" className="hover:text-foreground transition-colors">
                  Agent Directory
                </Link>
              </li>
              <li>
                <Link href="/verify" className="hover:text-foreground transition-colors">
                  Independent Verifier
                </Link>
              </li>
              <li>
                <Link href="/status" className="hover:text-foreground transition-colors">
                  System Status
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Documentation & Legal */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Transparency
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/learn" className="hover:text-foreground transition-colors">
                  How It Works (Learn)
                </Link>
              </li>
              <li>
                <Link href="/risk" className="hover:text-foreground transition-colors">
                  Risk Disclosure
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-foreground transition-colors">
                  Terms of Use
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-foreground transition-colors">
                  Privacy Notice
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright and disclaimer */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>
            © 2026 Marcussy34 and OpenVerdict contributors. Released under the{" "}
            <span className="font-medium text-foreground">MIT License</span>.
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            <span>Experimental Software — Capped Demo Funds — Unaudited Move Contracts</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
