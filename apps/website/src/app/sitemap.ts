import { MetadataRoute } from "next";
import { ARTICLES } from "@/lib/articles";
import { DEMOS } from "@/lib/demos";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://berightback.xyz";

  const articles = ARTICLES.map((a) => ({
    url: `${base}/how-its-built/${a.slug}`,
    lastModified: new Date(),
  }));

  const playgrounds = DEMOS.map((d) => ({
    url: `${base}/playground/${d.slug}`,
    lastModified: new Date(),
  }));

  return [
    { url: base, lastModified: new Date() },
    { url: `${base}/download`, lastModified: new Date() },
    { url: `${base}/privacy`, lastModified: new Date() },
    { url: `${base}/how-its-built`, lastModified: new Date() },
    { url: `${base}/playground`, lastModified: new Date() },
    ...articles,
    ...playgrounds,
  ];
}
