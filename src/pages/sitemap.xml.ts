import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { listApproved } from "../lib/db";
import { getCategories, categorySlug } from "../lib/getCategories";

// Server-rendered on purpose: @astrojs/sitemap only enumerates pages that
// exist at build time, which would omit every approved community page.
export const prerender = false;

const SITE = "https://wiki.hackclub.com";

interface Entry {
  loc: string;
  lastmod?: string;
  priority: string;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.origin ?? SITE).replace(/\/$/, "");
  const entries: Entry[] = [{ loc: `${base}/`, priority: "1.0" }];

  const pages = await getCollection("wiki");
  for (const p of pages) {
    entries.push({
      loc: `${base}/wiki/${p.id}`,
      lastmod: p.data.lastEdited,
      priority: "0.8",
    });
  }

  for (const cat of Object.keys(getCategories(pages))) {
    entries.push({
      loc: `${base}/category/${categorySlug(cat)}`,
      priority: "0.5",
    });
  }

  for (const path of [
    "/special/all-pages",
    "/special/categories",
    "/special/recent-changes",
    "/contribute",
    "/starred",
  ]) {
    entries.push({ loc: `${base}${path}`, priority: "0.5" });
  }

  // Community pages exist only in the database; a build-time sitemap misses them.
  try {
    for (const row of await listApproved()) {
      entries.push({
        loc: `${base}/wiki/c/${row.slug}`,
        lastmod: row.reviewed_at?.toISOString(),
        priority: row.starred ? "0.8" : "0.6",
      });
    }
  } catch {
    // A database outage should degrade the sitemap, not break it.
  }

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${xmlEscape(e.loc)}</loc>` +
          (e.lastmod ? `<lastmod>${xmlEscape(e.lastmod)}</lastmod>` : "") +
          `<priority>${e.priority}</priority></url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
