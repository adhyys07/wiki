import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  const base = (site?.origin ?? "https://wiki.hackclub.com").replace(/\/$/, "");
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /contribute/

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
