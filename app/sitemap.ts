import type { MetadataRoute } from "next";
import { SITE_URL, APP_URL } from "@/lib/web/site-urls";

// Static sitemap covering the landing site and console application routes.
export default function sitemap(): MetadataRoute.Sitemap {
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
  ];
}
