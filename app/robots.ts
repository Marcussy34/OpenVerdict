import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/web/site-urls";

// Static robots.txt policy for search crawlers.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
