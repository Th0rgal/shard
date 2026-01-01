import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://shard.thomas.md";

  // Static pages
  const staticPages = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 1,
    },
  ];

  // Documentation pages
  const docPages = [
    "/docs",
    "/docs/getting-started",
    "/docs/getting-started/first-profile",
    "/docs/getting-started/accounts",
    "/docs/concepts",
    "/docs/concepts/profiles",
    "/docs/concepts/content-store",
    "/docs/concepts/instances",
    "/docs/cli",
    "/docs/building",
    "/docs/building/development",
    "/docs/building/contributing",
    "/docs/faq",
  ].map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...docPages];
}
