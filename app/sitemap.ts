import type { MetadataRoute } from "next";
import { loadDocNav } from "@/lib/docs/pages";
import { SITE_URL, APP_URL, DOCS_URL } from "@/lib/web/site-urls";

// Static sitemap covering the landing site, console routes and the docs.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The docs list is read from docs/site, so a new page is listed by adding it.
  const docsOrigin = DOCS_URL.startsWith("http")
    ? DOCS_URL
    : `${SITE_URL}${DOCS_URL}`;
  const docs = (await loadDocNav()).map((page) => ({
    url: page.slug ? `${docsOrigin}/${page.slug}` : `${docsOrigin}/`,
  }));

  return [
    {
      url: `${SITE_URL}/`,
      priority: 1,
    },
    {
      url: `${SITE_URL}/learn`,
    },
    {
      url: `${SITE_URL}/privacy`,
    },
    {
      url: `${SITE_URL}/terms`,
    },
    {
      url: `${SITE_URL}/risk`,
    },
    {
      url: `${APP_URL}/`,
    },
    {
      url: `${APP_URL}/claims`,
    },
    {
      url: `${APP_URL}/agents`,
    },
    {
      url: `${APP_URL}/verify`,
    },
    {
      url: `${APP_URL}/status`,
    },
    {
      url: `${APP_URL}/fact-check`,
    },
    ...docs,
  ];
}
