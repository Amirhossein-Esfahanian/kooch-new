import type { MetadataRoute } from "next";
import { publicFrontendOrigin } from "@/lib/public-booking-url";

export default function robots(): MetadataRoute.Robots {
  const origin = publicFrontendOrigin(process.env.NEXT_PUBLIC_KOOCH_PUBLIC_ORIGIN);
  return {
    rules: {
      userAgent: "*", allow: "/",
      // Crawl guidance only; existing authentication remains the access boundary.
      disallow: ["/admin", "/owner", "/account", "/booking/", "/api/", "/login", "/management-login", "/choose-workspace", "/set-password", "/dev/"],
    },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
