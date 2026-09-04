// Canonical origin URLs for the landing page and the console app.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://openverdict.info").replace(/\/$/, "");
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || `${SITE_URL}/app`).replace(/\/$/, "");
// Where the technical documentation lives. Its own host when
// NEXT_PUBLIC_DOCS_URL names one, otherwise in-app at /docs; both forms work
// as a link target, so nothing else has to know which deployment this is.
export const DOCS_URL = (process.env.NEXT_PUBLIC_DOCS_URL || "").replace(/\/$/, "") || "/docs";

/** A link to one documentation page: docsHref("api") or docsHref() for the index. */
export function docsHref(slug?: string): string {
  return slug ? `${DOCS_URL}/${slug}` : DOCS_URL;
}

// Brand and default metadata strings.
export const SITE_NAME = "OpenVerdict";
export const SITE_DESCRIPTION = "An adversarial AI jury protocol for factual disputes: juror seats from three model families on GonkaRouter, sealed ballots and cross-examination coordinated and settled on Sui, evidence preserved on Walrus.";
