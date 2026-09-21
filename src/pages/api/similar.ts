import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { listApprovedForMatching } from "../../lib/db";
import { findSimilar, type Candidate } from "../../lib/similarity";

export const prerender = false;

export async function candidates(): Promise<Candidate[]> {
  const pages = await getCollection("wiki");
  const fromCollection: Candidate[] = pages.map((p) => ({
    slug: p.id,
    title: p.data.title,
    description: p.data.description,
    href: `/wiki/${p.id}`,
    source: "page",
  }));

  let fromDb: Candidate[] = [];
  try {
    fromDb = (await listApprovedForMatching()).map((r) => ({
      slug: r.slug,
      title: r.title,
      description: r.description,
      href: `/wiki/c/${r.slug}`,
      source: "community",
    }));
  } catch {
    // Duplicate hints are a convenience; never fail the page over them.
  }

  return [...fromCollection, ...fromDb];
}

export const POST: APIRoute = async ({ request }) => {
  const { title = "", description = "" } = await request
    .json()
    .catch(() => ({}));

  const matches = findSimilar(
    String(title).slice(0, 200),
    String(description).slice(0, 400),
    await candidates(),
  );

  return new Response(JSON.stringify({ matches }), {
    headers: { "content-type": "application/json" },
  });
};
