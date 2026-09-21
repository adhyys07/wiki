import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { createAdminPost, getApprovedBySlug } from "../../../lib/db";
import { slugify } from "../../../lib/markdown";
import { sameOrigin } from "../../../lib/auth";

export const prerender = false;

function bad(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!sameOrigin(request, url)) return bad("Bad origin.", 403);

  const form = await request.formData();
  const str = (k: string) => String(form.get(k) ?? "").trim();

  const title = str("title");
  const body = str("body");
  if (title.length < 3) return bad("Title must be at least 3 characters.");
  if (body.length < 20) return bad("The page needs some content.");

  const slug = slugify(str("slug") || title);
  if (!slug) return bad("Could not build a URL from that title.");

  const existing = await getCollection("wiki");
  if (existing.some((p) => p.id === slug))
    return bad(`/wiki/${slug} already exists as a markdown page.`);
  if (await getApprovedBySlug(slug))
    return bad(`/wiki/c/${slug} already exists.`);

  const split = (k: string) =>
    str(k)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);

  const r = await createAdminPost(
    {
      title,
      slug,
      description: str("description"),
      categories: split("categories"),
      tags: split("tags"),
      body,
    },
    locals.adminUser ?? "admin",
  );

  return r.ok
    ? new Response(JSON.stringify({ ok: true, redirect: `/wiki/c/${slug}` }), {
        headers: { "content-type": "application/json" },
      })
    : bad(r.error);
};
