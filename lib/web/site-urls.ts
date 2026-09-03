// Canonical origin URLs for the landing page and the console app.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://openverdict.info").replace(/\/$/, "");
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || `${SITE_URL}/app`).replace(/\/$/, "");

// Brand and default metadata strings.
export const SITE_NAME = "OpenVerdict";
export const SITE_DESCRIPTION = "An adversarial AI jury protocol for factual disputes: juror seats from three model families on GonkaRouter, sealed ballots and cross-examination coordinated and settled on Sui, evidence preserved on Walrus.";
