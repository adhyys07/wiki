import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { createSubmission, getApprovedBySlug } from "../../lib/db";
import { slugify } from "../../lib/markdown";
import { sameOrigin } from "../../lib/auth";

export const prerender = false;

const LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();

/** Per-process only - a second dyno gets its own independent limit. */
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

function bad(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request, clientAddress, url }) => {
  if (!sameOrigin(request, url)) return bad("Bad origin.", 403);
  if (rateLimited(clientAddress)) {
    return bad("Too many submissions. Try again in a few minutes.", 429);
  }

  const form = await request.formData();
  const str = (k: string) => String(form.get(k) ?? "").trim();

  // honeypot - real users never fill this
  if (str("website")) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  const title = str("title");
  const body = str("body");
  const description = str("description");

  if (title.length < 3 || title.length > 120)
    return bad("Title must be 3-120 characters.");
  if (description.length > 300)
    return bad("Description must be under 300 characters.");
  if (body.length < 50) return bad("The page needs at least 50 characters.");
  if (body.length > 50_000)
    return bad("That page is too long (50,000 character limit).");

  const slug = slugify(str("slug") || title);
  if (!slug) return bad("Could not build a URL from that title.");

  const existing = await getCollection("wiki");
  if (existing.some((p) => p.id === slug)) {
    return bad(`/wiki/${slug} already exists. Edit that page instead.`);
  }
  if (await getApprovedBySlug(slug)) {
    return bad(`/wiki/c/${slug} already exists. Pick a different title.`);
  }

  const split = (k: string) =>
    str(k)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);

  const id = await createSubmission({
    title,
    slug,
    description,
    categories: split("categories"),
    tags: split("tags"),
    body,
    author_name: str("author_name").slice(0, 80),
    author_contact: str("author_contact").slice(0, 160),
  });

  return new Response(JSON.stringify({ ok: true, id, slug }), {
    headers: { "content-type": "application/json" },
  });
};
